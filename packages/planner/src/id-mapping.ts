// Claude answers with ids; code turns them into source times (plan sections 16
// and 17). Line ids become one segment on word boundaries; keep ranges of word
// ids become in-order, non-overlapping segments.
import {
  type KeepRange,
  type ProposalShort,
  type Result,
  type Segment,
  type Transcript,
  wordIndex,
  wordRangeToSource,
} from "@alcyo/schema";

type Words = Pick<Transcript, "words" | "lines">;

/** One proposed short -> one segment, from its start line's first word to its end line's last word. */
export function mapProposalShort(item: ProposalShort, transcript: Words): Result<Segment> {
  const lines = new Map(transcript.lines.map((l, i) => [l.id, i]));
  const startAt = lines.get(item.startLine);
  const endAt = lines.get(item.endLine);
  if (startAt === undefined)
    return { ok: false, reason: `Line ${item.startLine} isn't in the transcript.` };
  if (endAt === undefined)
    return { ok: false, reason: `Line ${item.endLine} isn't in the transcript.` };
  if (endAt < startAt) {
    return {
      ok: false,
      reason: `End line ${item.endLine} comes before start line ${item.startLine}.`,
    };
  }
  const first = transcript.lines[startAt]!.wordIds[0]!;
  const last = transcript.lines[endAt]!.wordIds.at(-1)!;
  const span = wordRangeToSource(transcript, { fromWord: first, toWord: last });
  if (!span.ok) return span;
  if (span.value.endMs <= span.value.startMs) {
    return { ok: false, reason: `Lines ${item.startLine} to ${item.endLine} have no length.` };
  }
  return { ok: true, value: { srcIn: span.value.startMs, srcOut: span.value.endMs } };
}

/** Maps every short in a proposal. Fails with every reason, so the retry can list them. */
export function mapProposal(
  shorts: readonly ProposalShort[],
  transcript: Words,
): Result<Segment[][]> {
  const out: Segment[][] = [];
  const reasons: string[] = [];
  shorts.forEach((item, i) => {
    const mapped = mapProposalShort(item, transcript);
    if (mapped.ok) out.push([mapped.value]);
    else reasons.push(`Short ${i + 1}: ${mapped.reason}`);
  });
  return reasons.length === 0 ? { ok: true, value: out } : { ok: false, reason: reasons.join(" ") };
}

/**
 * revise_short's keep ranges -> segments: each range from its first word's
 * start to its last word's end, sorted, with overlapping or touching ranges
 * merged.
 */
export function mapKeep(
  keep: readonly KeepRange[],
  transcript: Pick<Transcript, "words">,
): Result<Segment[]> {
  const index = wordIndex(transcript);
  const spans: Segment[] = [];
  for (const range of keep) {
    const span = wordRangeToSource(transcript, range, index);
    if (!span.ok) return span;
    if (span.value.endMs > span.value.startMs) {
      spans.push({ srcIn: span.value.startMs, srcOut: span.value.endMs });
    }
  }
  if (spans.length === 0) return { ok: false, reason: "The keep ranges cover no time." };
  spans.sort((a, b) => a.srcIn - b.srcIn);
  const merged: Segment[] = [];
  for (const s of spans) {
    const prev = merged.at(-1);
    if (prev !== undefined && s.srcIn <= prev.srcOut) prev.srcOut = Math.max(prev.srcOut, s.srcOut);
    else merged.push({ ...s });
  }
  return { ok: true, value: merged };
}
