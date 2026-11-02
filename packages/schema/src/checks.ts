// Checks Zod can't express on its own: ordering, overlap and references to
// other files. Each returns issues with a path and a plain reason; empty means
// fine. Run after the schema has parsed.
import type { z } from "zod";
import type { ChatAction } from "./claude.ts";
import type { CreatorProfile } from "./profile.ts";
import type { Short, ShortVersion } from "./short.ts";
import { shortDuration } from "./time.ts";
import { MAX_LINE_MS, type Transcript } from "./transcript.ts";

export interface Issue {
  path: string;
  message: string;
}

/** ["segments", 2, "srcOut"] -> "segments[2].srcOut". */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else out += out.length === 0 ? String(key) : `.${String(key)}`;
  }
  return out;
}

function join(prefix: string, path: string): string {
  if (prefix.length === 0) return path;
  if (path.length === 0) return prefix;
  return path.startsWith("[") ? `${prefix}${path}` : `${prefix}.${path}`;
}

export function zodIssues(error: z.ZodError, prefix = ""): Issue[] {
  return error.issues.map((issue) => ({
    path: join(prefix, formatPath(issue.path)) || "(file)",
    message: issue.message,
  }));
}

export interface ShortContext {
  /** The source's length, from source.json's probe. */
  sourceDurationMs?: number;
  /** Word ids in the source's transcript. */
  wordIds?: ReadonlySet<string>;
}

export function checkShort(short: Short, ctx: ShortContext = {}, prefix = ""): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ path: join(prefix, path), message });

  short.segments.forEach((seg, i) => {
    if (seg.srcOut <= seg.srcIn) add(`segments[${i}]`, "srcOut must be after srcIn.");
    if (ctx.sourceDurationMs !== undefined && seg.srcOut > ctx.sourceDurationMs) {
      add(
        `segments[${i}].srcOut`,
        `Ends at ${seg.srcOut} ms, past the end of the source at ${ctx.sourceDurationMs} ms.`,
      );
    }
    const prev = short.segments[i - 1];
    if (prev !== undefined && seg.srcIn < prev.srcOut) {
      add(
        `segments[${i}].srcIn`,
        `Starts at ${seg.srcIn} ms, before the previous segment ends at ${prev.srcOut} ms. Segments stay in source order and don't overlap.`,
      );
    }
  });

  const dur = shortDuration(short.segments);
  short.crop.keys.forEach((key, i) => {
    if (key.t >= dur) {
      add(`crop.keys[${i}].t`, `At ${key.t} ms, outside the short, which is ${dur} ms long.`);
    }
    const prev = short.crop.keys[i - 1];
    if (prev !== undefined && key.t <= prev.t) {
      add(`crop.keys[${i}].t`, `At ${key.t} ms, not after the key before it at ${prev.t} ms.`);
    }
  });

  const seen = new Set<string>();
  short.captions.overrides.forEach((o, i) => {
    if (ctx.wordIds !== undefined && !ctx.wordIds.has(o.wordId)) {
      add(`captions.overrides[${i}].wordId`, `Word ${o.wordId} isn't in the transcript.`);
    }
    if (seen.has(o.wordId)) {
      add(`captions.overrides[${i}].wordId`, `Word ${o.wordId} has more than one override.`);
    }
    seen.add(o.wordId);
  });

  if (short.hook !== undefined) {
    if (short.hook.end <= short.hook.start) add("hook.end", "The hook must end after it starts.");
    if (short.hook.end > dur) {
      add("hook.end", `Ends at ${short.hook.end} ms, after the short ends at ${dur} ms.`);
    }
  }
  return issues;
}

export function checkVersion(version: ShortVersion, ctx: ShortContext = {}): Issue[] {
  const issues = checkShort(version.short, ctx, "short");
  if (version.parent !== null && version.parent >= version.version) {
    issues.push({
      path: "parent",
      message: `Version ${version.version} can't come from version ${version.parent}.`,
    });
  }
  return issues;
}

export function checkChatAction(
  action: ChatAction,
  ctx: { shortIds: ReadonlySet<string> },
): Issue[] {
  const issues: Issue[] = [];
  const known = (id: string) => {
    if (!ctx.shortIds.has(id)) {
      issues.push({ path: "shortId", message: `There's no short ${id} in this stream.` });
    }
  };
  switch (action.action) {
    case "revise_short":
    case "retime_short":
      known(action.shortId);
      if (
        action.action === "retime_short" &&
        action.startWord === undefined &&
        action.endWord === undefined
      ) {
        issues.push({ path: "startWord", message: "A retime needs a new start word or end word." });
      }
      break;
    case "set_style":
      if (action.scope === "short") {
        if (action.shortId === undefined) {
          issues.push({ path: "shortId", message: "A style change for one short needs its id." });
        } else known(action.shortId);
      }
      if (action.captionPresetId === undefined && action.hookPresetId === undefined) {
        issues.push({
          path: "captionPresetId",
          message: "A style change needs a caption or hook preset.",
        });
      }
      break;
    case "new_shorts":
    case "answer":
    case "clarify":
      break;
  }
  return issues;
}

export function checkTranscript(transcript: Transcript): Issue[] {
  const issues: Issue[] = [];
  const index = new Map<string, number>();
  transcript.words.forEach((w, i) => {
    if (index.has(w.id))
      issues.push({ path: `words[${i}].id`, message: `Word id ${w.id} is used twice.` });
    index.set(w.id, i);
    const prev = transcript.words[i - 1];
    if (prev !== undefined && w.startMs < prev.startMs) {
      issues.push({
        path: `words[${i}].startMs`,
        message: `Starts at ${w.startMs} ms, before the word before it at ${prev.startMs} ms.`,
      });
    }
  });

  const lineIds = new Set<string>();
  transcript.lines.forEach((line, i) => {
    if (lineIds.has(line.id))
      issues.push({ path: `lines[${i}].id`, message: `Line id ${line.id} is used twice.` });
    lineIds.add(line.id);
    let last = -1;
    let ok = true;
    line.wordIds.forEach((id, j) => {
      const at = index.get(id);
      if (at === undefined) {
        issues.push({
          path: `lines[${i}].wordIds[${j}]`,
          message: `Word ${id} isn't in the transcript.`,
        });
        ok = false;
      } else if (at <= last) {
        issues.push({ path: `lines[${i}].wordIds[${j}]`, message: `Word ${id} is out of order.` });
        ok = false;
      } else last = at;
    });
    if (line.endMs - line.startMs > MAX_LINE_MS) {
      issues.push({
        path: `lines[${i}]`,
        message: `Runs ${line.endMs - line.startMs} ms; lines are at most ${MAX_LINE_MS} ms.`,
      });
    }
    if (ok) {
      const first = transcript.words[index.get(line.wordIds[0]!)!]!;
      const lastWord = transcript.words[index.get(line.wordIds.at(-1)!)!]!;
      if (line.startMs !== first.startMs || line.endMs !== lastWord.endMs) {
        issues.push({
          path: `lines[${i}]`,
          message: "The line's times must match its first word's start and last word's end.",
        });
      }
    }
  });
  return issues;
}

export function checkProfile(profile: Pick<CreatorProfile, "lengthMs">): Issue[] {
  return profile.lengthMs.min > profile.lengthMs.max
    ? [{ path: "lengthMs", message: "The shortest length is longer than the longest." }]
    : [];
}
