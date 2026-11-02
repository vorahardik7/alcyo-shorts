// Analysis outputs (plan sections 14 and 15). Word and line ordering is
// checked by checkTranscript in checks.ts.
import { z } from "zod";
import { Id, IsoDateTime, LineId, Ms, SchemaVersion, WordId } from "./primitives.ts";

export const Word = z
  .object({
    id: WordId,
    text: z.string().min(1).max(100),
    startMs: Ms,
    endMs: Ms,
    /** whisper's token probability, 0 to 1. */
    p: z.number().min(0).max(1),
  })
  .refine((w) => w.endMs > w.startMs, { message: "endMs must be after startMs" });
export type Word = z.infer<typeof Word>;

/** Lines of at most 12 s; Claude sees one per row. */
export const MAX_LINE_MS = 12_000;

export const Line = z.object({
  id: LineId,
  startMs: Ms,
  endMs: Ms,
  wordIds: z.array(WordId).min(1),
});
export type Line = z.infer<typeof Line>;

export const Transcript = z.object({
  schemaVersion: SchemaVersion,
  sourceId: Id,
  language: z.string().max(20),
  model: z.string().max(50),
  words: z.array(Word),
  lines: z.array(Line),
});
export type Transcript = z.infer<typeof Transcript>;

/** transcript:window answer: just the asked-for range. */
export const TranscriptWindow = z.object({
  sourceId: Id,
  fromMs: Ms,
  toMs: Ms,
  words: z.array(Word),
  lines: z.array(Line),
});
export type TranscriptWindow = z.infer<typeof TranscriptWindow>;

export const SourceRange = z
  .object({ startMs: Ms, endMs: Ms })
  .refine((r) => r.endMs > r.startMs, { message: "endMs must be after startMs" });
export type SourceRange = z.infer<typeof SourceRange>;

export const Silences = z.object({
  schemaVersion: SchemaVersion,
  sourceId: Id,
  silences: z.array(SourceRange),
});
export type Silences = z.infer<typeof Silences>;

export const Scenes = z.object({
  schemaVersion: SchemaVersion,
  sourceId: Id,
  cutsMs: z.array(Ms),
});
export type Scenes = z.infer<typeof Scenes>;

export const Loudness = z.object({
  schemaVersion: SchemaVersion,
  sourceId: Id,
  integratedLufs: z.number(),
  momentary: z.array(z.object({ tMs: Ms, lufs: z.number() })),
});
export type Loudness = z.infer<typeof Loudness>;

export const AnalysisStepName = z.enum([
  "probe",
  "audio",
  "silences",
  "transcript",
  "clips",
  "loudness",
  "scenes",
  "short-proxies",
  "proxy",
  "peaks",
  "thumbnails",
]);
export type AnalysisStepName = z.infer<typeof AnalysisStepName>;

/** analysis/steps.json: the cache key each finished step ran with. */
export const AnalysisSteps = z.object({
  schemaVersion: SchemaVersion,
  sourceId: Id,
  steps: z.partialRecord(
    AnalysisStepName,
    z.object({ key: z.string().min(1), toolVersion: z.string(), finishedAt: IsoDateTime }),
  ),
});
export type AnalysisSteps = z.infer<typeof AnalysisSteps>;
