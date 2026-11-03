// Finding a clip in the VOD from its words (plan section 12, step 2). Pure.
// Each word run the clip shares with the VOD votes for an offset; the
// biggest group of votes is the candidate.

import { CLIP_PLACED_MIN } from "@alcyo/schema";

/** A match below this shows as "Couldn't place this clip". */
export const PLACED_MIN = CLIP_PLACED_MIN;
/** Fewer clip words than this means no usable speech: match on audio only. */
export const MIN_WORDS = 4;
const GRAM = 3;
const BUCKET_MS = 500;

export interface TimedWord {
  text: string;
  startMs: number;
}

export function normalizeWord(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function tokens(words: readonly TimedWord[]): TimedWord[] {
  const out: TimedWord[] = [];
  for (const w of words) {
    const text = normalizeWord(w.text);
    if (text.length > 0) out.push({ text, startMs: w.startMs });
  }
  return out;
}

export interface Candidate {
  /** Where the clip's 0 ms falls in the VOD. May be negative for a padded clip. */
  offsetMs: number;
  /** Share of the clip's word runs that agree with the offset, 0 to 1. */
  score: number;
}

export function transcriptCandidate(
  clipWords: readonly TimedWord[],
  vodWords: readonly TimedWord[],
): Candidate | null {
  const clip = tokens(clipWords);
  const vod = tokens(vodWords);
  if (clip.length < MIN_WORDS || vod.length < GRAM) return null;

  const index = new Map<string, number[]>();
  for (let i = 0; i + GRAM <= vod.length; i++) {
    const key = vod
      .slice(i, i + GRAM)
      .map((t) => t.text)
      .join(" ");
    const list = index.get(key);
    if (list === undefined) index.set(key, [i]);
    else if (list.length < 200) list.push(i);
  }

  const votes = new Map<number, number[]>();
  const grams = clip.length - GRAM + 1;
  for (let j = 0; j < grams; j++) {
    const key = clip
      .slice(j, j + GRAM)
      .map((t) => t.text)
      .join(" ");
    const hits = index.get(key);
    if (hits === undefined) continue;
    // A phrase repeated all over the VOD says little; count it once per bucket.
    const seen = new Set<number>();
    for (const i of hits) {
      const offset = vod[i]!.startMs - clip[j]!.startMs;
      const bucket = Math.round(offset / BUCKET_MS);
      if (seen.has(bucket)) continue;
      seen.add(bucket);
      const list = votes.get(bucket);
      if (list === undefined) votes.set(bucket, [offset]);
      else list.push(offset);
    }
  }
  if (votes.size === 0) return null;

  let bestBucket = 0;
  let bestCount = -1;
  for (const bucket of votes.keys()) {
    const count =
      (votes.get(bucket - 1)?.length ?? 0) +
      (votes.get(bucket)?.length ?? 0) +
      (votes.get(bucket + 1)?.length ?? 0);
    if (count > bestCount) {
      bestCount = count;
      bestBucket = bucket;
    }
  }
  const offsets = [
    ...(votes.get(bestBucket - 1) ?? []),
    ...(votes.get(bestBucket) ?? []),
    ...(votes.get(bestBucket + 1) ?? []),
  ].sort((a, b) => a - b);
  const median = offsets[Math.floor(offsets.length / 2)]!;
  return { offsetMs: median, score: Math.min(1, bestCount / grams) };
}
