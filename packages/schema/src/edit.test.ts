import { describe, expect, it } from "vitest";
import {
  deleteCropKey,
  isWordKept,
  moveCropKey,
  nudgeWord,
  restoreWords,
  rippleDeleteShortRange,
  setCropKey,
  setHook,
  setWordOverride,
  setWordsPerLine,
  snapTo,
  splitAt,
  trimSegment,
} from "./edit.ts";
import type { Short } from "./short.ts";
import { checkShort } from "./checks.ts";
import { shortDuration } from "./time.ts";
import { transcript } from "./testing/fixtures.ts";

const base: Short = {
  title: "t",
  reason: "r",
  segments: [
    { srcIn: 1000, srcOut: 3000 },
    { srcIn: 5000, srcOut: 7000 },
  ],
  crop: {
    keys: [
      { t: 0, x: 0.5, ease: "hold" },
      { t: 2500, x: 0.8, ease: "linear" },
    ],
  },
  captions: { presetId: "bold-pop", wordsPerLine: 3, overrides: [] },
  hook: { text: "Wait", start: 0, end: 3000, presetId: "hook-bold" },
};

const value = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe("editor edits", () => {
  it("trims within neighbours and the source, keeping valid shorts", () => {
    const a = value(trimSegment(base, 0, "out", 9000, 60_000));
    expect(a.segments[0]).toEqual({ srcIn: 1000, srcOut: 5000 });
    const b = value(trimSegment(base, 1, "in", 100, 60_000));
    expect(b.segments[1]).toEqual({ srcIn: 3000, srcOut: 7000 });
    const c = value(trimSegment(base, 0, "in", 2990, 60_000));
    expect(c.segments[0]).toEqual({ srcIn: 2900, srcOut: 3000 });
    const d = value(trimSegment(base, 1, "out", 99_000, 8000));
    expect(d.segments[1]!.srcOut).toBe(8000);
    for (const s of [a, b, c, d]) expect(checkShort(s)).toEqual([]);
    expect(trimSegment(base, 5, "in", 0, 1).ok).toBe(false);
  });

  it("splits at the playhead, not on an edge", () => {
    const s = value(splitAt(base, 500));
    expect(s.segments).toEqual([
      { srcIn: 1000, srcOut: 1500 },
      { srcIn: 1500, srcOut: 3000 },
      { srcIn: 5000, srcOut: 7000 },
    ]);
    expect(shortDuration(s.segments)).toBe(4000);
    expect(splitAt(base, 2000).ok).toBe(false);
    expect(splitAt(base, 30).ok).toBe(false);
  });

  it("ripple-deletes a short-time range across a cut", () => {
    // 1500..2500 short = 2500..3000 of seg 1 and 5000..5500 of seg 2.
    const s = value(rippleDeleteShortRange(base, 1500, 2500));
    expect(s.segments).toEqual([
      { srcIn: 1000, srcOut: 2500 },
      { srcIn: 5500, srcOut: 7000 },
    ]);
    expect(checkShort(s)).toEqual([]);
    expect(rippleDeleteShortRange(base, 0, 4000).ok).toBe(false);
    expect(rippleDeleteShortRange(base, 300, 300).ok).toBe(false);
  });

  it("restores cut words, merging with what they touch", () => {
    const short: Short = { ...base, segments: [{ srcIn: 1000, srcOut: 1400 }] };
    expect(isWordKept(short, transcript.words[1]!)).toBe(false);
    const s = value(restoreWords(short, transcript, [{ fromWord: "w00002", toWord: "w00003" }]));
    expect(s.segments).toEqual([{ srcIn: 1000, srcOut: 2100 }]);
    const t = value(restoreWords(short, transcript, [{ fromWord: "w00005", toWord: "w00005" }]));
    // w00005 is far from the kept word, with w00002 to w00004 between: no bridge.
    expect(t.segments).toEqual([
      { srcIn: 1000, srcOut: 1400 },
      { srcIn: 5250, srcOut: 5600 },
    ]);
    expect(restoreWords(short, transcript, [{ fromWord: "w09999", toWord: "w00001" }]).ok).toBe(
      false,
    );
  });

  it("keeps caption overrides tidy", () => {
    let s = setWordOverride(base, "w00001", { text: "  NO   way " });
    expect(s.captions.overrides).toEqual([{ wordId: "w00001", text: "NO way" }]);
    s = setWordOverride(s, "w00001", { hidden: true });
    expect(s.captions.overrides).toEqual([{ wordId: "w00001", text: "NO way", hidden: true }]);
    s = setWordOverride(s, "w00001", { text: "", hidden: false });
    expect(s.captions.overrides).toEqual([]);
    s = nudgeWord(nudgeWord(base, "w00002", 10), "w00002", 100);
    expect(s.captions.overrides).toEqual([{ wordId: "w00002", startDelta: 110, endDelta: 110 }]);
    s = nudgeWord(s, "w00002", -110);
    expect(s.captions.overrides).toEqual([]);
    expect(nudgeWord(base, "w00002", 5000).captions.overrides[0]!.startDelta).toBe(1000);
    expect(setWordsPerLine(base, 9).captions.wordsPerLine).toBe(4);
  });

  it("adds, moves and deletes crop keys, keeping them sorted and inside", () => {
    let s = setCropKey(base, { t: 1000, x: 2, ease: "linear" });
    expect(s.crop.keys.map((k) => [k.t, k.x])).toEqual([
      [0, 0.5],
      [1000, 1],
      [2500, 0.8],
    ]);
    s = setCropKey(s, { t: 99_999, x: 0.1, ease: "hold" });
    expect(s.crop.keys.at(-1)).toEqual({ t: 3999, x: 0.1, ease: "hold" });
    s = value(moveCropKey(s, 1, 2500));
    expect(s.crop.keys.map((k) => k.t)).toEqual([0, 2500, 3999]);
    expect(s.crop.keys[1]!.x).toBe(1);
    s = value(deleteCropKey(s, 2));
    s = value(deleteCropKey(s, 1));
    expect(deleteCropKey(s, 0).ok).toBe(false);
    expect(checkShort(s)).toEqual([]);
  });

  it("sets the hook inside the short, or removes it", () => {
    const s = value(
      setHook(base, { text: " Look ", start: -5, end: 99_000, presetId: "hook-bold" }),
    );
    expect(s.hook).toEqual({ text: "Look", start: 0, end: 4000, presetId: "hook-bold" });
    expect(value(setHook(base, null)).hook).toBeUndefined();
    expect(setHook(base, { text: " ", start: 0, end: 1, presetId: "x" }).ok).toBe(false);
  });

  it("snaps within range only", () => {
    expect(snapTo(1040, [1000, 2000], 50)).toBe(1000);
    expect(snapTo(1100, [1000, 2000], 50)).toBe(1100);
  });
});
