import { describe, expect, it } from "vitest";
import { BUILTIN_CAPTION_PRESETS, BUILTIN_HOOK_PRESETS } from "@alcyo/schema";
import * as F from "@alcyo/schema/testing";
import { buildAss } from "./ass.ts";
import { resolveShortStyles, snapshotShortStyles } from "./looks.ts";

describe("saved look snapshots", () => {
  const original = { ...BUILTIN_CAPTION_PRESETS[0]!, id: "custom", origin: "template" as const };
  const catalog = { captionPresets: [original], hookPresets: BUILTIN_HOOK_PRESETS };
  it("preserves imported looks across reimport and project moves without a profile catalog", () => {
    const short = snapshotShortStyles(
      { ...F.short, captions: { ...F.short.captions, presetId: "custom" } },
      catalog,
    );
    const before = buildAss({ short, words: F.transcript.words, ...resolveShortStyles(short) });
    const changed = { ...catalog, captionPresets: [{ ...original, sizePx: 150 }] };
    expect(resolveShortStyles(short, changed).caption.sizePx).toBe(original.sizePx);
    const after = buildAss({
      short,
      words: F.transcript.words,
      ...resolveShortStyles(short, changed),
    });
    expect(after).toBe(before);
    expect(resolveShortStyles(short).caption.id).toBe("custom");
  });
  it("captures a newly selected look while preserving the unchanged hook", () => {
    const saved = snapshotShortStyles(F.short, {
      captionPresets: BUILTIN_CAPTION_PRESETS,
      hookPresets: BUILTIN_HOOK_PRESETS,
    });
    const next = snapshotShortStyles(
      { ...saved, captions: { ...saved.captions, presetId: "custom" } },
      catalog,
    );
    expect(next.styles?.caption).toEqual(original);
    expect(next.styles?.hook).toEqual(saved.styles?.hook);
  });
  it("reports unavailable legacy custom looks instead of changing the export", () => {
    expect(() =>
      resolveShortStyles({ ...F.short, captions: { ...F.short.captions, presetId: "missing" } }),
    ).toThrow("custom look isn't available");
  });
});
