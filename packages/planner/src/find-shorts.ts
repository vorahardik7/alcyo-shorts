// Find shorts (plan section 16): the agent reads numbered lines and answers
// with line ids. Code maps them to word edges, snaps to pauses, checks length
// and overlap, and builds version 1 of each short. A long stream is split into
// overlapping windows, then one more call picks from the candidates.
import {
  BUILTIN_CAPTION_PRESETS,
  BUILTIN_HOOK_PRESETS,
  type CaptionPreset,
  ClaudeProposal,
  type CreatorProfile,
  type HookPreset,
  type ProposalShort,
  type Segment,
  type Short,
  type SourceSpan,
  type Transcript,
  checkShort,
  claudeJsonSchemas,
  shortDuration,
} from "@alcyo/schema";
import { profileText } from "@alcyo/profile";
import { mapProposalShort } from "./id-mapping";
import {
  type PromptLine,
  type StreamFacts,
  estimateTokens,
  formatLine,
  lengthRange,
  promptLines,
  seconds,
  streamHeader,
} from "./lines";
import { type Problem, askChecked } from "./llm/ask";
import { type LlmProvider, PlannerError } from "./llm/provider";
import { snapShort } from "./snapping";

/** The hook shows over the first 3 s of a new short. */
export const HOOK_MS = 3000;
/** Snapping moves each edge up to 1.5 s, so the length check allows 2 s each side. */
export const LENGTH_SLACK_MS = 2000;
export const DEFAULT_COUNT = 3;
export const MAX_CANDIDATES = 5;
export const MAX_INPUT_TOKENS = 150_000;
export const WINDOW_TOKENS = 100_000;
export const OVERLAP_TOKENS = 5_000;

export const FIND_FAILED =
  "The agent's shorts didn't fit the checks, twice, so nothing was saved. Try Find shorts again.";

export interface PlanInputs {
  transcript: Pick<Transcript, "words" | "lines">;
  sourceDurationMs: number;
  /** Silences from analysis; edges snap to them. */
  silences: readonly SourceSpan[];
  /** Placed viewer clips, in source time. */
  clips: readonly SourceSpan[];
  profile: CreatorProfile;
  presets: {
    captionPresets: readonly CaptionPreset[];
    hookPresets: readonly HookPreset[];
  };
  stream: StreamFacts;
}

export interface FindOptions {
  count?: number;
  /** new_shorts: what the creator asked for, in their words. */
  request?: string;
  /** Existing shorts; new ones must not overlap them. */
  exclude?: readonly SourceSpan[];
  model: string;
  signal: AbortSignal;
  maxTokens?: number;
  windowTokens?: number;
  overlapTokens?: number;
  log?: (line: string) => void;
}

/** The caption and hook looks a new short starts with: the profile's, if they still exist. */
export function startingLooks(inputs: Pick<PlanInputs, "profile" | "presets">): {
  caption: CaptionPreset;
  hookPresetId: string;
} {
  const caption =
    inputs.presets.captionPresets.find((p) => p.id === inputs.profile.captionPresetId) ??
    BUILTIN_CAPTION_PRESETS[0]!;
  const hook =
    inputs.presets.hookPresets.find((p) => p.id === inputs.profile.hookPresetId) ??
    BUILTIN_HOOK_PRESETS[0]!;
  return { caption, hookPresetId: hook.id };
}

/** Version 1 of a proposed short, before snapping. */
export function newShort(
  item: ProposalShort,
  segment: Segment,
  inputs: Pick<PlanInputs, "profile" | "presets">,
): Short {
  const { caption, hookPresetId } = startingLooks(inputs);
  const dur = segment.srcOut - segment.srcIn;
  return {
    title: item.title.trim().slice(0, 80),
    reason: item.reason.trim().slice(0, 300),
    segments: [segment],
    crop: { keys: [{ t: 0, x: 0.5, ease: "hold" }] },
    captions: { presetId: caption.id, wordsPerLine: caption.wordsPerLine, overrides: [] },
    hook: {
      text: item.hookText.trim().slice(0, 80),
      start: 0,
      end: Math.min(dur, HOOK_MS),
      presetId: hookPresetId,
    },
  };
}

function spanOf(short: Short): SourceSpan {
  return { startMs: short.segments[0]!.srcIn, endMs: short.segments.at(-1)!.srcOut };
}

