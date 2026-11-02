// Caption and hook presets, and Alcyo templates (plan section 13).
import { z } from "zod";
import { HexColor, Id, Ms, SchemaVersion } from "./primitives.ts";
import { Platform } from "./profile.ts";

export const CaptionPreset = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  /** A font in resources/fonts; a missing one falls back with a note. */
  font: z.string().min(1).max(80),
  sizePx: z.number().int().min(12).max(200),
  color: HexColor,
  /** The spoken word's color. */
  highlightColor: HexColor,
  outlineColor: HexColor,
  outlinePx: z.number().int().min(0).max(20),
  shadowPx: z.number().int().min(0).max(20),
  uppercase: z.boolean(),
  /** Vertical position of the caption's center, 0 top to 1 bottom. */
  positionY: z.number().min(0).max(1),
  wordsPerLine: z.number().int().min(1).max(4),
  origin: z.enum(["builtin", "template", "ass"]),
});
export type CaptionPreset = z.infer<typeof CaptionPreset>;

export const HookPreset = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  font: z.string().min(1).max(80),
  sizePx: z.number().int().min(12).max(200),
  color: HexColor,
  background: HexColor.nullable(),
  uppercase: z.boolean(),
  positionY: z.number().min(0).max(1),
  origin: z.enum(["builtin", "template", "ass"]),
});
export type HookPreset = z.infer<typeof HookPreset>;

/** preset.json: the presets available in userData. */
export const PresetFile = z.object({
  schemaVersion: SchemaVersion,
  captionPresets: z.array(CaptionPreset),
  hookPresets: z.array(HookPreset),
});
export type PresetFile = z.infer<typeof PresetFile>;

/** *.alcyo-template.json: export, share with an editor, import elsewhere. */
export const Template = z.object({
  schemaVersion: SchemaVersion,
  kind: z.literal("alcyo-template"),
  name: z.string().min(1).max(80),
  captionPresets: z.array(CaptionPreset),
  hookPresets: z.array(HookPreset),
  targetLengthMs: z.object({ min: Ms, max: Ms }).optional(),
  titleRules: z.string().max(500).optional(),
  safeArea: Platform.optional(),
});
export type Template = z.infer<typeof Template>;
