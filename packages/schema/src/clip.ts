// Viewer clips and where they sit in the VOD (plan sections 12 and 22).
import { z } from "zod";
import { HttpUrl, Id, Ms, SchemaVersion } from "./primitives.ts";

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
  z.object({ kind: z.literal("url"), url: HttpUrl }),
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