const overlaps = (a: SourceSpan, b: SourceSpan) => a.startMs < b.endMs && b.startMs < a.endMs;

/** "L0100 to L0120" for a source span: the lines it overlaps. */
export function linesFor(lines: readonly PromptLine[], span: SourceSpan): string {
  const inside = lines.filter((l) => l.startMs < span.endMs && l.endMs > span.startMs);
  if (inside.length === 0) return "no lines";
  return `${inside[0]!.id} to ${inside.at(-1)!.id}`;
}

export interface ProposalRules {
  /** How many shorts the answer may have. */
  count: { min: number; max: number };
  range: { min: number; max: number };
  exclude: readonly SourceSpan[];
  /** When set, start and end lines must be among these (a window, or the candidates). */
  allowed?: ReadonlySet<string>;
}

/**
 * Maps, snaps and checks a proposal. Returns the built shorts, or every
 * problem so the retry can list them.
 */
export function buildProposal(
  proposal: ClaudeProposal,
  inputs: PlanInputs,
  rules: ProposalRules,
  lines: readonly PromptLine[] = promptLines(inputs.transcript, inputs.clips),
): { shorts: Short[]; problems: Problem[] } {
  const problems: Problem[] = [];
  const n = proposal.shorts.length;
  if (n < rules.count.min || n > rules.count.max) {
    const want =
      rules.count.min === rules.count.max
        ? `exactly ${rules.count.min}`
        : `${rules.count.min} to ${rules.count.max}`;
    problems.push({ path: "shorts", message: `Return ${want} shorts, not ${n}.` });
  }
  const lo = Math.max(0, rules.range.min - LENGTH_SLACK_MS);
  const hi = rules.range.max + LENGTH_SLACK_MS;
  const built: { short: Short; span: SourceSpan; at: number }[] = [];

  proposal.shorts.forEach((item, i) => {
    const path = `shorts[${i}]`;
    if (item.title.trim().length === 0 || item.hookText.trim().length === 0) {
      problems.push({ path, message: "Write a title and a hookText." });
      return;
    }
    if (rules.allowed !== undefined) {
      for (const id of [item.startLine, item.endLine]) {
        if (!rules.allowed.has(id)) {
          problems.push({ path, message: `Line ${id} isn't one you can pick from here.` });
          return;
        }
      }
    }
    const mapped = mapProposalShort(item, inputs.transcript);
    if (!mapped.ok) {
      problems.push({ path, message: mapped.reason });
      return;
    }
    const short = snapShort(newShort(item, mapped.value, inputs), inputs.silences, {
      sourceDurationMs: inputs.sourceDurationMs,
    });
    const len = shortDuration(short.segments);
    if (len < lo || len > hi) {
      problems.push({
        path,
        message: `Runs ${seconds(len)} (${item.startLine} to ${item.endLine}). Pick lines that run ${seconds(rules.range.min)} to ${seconds(rules.range.max)}.`,
      });
      return;
    }
    const issues = checkShort(short, { sourceDurationMs: inputs.sourceDurationMs });
    if (issues.length > 0) {
      problems.push({ path, message: issues[0]!.message });
      return;
    }
    const span = spanOf(short);
    const other = built.find((b) => overlaps(b.span, span));
    if (other !== undefined) {
      problems.push({ path, message: `Overlaps shorts[${other.at}]. Shorts must not overlap.` });
      return;
    }
    const old = rules.exclude.find((e) => overlaps(e, span));
    if (old !== undefined) {
      problems.push({
        path,
        message: `Overlaps an existing short (${linesFor(lines, old)}). Pick other lines.`,
      });
      return;
    }
    built.push({ short, span, at: i });
  });
  return { shorts: problems.length === 0 ? built.map((b) => b.short) : [], problems };
}

/** How many shorts the stream has room for, at the shortest length. */
export function roomFor(
  lines: readonly PromptLine[],
  exclude: readonly SourceSpan[],
  minMs: number,
): number {
  if (lines.length === 0) return 0;
  const span = lines.at(-1)!.endMs - lines[0]!.startMs;
  const taken = exclude.reduce((sum, e) => sum + Math.max(0, e.endMs - e.startMs), 0);
  return Math.floor(Math.max(0, span - taken) / Math.max(1, minMs));
}

