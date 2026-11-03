// Runs one render (Node side; the worker calls it). Writes the .ass and the
// filter graph into a work folder with copies of the bundled fonts, runs
// ffmpeg there, checks the output with ffprobe, and only then moves it into
// place. A cancel or failure leaves no file behind.
import { copyFile, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MediaError, type Runner, ffmpegProgress, ffprobeArgs, parseFfprobe } from "@alcyo/media";
import type { CaptionPreset, HookPreset, Short, Word } from "@alcyo/schema";
import { type RenderPreset, type SourceVideo, renderPlan } from "./args.ts";
import { buildAss } from "./ass.ts";

export const RENDER_FAILED = "The render stopped before it finished. Try again.";

/** The output's length may differ from the kept segments by this much. */
export const LENGTH_TOLERANCE_MS = 100;

export interface RenderJob {
  ffmpeg: string;
  ffprobe: string;
  /** resources/fonts, the OFL fonts the app ships. */
  fontsDir: string;
  /** An empty folder for this render. Removed at the end. */
  workDir: string;
  sourcePath: string;
  source: SourceVideo;
  short: Short;
  words: readonly Word[];
  caption: CaptionPreset;
  hook: HookPreset;
  preset: RenderPreset;
  outPath: string;
}

export interface RenderOutput {
  width: number;
  height: number;
  durationMs: number;
  videoCodec: string;
  audioCodec: string;
}

export async function renderShort(
  job: RenderJob,
  deps: { run: Runner },
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<RenderOutput> {
  await rm(job.workDir, { recursive: true, force: true });
  await mkdir(join(job.workDir, "fonts"), { recursive: true });
  const part = `${job.outPath}.part.mp4`;
  try {
    for (const f of await readdir(job.fontsDir)) {
      if (/\.(ttf|otf)$/i.test(f))
        await copyFile(join(job.fontsDir, f), join(job.workDir, "fonts", f));
    }
    const files = { filter: "filter.txt", ass: "captions.ass", fonts: "fonts" };
    const plan = renderPlan({
      sourcePath: job.sourcePath,
      source: job.source,
      short: job.short,
      preset: job.preset,
      outPath: part,
      files,
    });
    await writeFile(join(job.workDir, files.filter), plan.filter, "utf8");
    await writeFile(
      join(job.workDir, files.ass),
      buildAss({ short: job.short, words: job.words, caption: job.caption, hook: job.hook }),
      "utf8",
    );
    onProgress(0);
    const out = await deps.run(job.ffmpeg, plan.args, {
      cwd: job.workDir,
      signal,
      onStdoutLine: (line) => {
        const pct = ffmpegProgress(line, plan.durationMs);
        if (pct !== null) onProgress(Math.min(99, pct));
      },
    });
    if (signal.aborted) throw new MediaError("cancelled", "Cancelled.");
    if (out.code !== 0) throw new MediaError("tool-failed", RENDER_FAILED, out.stderrTail);

    const probed = await deps.run(job.ffprobe, ffprobeArgs(part), { collectStdout: true, signal });
    if (probed.code !== 0) throw new MediaError("tool-failed", RENDER_FAILED, probed.stderrTail);
    const p = parseFfprobe(probed.stdout);
    const result: RenderOutput = {
      width: p.video?.width ?? 0,
      height: p.video?.height ?? 0,
      durationMs: p.durationMs,
      videoCodec: p.video?.codec ?? "",
      audioCodec: p.audio?.codec ?? "",
    };
    const problems = checkOutput(result, job.preset, plan.durationMs);
    if (problems.length > 0) {
      throw new MediaError(
        "tool-failed",
        `The render didn't come out right: ${problems.join(" ")}`,
      );
    }
    await rename(part, job.outPath);
    onProgress(100);
    return result;
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  } finally {
    await rm(job.workDir, { recursive: true, force: true });
  }
}

/** The checks from spec 9: the preset's size, H.264, AAC, and the kept length within 100 ms. */
export function checkOutput(out: RenderOutput, preset: RenderPreset, expectMs: number): string[] {
  const problems: string[] = [];
  if (out.width !== preset.width || out.height !== preset.height) {
    problems.push(`It's ${out.width} × ${out.height}, not ${preset.width} × ${preset.height}.`);
  }
  if (out.videoCodec !== "h264")
    problems.push(`The video is ${out.videoCodec || "missing"}, not H.264.`);
  if (out.audioCodec !== "aac")
    problems.push(`The audio is ${out.audioCodec || "missing"}, not AAC.`);
  if (Math.abs(out.durationMs - expectMs) > LENGTH_TOLERANCE_MS) {
    problems.push(`It runs ${out.durationMs} ms, not ${expectMs} ms.`);
  }
  return problems;
}
