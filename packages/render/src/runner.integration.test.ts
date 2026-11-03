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
});
