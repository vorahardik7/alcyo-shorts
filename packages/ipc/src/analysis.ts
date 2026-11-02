// The analysis job (plan section 14): what main asks the worker to run, the
// events it streams back, and the result. Main fills in every path, so the
// engine never derives one from the source's folder.
import { AnalysisStepName, Fingerprint, Probe } from "@alcyo/schema";
import { z } from "zod";

export const JobId = z.string().min(1).max(64);

export const AnalysisRequest = z.object({
  sourceId: z.string().min(1).max(64),
  sourcePath: z.string().min(1),
  /** sources/<sourceId>/analysis/ */
  analysisDir: z.string().min(1),
  /** cache/<sourceId>/ */
  cacheDir: z.string().min(1),
  tools: z.object({
    ffmpeg: z.string().min(1),
    ffprobe: z.string().min(1),
    whisper: z.string().min(1),
  }),
  /** Part of every cache key, so a tool update reruns its steps. */
  toolVersions: z.object({ ffmpeg: z.string().max(50), whisper: z.string().max(50) }),
  /** Null when the model isn't downloaded: the transcript step is skipped with a note. */
  model: z.object({ path: z.string().min(1), name: z.enum(["small.en", "base.en"]) }).nullable(),
  vadModel: z.string().min(1),
  /** Quick: probe, audio, silences, transcript, scenes, loudness. */
  mode: z.enum(["full", "quick"]),
  /** The saved proxy encoder, or null to run the test encode. */
  encoder: z.string().max(50).nullable(),
  threads: z.number().int().min(1).max(64),
});
export type AnalysisRequest = z.infer<typeof AnalysisRequest>;

export const AnalysisEvent = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("progress"),
    step: AnalysisStepName,
    stage: z.string().max(120),
    /** This step's percent. */
    pct: z.number().min(0).max(100),
    /** The whole job's percent, weighted by how long steps usually take. */
    overallPct: z.number().min(0).max(100),
  }),
  z.object({ kind: z.literal("step-done"), step: AnalysisStepName, skipped: z.boolean() }),
  /** The test encode picked an encoder; main saves it in settings. */
  z.object({ kind: z.literal("encoder"), encoder: z.string().max(50) }),
]);
export type AnalysisEvent = z.infer<typeof AnalysisEvent>;

export const StepOutcome = z.enum(["done", "skipped", "not-needed", "failed"]);
export type StepOutcome = z.infer<typeof StepOutcome>;

export const AnalysisResult = z.object({
  sourceId: z.string(),
  probe: Probe,
  fingerprint: Fingerprint,
  steps: z.partialRecord(AnalysisStepName, StepOutcome),
  /** Plain lines for steps that failed, like "This file has no audio…". */
  problems: z.array(z.object({ step: AnalysisStepName, message: z.string().max(300) })),
  /** File name of the poster thumbnail in the cache dir, when thumbnails ran. */
  poster: z.string().nullable(),
  encoder: z.string().nullable(),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;
