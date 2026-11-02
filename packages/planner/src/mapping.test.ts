// Unit tests and correctness properties 3, 5 and 6 (.kiro/specs/schema/design.md).
import { checkShort, Segment, Short } from "@alcyo/schema";
import { arb, short as fixtureShort, transcript as fixtureTranscript } from "@alcyo/schema/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mapKeep, mapProposal, mapProposalShort } from "./id-mapping";
import { snapShort } from "./snapping";

const RUNS = { numRuns: 300 };

describe("mapProposalShort", () => {
  it("maps line ids to the first and last word's times", () => {
    expect(
      mapProposalShort(
        { title: "t", hookText: "h", reason: "r", startLine: "L0001", endLine: "L0002" },
        fixtureTranscript,
      ),
    ).toEqual({ ok: true, value: { srcIn: 1000, srcOut: 6300 } });
  });

  it("names unknown and backwards lines", () => {
    const item = { title: "t", hookText: "h", reason: "r" };
    expect(
      mapProposalShort({ ...item, startLine: "L0009", endLine: "L0002" }, fixtureTranscript),
    ).toEqual({
      ok: false,
      reason: "Line L0009 isn't in the transcript.",
    });
    expect(
      mapProposalShort({ ...item, startLine: "L0002", endLine: "L0001" }, fixtureTranscript),
    ).toEqual({
      ok: false,
      reason: "End line L0001 comes before start line L0002.",
    });
    const all = mapProposal(
      [
        { ...item, startLine: "L0001", endLine: "L0001" },
        { ...item, startLine: "L0003", endLine: "L0001" },
      ],
      fixtureTranscript,
    );
    expect(all).toEqual({ ok: false, reason: "Short 2: Line L0003 isn't in the transcript." });
  });
});

describe("mapKeep", () => {
  it("sorts and merges ranges", () => {
    expect(
      mapKeep(
        [
          { fromWord: "w00004", toWord: "w00005" },
          { fromWord: "w00001", toWord: "w00002" },
          { fromWord: "w00005", toWord: "w00007" },
        ],
        fixtureTranscript,
      ),
    ).toEqual({
      ok: true,
      value: [
        { srcIn: 1000, srcOut: 1700 },
        { srcIn: 5000, srcOut: 6300 },
      ],
    });
  });

  it("names unknown words and backwards ranges", () => {
    expect(mapKeep([{ fromWord: "w00001", toWord: "w12345" }], fixtureTranscript)).toEqual({
      ok: false,
      reason: "Word w12345 isn't in the transcript.",
    });
    expect(mapKeep([{ fromWord: "w00003", toWord: "w00002" }], fixtureTranscript).ok).toBe(false);
  });
});

describe("snapShort", () => {
  it("moves edges into nearby pauses and leaves far ones alone", () => {
    const { hook: _hook, ...rest } = fixtureShort;
    const noHook = { ...rest, segments: [{ srcIn: 1000, srcOut: 2100 }] };
    const snapped = snapShort(
      noHook,
      [
        { startMs: 400, endMs: 900 },
        { startMs: 2300, endMs: 4000 },
      ],
      { sourceDurationMs: 10_000 },
    );
    expect(snapped.segments).toEqual([{ srcIn: 900, srcOut: 2300 }]);
    const far = snapShort(noHook, [{ startMs: 5000, endMs: 9000 }], { sourceDurationMs: 10_000 });
    expect(far.segments).toEqual(noHook.segments);
  });

  it("never pushes a segment into its neighbour", () => {
    const short = {
      ...fixtureShort,
      segments: [
        { srcIn: 1000, srcOut: 2000 },
        { srcIn: 2200, srcOut: 3000 },
      ],
    };
    const snapped = snapShort(short, [{ startMs: 2500, endMs: 2600 }], {
      sourceDurationMs: 10_000,
    });
    expect(snapped.segments[0]!.srcOut).toBe(2000);
    expect(checkShort(snapped, { sourceDurationMs: 10_000 })).toEqual([]);
  });
});

describe("property 3: snapping", () => {
  it("keeps the short valid and moves no cut more than 1500 ms", () => {
    fc.assert(
      fc.property(arb.short, arb.silences, (short, silences) => {
        const snapped = snapShort(short, silences, { sourceDurationMs: arb.MAX_SOURCE_MS });
        expect(Short.safeParse(snapped).success).toBe(true);
        expect(checkShort(snapped, { sourceDurationMs: arb.MAX_SOURCE_MS })).toEqual([]);
        expect(snapped.segments).toHaveLength(short.segments.length);
        snapped.segments.forEach((s, i) => {
          const before = short.segments[i]!;
          expect(Math.abs(s.srcIn - before.srcIn)).toBeLessThanOrEqual(1500);
          expect(Math.abs(s.srcOut - before.srcOut)).toBeLessThanOrEqual(1500);
        });
      }),
      RUNS,
    );
  });
});

describe("property 5: line ids to segments", () => {
  it("gives segments on word boundaries", () => {
    fc.assert(
      fc.property(
        arb.transcript.chain((t) =>
          fc
            .tuple(
              fc.integer({ min: 0, max: t.lines.length - 1 }),
              fc.integer({ min: 0, max: t.lines.length - 1 }),
            )
            .map(([a, b]) => ({
              t,
              item: {
                title: "t",
                hookText: "h",
                reason: "r",
                startLine: t.lines[Math.min(a, b)]!.id,
                endLine: t.lines[Math.max(a, b)]!.id,
              },
            })),
        ),
        ({ t, item }) => {
          const mapped = mapProposalShort(item, t);
          expect(mapped.ok).toBe(true);
          if (!mapped.ok) return;
          expect(Segment.safeParse(mapped.value).success).toBe(true);
          expect(t.words.some((w) => w.startMs === mapped.value.srcIn)).toBe(true);
          expect(t.words.some((w) => w.endMs === mapped.value.srcOut)).toBe(true);
        },
      ),
      RUNS,
    );
  });
});

describe("property 6: keep ranges to segments", () => {
  it("gives in-order, non-overlapping segments on word boundaries", () => {
    fc.assert(
      fc.property(
        arb.transcript.chain((t) => arb.wordRanges(t, 8).map((keep) => ({ t, keep }))),
        ({ t, keep }) => {
          const mapped = mapKeep(keep, t);
          expect(mapped.ok).toBe(true);
          if (!mapped.ok) return;
          mapped.value.forEach((s, i) => {
            expect(Segment.safeParse(s).success).toBe(true);
            expect(t.words.some((w) => w.startMs === s.srcIn)).toBe(true);
            expect(t.words.some((w) => w.endMs === s.srcOut)).toBe(true);
            const prev = mapped.value[i - 1];
            if (prev !== undefined) expect(s.srcIn).toBeGreaterThan(prev.srcOut);
          });
        },
      ),
      RUNS,
    );
  });
});
