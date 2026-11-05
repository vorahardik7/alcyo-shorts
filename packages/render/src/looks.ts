import {
  BUILTIN_CAPTION_PRESETS,
  BUILTIN_HOOK_PRESETS,
  type CaptionPreset,
  type HookPreset,
  type Short,
  type ShortStyles,
} from "@alcyo/schema";

export interface LookCatalog {
  captionPresets: readonly CaptionPreset[];
  hookPresets: readonly HookPreset[];
}

/** Immutable version snapshots win. Missing custom looks are never substituted. */
export function resolveShortStyles(
  short: Short,
  catalog: LookCatalog = {
    captionPresets: BUILTIN_CAPTION_PRESETS,
    hookPresets: BUILTIN_HOOK_PRESETS,
  },
): ShortStyles {
  const caption =
    short.styles?.caption.id === short.captions.presetId
      ? short.styles.caption
      : catalog.captionPresets.find((p) => p.id === short.captions.presetId);
  const hookId = short.hook?.presetId ?? BUILTIN_HOOK_PRESETS[0]!.id;
  const hook =
    short.styles?.hook.id === hookId
      ? short.styles.hook
      : catalog.hookPresets.find((p) => p.id === hookId);
  if (caption === undefined || hook === undefined)
    throw new Error(
      "This version's custom look isn't available. Import its template before opening or rendering it.",
    );
  return { caption, hook };
}

export function snapshotShortStyles(short: Short, catalog: LookCatalog): Short {
  const styles = resolveShortStyles(short, catalog);
  return short.styles?.caption === styles.caption && short.styles.hook === styles.hook
    ? short
    : { ...short, styles };
}
