// Chat actions (plan section 17): one message becomes one ChatAction. The
// agent gets the profile, the last 20 messages as text, the shorts list and
// word windows; code checks the action and turns it into versions or text.
import { LENGTH_LIMITS, profileText } from "@alcyo/profile";
import {
  ChatAction,
  type Message,
  type Segment,
  type Short,
  type ShortRef,
  type ShortVersion,
  type SourceSpan,
  type Word,
  checkChatAction,
  checkShort,
  claudeJsonSchemas,
  normalizeShortTimes,
  shortDuration,
} from "@alcyo/schema";
import { HOOK_MS, LENGTH_SLACK_MS, type PlanInputs, linesFor } from "./find-shorts";
import { mapKeep } from "./id-mapping";
import { clock, lengthRange, promptLines, seconds, streamHeader } from "./lines";
import { type Problem, askChecked } from "./llm/ask";
import type { LlmProvider } from "./llm/provider";
import { snapShort } from "./snapping";

export const HISTORY = 20;
/** Without a reply, word windows go out for this many shorts (the newest). */
export const MAX_WINDOWS = 6;
/** A window reaches this far past each end of a short. */
export const WINDOW_PAD_MS = 20_000;
const HISTORY_CHARS = 500;

export const CHAT_FAILED =
  "The agent's answer didn't fit the checks, twice, so nothing changed. Try again.";

export interface ChatInputs extends PlanInputs {
  /** Each short's head, in project order. */
  shorts: readonly ShortVersion[];
  /** The thread before this message. */
  messages: readonly Message[];
  text: string;
  replyTo?: ShortRef;
}

export interface VersionChange {
  shortId: string;
  short: Short;
  createdBy: "claude" | "user";
  /** Saved on the version, at most 200 characters. */
  note: string;
  /** Posted in the version message, at most 300 characters. */
  whatChanged: string;
}

export type ChatResult =
  | { kind: "versions"; changes: VersionChange[] }
  | { kind: "new_shorts"; request: string; count: number }
  | { kind: "answer"; text: string }
  | { kind: "clarify"; text: string };

interface Window {
  shortId: string;
  words: Word[];
  ids: Set<string>;
}

const isKept = (segments: readonly Segment[], w: Word) => {
  const mid = (w.startMs + w.endMs) / 2;
  return segments.some((s) => mid >= s.srcIn && mid < s.srcOut);
};

function windowFor(inputs: ChatInputs, v: ShortVersion): Window {
  const from = Math.max(0, v.short.segments[0]!.srcIn - WINDOW_PAD_MS);
  const to = Math.min(inputs.sourceDurationMs, v.short.segments.at(-1)!.srcOut + WINDOW_PAD_MS);
  const words = inputs.transcript.words.filter((w) => w.startMs < to && w.endMs > from);
  return { shortId: v.shortId, words, ids: new Set(words.map((w) => w.id)) };
}

/** The shorts whose words are sent: the reply target, or the newest few. */
export function windowShorts(inputs: ChatInputs): ShortVersion[] {
  if (inputs.replyTo !== undefined) {
    const target = inputs.shorts.find((s) => s.shortId === inputs.replyTo!.shortId);
    return target === undefined ? [] : [target];
  }
  return inputs.shorts.slice(-MAX_WINDOWS);
}

function formatWindow(inputs: ChatInputs, v: ShortVersion, w: Window): string[] {
  const byId = new Map(w.words.map((x) => [x.id, x]));
  const out = [`## Words of ${v.shortId}. Words in parentheses are cut from its current version.`];
  for (const line of inputs.transcript.lines) {
    const words = line.wordIds.map((id) => byId.get(id)).filter((x) => x !== undefined);
    if (words.length === 0) continue;
    const tokens = words.map((x) => {
      const t = `${x.id}:${x.text.trim()}`;
      return isKept(v.short.segments, x) ? t : `(${t})`;
    });
    out.push(`${line.id} ${tokens.join(" ")}`);
  }
  return out;
}

function messageText(m: Message, titles: ReadonlyMap<string, string>): string | null {
  const who = m.author === "user" ? "Creator" : m.author === "claude" ? "You" : "App";
  const b = m.body;
  const cut = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, HISTORY_CHARS);
  switch (b.kind) {
    case "text": {
      const re = m.replyTo === undefined ? "" : ` (replying to ${m.replyTo.shortId})`;
      return `${who}${re}: ${cut(b.text)}`;
    }
    case "shorts":
      return `${who}: proposed ${b.shorts.map((r) => `${r.shortId} "${titles.get(r.shortId) ?? "a short"}"`).join(", ")}`;
    case "version":
      return `${who}: saved ${b.ref.shortId} v${b.ref.version}: ${cut(b.whatChanged)}`;
    case "question":
      return `${who} asked: ${cut(b.text)}`;
    case "clips":
      return "App: viewer clips were added.";
    case "status":
    case "render":
      return null;
  }
}

