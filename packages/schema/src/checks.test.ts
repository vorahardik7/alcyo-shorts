import { describe, expect, it } from "vitest";
import {
  checkChatAction,
  checkProfile,
  checkShort,
  checkTranscript,
  checkVersion,
  formatPath,
} from "./checks.ts";
import { Short } from "./short.ts";
import * as F from "./testing/fixtures.ts";
import {
  normalizeShortTimes,
  remapShortTime,
  rippleDelete,
  rippleDeleteWords,
  shortDuration,
  shortToSource,
  sourceToShort,
  wordRangeToSource,
} from "./time.ts";

const wordIds = new Set(F.transcript.words.map((w) => w.id));
const ctx = { sourceDurationMs: 10_000, wordIds };
const paths = (issues: Array<{ path: string }>) => issues.map((i) => i.path);

describe("checkShort", () => {
  it("passes the fixture", () => {
    expect(checkShort(F.short, ctx)).toEqual([]);
  });

  it("rejects backwards, past-the-source and overlapping segments", () => {
    const s = {
      ...F.short,
      segments: [
        { srcIn: 3000, srcOut: 4000 },
        { srcIn: 3500, srcOut: 5000 },
        { srcIn: 6000, srcOut: 6000 },
        { srcIn: 9000, srcOut: 12_000 },
      ],
    };
    const issues = checkShort(s, ctx);
    expect(paths(issues)).toEqual(["segments[1].srcIn", "segments[2]", "segments[3].srcOut"]);
    expect(issues[2]?.message).toContain("past the end of the source at 10000 ms");
  });

  it("rejects segments out of source order", () => {
    const s = {
      ...F.short,
      segments: [
        { srcIn: 5000, srcOut: 6000 },
        { srcIn: 1000, srcOut: 2000 },
      ],
    };
    expect(paths(checkShort(s, ctx))).toEqual(["segments[1].srcIn"]);
  });

  it("allows touching segments", () => {
    const s = {
      ...F.short,
      segments: [
        { srcIn: 1000, srcOut: 2000 },
        { srcIn: 2000, srcOut: 3000 },
      ],
    };
    expect(checkShort(s, ctx)).toEqual([]);
  });

  it("rejects crop keys out of order or outside the short", () => {
    const dur = shortDuration(F.short.segments);
    const s = {
      ...F.short,
      crop: {
        keys: [
          { t: 500, x: 0.5, ease: "hold" as const },
          { t: 500, x: 0.4, ease: "hold" as const },
          { t: 100, x: 0.4, ease: "linear" as const },
          { t: dur, x: 0.4, ease: "linear" as const },
        ],
      },
    };
    expect(paths(checkShort(s, ctx))).toEqual([
      "crop.keys[1].t",
      "crop.keys[2].t",
      "crop.keys[3].t",
    ]);
  });

  it("rejects overrides for unknown or repeated words", () => {
    const s = {
      ...F.short,
      captions: {
        ...F.short.captions,
        overrides: [{ wordId: "w99999" }, { wordId: "w00001" }, { wordId: "w00001", hidden: true }],
      },
    };
    const issues = checkShort(s, ctx);
    expect(issues.map((i) => i.message)).toEqual([
      "Word w99999 isn't in the transcript.",
      "Word w00001 has more than one override.",
    ]);
  });

  it("rejects a hook that ends before it starts or after the short", () => {
    expect(
      paths(checkShort({ ...F.short, hook: { ...F.short.hook!, start: 900, end: 900 } }, ctx)),
    ).toEqual(["hook.end"]);
    expect(
      checkShort({ ...F.short, hook: { ...F.short.hook!, end: 99_000 } }, ctx)[0]?.message,
    ).toContain("after the short ends");
  });

  it("skips context checks it has no context for", () => {
    const s = { ...F.short, captions: { ...F.short.captions, overrides: [{ wordId: "w99999" }] } };
    expect(checkShort(s)).toEqual([]);
  });
});

describe("checkVersion", () => {
  it("prefixes short issues and checks the parent", () => {
    const v = {
      ...F.version,
      version: 2,
      parent: 2,
      short: { ...F.short, segments: [{ srcIn: 1000, srcOut: 20_000 }] },
    };
    expect(paths(checkVersion(v, ctx))).toEqual(["short.segments[0].srcOut", "parent"]);
  });
});

describe("checkChatAction", () => {
  const shortIds = new Set(["sh1"]);
  it("passes the fixtures", () => {
    for (const a of F.chatActions) expect(checkChatAction(a, { shortIds })).toEqual([]);
  });
  it("rejects unknown shorts", () => {
    const [revise] = F.chatActions;
    expect(
      checkChatAction({ ...revise!, shortId: "nope" } as never, { shortIds })[0]?.message,
    ).toBe("There's no short nope in this stream.");
    expect(
      checkChatAction({ action: "retime_short", shortId: "x", endWord: "w00001" }, { shortIds }),
    ).toHaveLength(1);
  });
  it("needs a short id for a one-short style change, and some preset", () => {
    expect(
      paths(
        checkChatAction(
          { action: "set_style", scope: "short", captionPresetId: "c" },
          { shortIds },
        ),
      ),
    ).toEqual(["shortId"]);
    expect(paths(checkChatAction({ action: "set_style", scope: "all" }, { shortIds }))).toEqual([
      "captionPresetId",
    ]);
  });
  it("needs something to retime", () => {
    expect(
      paths(checkChatAction({ action: "retime_short", shortId: "sh1" }, { shortIds })),
    ).toEqual(["startWord"]);
  });
});

