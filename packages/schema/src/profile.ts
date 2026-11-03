// The creator profile (plan sections 13 and 22). No .refine here: InterviewStep
// uses .omit on it. checkProfile checks lengthMs.min <= max.
import { z } from "zod";
import { Id, Ms, SchemaVersion } from "./primitives.ts";

export const GoodMoment = z.enum([
  "funny",
  "skill",
  "rage",
  "wholesome",
  "story",
  "info",
  "close-call",
]);
export type GoodMoment = z.infer<typeof GoodMoment>;

export const Platform = z.enum(["tiktok", "youtube-shorts", "reels"]);
export type Platform = z.infer<typeof Platform>;

export const CreatorProfile = z.object({
  schemaVersion: SchemaVersion,
  name: z.string().max(80),
  streams: z.string().max(300),
  audience: z.string().max(300),
  goodMoments: z.array(GoodMoment),
  lengthMs: z.object({ min: Ms, max: Ms }),
  titleRules: z.string().max(500),
  exampleTitles: z.array(z.string().max(80)).max(5),
  avoid: z.array(z.string().max(80)).max(20),
  platforms: z.array(Platform),
  captionPresetId: Id,
  hookPresetId: Id,
  style: z.object({
    summary: z.string().max(800),
    firstWordMs: Ms.optional(),
    wordsPerSecond: z.number().optional(),
    cutEveryMs: Ms.optional(),
    sampleCount: z.number().int().nonnegative(),
  }),
});
export type CreatorProfile = z.infer<typeof CreatorProfile>;

/** What code measures on one past short (plan section 13). Text and numbers only. */
export const PastShortMeasures = z.object({
  lengthMs: Ms,
  /** Null when there's no speech. */
  firstWordMs: Ms.nullable(),
  firstSentence: z.string().max(300),
  wordsPerSecond: z.number().nonnegative().nullable(),
  /** Length divided by (scene cuts + 1). */
  cutEveryMs: Ms,
  /** Silences over 300 ms that were left in, per 10 s. */
  pausesPer10s: z.number().nonnegative(),
  loudnessLufs: z.number().nullable(),
});
export type PastShortMeasures = z.infer<typeof PastShortMeasures>;

/** userData/samples/<sampleId>/sample.json. The video itself is never copied. */
export const SampleFile = z.object({
  schemaVersion: SchemaVersion,
  sampleId: Id,
  /** The file name only, for the list. Not sent to the agent. */
  fileName: z.string().max(260),
  addedAt: z.iso.datetime(),
  measures: PastShortMeasures,
  /** The first 8 s of words, for the style summary. */
  opening: z.string().max(600),
});
export type SampleFile = z.infer<typeof SampleFile>;

/** Default short length when the profile doesn't set one (section 22). */
export const DEFAULT_LENGTH_MS = { min: 15_000, max: 60_000 } as const;