/** The instruction and input for one chat message. */
export function chatRequest(inputs: ChatInputs): { instruction: string; input: string } {
  const lines = promptLines(inputs.transcript, inputs.clips);
  const captions = inputs.presets.captionPresets.map((p) => `${p.id} "${p.name}"`).join(", ");
  const hooks = inputs.presets.hookPresets.map((p) => `${p.id} "${p.name}"`).join(", ");
  const reply = inputs.replyTo;
  const instruction = [
    "You help a streamer edit vertical shorts made from their stream, in a chat. Read their message and answer with exactly one action as JSON. You only read text; code makes every change and checks it.",
    `Actions:
- revise_short: change what one short keeps, and its title and hook. keep lists {fromWord, toWord} ranges of word ids from that short's words below, in order; words outside the ranges are cut. whatChanged says what you changed, in a few plain words.
- retime_short: move one short's start or end. startWord is the new first word, endWord the new last word, from that short's words below.
- set_style: change the caption look or hook look, for one short (scope "short" with shortId) or all of them (scope "all"). Use only ids under Caption looks and Hook looks.
- new_shorts: find more shorts. request says what the creator wants, in their words; count is how many, 1 to 5.
- answer: a question about the shorts or the stream. Reply in plain text; nothing changes.
- clarify: the message is unclear. Ask one short question back.`,
    reply === undefined
      ? "The creator isn't replying to a card. If they mean one short, name it by its id from the list."
      : `The creator is replying to ${reply.shortId}. Any change is to that short.`,
    `Use only short ids from the list and word ids from the words below. A changed short stays ${seconds(lengthRange(inputs.profile).min).replace(" s", "")} to ${seconds(lengthRange(inputs.profile).max)} long, the creator's usual length, unless they ask for another length (5 s to 3 min). Never return times.`,
  ].join("\n\n");

  const titles = new Map(inputs.shorts.map((s) => [s.shortId, s.short.title]));
  const parts = [profileText(inputs.profile), "", streamHeader(inputs.stream), "# Shorts"];
  if (inputs.shorts.length === 0) parts.push("No shorts yet.");
  for (const v of inputs.shorts) {
    const span = { startMs: v.short.segments[0]!.srcIn, endMs: v.short.segments.at(-1)!.srcOut };
    const hook = v.short.hook === undefined ? "" : ` Hook: "${v.short.hook.text}".`;
    parts.push(
      `${v.shortId} v${v.version} "${v.short.title}". ${clock(span.startMs)} to ${clock(span.endMs)} (${seconds(shortDuration(v.short.segments))}), lines ${linesFor(lines, span)}.${hook} Captions: ${v.short.captions.presetId}.`,
    );
  }
  parts.push(`# Caption looks: ${captions}`, `# Hook looks: ${hooks}`);
  const history = inputs.messages
    .map((m) => messageText(m, titles))
    .filter((x) => x !== null)
    .slice(-HISTORY);
  if (history.length > 0) parts.push("# Recent messages, oldest first", ...history);
  for (const v of windowShorts(inputs))
    parts.push(...formatWindow(inputs, v, windowFor(inputs, v)));
  parts.push(
    `# The creator's message${reply === undefined ? "" : ` (replying to ${reply.shortId})`}`,
    inputs.text.trim().slice(0, 4000),
  );
  return { instruction, input: parts.join("\n") };
}

function hookAtStart(old: Short, next: Short, text?: string): Short {
  const dur = shortDuration(next.segments);
  if (old.hook === undefined) return next;
  if (text === undefined && old.hook.start !== 0) return next;
  const length = text === undefined ? old.hook.end - old.hook.start : HOOK_MS;
  return {
    ...next,
    hook: {
      ...old.hook,
      text: text ?? old.hook.text,
      start: 0,
      end: Math.max(1, Math.min(dur, length)),
    },
  };
}

/** True when the message names a length or a time, like "make it 20 s" or "3 seconds earlier". */
export function namesLength(text: string): boolean {
  return /\b\d+(\.\d+)?\s*(s|sec|secs|second|seconds|min|mins|minute|minutes)\b/i.test(text);
}

/**
 * The length a changed short must have: the profile's range (with the same
 * slack as Find shorts), or anything from 5 s to 3 min when the creator named
 * a length. "Make it punchier" must not turn a 40 s short into 6 s.
 */
