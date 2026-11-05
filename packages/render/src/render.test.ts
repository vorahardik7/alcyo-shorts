import {
  BUILTIN_CAPTION_PRESETS,
  BUILTIN_HOOK_PRESETS,
  type CropKey,
  type Short,
  type Word,
} from "@alcyo/schema";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RENDER_PRESET,
  fileSlug,
  renderFileName,
  renderPlan,
  snapSegments,
} from "./args.ts";
import { assColor, assTime, buildAss, captionLines, captionWords } from "./ass.ts";
import { SECTION, cropFraction, cropSize, cropWindow, cropXExpr } from "./crop.ts";
import { checkOutput } from "./runner.ts";

const caption = BUILTIN_CAPTION_PRESETS[0]!; // Bold pop: uppercase, 3 words a line
const hook = BUILTIN_HOOK_PRESETS[0]!;

/** Evaluates an ffmpeg crop x expression at t seconds. Test-only. */
function evalExpr(expr: string, t: number): number {
  const js = expr.replace(/\bt\b/g, String(t));
  const fns = {
    lt: (a: number, b: number) => (a < b ? 1 : 0),
    gte: (a: number, b: number) => (a >= b ? 1 : 0),
    floor: Math.floor,
    clip: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)),
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return (new Function(...Object.keys(fns), `return ${js};`) as (...a: unknown[]) => number)(
    ...Object.values(fns),
  );
}

/** Words 300 ms long every 400 ms, from 10 s: "w0 w1 w2 ...". */
function words(n: number, from = 10_000): Word[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `w${String(i + 1).padStart(5, "0")}`,
    text: `word${i}`,
    startMs: from + i * 400,
    endMs: from + i * 400 + 300,
    p: 0.9,
  }));
}

const short = (over: Partial<Short> = {}): Short => ({
  title: "No way",
  reason: "r",
  segments: [
    { srcIn: 10_000, srcOut: 12_000 },
    { srcIn: 14_000, srcOut: 16_000 },
  ],
  crop: { keys: [{ t: 0, x: 0.5, ease: "hold" }] },
  captions: { presetId: caption.id, wordsPerLine: 3, overrides: [] },
  hook: { text: "Wait for it", start: 0, end: 3000, presetId: hook.id },
  ...over,
});

