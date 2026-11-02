// The real pipeline: bundled ffmpeg, ffprobe and whisper-cli on a generated
// clip in a folder with spaces, quotes and non-ASCII. Skipped, with a note,
// when the binaries (pnpm fetch-binaries) or the whisper model aren't here.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AnalysisEvent, AnalysisRequest } from "@alcyo/ipc";
import { Scenes, Silences, Transcript, checkTranscript } from "@alcyo/schema";
import { describe, expect, it } from "vitest";
import { analyze } from "./analyze.ts";
import { runTool } from "./process.ts";

const win = process.platform === "win32";
const exe = (name: string) => (win ? `${name}.exe` : name);
const target = `${win ? "win" : process.platform === "darwin" ? "mac" : process.platform}-${process.arch}`;
const binDir =
  process.env["ALCYO_BIN_DIR"] ??
  resolve(import.meta.dirname, "..", "..", "..", "apps", "desktop", "resources", "bin", target);

function findModel(): { path: string; name: "small.en" | "base.en" } | null {
  const dirs = [
    process.env["ALCYO_MODELS_DIR"],
    win
      ? join(process.env["APPDATA"] ?? "", "Alcyo Shorts", "models")
      : join(homedir(), "Library", "Application Support", "Alcyo Shorts", "models"),
  ].filter((d): d is string => d !== undefined && d.length > 0);
  for (const dir of dirs) {
    for (const name of ["small.en", "base.en"] as const) {
      const path = join(dir, `ggml-${name}.bin`);
      if (existsSync(path)) return { path, name };
    }
  }
  return null;
}

const tools = {
  ffmpeg: join(binDir, exe("ffmpeg")),
  ffprobe: join(binDir, exe("ffprobe")),
  whisper: join(binDir, exe("whisper-cli")),
};
const vadDir = join(binDir, "models");
const vad = existsSync(vadDir)
  ? readdirSync(vadDir).find((f) => f.startsWith("ggml-silero"))
  : undefined;
const model = findModel();
const ready = Object.values(tools).every(existsSync) && vad !== undefined && model !== null;
const canSpeak = process.platform === "darwin" && existsSync("/usr/bin/say");

if (!ready) {
  console.warn(
    `[media] Skipping the real-tools test: needs ${binDir} (pnpm fetch-binaries) and a whisper model.`,
  );
}

const LINE = "Alright chat we are live. Today we finally beat the boss. No way, did you see that?";

/** A 10 s MKV (so it needs a proxy) with speech, a silence and a scene cut. */
function makeClip(dir: string): string {
  const out = join(dir, "stream.mkv");
  const speech = join(dir, "..", "speech.aiff");
  const audioIn = canSpeak
    ? (execFileSync("/usr/bin/say", ["-v", "Samantha", "-o", speech, LINE]), ["-i", speech])
    : ["-f", "lavfi", "-i", "sine=frequency=440:duration=6"];
  execFileSync(tools.ffmpeg, [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=red:s=1280x720:r=30:d=5",
    "-f", "lavfi", "-i", "color=c=blue:s=1280x720:r=30:d=5",
    ...audioIn,
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v];[2:a]apad=whole_dur=10[a]",
    "-map", "[v]", "-map", "[a]", "-t", "10",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
    out,
  ]); // prettier-ignore
  return out;
}

