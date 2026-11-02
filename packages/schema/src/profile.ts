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

/** Default short length when the profile doesn't set one (section 22). */
export const DEFAULT_LENGTH_MS = { min: 15_000, max: 60_000 } as const;
