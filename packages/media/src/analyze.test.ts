// The pipeline with a fake runner that writes what each tool would.
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnalysisEvent, AnalysisRequest } from "@alcyo/ipc";
import { AnalysisSteps, Transcript, checkTranscript } from "@alcyo/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { analyze } from "./analyze.ts";
import { MediaError, NO_AUDIO_MESSAGE } from "./errors.ts";
import type { RunOptions, RunOutcome, Runner } from "./process.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
const whisperJson = fixture("whisper-ojf.json");

function probeJson(opts: { seconds: number; video?: string | null; audio?: boolean }): string {
  const streams: unknown[] = [];
  if (opts.video !== null) {
    streams.push({
      codec_type: "video",
      codec_name: opts.video ?? "hevc",
      width: 1920,
      height: 1080,
      avg_frame_rate: "30/1",
    });
  }
  if (opts.audio !== false) {
    streams.push({ codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 });
  }
  return JSON.stringify({
    streams,
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: String(opts.seconds) },
  });
}

function wav(samples: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + samples * 2, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(samples * 2, 40);
  const body = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) body.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), i * 2);
  return Buffer.concat([h, body]);
}

type Kind =
  | "ffprobe"
  | "audio"
  | "chunk"
  | "silences"
  | "loudness"
  | "scenes"
  | "encoder-test"
  | "proxy"
  | "thumbnails"
  | "whisper";

function kindOf(file: string, args: readonly string[]): Kind {
  if (file.endsWith("ffprobe")) return "ffprobe";
  if (file.endsWith("whisper-cli")) return "whisper";
  const s = args.join(" ");
  if (s.includes("testsrc2")) return "encoder-test";
  if (s.includes("silencedetect")) return "silences";
  if (s.includes("ebur128")) return "loudness";
  if (s.includes("showinfo")) return "scenes";
  if (s.includes("fps=1/5")) return "thumbnails";
  if (s.includes("scale=-2:720")) return "proxy";
  if (args.includes("-ss")) return "chunk";
  return "audio";
}

interface Fake {
  run: Runner;
  calls: Array<{ kind: Kind; args: readonly string[] }>;
  probe: string;
  /** Return a non-zero code, or "hang" to wait for cancel. */
  fail: Partial<Record<Kind, number | "hang" | ((n: number) => number | undefined)>>;
  encoderWorks: string[];
}

function fakeTools(): Fake {
  const fake: Fake = {
    calls: [],
    probe: probeJson({ seconds: 20 }),
    fail: {},
    encoderWorks: ["h264_qsv"],
    run: async (file, args, opts: RunOptions): Promise<RunOutcome> => {
      const kind = kindOf(file, args);
      const n = fake.calls.filter((c) => c.kind === kind).length;
      fake.calls.push({ kind, args });
      const ok = (stdout = ""): RunOutcome => ({ code: 0, stdout, stderrTail: [] });
      const f = fake.fail[kind];
      const failure = typeof f === "function" ? f(n) : f;
      if (failure === "hang") {
        // Like a real tool: write a partial output, then wait to be killed.
        const out = args.at(-1);
        if (out !== undefined && out !== "-") await writeFile(out, "partial");
        await new Promise((_, reject) => {
          opts.signal?.addEventListener("abort", () =>
            reject(new MediaError("cancelled", "Cancelled.")),
          );
        });
      }
      if (typeof failure === "number")
        return { code: failure, stdout: "", stderrTail: ["boom", "exit"] };

      const durationS = 20;
      switch (kind) {
        case "ffprobe":
          return ok(fake.probe);
        case "audio":
          opts.onStdoutLine?.("out_time_us=10000000");
          await writeFile(args.at(-1)!, wav(16000 * 2));
          return ok();
        case "chunk":
          await writeFile(args.at(-1)!, wav(1600));
          return ok();
        case "silences":
          opts.onStderrLine?.("[Parsed_silencedetect_0 @ 0x1] silence_start: 2");
          opts.onStderrLine?.(
            "[Parsed_silencedetect_0 @ 0x1] silence_end: 2.5 | silence_duration: 0.5",
          );
          return ok();
        case "loudness":
          opts.onStderrLine?.(
            "[Parsed_ebur128_0 @ 0x1] t: 0.5  TARGET:-23 LUFS    M: -20.0 S: -20.0     I: -20.0 LUFS",
          );
          opts.onStderrLine?.("[Parsed_ebur128_0 @ 0x1] Summary:");
          opts.onStderrLine?.("    I:         -18.5 LUFS");
          return ok();
        case "scenes":
          opts.onStderrLine?.(
            "[Parsed_showinfo_2 @ 0x6] n:   0 pts:  25600 pts_time:12.5   duration: 512",
          );
          return ok();
        case "encoder-test": {
          const enc = args[args.indexOf("-c:v") + 1]!;
          return fake.encoderWorks.includes(enc) ? ok() : { code: 1, stdout: "", stderrTail: [] };
        }
        case "proxy":
          opts.onStdoutLine?.(`out_time_us=${(durationS / 2) * 1e6}`);
          await writeFile(args.at(-1)!, "mp4");
          return ok();
        case "thumbnails": {
          const pattern = args.at(-1)!;
          await writeFile(pattern.replace("%03d", "001"), Buffer.alloc(100));
          await writeFile(pattern.replace("%03d", "002"), Buffer.alloc(9000));
          await writeFile(pattern.replace("%03d", "003"), Buffer.alloc(9000));
          return ok();
        }
        case "whisper": {
          const outBase = args[args.indexOf("-of") + 1]!;
          opts.onStderrLine?.("whisper_print_progress_callback: progress =  50%");
          await writeFile(`${outBase}.json`, whisperJson);
          return ok();
        }
      }
    },
  };
  return fake;
}