type Mode =
  | { kind: "pick"; count: number }
  | { kind: "window"; context: readonly PromptLine[] }
  | {
      kind: "final";
      count: number;
      candidates: readonly { item: ProposalShort; lines: PromptLine[] }[];
    };

/** The instruction and input for one Find shorts call. */
export function findRequest(
  inputs: PlanInputs,
  lines: readonly PromptLine[],
  mode: Mode,
  opts: {
    request?: string;
    exclude?: readonly SourceSpan[];
    allLines?: readonly PromptLine[];
  } = {},
): { instruction: string; input: string } {
  const range = lengthRange(inputs.profile);
  const len = `${seconds(range.min)} to ${seconds(range.max)}`.replace(/ s to /, " to ");
  const want =
    mode.kind === "window"
      ? `up to ${MAX_CANDIDATES} candidate shorts`
      : `${mode.count} short${mode.count === 1 ? "" : "s"}`;
  const all = opts.allLines ?? lines;
  const exclude = (opts.exclude ?? []).map((e) => linesFor(all, e));
  const instruction = [
    "You pick moments from a live stream to become vertical shorts for this creator. You only read text; code cuts the video.",
    "Each transcript row is: line id, start time, markers, then the words. [clipped] or [clipped xN] means N viewers clipped that moment, a strong sign it's good. [pause] means the streamer paused for a second or more before the line.",
    `Pick ${want}. Each short runs from startLine to endLine, both included, and lasts ${len}: use the start times to judge the length. A short stands on its own: open on the moment or just before it, and end after the payoff. No two shorts overlap.`,
    "Follow the creator profile: its good moments, its title rules, and its Avoid list.",
    "title follows the creator's title rules, at most 80 characters. hookText is the text on screen for the first seconds, at most 80 characters. reason is one plain sentence on why the moment works.",
    mode.kind === "window"
      ? "This is one part of a long stream. Pick only from the rows under # Transcript. The rows under # Clipped elsewhere are from other parts, for context."
      : null,
    mode.kind === "final"
      ? "These are candidates from a long stream. Pick the best, using each candidate's rows. You may move a candidate's start or end within its rows."
      : null,
    opts.request !== undefined && opts.request.trim().length > 0
      ? `The creator asked for: "${opts.request.trim().slice(0, 300)}". Pick shorts that fit it.`
      : null,
    exclude.length > 0
      ? `These lines are already shorts. Don't overlap them: ${exclude.join("; ")}.`
      : null,
    'Use only line ids from the rows. Return {"shorts":[{"title":...,"hookText":...,"reason":...,"startLine":...,"endLine":...}]}.',
  ]
    .filter((x) => x !== null)
    .join("\n\n");

  const parts = [
    profileText(inputs.profile),
    "",
    streamHeader(inputs.stream),
    `# Pick ${want}, each ${len}.`,
  ];
  if (mode.kind === "final") {
    parts.push("# Candidates");
    mode.candidates.forEach((c, i) => {
      parts.push(`## Candidate ${i + 1}: ${c.item.title}. ${c.item.reason}`);
      parts.push(...c.lines.map(formatLine));
    });
  } else {
    parts.push("# Transcript", ...lines.map(formatLine));
    if (mode.kind === "window" && mode.context.length > 0) {
      parts.push("# Clipped elsewhere (context only)", ...mode.context.map(formatLine));
    }
  }
  return { instruction, input: parts.join("\n") };
}

/** Overlapping windows of about `size` tokens each. */
export function splitWindows(
  lines: readonly PromptLine[],
  size: number,
  overlap: number,
): { from: number; to: number }[] {
  const cost = lines.map((l) => estimateTokens(`${formatLine(l)}\n`));
  const out: { from: number; to: number }[] = [];
  let from = 0;
  while (from < lines.length) {
    let to = from;
    let total = 0;
    while (to < lines.length && (to === from || total + cost[to]! <= size)) total += cost[to++]!;
    out.push({ from, to });
    if (to >= lines.length) break;
    // Step back about `overlap` tokens, but always move forward.
    let back = to;
    let kept = 0;
    while (back > from + 1 && kept + cost[back - 1]! <= overlap) kept += cost[--back]!;
    from = back;
  }
  return out;
}

