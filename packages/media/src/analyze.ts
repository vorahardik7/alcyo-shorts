// The analysis pipeline (plan section 14): runs the steps in order, skips any
// whose cache key matches, streams progress, and cancels cleanly.
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AnalysisEvent, AnalysisRequest, AnalysisResult, StepOutcome } from "@alcyo/ipc";
import {
  type AnalysisStepName,
  Fingerprint,
  Loudness,
  Probe,
  Scenes,
  Silences,
  type SourceRange,
  Transcript,
  checkTranscript,
} from "@alcyo/schema";
import { z } from "zod";
import { readSteps, stepKey, writeSteps } from "./cache.ts";
import { planChunks } from "./chunks.ts";
import {
  MediaError,
  NO_AUDIO_MESSAGE,
  NO_MODEL_MESSAGE,
  UNREADABLE_MESSAGE,
  stepFailed,
} from "./errors.ts";
import {
  AUDIO_RATE,
  ENCODER_ORDER,
  PROXY_HEIGHT,
  SCENE_THRESHOLD,
  SCENE_WIDTH,
  SILENCE_MIN_MS,
  SILENCE_NOISE_DB,
  THUMB_EVERY_MS,
  THUMB_WIDTH,
  audioArgs,
  chunkAudioArgs,
  encoderTestArgs,
  loudnessArgs,
  proxyArgs,
  sceneArgs,
  silenceArgs,
  thumbnailArgs,
} from "./ffmpeg-args.ts";
import {
  exists,
  readJson,
  removeQuietly,
  renameInto,
  tempPathFor,
  writeJsonAtomic,
} from "@alcyo/store";
import { fingerprint as fingerprintOf } from "./fingerprint.ts";
import { parseLoudness, parseScenes, parseSilences } from "./parse.ts";
import { PEAKS_PER_SECOND, writePeaks } from "./peaks.ts";
import { ffprobeArgs, parseFfprobe } from "./probe.ts";
import type { Runner } from "./process.ts";
import { clampPct, ffmpegProgress, whisperProgress } from "./progress.ts";
import {
  type RawWord,
  WhisperJson,
  buildTranscript,
  fixWordTimes,
  parseVadMap,
  remapTokens,
  tokensToWords,
  whisperArgs,
} from "./whisper.ts";

export const FULL_STEPS = [
  "probe",
  "audio",
  "silences",
  "transcript",
  "loudness",
  "scenes",
  "proxy",
  "peaks",
  "thumbnails",
] as const satisfies readonly AnalysisStepName[];
export const QUICK_STEPS = [
  "probe",
  "audio",
  "silences",
  "transcript",
  "scenes",
  "loudness",
] as const satisfies readonly AnalysisStepName[];
type Step = (typeof FULL_STEPS)[number];

/** Rough share of a job's time, so the overall bar moves evenly. */
const WEIGHT: Record<Step, number> = {
  probe: 1,
  audio: 8,
  silences: 3,
  transcript: 60,
  loudness: 3,
  scenes: 6,
  proxy: 12,
  peaks: 2,
  thumbnails: 5,
};

const READS: Record<Step, Step[]> = {
  probe: [],
  audio: ["probe"],
  silences: ["audio"],
  transcript: ["audio", "silences"],
  loudness: ["audio"],
  scenes: ["probe"],
  proxy: ["probe"],
  peaks: ["audio"],
  thumbnails: ["probe"],
};

const NEEDS_AUDIO = new Set<Step>(["audio", "silences", "transcript", "loudness", "peaks"]);
const NEEDS_VIDEO = new Set<Step>(["scenes", "proxy", "thumbnails"]);

export const ProbeFile = z.object({
  schemaVersion: z.literal(1),
  sourceId: z.string(),
  probe: Probe,
  fingerprint: Fingerprint,
});

const ChunkFile = z.object({
  key: z.string(),
  startMs: z.number().int(),
  endMs: z.number().int(),
  language: z.string(),
  words: z.array(
    z.object({ text: z.string(), startMs: z.number(), endMs: z.number(), p: z.number() }),
  ),
});

export interface AnalyzeDeps {
  run: Runner;
  now?: () => Date;
  /**
   * Awaited before each background step (after the transcript), so a render
   * can run first. Plan section 23 spec 9: background analysis pauses.
   */
  waitTurn?: (step: AnalysisStepName) => Promise<void>;
}

/** Steps that wait while a render runs. Probe to transcript never wait. */
export const BACKGROUND_STEPS: ReadonlySet<AnalysisStepName> = new Set([
  "loudness",
  "scenes",
  "proxy",
  "peaks",
  "thumbnails",
]);