describe("checkTranscript", () => {
  it("passes the fixture", () => {
    expect(checkTranscript(F.transcript)).toEqual([]);
  });
  it("rejects words out of order, unknown or repeated words, and long lines", () => {
    const words = [...F.transcript.words];
    words[2] = { ...words[2]!, startMs: 100, endMs: 200 };
    const t = {
      ...F.transcript,
      words,
      lines: [
        { id: "L0001", startMs: 1000, endMs: 1700, wordIds: ["w00002", "w00001"] },
        { id: "L0001", startMs: 0, endMs: 13_000, wordIds: ["w00009"] },
      ],
    };
    expect(paths(checkTranscript(t))).toEqual([
      "words[2].startMs",
      "lines[0].wordIds[1]",
      "lines[1].id",
      "lines[1].wordIds[0]",
      "lines[1]",
    ]);
  });
  it("rejects a line whose times don't match its words", () => {
    const t = { ...F.transcript, lines: [{ ...F.transcript.lines[0]!, endMs: 3000 }] };
    expect(checkTranscript(t)[0]?.message).toContain("must match");
  });
});

describe("checkProfile", () => {
  it("rejects a backwards length range", () => {
    expect(checkProfile(F.profile)).toEqual([]);
    expect(checkProfile({ lengthMs: { min: 40_000, max: 20_000 } })).toHaveLength(1);
  });
});

describe("formatPath", () => {
  it("formats keys and indexes", () => {
    expect(formatPath(["segments", 2, "srcOut"])).toBe("segments[2].srcOut");
    expect(formatPath([0, "id"])).toBe("[0].id");
    expect(formatPath([])).toBe("");
  });
});

describe("time math examples", () => {
  const segs = [
    { srcIn: 1000, srcOut: 2000 },
    { srcIn: 5000, srcOut: 6000 },
  ];
  it("maps between short time and source time", () => {
    expect(shortDuration(segs)).toBe(2000);
    expect(shortToSource(segs, 0)).toBe(1000);
    expect(shortToSource(segs, 999)).toBe(1999);
    expect(shortToSource(segs, 1000)).toBe(5000);
    expect(shortToSource(segs, 2000)).toBe(6000);
    expect(shortToSource(segs, 2001)).toBeNull();
    expect(shortToSource(segs, -1)).toBeNull();
    expect(shortToSource(segs, 1.5)).toBeNull();
    expect(sourceToShort(segs, 5500)).toBe(1500);
    expect(sourceToShort(segs, 2000)).toBeNull();
    expect(sourceToShort(segs, 3000)).toBeNull();
  });

  it("remaps a cut time to the next kept moment", () => {
    const after = [{ srcIn: 5000, srcOut: 6000 }];
    expect(remapShortTime(segs, after, 500)).toBe(0);
    expect(remapShortTime(segs, after, 1500)).toBe(500);
    expect(remapShortTime(segs, after, 2000)).toBe(1000);
  });

  it("ripple delete closes the gap and moves keys and the hook", () => {
    const short = {
      ...F.short,
      segments: segs,
      crop: {
        keys: [
          { t: 0, x: 0.2, ease: "hold" as const },
          { t: 500, x: 0.4, ease: "hold" as const },
          { t: 1500, x: 0.8, ease: "linear" as const },
        ],
      },
      hook: { text: "x", start: 200, end: 800, presetId: "h" },
    };
    const result = rippleDelete(short, [{ startMs: 1000, endMs: 2000 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.segments).toEqual([{ srcIn: 5000, srcOut: 6000 }]);
    // Keys at 0 and 500 both land on 0; the later one wins.
    expect(result.value.crop.keys).toEqual([
      { t: 0, x: 0.4, ease: "hold" },
      { t: 500, x: 0.8, ease: "linear" },
    ]);
    // The hook sat entirely in the cut, so it's dropped.
    expect(result.value.hook).toBeUndefined();
    expect(Short.safeParse(result.value).success).toBe(true);
  });

  it("ripple delete splits a segment around a cut in the middle", () => {
    const result = rippleDelete({ ...F.short, segments: [{ srcIn: 0, srcOut: 3000 }] }, [
      { startMs: 1000, endMs: 1500 },
    ]);
    expect(result.ok && result.value.segments).toEqual([
      { srcIn: 0, srcOut: 1000 },
      { srcIn: 1500, srcOut: 3000 },
    ]);
  });

  it("refuses to delete everything", () => {
    const result = rippleDelete(F.short, [{ startMs: 0, endMs: 10_000 }]);
    expect(result).toEqual({
      ok: false,
      reason: "That would cut everything in the short. Keep at least one word.",
    });
  });

  it("ripple-deletes words, and names bad word ids", () => {
    const result = rippleDeleteWords(F.short, F.transcript, [
      { fromWord: "w00002", toWord: "w00003" },
    ]);
    expect(result.ok && result.value.segments).toEqual([
      { srcIn: 1000, srcOut: 1450 },
      { srcIn: 5000, srcOut: 6300 },
    ]);
    expect(
      rippleDeleteWords(F.short, F.transcript, [{ fromWord: "w00009", toWord: "w00009" }]),
    ).toEqual({
      ok: false,
      reason: "Word w00009 isn't in the transcript.",
    });
    expect(wordRangeToSource(F.transcript, { fromWord: "w00003", toWord: "w00001" })).toEqual({
      ok: false,
      reason: "w00001 comes before w00003.",
    });
  });

  it("normalize keeps at least one key", () => {
    const short = { ...F.short, crop: { keys: [{ t: 2000, x: 0.5, ease: "hold" as const }] } };
    const out = normalizeShortTimes(
      { ...short, segments: [{ srcIn: 5000, srcOut: 5500 }] },
      short.segments,
    );
    expect(out.crop.keys).toEqual([{ t: 499, x: 0.5, ease: "hold" }]);
  });
});