async function ask(
  provider: LlmProvider,
  inputs: PlanInputs,
  req: { instruction: string; input: string },
  rules: ProposalRules,
  lines: readonly PromptLine[],
  opts: FindOptions,
): Promise<{ items: ProposalShort[]; shorts: Short[] }> {
  let last: Short[] = [];
  const answer = await askChecked(
    provider,
    ClaudeProposal,
    {
      ...req,
      jsonSchema: claudeJsonSchemas.proposal,
      model: opts.model,
      signal: opts.signal,
    },
    (proposal) => {
      const built = buildProposal(proposal, inputs, rules, lines);
      last = built.shorts;
      if (built.problems.length > 0) {
        opts.log?.(
          `Find shorts answer sent back: ${built.problems.map((p) => `${p.path}: ${p.message}`).join(" | ")}`,
        );
      }
      return built.problems;
    },
    FIND_FAILED,
  );
  return { items: answer.shorts, shorts: last };
}

/**
 * Asks for shorts and returns them built and checked, ready to save as
 * version 1. Throws a PlannerError when the agent fails twice.
 */
export async function findShorts(
  provider: LlmProvider,
  inputs: PlanInputs,
  opts: FindOptions,
): Promise<Short[]> {
  const lines = promptLines(inputs.transcript, inputs.clips);
  if (lines.length === 0) {
    throw new PlannerError("There's no speech in the transcript to pick shorts from.", "failed");
  }
  const range = lengthRange(inputs.profile);
  const exclude = opts.exclude ?? [];
  const asked = Math.min(MAX_CANDIDATES, Math.max(1, opts.count ?? DEFAULT_COUNT));
  const room = roomFor(lines, exclude, range.min);
  if (room === 0) {
    throw new PlannerError(
      exclude.length > 0
        ? "There's no room left in this stream for another short that long."
        : `This stream is too short for a ${seconds(range.min)} short.`,
      "failed",
    );
  }
  const count = Math.min(asked, room);
  const rules: ProposalRules = { count: { min: count, max: count }, range, exclude };
  const shared = {
    ...(opts.request === undefined ? {} : { request: opts.request }),
    exclude,
    allLines: lines,
  };

  const single = findRequest(inputs, lines, { kind: "pick", count }, shared);
  const max = opts.maxTokens ?? MAX_INPUT_TOKENS;
  if (estimateTokens(single.instruction + single.input) <= max) {
    return (await ask(provider, inputs, single, rules, lines, opts)).shorts;
  }

  // A long stream: candidates per window, then one pick.
  const wins = splitWindows(
    lines,
    opts.windowTokens ?? WINDOW_TOKENS,
    opts.overlapTokens ?? OVERLAP_TOKENS,
  );
  const clipped = lines.filter((l) => l.clipped > 0);
  const candidates: { item: ProposalShort; lines: PromptLine[] }[] = [];
  const index = new Map(lines.map((l, i) => [l.id, i]));
  for (const [n, w] of wins.entries()) {
    const part = lines.slice(w.from, w.to);
    const ids = new Set(part.map((l) => l.id));
    const context = clipped.filter((l) => !ids.has(l.id));
    const req = findRequest(inputs, part, { kind: "window", context }, shared);
    try {
      const got = await ask(
        provider,
        inputs,
        req,
        { count: { min: 1, max: MAX_CANDIDATES }, range, exclude, allowed: ids },
        lines,
        opts,
      );
      for (const item of got.items) {
        const a = index.get(item.startLine)!;
        const b = index.get(item.endLine)!;
        // A little room each side, so the final pick can move the edges.
        candidates.push({ item, lines: lines.slice(Math.max(0, a - 2), b + 3) });
      }
    } catch (error) {
      if (error instanceof PlannerError && error.code === "cancelled") throw error;
      if (opts.signal.aborted) throw new PlannerError("The request was cancelled.", "cancelled");
      opts.log?.(`Window ${n + 1} of ${wins.length} gave no candidates.`);
    }
  }
  if (candidates.length === 0) throw new PlannerError(FIND_FAILED, "failed");
  candidates.sort((a, b) => a.lines[0]!.startMs - b.lines[0]!.startMs);
  const allowed = new Set(candidates.flatMap((c) => c.lines.map((l) => l.id)));
  const finalCount = Math.min(count, candidates.length);
  const req = findRequest(inputs, lines, { kind: "final", count: finalCount, candidates }, shared);
  return (
    await ask(
      provider,
      inputs,
      req,
      { count: { min: finalCount, max: finalCount }, range, exclude, allowed },
      lines,
      opts,
    )
  ).shorts;
}