describe.skipIf(!ready)("analysis with the real tools", () => {
  it("analyzes a clip in an awkward folder, then skips it all on a rerun", async () => {
    const root = await mkdtemp(join(tmpdir(), "alcyo-real-"));
    // Windows forbids " in file names; everything else is fair game.
    const sourceDir = join(root, win ? `Strëam it's 名前 folder` : `Strëam "quoted" it's 名前`);
    await mkdir(sourceDir);
    const source = makeClip(sourceDir);
    const project = join(root, "My Stream.alcyo");
    const req: AnalysisRequest = {
      sourceId: "src1",
      sourcePath: source,
      analysisDir: join(project, "sources", "src1", "analysis"),
      cacheDir: join(project, "cache", "src1"),
      tools,
      toolVersions: { ffmpeg: "9.0.2", whisper: "1.9.5" },
      model: model!,
      vadModel: join(vadDir, vad!),
      mode: "full",
      encoder: null,
      threads: 4,
    };

    const events: AnalysisEvent[] = [];
    const result = await analyze(req, { run: runTool }, (e) => events.push(e));
    expect(result.problems).toEqual([]);
    expect(result.steps).toEqual({
      probe: "done",
      audio: "done",
      silences: "done",
      transcript: "done",
      loudness: "done",
      scenes: "done",
      proxy: "done",
      peaks: "done",
      thumbnails: "done",
    });
    expect(result.probe.playsDirectly).toBe(false);
    // AAC padding makes the file a few tens of ms longer than 10 s.
    expect(Math.abs(result.probe.durationMs - 10_000)).toBeLessThan(100);
    expect(result.encoder).not.toBeNull();
    expect(result.poster).toMatch(/^thumbs-\d{3}\.jpg$/);

    const read = async (name: string) =>
      JSON.parse(await readFile(join(req.analysisDir, name), "utf8")) as unknown;
    const transcript = Transcript.parse(await read("transcript.json"));
    expect(checkTranscript(transcript)).toEqual([]);
    if (canSpeak) {
      const text = transcript.words.map((w) => w.text.toLowerCase()).join(" ");
      expect(text).toContain("boss");
      // Speech ends by about 6 s; nothing should be placed in the padded tail.
      expect(transcript.words.at(-1)!.endMs).toBeLessThan(8000);
    }
    const silences = Silences.parse(await read("silences.json")).silences;
    expect(Math.abs(silences.at(-1)!.endMs - result.probe.durationMs)).toBeLessThan(100);
    expect(Scenes.parse(await read("scenes.json")).cutsMs).toContainEqual(5000);

    // The proxy is 720p H.264 with AAC.
    const probe = execFileSync(tools.ffprobe, [
      "-v", "error", "-show_entries", "stream=codec_name,height", "-of", "csv=p=0",
      join(req.cacheDir, "proxy.mp4"),
    ], { encoding: "utf8" }); // prettier-ignore
    expect(probe).toContain("h264,720");
    expect(probe).toContain("aac");
    const peaks = (await readFile(join(req.cacheDir, "peaks.bin"))).length;
    expect(Math.abs(peaks - 2000)).toBeLessThanOrEqual(20);

    expect(await readdir(sourceDir)).toEqual(["stream.mkv"]);
    expect(events.filter((e) => e.kind === "step-done").map((e) => e.step)).toContain("transcript");

    const again = await analyze({ ...req, encoder: result.encoder }, { run: runTool });
    expect(Object.values(again.steps).every((s) => s === "skipped")).toBe(true);
  }, 180_000);

  it("cancels a real ffmpeg mid-step and leaves no partial files", async () => {
    const root = await mkdtemp(join(tmpdir(), "alcyo-cancel-"));
    await mkdir(join(root, "src"));
    const source = makeClip(join(root, "src"));
    const cacheDir = join(root, "cache");
    const controller = new AbortController();
    const pending = analyze(
      {
        sourceId: "s",
        sourcePath: source,
        analysisDir: join(root, "analysis"),
        cacheDir,
        tools,
        toolVersions: { ffmpeg: "9.0.2", whisper: "1.9.5" },
        model: model!,
        vadModel: join(vadDir, vad!),
        mode: "full",
        encoder: null,
        threads: 4,
      },
      { run: runTool },
      (e) => {
        if (e.kind === "progress" && e.step === "transcript") controller.abort();
      },
      controller.signal,
    );
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    const left = await readdir(cacheDir);
    expect(left.filter((f) => f.endsWith(".part") || f === "tmp")).toEqual([]);
  }, 60_000);
});