export function editRange(inputs: ChatInputs): { min: number; max: number } {
  if (namesLength(inputs.text)) return { ...LENGTH_LIMITS };
  const r = lengthRange(inputs.profile);
  return {
    min: Math.max(LENGTH_LIMITS.min, r.min - LENGTH_SLACK_MS),
    max: Math.min(LENGTH_LIMITS.max, r.max + LENGTH_SLACK_MS),
  };
}

function checkLength(short: Short, inputs: ChatInputs): Problem[] {
  const len = shortDuration(short.segments);
  const range = editRange(inputs);
  if (len < range.min || len > range.max) {
    const profile = lengthRange(inputs.profile);
    return [
      {
        path: "keep",
        message: namesLength(inputs.text)
          ? `That short would run ${seconds(len)}. Keep it between ${seconds(LENGTH_LIMITS.min)} and 3 min.`
          : `That short would run ${seconds(len)}. Keep it between ${seconds(profile.min)} and ${seconds(profile.max)}, the creator's usual length, since they didn't ask for another.`,
      },
    ];
  }
  return checkShort(short, { sourceDurationMs: inputs.sourceDurationMs }).map((i) => ({
    path: i.path,
    message: i.message,
  }));
}

function retimed(segments: readonly Segment[], start?: number, end?: number): Segment[] | null {
  let segs = segments.map((s) => ({ ...s }));
  if (start !== undefined) {
    segs = segs.filter((s) => s.srcOut > start);
    if (segs.length === 0) return null;
    segs[0]!.srcIn = start;
  }
  if (end !== undefined) {
    segs = segs.filter((s) => s.srcIn < end);
    if (segs.length === 0) return null;
    segs.at(-1)!.srcOut = end;
  }
  return segs.every((s) => s.srcOut > s.srcIn) ? segs : null;
}

function moved(label: string, before: number, after: number, later: string, earlier: string) {
  const d = after - before;
  if (Math.abs(d) < 100) return null;
  return `${label} ${seconds(Math.abs(d))} ${d > 0 ? later : earlier}`;
}

