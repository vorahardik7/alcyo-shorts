// Viewer clips and where they sit in the VOD (plan sections 12 and 22).
import { z } from "zod";
import { HttpUrl, Id, Ms, SchemaVersion } from "./primitives.ts";

/** A match below this confidence shows as "Couldn't place this clip". */
export const CLIP_PLACED_MIN = 0.6;

/** True when a clip has a match good enough to show where it sits. */
export function isPlaced(match: { confidence: number } | null): boolean {
  return match !== null && match.confidence >= CLIP_PLACED_MIN;
}

export const ClipMatch = z
  .object({
    srcIn: Ms,
    srcOut: Ms,
    confidence: z.number().min(0).max(1),
    method: z.enum(["metadata", "transcript", "audio", "manual"]),
  })
  .refine((m) => m.srcOut > m.srcIn, { message: "srcOut must be after srcIn" });
export type ClipMatch = z.infer<typeof ClipMatch>;

export const ClipOrigin = z.discriminatedUnion("kind", [
  /** path: the downloaded copy inside the project. Missing on files from before spec 6. */
  z.object({ kind: z.literal("url"), url: HttpUrl, path: z.string().min(1).optional() }),
  z.object({ kind: z.literal("file"), path: z.string() }),
]);

export const Clip = z.object({
  clipId: Id,
  origin: ClipOrigin,
  title: z.string().max(200).optional(),
  clippedBy: z.string().max(100).optional(),
  durationMs: Ms,
  match: ClipMatch.nullable(),
});
export type Clip = z.infer<typeof Clip>;

/** clips/<clipId>/clip.json. */
export const ClipFile = Clip.extend({ schemaVersion: SchemaVersion });
export type ClipFile = z.infer<typeof ClipFile>;
