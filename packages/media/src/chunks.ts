// Splitting the audio into ~10 minute chunks at silences (section 14 step 4).
import type { SourceRange } from "@alcyo/schema";

export const CHUNK_TARGET_MS = 10 * 60_000;
export const CHUNK_SLACK_MS = 2 * 60_000;
/** A remainder under this joins the last chunk instead of becoming its own. */
export const CHUNK_MAX_MS = 12 * 60_000;

/**
 * Chunks that cover [0, durationMs) with no gaps or overlaps. Each cut sits at
 * the middle of the silence nearest start + 10 min within ±2 min, or at
 * start + 10 min when there's no silence there.
 */
export function planChunks(durationMs: number, silences: readonly SourceRange[]): SourceRange[] {
  if (durationMs <= 0) return [];
  const mids = silences
    .map((s) => Math.round((s.startMs + s.endMs) / 2))
    .filter((m) => m > 0 && m < durationMs)
    .sort((a, b) => a - b);
  const chunks: SourceRange[] = [];
  let start = 0;
  while (durationMs - start > CHUNK_MAX_MS) {
    const target = start + CHUNK_TARGET_MS;
    let cut = target;
    let best = Infinity;
    for (const m of mids) {
      const d = Math.abs(m - target);
      if (d <= CHUNK_SLACK_MS && d < best) {
        best = d;
        cut = m;
      }
    }
    chunks.push({ startMs: start, endMs: cut });
    start = cut;
  }
  chunks.push({ startMs: start, endMs: durationMs });
  return chunks;
}
