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

/**
 * Font families the app ships (OFL), as libass names them. The files arrive
 * with the render engine (spec 9); presets and imports are checked against
 * this list now. Anything else falls back to FALLBACK_FONT.
 */
export const BUNDLED_FONTS = [
  "Inter",
  "Inter SemiBold",
  "Inter Black",
  "Anton",
  "Montserrat ExtraBold",
] as const;
export const FALLBACK_FONT = "Inter";

export function isBundledFont(font: string): boolean {
  return (BUNDLED_FONTS as readonly string[]).some((f) => f.toLowerCase() === font.toLowerCase());
}

/** The four caption looks offered in onboarding. */
export const BUILTIN_CAPTION_PRESETS: readonly CaptionPreset[] = [
  {
    id: "bold-pop",
    name: "Bold pop",
    font: "Inter Black",
    sizePx: 88,
    color: "#FFFFFF",
    highlightColor: "#FACC15",
    outlineColor: "#000000",
    outlinePx: 6,
    shadowPx: 0,
    uppercase: true,
    positionY: 0.72,
    wordsPerLine: 3,
    origin: "builtin",
  },
  {
    id: "clean",
    name: "Clean",
    font: "Inter SemiBold",
    sizePx: 72,
    color: "#FFFFFF",
    highlightColor: "#FFFFFF",
    outlineColor: "#000000",
    outlinePx: 0,
    shadowPx: 4,
    uppercase: false,
    positionY: 0.75,
    wordsPerLine: 4,
    origin: "builtin",
  },
  {
    id: "punch",
    name: "Punch",
    font: "Anton",
    sizePx: 110,
    color: "#FFFFFF",
    highlightColor: "#22D3EE",
    outlineColor: "#000000",
    outlinePx: 8,
    shadowPx: 0,
    uppercase: true,
    positionY: 0.65,
    wordsPerLine: 2,
    origin: "builtin",
  },
  {
    id: "steady",
    name: "Steady",
    font: "Montserrat ExtraBold",
    sizePx: 80,
    color: "#FFFFFF",
    highlightColor: "#F472B6",
    outlineColor: "#111111",
    outlinePx: 5,
    shadowPx: 2,
    uppercase: false,
    positionY: 0.7,
    wordsPerLine: 3,
    origin: "builtin",
  },
];

export const BUILTIN_HOOK_PRESETS: readonly HookPreset[] = [
  {
    id: "hook-bold",
    name: "Bold",
    font: "Inter Black",
    sizePx: 72,
    color: "#000000",
    background: "#FFFFFF",
    uppercase: true,
    positionY: 0.18,
    origin: "builtin",
  },
  {
    id: "hook-plain",
    name: "Plain",
    font: "Anton",
    sizePx: 84,
    color: "#FFFFFF",
    background: null,
    uppercase: true,
    positionY: 0.2,
    origin: "builtin",
  },
];

/** Which hook goes with each caption look by default. */
export const HOOK_FOR_CAPTION: Readonly<Record<string, string>> = {
  "bold-pop": "hook-bold",
  clean: "hook-bold",
  punch: "hook-plain",
  steady: "hook-plain",
};