let root: string;
let sourceDir: string;
let source: string;
let req: AnalysisRequest;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "alcyo-analyze-"));
  sourceDir = join(root, `My "Stream" folder 名前`);
  await mkdir(sourceDir);
  source = join(sourceDir, "stream.mp4");
  await writeFile(source, "not really a video, but the fake tools don't mind");
  const project = join(root, "My Stream.alcyo");
  req = {
    sourceId: "src1",
    sourcePath: source,
    analysisDir: join(project, "sources", "src1", "analysis"),
    cacheDir: join(project, "cache", "src1"),
    tools: { ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe", whisper: "/bin/whisper-cli" },
    toolVersions: { ffmpeg: "9.0.2", whisper: "1.9.5" },
    model: { path: "/models/ggml-small.en.bin", name: "small.en" },
    vadModel: "/bin/models/silero.bin",
    mode: "full",
    encoder: null,
    threads: 4,
  };
});

const ran = (fake: Fake) => fake.calls.map((c) => c.kind).filter((k) => k !== "ffprobe");

describe("analyze", () => {
  it("runs every step in order and writes each output", async () => {
    const fake = fakeTools();
    const events: AnalysisEvent[] = [];
    const result = await analyze(req, { run: fake.run }, (e) => events.push(e));

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
    expect(ran(fake)).toEqual([
      "audio",
      "silences",
      "chunk",
      "whisper",
      "loudness",
      "scenes",
      "encoder-test",
      "encoder-test",
      "encoder-test",
      "proxy",
      "thumbnails",
    ]);
    expect(result.encoder).toBe("h264_qsv");
    expect(events).toContainEqual({ kind: "encoder", encoder: "h264_qsv" });
    expect(result.poster).toBe("thumbs-002.jpg");
    expect(result.problems).toEqual([]);

    const transcript = Transcript.parse(
      JSON.parse(await readFile(join(req.analysisDir, "transcript.json"), "utf8")),
    );
    expect(checkTranscript(transcript)).toEqual([]);
    expect(transcript.words.length).toBeGreaterThan(20);
    expect((await readdir(req.analysisDir)).sort()).toEqual([
      "loudness.json",
      "probe.json",
      "scenes.json",
      "silences.json",
      "steps.json",
      "transcript.json",
    ]);
    expect((await readdir(req.cacheDir)).sort()).toEqual([
      "audio.wav",
      "peaks.bin",
      "proxy.mp4",
      "thumbs-001.jpg",
      "thumbs-002.jpg",
      "thumbs-003.jpg",
    ]);
    // 2 s of audio at 100 pairs a second.
    expect((await readFile(join(req.cacheDir, "peaks.bin"))).length).toBe(400);
  });

  it("emits transcript step-done before the background steps, and progress that only climbs", async () => {
    const events: AnalysisEvent[] = [];
    await analyze(req, { run: fakeTools().run }, (e) => events.push(e));
    const doneSteps = events.flatMap((e) => (e.kind === "step-done" ? [e.step] : []));
    expect(doneSteps.indexOf("transcript")).toBeLessThan(doneSteps.indexOf("proxy"));
    const overall = events.flatMap((e) => (e.kind === "progress" ? [e.overallPct] : []));
    overall.forEach((p, i) => i > 0 && expect(p).toBeGreaterThanOrEqual(overall[i - 1]!));
    expect(overall.at(-1)).toBe(100);
  });

  it("skips every step on a second run with the same keys", async () => {
    await analyze({ ...req }, { run: fakeTools().run });
    const fake = fakeTools();
    const events: AnalysisEvent[] = [];
    const result = await analyze({ ...req, encoder: "h264_qsv" }, { run: fake.run }, (e) =>
      events.push(e),
    );
    expect(ran(fake)).toEqual([]);
    expect(Object.values(result.steps).every((s) => s === "skipped")).toBe(true);
    expect(events.filter((e) => e.kind === "step-done").every((e) => e.skipped)).toBe(true);
  });

  it("reruns a step and what reads it when its settings change, and nothing else", async () => {
    await analyze(req, { run: fakeTools().run });
    const fake = fakeTools();
    const result = await analyze(
      { ...req, encoder: "h264_qsv", model: { path: "/m/base.bin", name: "base.en" } },
      { run: fake.run },
    );
    expect(ran(fake)).toEqual(["chunk", "whisper"]);
    expect(result.steps.transcript).toBe("done");
    expect(result.steps.audio).toBe("skipped");
  });

  it("reruns everything when the source changes", async () => {
    await analyze(req, { run: fakeTools().run });
    await writeFile(source, "a different file now");
    const fake = fakeTools();
    const result = await analyze({ ...req, encoder: "h264_qsv" }, { run: fake.run });
    expect(Object.values(result.steps).every((s) => s === "done")).toBe(true);
  });

  it("resumes a transcription from the chunks already saved", async () => {
    // 20 minutes: two chunks of 10.
    const fake = fakeTools();
    fake.probe = probeJson({ seconds: 1200 });
    fake.fail.whisper = (n) => (n === 1 ? 1 : undefined);
    const first = await analyze({ ...req, mode: "quick" }, { run: fake.run });
    expect(first.steps.transcript).toBe("failed");
    expect(first.problems).toContainEqual({
      step: "transcript",
      message: "The transcript step stopped. The job log has the details.",
    });

    const again = fakeTools();
    again.probe = probeJson({ seconds: 1200 });
    const second = await analyze({ ...req, mode: "quick" }, { run: again.run });
    expect(second.steps.transcript).toBe("done");
    const whisperRuns = again.calls.filter((c) => c.kind === "whisper");
    expect(whisperRuns).toHaveLength(1);
    expect(whisperRuns[0]!.args[whisperRuns[0]!.args.indexOf("-of") + 1]).toMatch(/whisper-001$/);
    // The saved chunks are gone once the transcript is in.
    expect(await readdir(req.cacheDir)).not.toContain("transcript");
  });

  it("cancels a running step: rejects, removes partial files, records nothing for it", async () => {
    const fake = fakeTools();
    fake.fail.proxy = "hang";
    const controller = new AbortController();
    const pending = analyze(
      req,
      { run: fake.run },
      (e) => {
        if (e.kind === "progress" && e.step === "proxy" && e.stage !== "Testing video encoders")
          setTimeout(() => controller.abort(), 20);
      },
      controller.signal,
    );
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    const cache = await readdir(req.cacheDir);
    expect(cache.filter((f) => f.endsWith(".part") || f === "tmp")).toEqual([]);
    expect(cache).not.toContain("proxy.mp4");
    const steps = AnalysisSteps.parse(
      JSON.parse(await readFile(join(req.analysisDir, "steps.json"), "utf8")),
    );
    expect(steps.steps.transcript).toBeDefined();
    expect(steps.steps.proxy).toBeUndefined();
  });

  it("says plainly when there's no audio, and still runs the video steps", async () => {
    const fake = fakeTools();
    fake.probe = probeJson({ seconds: 20, audio: false });
    const result = await analyze(req, { run: fake.run });
    expect(result.problems).toEqual([{ step: "audio", message: NO_AUDIO_MESSAGE }]);
    for (const s of ["audio", "silences", "transcript", "loudness", "peaks"] as const) {
      expect(result.steps[s]).toBe("not-needed");
    }
    expect(result.steps.scenes).toBe("done");
    expect(result.steps.thumbnails).toBe("done");
  });

  it("skips the proxy when the source plays directly", async () => {
    const fake = fakeTools();
    fake.probe = probeJson({ seconds: 20, video: "h264" });
    const result = await analyze(req, { run: fake.run });
    expect(result.steps.proxy).toBe("not-needed");
    expect(ran(fake)).not.toContain("encoder-test");
    expect(result.encoder).toBeNull();
  });

  it("fails plainly when ffprobe can't read the file", async () => {
    const fake = fakeTools();
    fake.fail.ffprobe = 1;
    await expect(analyze(req, { run: fake.run })).rejects.toThrow(
      "This file couldn't be read. It may be damaged or not a video.",
    );
  });

  it("keeps going after a background step fails", async () => {
    const fake = fakeTools();
    fake.fail.scenes = 1;
    const result = await analyze(req, { run: fake.run });
    expect(result.steps.scenes).toBe("failed");
    expect(result.steps.thumbnails).toBe("done");
    expect(result.problems).toEqual([
      { step: "scenes", message: "The scenes step stopped. The job log has the details." },
    ]);
  });

  it("runs only the quick steps in quick mode", async () => {
    const fake = fakeTools();
    const result = await analyze({ ...req, mode: "quick" }, { run: fake.run });
    expect(Object.keys(result.steps)).toEqual([
      "probe",
      "audio",
      "silences",
      "transcript",
      "scenes",
      "loudness",
    ]);
    expect(ran(fake)).not.toContain("proxy");
  });

  it("writes nothing next to the source", async () => {
    await analyze(req, { run: fakeTools().run });
    expect(await readdir(sourceDir)).toEqual(["stream.mp4"]);
  });
});