export interface Paths {
  probe: string;
  steps: string;
  silences: string;
  transcript: string;
  loudness: string;
  scenes: string;
  audio: string;
  proxy: string;
  peaks: string;
  chunks: string;
  tmp: string;
}

export function analysisPaths(req: Pick<AnalysisRequest, "analysisDir" | "cacheDir">): Paths {
  const a = req.analysisDir;
  const c = req.cacheDir;
  return {
    probe: join(a, "probe.json"),
    steps: join(a, "steps.json"),
    silences: join(a, "silences.json"),
    transcript: join(a, "transcript.json"),
    loudness: join(a, "loudness.json"),
    scenes: join(a, "scenes.json"),
    audio: join(c, "audio.wav"),
    proxy: join(c, "proxy.mp4"),
    peaks: join(c, "peaks.bin"),
    chunks: join(c, "transcript"),
    tmp: join(c, "tmp"),
  };
}

const POSTER_MIN_BYTES = 6 * 1024;
const THUMB_RE = /^thumbs-\d{3,}\.jpg$/;

/**
 * Runs the request's steps. Resolves with what happened to each; rejects with
 * MediaError("unreadable") when ffprobe can't read the source, or
 * MediaError("cancelled") when the signal aborts.
 */
export async function analyze(
  req: AnalysisRequest,
  deps: AnalyzeDeps,
  onEvent: (event: AnalysisEvent) => void = () => undefined,
  signal: AbortSignal = new AbortController().signal,
): Promise<AnalysisResult> {
  const now = deps.now ?? (() => new Date());
  const paths = analysisPaths(req);
  await mkdir(req.analysisDir, { recursive: true });
  await mkdir(req.cacheDir, { recursive: true });

  const order: readonly Step[] = req.mode === "quick" ? QUICK_STEPS : FULL_STEPS;
  const totalWeight = order.reduce((n, s) => n + WEIGHT[s], 0);
  let doneWeight = 0;
  const progress = (step: Step, stage: string, pct: number) =>
    onEvent({
      kind: "progress",
      step,
      stage,
      pct: clampPct(pct),
      overallPct: clampPct(((doneWeight + (WEIGHT[step] * pct) / 100) / totalWeight) * 100),
    });

  const temps = new Set<string>();
  const temp = (target: string) => {
    const t = tempPathFor(target);
    temps.add(t);
    return t;
  };
  const cleanTemps = async () => {
    await Promise.all([...temps].map(removeQuietly));
    temps.clear();
  };
  const run = async (
    step: Step,
    file: string,
    args: string[],
    opts: Parameters<Runner>[2] = {},
  ) => {
    const out = await deps.run(file, args, { ...opts, signal });
    if (out.code !== 0) throw stepFailed(step, out.stderrTail);
    return out;
  };

  // Probe always runs: it's quick, and every key needs the fingerprint.
  progress("probe", "Reading the file", 0);
  const probeOut = await deps.run(req.tools.ffprobe, ffprobeArgs(req.sourcePath), {
    signal,
    collectStdout: true,
  });
  if (probeOut.code !== 0)
    throw new MediaError("unreadable", UNREADABLE_MESSAGE, probeOut.stderrTail);
  const probe = parseFfprobe(probeOut.stdout);
  const fp = await fingerprintOf(req.sourcePath, probe);
  const durationMs = probe.durationMs;

  const stepsFile = await readSteps(paths.steps, req.sourceId);
  const keys = new Map<Step, string>();
  const outcomes: Partial<Record<Step, StepOutcome>> = {};
  const problems: AnalysisResult["problems"] = [];
  let poster: string | null = null;
  let encoder = req.encoder;

  const settingsFor = (step: Step): Record<string, unknown> => {
    switch (step) {
      case "probe":
        return {};
      case "audio":
        return { rate: AUDIO_RATE, channels: 1 };
      case "silences":
        return { noiseDb: SILENCE_NOISE_DB, minMs: SILENCE_MIN_MS };
      case "transcript":
        return {
          model: req.model?.name ?? null,
          vad: "silero-v6.2.0",
          language: "en",
          nfa: true,
          timing: "dtw",
          // Token times put back on the file's clock (whisper.cpp 1.9.5 VAD bug).
          vadMap: 1,
        };
      case "loudness":
        return { framelog: "1s-max" };
      case "scenes":
        return { threshold: SCENE_THRESHOLD, width: SCENE_WIDTH };
      case "proxy":
        return { encoder, height: PROXY_HEIGHT, gopSeconds: 1 };
      case "peaks":
        return { perSecond: PEAKS_PER_SECOND };
      case "thumbnails":
        return { everyMs: THUMB_EVERY_MS, width: THUMB_WIDTH };
    }
  };
  const toolVersion = (step: Step) =>
    step === "transcript"
      ? `whisper ${req.toolVersions.whisper}`
      : step === "peaks"
        ? "alcyo 1"
        : `ffmpeg ${req.toolVersions.ffmpeg}`;

  const outputsOf = (step: Step): string[] => {
    switch (step) {
      case "probe":
        return [paths.probe];
      case "audio":
        return [paths.audio];
      case "silences":
        return [paths.silences];
      case "transcript":
        return [paths.transcript];
      case "loudness":
        return [paths.loudness];
      case "scenes":
        return [paths.scenes];
      case "proxy":
        return [paths.proxy];
      case "peaks":
        return [paths.peaks];
      case "thumbnails":
        return [join(req.cacheDir, "thumbs-001.jpg")];
    }
  };

  const readSilences = async (): Promise<SourceRange[]> =>
    (await readJson(paths.silences, Silences))?.silences ?? [];

  const bodies: Record<Step, (key: string) => Promise<void>> = {
    probe: async () => {
      await writeJsonAtomic(paths.probe, {
        schemaVersion: 1,
        sourceId: req.sourceId,
        probe,
        fingerprint: fp,
      });
    },

    audio: async () => {
      const out = temp(paths.audio);
      await run("audio", req.tools.ffmpeg, audioArgs(req.sourcePath, out), {
        onStdoutLine: (line) => {
          const pct = ffmpegProgress(line, durationMs);
          if (pct !== null) progress("audio", "Extracting audio", pct);
        },
      });
      await renameInto(out, paths.audio);
    },

    silences: async () => {
      const lines: string[] = [];
      await run("silences", req.tools.ffmpeg, silenceArgs(paths.audio), {
        onStdoutLine: (line) => {
          const pct = ffmpegProgress(line, durationMs);
          if (pct !== null) progress("silences", "Finding pauses", pct);
        },
        onStderrLine: (line) => {
          if (line.includes("silence_")) lines.push(line);
        },
      });
      await writeJsonAtomic(
        paths.silences,
        Silences.parse({
          schemaVersion: 1,
          sourceId: req.sourceId,
          silences: parseSilences(lines, durationMs),
        }),
      );
    },

    transcript: async (key) => {
      const model = req.model!;
      const chunks = planChunks(durationMs, await readSilences());
      await mkdir(paths.chunks, { recursive: true });
      await mkdir(paths.tmp, { recursive: true });
      const words: RawWord[] = [];
      let language = "en";
      let doneMs = 0;
      for (const [i, chunk] of chunks.entries()) {
        const n = String(i).padStart(3, "0");
        const savedPath = join(paths.chunks, `chunk-${n}.json`);
        const saved = await readJson(savedPath, ChunkFile);
        const span = chunk.endMs - chunk.startMs;
        const stage =
          chunks.length === 1 ? "Transcribing" : `Transcribing part ${i + 1} of ${chunks.length}`;
        if (
          saved !== null &&
          saved.key === key &&
          saved.startMs === chunk.startMs &&
          saved.endMs === chunk.endMs
        ) {
          words.push(...saved.words);
          language = saved.language;
          doneMs += span;
          progress("transcript", stage, (doneMs / durationMs) * 100);
          continue;
        }
        const wav = temp(join(paths.tmp, `chunk-${n}.wav`));
        await run(
          "transcript",
          req.tools.ffmpeg,
          chunkAudioArgs(paths.audio, chunk.startMs, chunk.endMs, wav),
        );
        const outBase = join(paths.tmp, `whisper-${n}`);
        temps.add(`${outBase}.json`);
        const vadLines: string[] = [];
        const onLine = (line: string) => {
          if (line.includes("vad_segment_info")) vadLines.push(line);
          const pct = whisperProgress(line);
          if (pct !== null)
            progress("transcript", stage, ((doneMs + (span * pct) / 100) / durationMs) * 100);
        };
        await run(
          "transcript",
          req.tools.whisper,
          whisperArgs({
            model: model.path,
            modelName: model.name,
            vadModel: req.vadModel,
            wav,
            outBase,
            threads: req.threads,
          }),
          { onStdoutLine: onLine, onStderrLine: onLine },
        );
        const raw = await readJson(`${outBase}.json`, WhisperJson);
        if (raw === null) throw stepFailed("transcript", ["whisper-cli wrote no readable JSON."]);
        const json = remapTokens(raw, parseVadMap(vadLines));
        const chunkWords = json.transcription.flatMap((seg) =>
          tokensToWords(seg.tokens, chunk.startMs),
        );
        language = json.result?.language ?? language;
        await writeJsonAtomic(savedPath, {
          key,
          startMs: chunk.startMs,
          endMs: chunk.endMs,
          language,
          words: chunkWords,
        });
        await removeQuietly(wav);
        await removeQuietly(`${outBase}.json`);
        words.push(...chunkWords);
        doneMs += span;
        progress("transcript", stage, (doneMs / durationMs) * 100);
      }
      const transcript = buildTranscript({
        sourceId: req.sourceId,
        language,
        model: model.name,
        words: fixWordTimes(words),
      });
      const issues = checkTranscript(Transcript.parse(transcript));
      if (issues.length > 0)
        throw stepFailed(
          "transcript",
          issues.map((i) => `${i.path}: ${i.message}`),
        );
      await writeJsonAtomic(paths.transcript, transcript);
      // Chunk results only matter until the transcript is in.
      await removeQuietly(paths.chunks);
    },

    loudness: async () => {
      const lines: string[] = [];
      await run("loudness", req.tools.ffmpeg, loudnessArgs(paths.audio), {
        onStdoutLine: (line) => {
          const pct = ffmpegProgress(line, durationMs);
          if (pct !== null) progress("loudness", "Measuring loudness", pct);
        },
        onStderrLine: (line) => {
          if (line.includes("ebur128") || /^\s*I:/.test(line)) lines.push(line);
        },
      });
      const parsed = parseLoudness(lines);
      await writeJsonAtomic(
        paths.loudness,
        Loudness.parse({ schemaVersion: 1, sourceId: req.sourceId, ...parsed }),
      );
    },

    scenes: async () => {
      const lines: string[] = [];
      await run("scenes", req.tools.ffmpeg, sceneArgs(req.sourcePath), {
        onStdoutLine: (line) => {
          const pct = ffmpegProgress(line, durationMs);
          if (pct !== null) progress("scenes", "Finding scene cuts", pct);
        },
        onStderrLine: (line) => {
          if (line.includes("showinfo") && line.includes("pts_time")) lines.push(line);
        },
      });
      await writeJsonAtomic(
        paths.scenes,
        Scenes.parse({ schemaVersion: 1, sourceId: req.sourceId, cutsMs: parseScenes(lines) }),
      );
    },

    proxy: async () => {
      const out = temp(paths.proxy);
      const fps = probe.video === null ? 30 : probe.video.fpsNum / probe.video.fpsDen;
      await run(
        "proxy",
        req.tools.ffmpeg,
        proxyArgs({
          input: req.sourcePath,
          out,
          encoder: encoder ?? "libx264",
          fps,
          hasAudio: probe.audio !== null,
        }),
        {
          onStdoutLine: (line) => {
            const pct = ffmpegProgress(line, durationMs);
            if (pct !== null) progress("proxy", "Making a preview copy", pct);
          },
        },
      );
      await renameInto(out, paths.proxy);
    },

    peaks: async () => {
      progress("peaks", "Drawing the waveform", 0);
      await writePeaks(paths.audio, paths.peaks, signal);
    },

    thumbnails: async () => {
      const dir = join(paths.tmp, "thumbs");
      await removeQuietly(dir);
      await mkdir(dir, { recursive: true });
      temps.add(dir);
      await run(
        "thumbnails",
        req.tools.ffmpeg,
        thumbnailArgs(req.sourcePath, join(dir, "thumbs-%03d.jpg")),
        {
          onStdoutLine: (line) => {
            const pct = ffmpegProgress(line, durationMs);
            if (pct !== null) progress("thumbnails", "Making thumbnails", pct);
          },
        },
      );
      for (const old of (await readdir(req.cacheDir)).filter((f) => THUMB_RE.test(f))) {
        await removeQuietly(join(req.cacheDir, old));
      }
      const made = (await readdir(dir)).filter((f) => THUMB_RE.test(f)).sort();
      for (const f of made) await renameInto(join(dir, f), join(req.cacheDir, f));
      await removeQuietly(dir);
    },
  };

  const finish = (step: Step, outcome: StepOutcome) => {
    outcomes[step] = outcome;
    doneWeight += WEIGHT[step];
    if (outcome === "done" || outcome === "skipped") {
      onEvent({ kind: "step-done", step, skipped: outcome === "skipped" });
    }
  };

  try {
    for (const step of order) {
      if (signal.aborted) throw new MediaError("cancelled", "Cancelled.");
      if (deps.waitTurn !== undefined && BACKGROUND_STEPS.has(step)) {
        await deps.waitTurn(step);
        if (signal.aborted) throw new MediaError("cancelled", "Cancelled.");
      }

      const blocked =
        (NEEDS_AUDIO.has(step) && probe.audio === null) ||
        (NEEDS_VIDEO.has(step) && probe.video === null) ||
        (step === "proxy" && probe.playsDirectly) ||
        READS[step].some((r) => outcomes[r] === "failed" || outcomes[r] === "not-needed");
      const noModel = step === "transcript" && req.model === null;
      if (blocked || noModel) {
        if (step === "audio" && probe.audio === null)
          problems.push({ step, message: NO_AUDIO_MESSAGE });
        if (noModel && !blocked) problems.push({ step, message: NO_MODEL_MESSAGE });
        delete stepsFile.steps[step];
        finish(step, "not-needed");
        continue;
      }

      if (step === "proxy" && encoder === null) {
        progress("proxy", "Testing video encoders", 0);
        encoder = await pickEncoder(deps.run, req.tools.ffmpeg, signal);
        onEvent({ kind: "encoder", encoder });
      }

      const key = stepKey(step, {
        fingerprint: fp,
        settings: settingsFor(step),
        toolVersion: toolVersion(step),
        inputs: READS[step].map((r) => keys.get(r) ?? ""),
      });
      keys.set(step, key);

      const recorded = stepsFile.steps[step];
      const outputs = outputsOf(step);
      if (recorded?.key === key && (await allExist(outputs))) {
        finish(step, "skipped");
        continue;
      }

      try {
        progress(step, stageName(step), 0);
        await bodies[step](key);
        await cleanTemps();
      } catch (error) {
        await cleanTemps();
        if (error instanceof MediaError && error.code === "cancelled") throw error;
        if (signal.aborted) throw new MediaError("cancelled", "Cancelled.");
        const message =
          error instanceof MediaError
            ? error.message
            : `The ${step} step stopped. The job log has the details.`;
        problems.push({ step, message });
        delete stepsFile.steps[step];
        await writeSteps(paths.steps, stepsFile);
        finish(step, "failed");
        continue;
      }
      stepsFile.steps[step] = {
        key,
        toolVersion: toolVersion(step),
        finishedAt: now().toISOString(),
      };
      await writeSteps(paths.steps, stepsFile);
      progress(step, stageName(step), 100);
      finish(step, "done");
    }
  } finally {
    await cleanTemps();
    await removeQuietly(paths.tmp);
  }

  if (outcomes.thumbnails === "done" || outcomes.thumbnails === "skipped") {
    poster = await pickPoster(req.cacheDir);
  }
  await writeSteps(paths.steps, stepsFile);

  return {
    sourceId: req.sourceId,
    probe,
    fingerprint: fp,
    steps: outcomes,
    problems,
    poster,
    encoder,
  };
}

