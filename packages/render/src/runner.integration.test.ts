// A real render with the bundled ffmpeg and fonts: two segments of a
// generated 1080p60 source, crop keys, captions and a hook, in a folder with
// spaces, quotes and non-ASCII. Skipped when the binaries aren't fetched.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MediaError, runTool } from "@alcyo/media";
import {
  BUILTIN_CAPTION_PRESETS,
  BUILTIN_HOOK_PRESETS,
  type Short,
  type Word,
} from "@alcyo/schema";
import { describe, expect, it } from "vitest";
import { DEFAULT_RENDER_PRESET } from "./args.ts";
import { cropSize, cropWindow } from "./crop.ts";
import { type RenderJob, renderShort } from "./runner.ts";

const win = process.platform === "win32";
const exe = (name: string) => (win ? `${name}.exe` : name);
const target = `${win ? "win" : process.platform === "darwin" ? "mac" : process.platform}-${process.arch}`;
const desktop = resolve(import.meta.dirname, "..", "..", "..", "apps", "desktop");
const binDir = process.env["ALCYO_BIN_DIR"] ?? join(desktop, "resources", "bin", target);
const fontsDir = join(desktop, "resources", "fonts");
const ffmpeg = join(binDir, exe("ffmpeg"));
const ffprobe = join(binDir, exe("ffprobe"));
const have = existsSync(ffmpeg) && existsSync(ffprobe);

const words: Word[] = Array.from({ length: 40 }, (_, i) => ({
  id: `w${String(i + 1).padStart(5, "0")}`,
  text: `word${i}`,
  startMs: 1000 + i * 400,
  endMs: 1000 + i * 400 + 300,
  p: 0.9,
}));

const short: Short = {
  title: "It's a test",
  reason: "r",
  segments: [
    { srcIn: 1000, srcOut: 3517 },
    { srcIn: 6003, srcOut: 8000 },
  ],
  crop: {
    keys: [
      { t: 0, x: 0, ease: "linear" },
      { t: 2000, x: 1, ease: "hold" },
      { t: 3000, x: 0.5, ease: "hold" },
    ],
  },
  captions: { presetId: "bold-pop", wordsPerLine: 3, overrides: [] },
  hook: { text: "Wait for it", start: 0, end: 2000, presetId: "hook-bold" },
};

describe.skipIf(!have)("renderShort with the bundled ffmpeg", () => {
  async function setup(): Promise<RenderJob> {
    const dir = await mkdtemp(join(tmpdir(), "alcyo-render-"));
    const folder = join(dir, "Shorts 名前 it's");
    await mkdir(folder);
    const src = join(folder, "source clip.mp4");
    execFileSync(ffmpeg, [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=60:d=10",
      "-f", "lavfi", "-i", "sine=frequency=330:duration=10",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      src,
    ]); // prettier-ignore
    return {
      ffmpeg,
      ffprobe,
      fontsDir,
      workDir: join(folder, "work"),
      sourcePath: src,
      source: { width: 1920, height: 1080, fpsNum: 60, fpsDen: 1, hasAudio: true },
      short,
      words,
      caption: BUILTIN_CAPTION_PRESETS[0]!,
      hook: BUILTIN_HOOK_PRESETS[0]!,
      preset: DEFAULT_RENDER_PRESET,
      outPath: join(folder, "out file.mp4"),
    };
  }

  it(
    "writes a checked 1080 × 1920 H.264 and AAC file of the kept length",
    { timeout: 120_000 },
    async () => {
      const job = await setup();
      const pcts: number[] = [];
      const out = await renderShort(
        job,
        { run: runTool },
        (p) => pcts.push(p),
        new AbortController().signal,
      );
      // 151 + 120 frames at 60 fps = 4517 ms.
      expect(out).toMatchObject({
        width: 1080,
        height: 1920,
        videoCodec: "h264",
        audioCodec: "aac",
      });
      expect(Math.abs(out.durationMs - 4517)).toBeLessThanOrEqual(100);
      expect(pcts.at(-1)).toBe(100);
      expect(existsSync(job.outPath)).toBe(true);
      expect(existsSync(job.workDir)).toBe(false);
      expect(readdirSync(join(job.outPath, "..")).sort()).toEqual([
        "out file.mp4",
        "source clip.mp4",
      ]);
    },
  );

  it("leaves nothing behind when cancelled", { timeout: 120_000 }, async () => {
    const job = await setup();
    const controller = new AbortController();
    const run = renderShort(
      job,
      { run: runTool },
      (p) => {
        if (p > 0) controller.abort();
      },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 400);
    await expect(run).rejects.toBeInstanceOf(MediaError);
    expect(await readdir(join(job.outPath, ".."))).toEqual(["source clip.mp4"]);
  });

  it(
    "ffmpeg's crop matches cropWindow within 1 px, for hold and linear keys",
    { timeout: 120_000 },
    async () => {
      const job = await setup();
      // A black 1920 x 1080 source with a 2 px white line at x = 1300 (inside every window), so the
      // line's column in each output frame gives the crop's x.
      const src = join(job.workDir, "..", "line.mp4");
      execFileSync(ffmpeg, [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "color=c=black:s=1920x1080:r=30:d=6,drawbox=x=1300:y=0:w=2:h=1080:color=white:t=fill",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0", "-pix_fmt", "yuv444p", "-c:a", "aac", "-t", "6",
      src,
    ]); // prettier-ignore
      const keys = [
        { t: 0, x: 0.6, ease: "hold" as const },
        { t: 1000, x: 0.65, ease: "linear" as const },
        { t: 4000, x: 0.95, ease: "hold" as const },
      ];
      const short: Short = { ...job.short, segments: [{ srcIn: 0, srcOut: 5000 }], crop: { keys } };
      delete short.hook;
      await renderShort(
        {
          ...job,
          sourcePath: src,
          source: { width: 1920, height: 1080, fpsNum: 30, fpsDen: 1, hasAudio: true },
          short,
          words: [],
        },
        { run: runTool },
        () => undefined,
        new AbortController().signal,
      );
      const { w } = cropSize(1920, 1080);
      const scale = 1080 / w;
      for (const tMs of [500, 1000, 2000, 2500, 3500, 4500]) {
        // One output row at the frame for tMs, as gray bytes.
        const row = execFileSync(ffmpeg, [
        "-v", "error", "-ss", String(tMs / 1000), "-i", job.outPath,
        "-frames:v", "1", "-vf", "crop=1080:1:0:960,format=gray", "-f", "rawvideo", "-",
      ]); // prettier-ignore
        let sum = 0;
        let wsum = 0;
        for (let x = 0; x < row.length; x++) {
          const v = row[x]!;
          if (v > 40) {
            sum += x * v;
            wsum += v;
          }
        }
        expect(wsum, `line visible at ${tMs} ms`).toBeGreaterThan(0);
        // The line's center in source pixels, from the output column.
        const center = (sum / wsum + 0.5) / scale;
        const ffmpegX = 1301 - center;
        // Output frames sit on 30 fps; cropWindow at that frame's time.
        const frameT = Math.round((Math.round((tMs / 1000) * 30) / 30) * 1000);
        expect(
          Math.abs(ffmpegX - cropWindow(keys, frameT, 1920, 1080).x),
          `at ${tMs} ms`,
        ).toBeLessThanOrEqual(1);
      }
    },
  );
});
