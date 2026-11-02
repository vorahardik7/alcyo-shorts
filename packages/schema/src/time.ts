// Short time <-> source time, and edits that change segments. Pure.
// Segments are half-open [srcIn, srcOut), in source order, never overlapping.
// Crop key and hook times are short time.
import type { KeepRange } from "./claude.ts";
import type { Segment, Short } from "./short.ts";
import type { Transcript } from "./transcript.ts";

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface SourceSpan {
  startMs: number;
  endMs: number;
}

export function shortDuration(segments: readonly Segment[]): number {
  let total = 0;
  for (const s of segments) total += Math.max(0, s.srcOut - s.srcIn);
  return total;
}

/**
 * Short ms -> source ms. t must be in [0, duration]; t = duration maps to the
 * last segment's srcOut. Returns null outside that range.
 */
export function shortToSource(segments: readonly Segment[], t: number): number | null {
  if (!Number.isInteger(t) || t < 0) return null;
  let acc = 0;
  for (const s of segments) {
    const len = s.srcOut - s.srcIn;
    if (t < acc + len) return s.srcIn + (t - acc);
    acc += len;
  }
  const last = segments.at(-1);
  return t === acc && last !== undefined ? last.srcOut : null;
}

/** Source ms -> short ms, when the source ms is kept. Otherwise null. */
export function sourceToShort(segments: readonly Segment[], s: number): number | null {
  let acc = 0;
  for (const seg of segments) {
    if (s >= seg.srcIn && s < seg.srcOut) return acc + (s - seg.srcIn);
    acc += seg.srcOut - seg.srcIn;
  }
  return null;
}

/**
 * Where a short time lands after the segments change: the same source ms if
 * it's still kept, otherwise the start of the next kept ms (or the end).
 */
export function remapShortTime(
  oldSegments: readonly Segment[],
  newSegments: readonly Segment[],
  t: number,
): number {
  const oldDur = shortDuration(oldSegments);
  const src = shortToSource(oldSegments, Math.min(Math.max(0, Math.round(t)), oldDur));
  if (src === null) return 0;
  const kept = sourceToShort(newSegments, src);
  if (kept !== null) return kept;
  let acc = 0;
  for (const seg of newSegments) {
    if (seg.srcIn >= src) return acc;
    acc += seg.srcOut - seg.srcIn;
  }
  return acc;
}

/**
 * After `short.segments` replaced `oldSegments`, moves crop keys and the hook
 * to follow the same source moments, keeps keys strictly increasing and inside
 * the short, and drops a hook that no longer has any length.
 */
export function normalizeShortTimes(short: Short, oldSegments: readonly Segment[]): Short {
  const dur = shortDuration(short.segments);
  const last = Math.max(0, dur - 1);

  const moved = short.crop.keys.map((k) => ({
    ...k,
    t: Math.min(last, remapShortTime(oldSegments, short.segments, k.t)),
  }));
  moved.sort((a, b) => a.t - b.t);
  const keys: typeof moved = [];
  for (const k of moved) {
    // Two keys landing on the same ms: the later one wins.
    if (keys.length > 0 && keys[keys.length - 1]!.t === k.t) keys[keys.length - 1] = k;
    else keys.push(k);
  }

  const { hook, ...rest } = short;
  const result: Short = { ...rest, crop: { keys } };
  if (hook !== undefined) {
    const start = Math.min(dur, remapShortTime(oldSegments, short.segments, hook.start));
    const end = Math.min(dur, remapShortTime(oldSegments, short.segments, hook.end));
    if (end > start) result.hook = { ...hook, start, end };
  }
  return result;
}

function mergeSpans(spans: readonly SourceSpan[]): SourceSpan[] {
  const sorted = spans
    .filter((s) => s.endMs > s.startMs)
    .map((s) => ({ ...s }))
    .sort((a, b) => a.startMs - b.startMs);
  const out: SourceSpan[] = [];
  for (const s of sorted) {
    const prev = out.at(-1);
    if (prev !== undefined && s.startMs <= prev.endMs) prev.endMs = Math.max(prev.endMs, s.endMs);
    else out.push(s);
  }
  return out;
}

/**
 * Removes source ranges from a short and closes the gaps. Crop keys and the
 * hook follow their source moments. Refuses to remove everything.
 */
export function rippleDelete(short: Short, ranges: readonly SourceSpan[]): Result<Short> {
  const cuts = mergeSpans(ranges);
  const segments: Segment[] = [];
  for (const seg of short.segments) {
    let cursor = seg.srcIn;
    for (const cut of cuts) {
      if (cut.endMs <= cursor || cut.startMs >= seg.srcOut) continue;
      if (cut.startMs > cursor) segments.push({ srcIn: cursor, srcOut: cut.startMs });
      cursor = Math.max(cursor, cut.endMs);
      if (cursor >= seg.srcOut) break;
    }
    if (cursor < seg.srcOut) segments.push({ srcIn: cursor, srcOut: seg.srcOut });
  }
  if (segments.length === 0) {
    return { ok: false, reason: "That would cut everything in the short. Keep at least one word." };
  }
  return { ok: true, value: normalizeShortTimes({ ...short, segments }, short.segments) };
}

/** A word range -> the source span from the first word's start to the last word's end. */
export function wordRangeToSource(
  transcript: Pick<Transcript, "words">,
  range: KeepRange,
  index: ReadonlyMap<string, number> = wordIndex(transcript),
): Result<SourceSpan> {
  const from = index.get(range.fromWord);
  const to = index.get(range.toWord);
  if (from === undefined)
    return { ok: false, reason: `Word ${range.fromWord} isn't in the transcript.` };
  if (to === undefined)
    return { ok: false, reason: `Word ${range.toWord} isn't in the transcript.` };
  if (to < from) {
    return { ok: false, reason: `${range.toWord} comes before ${range.fromWord}.` };
  }
  return {
    ok: true,
    value: { startMs: transcript.words[from]!.startMs, endMs: transcript.words[to]!.endMs },
  };
}

export function wordIndex(transcript: Pick<Transcript, "words">): Map<string, number> {
  return new Map(transcript.words.map((w, i) => [w.id, i]));
}

/** Ripple-deletes word ranges (the editor's transcript delete). */
export function rippleDeleteWords(
  short: Short,
  transcript: Pick<Transcript, "words">,
  ranges: readonly KeepRange[],
): Result<Short> {
  const index = wordIndex(transcript);
  const spans: SourceSpan[] = [];
  for (const range of ranges) {
    const span = wordRangeToSource(transcript, range, index);
    if (!span.ok) return span;
    spans.push(span.value);
  }
  return rippleDelete(short, spans);
}