/** Checks an action and works out what it does. Problems go back to the agent. */
export function applyChatAction(
  action: ChatAction,
  inputs: ChatInputs,
): { result: ChatResult | null; problems: Problem[] } {
  const fail = (problems: Problem[]) => ({ result: null, problems });
  const problems: Problem[] = checkChatAction(action, {
    shortIds: new Set(inputs.shorts.map((s) => s.shortId)),
  });
  if (problems.length > 0) return fail(problems);

  const reply = inputs.replyTo?.shortId;
  const target =
    "shortId" in action && action.shortId !== undefined
      ? inputs.shorts.find((s) => s.shortId === action.shortId)
      : undefined;
  if (reply !== undefined && target !== undefined && target.shortId !== reply) {
    return fail([
      { path: "shortId", message: `The creator replied to ${reply}. Change that short.` },
    ]);
  }
  const sent = new Map(windowShorts(inputs).map((v) => [v.shortId, windowFor(inputs, v)]));
  const opts = { sourceDurationMs: inputs.sourceDurationMs };

  switch (action.action) {
    case "revise_short":
    case "retime_short": {
      const v = target!;
      const w = sent.get(v.shortId);
      if (w === undefined) {
        return fail([
          {
            path: "shortId",
            message: `The words of ${v.shortId} weren't sent. Use clarify to ask the creator to reply to that short's card.`,
          },
        ]);
      }
      const ids =
        action.action === "revise_short"
          ? action.keep.flatMap((k) => [k.fromWord, k.toWord])
          : [action.startWord, action.endWord].filter((x) => x !== undefined);
      const outside = ids.filter((id) => !w.ids.has(id));
      if (outside.length > 0) {
        return fail([
          {
            path: action.action === "revise_short" ? "keep" : "startWord",
            message: `Word ${outside[0]} isn't in the words of ${v.shortId}.`,
          },
        ]);
      }
      const old = v.short;
      if (action.action === "revise_short") {
        const segs = mapKeep(action.keep, inputs.transcript);
        if (!segs.ok) return fail([{ path: "keep", message: segs.reason }]);
        const base = normalizeShortTimes({ ...old, segments: segs.value }, old.segments);
        const snapped = snapShort(base, inputs.silences, opts);
        const short = hookAtStart(
          old,
          { ...snapped, title: action.title.trim() },
          action.hookText.trim(),
        );
        const p = checkLength(short, inputs);
        if (p.length > 0) return fail(p);
        const what = action.whatChanged.trim().slice(0, 300);
        return {
          result: {
            kind: "versions",
            changes: [
              {
                shortId: v.shortId,
                short,
                createdBy: "claude",
                note: what.slice(0, 200),
                whatChanged: what,
              },
            ],
          },
          problems: [],
        };
      }
      const byId = new Map(w.words.map((x) => [x.id, x]));
      const start =
        action.startWord === undefined ? undefined : byId.get(action.startWord)!.startMs;
      const end = action.endWord === undefined ? undefined : byId.get(action.endWord)!.endMs;
      const segs = retimed(old.segments, start, end);
      if (segs === null) {
        return fail([{ path: "endWord", message: "The new end must come after the new start." }]);
      }
      const base = normalizeShortTimes({ ...old, segments: segs }, old.segments);
      const short = hookAtStart(old, snapShort(base, inputs.silences, opts));
      const p = checkLength(short, inputs);
      if (p.length > 0) return fail(p.map((x) => ({ ...x, path: "startWord" })));
      const what =
        [
          moved("Starts", old.segments[0]!.srcIn, short.segments[0]!.srcIn, "later", "earlier"),
          moved(
            "Ends",
            old.segments.at(-1)!.srcOut,
            short.segments.at(-1)!.srcOut,
            "later",
            "earlier",
          ),
        ]
          .filter((x) => x !== null)
          .join(", ") || "Kept the same start and end";
      return {
        result: {
          kind: "versions",
          changes: [
            {
              shortId: v.shortId,
              short,
              createdBy: "claude",
              note: `${what}.`,
              whatChanged: `${what}.`,
            },
          ],
        },
        problems: [],
      };
    }
    case "set_style": {
      const caption =
        action.captionPresetId === undefined
          ? undefined
          : inputs.presets.captionPresets.find((p) => p.id === action.captionPresetId);
      const hook =
        action.hookPresetId === undefined
          ? undefined
          : inputs.presets.hookPresets.find((p) => p.id === action.hookPresetId);
      if (action.captionPresetId !== undefined && caption === undefined) {
        return fail([
          {
            path: "captionPresetId",
            message: `There's no caption look ${action.captionPresetId}.`,
          },
        ]);
      }
      if (action.hookPresetId !== undefined && hook === undefined) {
        return fail([
          { path: "hookPresetId", message: `There's no hook look ${action.hookPresetId}.` },
        ]);
      }
      const targets = action.scope === "all" ? inputs.shorts : [target!];
      if (targets.length === 0) {
        return fail([
          { path: "scope", message: "There are no shorts yet. Use answer or new_shorts." },
        ]);
      }
      const what = [
        caption === undefined ? null : `Captions: ${caption.name}`,
        hook === undefined ? null : `Hook: ${hook.name}`,
      ]
        .filter((x) => x !== null)
        .join(". ");
      const changes = targets.map((v) => {
        const s = v.short;
        const short: Short = {
          ...s,
          captions:
            caption === undefined
              ? s.captions
              : { ...s.captions, presetId: caption.id, wordsPerLine: caption.wordsPerLine },
          ...(s.hook === undefined
            ? {}
            : { hook: hook === undefined ? s.hook : { ...s.hook, presetId: hook.id } }),
        };
        return {
          shortId: v.shortId,
          short,
          // A style change is the creator's choice applied as-is ("user-style versions").
          createdBy: "user" as const,
          note: `${what}.`,
          whatChanged: `${what}.`,
        };
      });
      return { result: { kind: "versions", changes }, problems: [] };
    }
    case "new_shorts":
      return {
        result: { kind: "new_shorts", request: action.request.trim(), count: action.count },
        problems: [],
      };
    case "answer":
      return { result: { kind: "answer", text: action.text.trim() }, problems: [] };
    case "clarify":
      return { result: { kind: "clarify", text: action.question.trim() }, problems: [] };
  }
}

/** Asks for one action and returns what it does, checked. */
export async function chatAction(
  provider: LlmProvider,
  inputs: ChatInputs,
  opts: { model: string; signal: AbortSignal; log?: (line: string) => void },
): Promise<ChatResult> {
  let last: ChatResult | null = null;
  await askChecked(
    provider,
    ChatAction,
    {
      ...chatRequest(inputs),
      jsonSchema: claudeJsonSchemas.chatAction,
      model: opts.model,
      signal: opts.signal,
    },
    (action) => {
      const out = applyChatAction(action, inputs);
      last = out.result;
      if (out.problems.length > 0) {
        opts.log?.(
          `Chat action sent back: ${out.problems.map((p) => `${p.path}: ${p.message}`).join(" | ")}`,
        );
      }
      return out.problems;
    },
    CHAT_FAILED,
  );
  return last!;
}

/** The source span of a short's head, for excluding it from new shorts. */
export function spanOfVersion(v: ShortVersion): SourceSpan {
  return { startMs: v.short.segments[0]!.srcIn, endMs: v.short.segments.at(-1)!.srcOut };
}
