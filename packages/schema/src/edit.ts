// The editor's edits (plan sections 6 and 23 spec 11), as pure functions on
// a Short. Each returns a new Short or a plain reason it can't. Segment times
// are source ms; crop keys and the hook are short ms. Every edit that moves
// segments keeps crop keys and the hook on their source moments.
import type { KeepRange } from "./claude.ts";
import type { CropKey, Hook, Segment, Short, WordOverride } from "./short.ts";
import {
  type Result,
  type SourceSpan,
  normalizeShortTimes,
  rippleDelete,
  shortDuration,
  shortToSource,
  wordIndex,
} from "./time.ts";
import type { Transcript, Word } from "./transcript.ts";

/** A segment is never shorter than this, so it stays visible and grabbable. */
export const MIN_SEGMENT_MS = 100;
export const NUDGE_SMALL_MS = 10;
export const NUDGE_LARGE_MS = 100;
const MAX_DELTA = 1000;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const no = <T>(reason: string): Result<T> => ({ ok: false, reason });

function withSegments(short: Short, segments: Segment[]): Short {
  return normalizeShortTimes({ ...short, segments }, short.segments);
}

/** Moves one edge of one segment, clamped between its neighbours and the source. */
export function trimSegment(
  short: Short,
  index: number,
  edge: "in" | "out",
  srcMs: number,
  sourceDurationMs: number,
): Result<Short> {
  const seg = short.segments[index];
  if (seg === undefined) return no("That segment isn't in the short.");
  const prev = short.segments[index - 1];
  const next = short.segments[index + 1];
  const t = Math.round(srcMs);
  const segments = short.segments.map((s) => ({ ...s }));
  if (edge === "in") {
    const lo = prev?.srcOut ?? 0;
    const hi = seg.srcOut - MIN_SEGMENT_MS;
    segments[index]!.srcIn = Math.min(hi, Math.max(lo, t));
  } else {
    const lo = seg.srcIn + MIN_SEGMENT_MS;
    const hi = next?.srcIn ?? sourceDurationMs;
    segments[index]!.srcOut = Math.max(lo, Math.min(hi, t));
  }
  return ok(withSegments(short, segments));
}

/** Splits the segment under short time t into two that touch. */
export function splitAt(short: Short, tMs: number): Result<Short> {
  const src = shortToSource(short.segments, Math.round(tMs));
  if (src === null) return no("The playhead isn't inside the short.");
  const at = short.segments.findIndex((s) => src > s.srcIn && src < s.srcOut);
  if (at === -1) return no("The playhead is on a cut already.");
  const seg = short.segments[at]!;
  if (src - seg.srcIn < MIN_SEGMENT_MS || seg.srcOut - src < MIN_SEGMENT_MS) {
    return no("Too close to the segment's edge to split.");
  }
  const segments = [
    ...short.segments.slice(0, at),
    { srcIn: seg.srcIn, srcOut: src },
    { srcIn: src, srcOut: seg.srcOut },
    ...short.segments.slice(at + 1),
  ];
  return ok({ ...short, segments });
}

/** Removes the short-time range [fromMs, toMs) and closes the gap. */
export function rippleDeleteShortRange(short: Short, fromMs: number, toMs: number): Result<Short> {
  const a = Math.max(0, Math.round(Math.min(fromMs, toMs)));
  const b = Math.min(shortDuration(short.segments), Math.round(Math.max(fromMs, toMs)));
  if (b <= a) return no("Select part of the short first.");
  // Each segment's overlap with the range, in source time.
  const spans: SourceSpan[] = [];
  let acc = 0;
  for (const s of short.segments) {
    const len = s.srcOut - s.srcIn;
    const lo = Math.max(a, acc);
    const hi = Math.min(b, acc + len);
    if (hi > lo) spans.push({ startMs: s.srcIn + (lo - acc), endMs: s.srcIn + (hi - acc) });
    acc += len;
  }
  return rippleDelete(short, spans);
}

/** True when a word's midpoint is kept by the short. */
export function isWordKept(short: Pick<Short, "segments">, w: Pick<Word, "startMs" | "endMs">) {
  const mid = Math.floor((w.startMs + w.endMs) / 2);
  return short.segments.some((s) => mid >= s.srcIn && mid < s.srcOut);
}

/**
 * Puts words back: each restored word's span joins the kept segments
 * (merging with neighbours it touches), in source order.
 */
export function restoreWords(
  short: Short,
  transcript: Pick<Transcript, "words">,
  ranges: readonly KeepRange[],
): Result<Short> {
  const index = wordIndex(transcript);
  const add: Segment[] = [];
  for (const r of ranges) {
    const a = index.get(r.fromWord);
    const b = index.get(r.toWord);
    if (a === undefined || b === undefined) return no("That word isn't in the transcript.");
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const first = transcript.words[lo]!;
    const last = transcript.words[hi]!;
    add.push({ srcIn: first.startMs, srcOut: last.endMs });
  }
  // A restored word joins a kept neighbour when no other word sits between
  // them, so the pause between two words isn't left cut.
  const mids = transcript.words.map((w) => Math.floor((w.startMs + w.endMs) / 2));
  const empty = (a: number, b: number) => !mids.some((m) => m >= a && m < b);
  for (const span of add) {
    const before = short.segments.filter((s) => s.srcOut <= span.srcIn).at(-1);
    if (before !== undefined && empty(before.srcOut, span.srcIn)) span.srcIn = before.srcOut;
    const after = short.segments.find((s) => s.srcIn >= span.srcOut);
    if (after !== undefined && empty(span.srcOut, after.srcIn)) span.srcOut = after.srcIn;
  }
  const all = [...short.segments.map((s) => ({ ...s })), ...add].sort((x, y) => x.srcIn - y.srcIn);
  const merged: Segment[] = [];
  for (const s of all) {
    const prev = merged.at(-1);
    if (prev !== undefined && s.srcIn <= prev.srcOut) prev.srcOut = Math.max(prev.srcOut, s.srcOut);
    else merged.push(s);
  }
  return ok(withSegments(short, merged));
}

