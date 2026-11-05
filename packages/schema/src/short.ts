// A short and its versions (plan section 22). Segment times are source ms;
// crop key and hook times are short ms. Ordering and references are checked
// in checks.ts, because .refine doesn't carry into JSON Schema.
import { z } from "zod";
import { CaptionPreset, HookPreset } from "./presets.ts";
import { Id, IsoDateTime, Ms, SchemaVersion } from "./primitives.ts";

export const Segment = z
  .object({ srcIn: Ms, srcOut: Ms })
  .refine((s) => s.srcOut > s.srcIn, { message: "srcOut must be after srcIn" });
export type Segment = z.infer<typeof Segment>;

export const CropKey = z.object({
  t: Ms,
  x: z.number().min(0).max(1),
  ease: z.enum(["hold", "linear"]),
});
export type CropKey = z.infer<typeof CropKey>;

export const WordOverride = z.object({
  wordId: Id,
  text: z.string().min(1).max(40).optional(),
  startDelta: z.number().int().min(-1000).max(1000).optional(),
  endDelta: z.number().int().min(-1000).max(1000).optional(),
  hidden: z.boolean().optional(),
});
export type WordOverride = z.infer<typeof WordOverride>;

export const Hook = z.object({
  text: z.string().min(1).max(80),
  start: Ms,
  end: Ms,
  presetId: Id,
});
export type Hook = z.infer<typeof Hook>;

export const ShortStyles = z.object({ caption: CaptionPreset, hook: HookPreset });
export type ShortStyles = z.infer<typeof ShortStyles>;

export const Short = z.object({
  title: z.string().min(1).max(80),
  reason: z.string().max(300),
  segments: z.array(Segment).min(1),
  crop: z.object({ keys: z.array(CropKey).min(1) }),
  captions: z.object({
    presetId: Id,
    wordsPerLine: z.number().int().min(1).max(4),
    overrides: z.array(WordOverride),
  }),
  hook: Hook.optional(),
  styles: ShortStyles.optional(),
});
export type Short = z.infer<typeof Short>;

export const ShortVersion = z.object({
  schemaVersion: SchemaVersion,
  shortId: Id,
  version: z.number().int().positive(),
  parent: z.number().int().positive().nullable(),
  createdBy: z.enum(["claude", "user"]),
  createdAt: IsoDateTime,
  /** The chat message that asked for it. */
  fromMessageId: Id.nullable(),
  note: z.string().max(200),
  sourceId: Id,
  sourceFingerprint: z.string(),
  short: Short,
});
export type ShortVersion = z.infer<typeof ShortVersion>;

export const ShortRef = z.object({ shortId: Id, version: z.number().int().positive() });
export type ShortRef = z.infer<typeof ShortRef>;

/** shorts/<shortId>/short.json: the head version and status. */
export const ShortFile = z.object({
  schemaVersion: SchemaVersion,
  shortId: Id,
  sourceId: Id,
  status: z.enum(["proposed", "edited", "rendered"]),
  head: z.number().int().positive(),
  createdAt: IsoDateTime,
});
export type ShortFile = z.infer<typeof ShortFile>;

/** shorts/<shortId>/draft.json: the autosaved working copy. */
export const Draft = z.object({
  schemaVersion: SchemaVersion,
  shortId: Id,
  sourceId: Id,
  baseVersion: z.number().int().positive(),
  savedAt: IsoDateTime,
  short: Short,
});
export type Draft = z.infer<typeof Draft>;

/** One row of the editor's version list (short:versions). */
export const VersionSummary = z.object({
  version: z.number().int().positive(),
  parent: z.number().int().positive().nullable(),
  createdBy: z.enum(["claude", "user"]),
  createdAt: IsoDateTime,
  note: z.string().max(200),
  fromMessageId: Id.nullable(),
});
export type VersionSummary = z.infer<typeof VersionSummary>;
