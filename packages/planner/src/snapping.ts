// Snap cut points to pauses (plan section 16, step 3): each segment start
// moves to the nearest silence end, each segment end to the nearest silence
// start, within 1.5 s, and only when the short stays valid.
import { normalizeShortTimes, type Segment, type Short, type SourceSpan } from "@alcyo/schema";

export const MAX_SNAP_MS = 1500;

function nearest(target: number, candidates: readonly number[], maxMoveMs: number): number[] {
  return candidates
    .filter((c) => Math.abs(c - target) <= maxMoveMs)
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
}

export function snapShort(
  short: Short,
  silences: readonly SourceSpan[],
  opts: { sourceDurationMs: number; maxMoveMs?: number },
): Short {
  const max = opts.maxMoveMs ?? MAX_SNAP_MS;
  const speechStarts = silences.map((s) => s.endMs);
  const speechEnds = silences.map((s) => s.startMs);
  const out: Segment[] = [];

  short.segments.forEach((seg, i) => {
    const prevOut = out.at(-1)?.srcOut ?? 0;
    const nextIn = short.segments[i + 1]?.srcIn ?? opts.sourceDurationMs;

    let srcIn = seg.srcIn;
    for (const c of nearest(seg.srcIn, speechStarts, max)) {
      if (c >= prevOut && c < seg.srcOut) {
        srcIn = c;
        break;
      }
    }
    let srcOut = seg.srcOut;
    for (const c of nearest(seg.srcOut, speechEnds, max)) {
      if (c > srcIn && c <= nextIn && c <= opts.sourceDurationMs) {
        srcOut = c;
        break;
      }
    }
    out.push({ srcIn, srcOut });
  });

  return normalizeShortTimes({ ...short, segments: out }, short.segments);
}
