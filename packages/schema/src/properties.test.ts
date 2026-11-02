// Correctness properties 1, 2, 4 and 7 from .kiro/specs/schema/design.md.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkShort } from "./checks.ts";
import { formatAppLink, parseAppLink } from "./link.ts";
import { Message } from "./message.ts";
import { CreatorProfile } from "./profile.ts";
import { Short, ShortVersion } from "./short.ts";
import * as A from "./testing/arbitraries.ts";
import {
  rippleDeleteWords,
  shortDuration,
  shortToSource,
  sourceToShort,
  wordIndex,
} from "./time.ts";

const RUNS = { numRuns: 300 };

describe("property 1: ripple delete", () => {
  it("gives a valid short whose length drops by exactly the kept time removed", () => {
    fc.assert(
      fc.property(
        A.shortOnTranscript.chain(({ transcript, short }) =>
          A.wordRanges(transcript).map((ranges) => ({ transcript, short, ranges })),
        ),
        ({ transcript, short, ranges }) => {
          // The oracle: count kept ms that fall inside any deleted word range.
          const index = wordIndex(transcript);
          const spans = ranges.map((r) => ({
            startMs: transcript.words[index.get(r.fromWord)!]!.startMs,
            endMs: transcript.words[index.get(r.toWord)!]!.endMs,
          }));
          let removed = 0;
          for (const seg of short.segments) {
            for (let x = seg.srcIn; x < seg.srcOut; x++) {
              if (spans.some((s) => x >= s.startMs && x < s.endMs)) removed++;
            }
          }
          const before = shortDuration(short.segments);
          const result = rippleDeleteWords(short, transcript, ranges);

          if (removed === before) {
            expect(result.ok).toBe(false);
            return;
          }
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(Short.safeParse(result.value).success).toBe(true);
          const wordIds = new Set(transcript.words.map((w) => w.id));
          expect(checkShort(result.value, { wordIds })).toEqual([]);
          expect(shortDuration(result.value.segments)).toBe(before - removed);
        },
      ),
      RUNS,
    );
  });
});

describe("property 2: short time and source time", () => {
  it("source -> short -> source is the identity inside kept segments", () => {
    fc.assert(
      fc.property(
        A.segments.chain((segs) =>
          fc
            .integer({ min: 0, max: segs.length - 1 })
            .chain((i) =>
              fc
                .integer({ min: segs[i]!.srcIn, max: segs[i]!.srcOut - 1 })
                .map((x) => ({ segs, x })),
            ),
        ),
        ({ segs, x }) => {
          const t = sourceToShort(segs, x);
          expect(t).not.toBeNull();
          expect(shortToSource(segs, t!)).toBe(x);
        },
      ),
      RUNS,
    );
  });

  it("short -> source -> short is the identity for every short ms", () => {
    fc.assert(
      fc.property(
        A.segments.chain((segs) =>
          fc.integer({ min: 0, max: shortDuration(segs) - 1 }).map((t) => ({ segs, t })),
        ),
        ({ segs, t }) => {
          const x = shortToSource(segs, t);
          expect(x).not.toBeNull();
          expect(sourceToShort(segs, x!)).toBe(t);
        },
      ),
      RUNS,
    );
  });

  it("source ms outside every segment has no short time", () => {
    fc.assert(
      fc.property(A.segments, fc.integer({ min: 0, max: A.MAX_SOURCE_MS + 10 }), (segs, x) => {
        const kept = segs.some((s) => x >= s.srcIn && x < s.srcOut);
        expect(sourceToShort(segs, x) !== null).toBe(kept);
      }),
      RUNS,
    );
  });
});

describe("property 4: JSON round trip", () => {
  const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

  it("versions", () => {
    fc.assert(
      fc.property(A.version, (v) => {
        expect(ShortVersion.parse(v)).toEqual(v);
        expect(ShortVersion.parse(roundTrip(v))).toEqual(v);
      }),
      RUNS,
    );
  });

  it("messages", () => {
    fc.assert(
      fc.property(A.message, (m) => {
        expect(Message.parse(roundTrip(m))).toEqual(m);
      }),
      RUNS,
    );
  });

  it("profiles", () => {
    fc.assert(
      fc.property(A.profile, (p) => {
        expect(CreatorProfile.parse(roundTrip(p))).toEqual(p);
      }),
      RUNS,
    );
  });
});

describe("property 7: alcyo:// links", () => {
  it("format then parse gives the same link", () => {
    fc.assert(
      fc.property(A.appLink, (link) => {
        expect(parseAppLink(formatAppLink(link))).toEqual(link);
      }),
      { numRuns: 1000 },
    );
  });
});