/** Sets or clears fields of a word's caption override. Empty overrides are dropped. */
export function setWordOverride(
  short: Short,
  wordId: string,
  patch: Partial<Omit<WordOverride, "wordId">>,
): Short {
  const old = short.captions.overrides.find((o) => o.wordId === wordId);
  const next: WordOverride = { ...(old ?? { wordId }), ...patch, wordId };
  for (const k of ["text", "startDelta", "endDelta", "hidden"] as const) {
    if (next[k] === undefined) delete next[k];
  }
  if (next.text !== undefined) next.text = next.text.replace(/\s+/g, " ").trim().slice(0, 40);
  if (next.text === "") delete next.text;
  if (next.hidden === false) delete next.hidden;
  if (next.startDelta === 0) delete next.startDelta;
  if (next.endDelta === 0) delete next.endDelta;
  const empty = Object.keys(next).length === 1;
  const rest = short.captions.overrides.filter((o) => o.wordId !== wordId);
  return {
    ...short,
    captions: { ...short.captions, overrides: empty ? rest : [...rest, next] },
  };
}

/** Moves a word's caption timing by deltaMs (both edges), within ±1 s. */
export function nudgeWord(short: Short, wordId: string, deltaMs: number): Short {
  const o = short.captions.overrides.find((x) => x.wordId === wordId);
  const clamp = (v: number) => Math.max(-MAX_DELTA, Math.min(MAX_DELTA, v));
  return setWordOverride(short, wordId, {
    startDelta: clamp((o?.startDelta ?? 0) + deltaMs),
    endDelta: clamp((o?.endDelta ?? 0) + deltaMs),
  });
}

export function setWordsPerLine(short: Short, n: number): Short {
  const v = Math.max(1, Math.min(4, Math.round(n)));
  return { ...short, captions: { ...short.captions, wordsPerLine: v } };
}

export function setCaptionPreset(short: Short, presetId: string, wordsPerLine: number): Short {
  return { ...short, captions: { ...short.captions, presetId, wordsPerLine } };
}

/** Adds or replaces the crop key at short time t. Keys stay sorted and inside the short. */
export function setCropKey(short: Short, key: CropKey): Short {
  const dur = shortDuration(short.segments);
  const t = Math.max(0, Math.min(Math.max(0, dur - 1), Math.round(key.t)));
  const x = Math.max(0, Math.min(1, key.x));
  const keys = short.crop.keys.filter((k) => k.t !== t);
  keys.push({ t, x, ease: key.ease });
  keys.sort((a, b) => a.t - b.t);
  return { ...short, crop: { keys } };
}

/** Moves the key at index to a new time (and x). A key landing on another replaces it. */
export function moveCropKey(short: Short, index: number, t: number, x?: number): Result<Short> {
  const key = short.crop.keys[index];
  if (key === undefined) return no("That keyframe isn't there.");
  const rest = { ...short, crop: { keys: short.crop.keys.filter((_, i) => i !== index) } };
  return ok(setCropKey(rest, { ...key, t, x: x ?? key.x }));
}

/** Deletes a key. The last key can't go: a short always has a crop. */
export function deleteCropKey(short: Short, index: number): Result<Short> {
  if (short.crop.keys.length <= 1) return no("A short keeps at least one keyframe.");
  if (short.crop.keys[index] === undefined) return no("That keyframe isn't there.");
  return ok({ ...short, crop: { keys: short.crop.keys.filter((_, i) => i !== index) } });
}

/** Sets the hook, clamped inside the short, or removes it with null. */
export function setHook(short: Short, hook: Hook | null): Result<Short> {
  const { hook: _old, ...rest } = short;
  if (hook === null) return ok(rest);
  const dur = shortDuration(short.segments);
  const text = hook.text.replace(/\s+/g, " ").trim().slice(0, 80);
  if (text.length === 0) return no("Write the hook text first.");
  const start = Math.max(0, Math.min(dur - 1, Math.round(hook.start)));
  const end = Math.max(start + 1, Math.min(dur, Math.round(hook.end)));
  return ok({ ...rest, hook: { ...hook, text, start, end } });
}

/** Nearest snap point to t within maxMs, or t itself. */
export function snapTo(t: number, points: readonly number[], maxMs: number): number {
  let best = t;
  let dist = maxMs + 1;
  for (const p of points) {
    const d = Math.abs(p - t);
    if (d < dist) {
      dist = d;
      best = p;
    }
  }
  return dist <= maxMs ? best : t;
}

/** Safe areas per platform as fractions of the 9:16 frame (UI covers the rest). */
export const SAFE_AREAS = {
  tiktok: { top: 0.09, bottom: 0.2, left: 0.06, right: 0.15 },
  "youtube-shorts": { top: 0.08, bottom: 0.18, left: 0.05, right: 0.13 },
  reels: { top: 0.1, bottom: 0.2, left: 0.05, right: 0.13 },
} as const;