function stageName(step: Step): string {
  return {
    probe: "Reading the file",
    audio: "Extracting audio",
    silences: "Finding pauses",
    transcript: "Transcribing",
    loudness: "Measuring loudness",
    scenes: "Finding scene cuts",
    proxy: "Making a preview copy",
    peaks: "Drawing the waveform",
    thumbnails: "Making thumbnails",
  }[step];
}

async function allExist(paths: readonly string[]): Promise<boolean> {
  for (const p of paths) if (!(await exists(p))) return false;
  return true;
}

/** The first encoder in ENCODER_ORDER whose 1-second test encode works; libx264 otherwise. */
export async function pickEncoder(
  run: Runner,
  ffmpeg: string,
  signal?: AbortSignal,
): Promise<string> {
  for (const enc of ENCODER_ORDER) {
    if (enc === "libx264") break;
    const out = await run(ffmpeg, encoderTestArgs(enc), signal === undefined ? {} : { signal });
    if (out.code === 0) return enc;
  }
  return "libx264";
}

/** The first thumbnail over 6 KB (near-black frames compress below that), else the first. */
export async function pickPoster(dir: string): Promise<string | null> {
  const files = (await readdir(dir)).filter((f) => THUMB_RE.test(f)).sort();
  for (const f of files) {
    if ((await stat(join(dir, f))).size > POSTER_MIN_BYTES) return f;
  }
  return files[0] ?? null;
}