describe("crop", () => {
  it("fits the largest even 9:16 window", () => {
    expect(cropSize(1920, 1080)).toEqual({ w: 606, h: 1076 });
    expect(cropSize(1280, 720)).toEqual({ w: 404, h: 718 });
    // A source already narrower than 9:16 keeps its width.
    expect(cropSize(720, 1280)).toEqual({ w: 720, h: 1280 });
  });

  it("holds, moves linearly, and stays put outside the keys", () => {
    const keys: CropKey[] = [
      { t: 1000, x: 0.2, ease: "linear" },
      { t: 3000, x: 0.6, ease: "hold" },
      { t: 5000, x: 1, ease: "hold" },
    ];
    expect(cropFraction(keys, 0)).toBe(0.2);
    expect(cropFraction(keys, 2000)).toBeCloseTo(0.4);
    expect(cropFraction(keys, 4000)).toBe(0.6);
    expect(cropFraction(keys, 9000)).toBe(1);
    expect(cropWindow(keys, 9000, 1920, 1080)).toEqual({ x: 1314, y: 2, w: 606, h: 1076 });
  });

  it("gives ffmpeg the same x as cropWindow, with 200 keys and no deep nesting", () => {
    const keys: CropKey[] = Array.from({ length: 200 }, (_, i) => ({
      t: 100 + i * 150,
      x: ((i * 37) % 100) / 100,
      ease: i % 3 === 0 ? "hold" : "linear",
    }));
    const expr = cropXExpr(keys, 1920, 1080);
    // ffmpeg's parser allows about 100 levels; sections keep it shallow.
    let depth = 0;
    let max = 0;
    for (const c of expr) {
      if (c === "(") max = Math.max(max, ++depth);
      if (c === ")") depth--;
    }
    expect(max).toBeLessThan(10);
    expect(expr.match(/\(lt\(|\(gte\(/g)?.length).toBe(Math.ceil(201 / SECTION));
    for (let t = 0; t <= 31_000; t += 33) {
      expect(evalExpr(expr, t / 1000)).toBe(cropWindow(keys, t, 1920, 1080).x);
    }
  });
});

describe("frames and args", () => {
  it("snaps segment edges to source frames", () => {
    const s = snapSegments([{ srcIn: 1010, srcOut: 2025 }], 30, 1);
    expect(s).toEqual([
      {
        startFrame: 30,
        frames: 31,
        startSec: "1.000000",
        durSec: "1.033333",
        startMs: 1000,
        durMs: 1033,
      },
    ]);
    // 29.97 fps
    expect(snapSegments([{ srcIn: 0, srcOut: 1000 }], 30000, 1001)[0]!.frames).toBe(30);
  });

  const input = (over: Partial<Short> = {}) => ({
    sourcePath: "/Users/me/Stream recordings 名前/it's live.mp4",
    source: { width: 1920, height: 1080, fpsNum: 60, fpsDen: 1, hasAudio: true },
    short: short(over),
    preset: DEFAULT_RENDER_PRESET,
    outPath: "/Users/me/Movies/Alcyo Shorts/My Stream.alcyo/renders/no-way-v1-1080p30.mp4.part.mp4",
    files: { filter: "filter.txt", ass: "captions.ass", fonts: "fonts" },
  });

  it("matches the snapshot for two segments, captions and hook", () => {
    const plan = renderPlan(input());
    expect(plan.durationMs).toBe(4000);
    expect(plan.args).toMatchSnapshot();
    expect(plan.filter).toMatchSnapshot();
  });

  it("matches the snapshot with 200 crop keys", () => {
    const keys: CropKey[] = Array.from({ length: 200 }, (_, i) => ({
      t: i * 20,
      x: (i % 10) / 10,
      ease: "linear",
    }));
    expect(renderPlan(input({ crop: { keys } })).filter).toMatchSnapshot();
  });

  it("keeps the source path as one argument and the graph free of paths", () => {
    const plan = renderPlan(input());
    expect(plan.args.filter((a) => a === "-i")).toHaveLength(1);
    expect(plan.concat).toContain("inpoint 10.000000");
    expect(plan.concat.split("\n").filter((line) => line.startsWith("file "))).toHaveLength(1);
    expect(plan.filter).not.toContain("/Users/");
    expect(plan.filter).toContain("/0.010000,0,1)");
    expect(plan.filter).toContain("subtitles=filename=captions.ass:fontsdir=fonts");
  });

  it("gives identical args and graph for the same version", () => {
    expect(renderPlan(input())).toEqual(renderPlan(input()));
  });

  it("fills silence when the source has no audio", () => {
    const plan = renderPlan({ ...input(), source: { ...input().source, hasAudio: false } });
    expect(plan.filter).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=4.000000[a]");
    expect(plan.filter).not.toContain("[0:a]");
  });

  it("names files after the title, version and preset", () => {
    expect(fileSlug("Cat Brings a DEAD Mouse — Mid Match!")).toBe(
      "cat-brings-a-dead-mouse-mid-match",
    );
    expect(fileSlug("名前")).toBe("short");
    expect(renderFileName("No way", 3, DEFAULT_RENDER_PRESET)).toBe("no-way-v3-1080p30.mp4");
  });
});

describe("captions", () => {
  it("uses only kept words, shifted to short time", () => {
    // Segment 1 keeps words 0-4 (10.0 to 11.9 s); segment 2 keeps words 10-14.
    const cw = captionWords(short(), words(20));
    expect(cw.map((w) => w.text)).toEqual([
      "word0", "word1", "word2", "word3", "word4",
      "word10", "word11", "word12", "word13", "word14",
    ]); // prettier-ignore
    expect(cw[0]).toMatchObject({ startMs: 0, endMs: 300 });
    expect(cw[5]).toMatchObject({ startMs: 2000, endMs: 2300 });
  });

  it("applies overrides: text, timing and hidden", () => {
    const cw = captionWords(
      short({
        captions: {
          presetId: caption.id,
          wordsPerLine: 3,
          overrides: [
            { wordId: "w00001", text: "NO" },
            { wordId: "w00002", hidden: true },
            { wordId: "w00003", startDelta: 50, endDelta: -50 },
          ],
        },
      }),
      words(5),
    );
    expect(cw.map((w) => [w.text, w.startMs, w.endMs])).toEqual([
      ["NO", 0, 300],
      ["word2", 850, 1050],
      ["word3", 1200, 1500],
      ["word4", 1600, 1900],
    ]);
  });

  it("splits lines at wordsPerLine, gaps and sentence ends", () => {
    const cw = [
      { id: "a", text: "one", startMs: 0, endMs: 100 },
      { id: "b", text: "two.", startMs: 150, endMs: 250 },
      { id: "c", text: "three", startMs: 300, endMs: 400 },
      { id: "d", text: "four", startMs: 1500, endMs: 1600 },
    ];
    expect(captionLines(cw, 3).map((l) => l.map((w) => w.text))).toEqual([
      ["one", "two."],
      ["three"],
      ["four"],
    ]);
  });

  it("highlights the spoken word, draws the hook, and matches the snapshot", () => {
    const ass = buildAss({ short: short(), words: words(20), caption, hook });
    expect(ass).toContain(
      "Dialogue: 0,0:00:00.00,0:00:00.40,Caption,,0,0,0,,{\\an5\\pos(540,1382)}{\\1c&H15CCFA&}WORD0{\\r} WORD1 WORD2",
    );
    expect(ass).toContain("Style: Caption,Inter Black,88,&H00FFFFFF,");
    expect(ass).toContain(
      "Dialogue: 1,0:00:00.00,0:00:03.00,Hook,,0,0,0,,{\\an5\\pos(540,346)}WAIT FOR IT",
    );
    expect(ass).toMatchSnapshot();
    expect(buildAss({ short: short(), words: words(20), caption, hook })).toBe(ass);
  });

  it("falls back to Inter for a font that isn't bundled, and strips tag characters", () => {
    const ass = buildAss({
      short: short({ hook: { text: "{\\b1}hi", start: 0, end: 1000, presetId: hook.id } }),
      words: [],
      caption: { ...caption, font: "Comic Sans MS" },
      hook,
    });
    expect(ass).toContain("Style: Caption,Inter,88,");
    expect(ass).toContain("}/B1HI");
  });

  it("formats colors and times for ASS", () => {
    expect(assColor("#FACC15")).toBe("&H0015CCFA");
    expect(assColor("#00000080")).toBe("&H7F000000");
    expect(assTime(3_725_456)).toBe("1:02:05.46");
  });
});

describe("output check", () => {
  it("accepts the preset's size, H.264, AAC and the length within 100 ms", () => {
    const ok = {
      width: 1080,
      height: 1920,
      durationMs: 4060,
      videoCodec: "h264",
      audioCodec: "aac",
    };
    expect(checkOutput(ok, DEFAULT_RENDER_PRESET, 4000)).toEqual([]);
    expect(
      checkOutput({ ...ok, durationMs: 4200, videoCodec: "hevc" }, DEFAULT_RENDER_PRESET, 4000),
    ).toEqual(["The video is hevc, not H.264.", "It runs 4200 ms, not 4000 ms."]);
  });
});
