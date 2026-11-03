// Templates (plan section 13): Alcyo templates in and out, and the
// [V4+ Styles] of .ass files as presets. Pure: callers read and write files.
import {
  type CaptionPreset,
  type CreatorProfile,
  FALLBACK_FONT,
  type HookPreset,
  Template,
  isBundledFont,
} from "@alcyo/schema";

/** Our presets are sized for a 1080x1920 frame. */
const FRAME_H = 1920;
/** libass's PlayResY when a script doesn't set one. */
const ASS_DEFAULT_PLAY_RES_Y = 288;

export interface ImportedPresets {
  captionPresets: CaptionPreset[];
  hookPresets: HookPreset[];
  /** Plain lines: fonts that fell back, styles that were skipped. */
  notes: string[];
}

export function slug(text: string): string {
  const s = text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return s.length > 0 ? s : "style";
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** &HAABBGGRR (or &HBBGGRR) to #RRGGBB. Null when it isn't a color. */
export function assColor(value: string): string | null {
  const m = /^&H([0-9a-f]{6,8})&?$/i.exec(value.trim());
  if (m === null) {
    // Some writers use a decimal BGR number.
    if (!/^-?\d+$/.test(value.trim())) return null;
    const n = Number(value.trim()) >>> 0;
    const hex = n.toString(16).padStart(8, "0");
    return `#${hex.slice(6, 8)}${hex.slice(4, 6)}${hex.slice(2, 4)}`.toUpperCase();
  }
  const hex = m[1]!.padStart(8, "0");
  return `#${hex.slice(6, 8)}${hex.slice(4, 6)}${hex.slice(2, 4)}`.toUpperCase();
}

function fontOf(name: string, notes: Set<string>): string {
  const font = name.trim().replace(/^@/, "");
  if (font.length > 0 && isBundledFont(font)) return font;
  notes.add(`${font || "A style's font"} isn't bundled, so ${FALLBACK_FONT} is used instead.`);
  return FALLBACK_FONT;
}

/** The [V4+ Styles] of an .ass file as caption presets, and hook presets for Hook or Title styles. */
export function parseAss(text: string, source: string): ImportedPresets {
  const notes = new Set<string>();
  let section = "";
  let playResY = ASS_DEFAULT_PLAY_RES_Y;
  let format: string[] | null = null;
  const styles: Array<Record<string, string>> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header !== null) {
      section = header[1]!.toLowerCase();
      continue;
    }
    if (section === "script info") {
      const m = /^PlayResY:\s*(\d+)/i.exec(line);
      if (m !== null && Number(m[1]) > 0) playResY = Number(m[1]);
    }
    if (section !== "v4+ styles" && section !== "v4 styles") continue;
    if (/^Format:/i.test(line)) {
      format = line
        .slice(line.indexOf(":") + 1)
        .split(",")
        .map((f) => f.trim().toLowerCase());
    } else if (/^Style:/i.test(line) && format !== null) {
      const values = line.slice(line.indexOf(":") + 1).split(",");
      // The last field may hold commas only in theory; keep extras on the name.
      const row: Record<string, string> = {};
      format.forEach((key, i) => (row[key] = (values[i] ?? "").trim()));
      styles.push(row);
    }
  }

  const scale = FRAME_H / playResY;
  const captionPresets: CaptionPreset[] = [];
  const hookPresets: HookPreset[] = [];
  const base = slug(source);
  const used = new Set<string>();
  for (const st of styles) {
    const name = (st["name"] ?? "Style").slice(0, 60) || "Style";
    let id = `ass-${base}-${slug(name)}`;
    for (let n = 2; used.has(id); n++) id = `ass-${base}-${slug(name)}-${n}`;
    used.add(id);
    const size = clamp(Math.round(Number(st["fontsize"] ?? 48) * scale), 12, 200);
    const align = Number(st["alignment"] ?? 2);
    const marginV = Number(st["marginv"] ?? 20) / playResY;
    const positionY =
      align >= 7 ? clamp(marginV + 0.05, 0, 1) : align >= 4 ? 0.5 : clamp(1 - marginV - 0.05, 0, 1);
    const color = assColor(st["primarycolour"] ?? "") ?? "#FFFFFF";
    const font = fontOf(st["fontname"] ?? "", notes);
    if (/hook|title/i.test(name)) {
      const boxed = st["borderstyle"] === "3";
      hookPresets.push({
        id,
        name,
        font,
        sizePx: size,
        color,
        background: boxed ? (assColor(st["backcolour"] ?? "") ?? "#000000") : null,
        uppercase: false,
        positionY: Math.round(positionY * 100) / 100,
        origin: "ass",
      });
    } else {
      captionPresets.push({
        id,
        name,
        font,
        sizePx: size,
        color,
        highlightColor: assColor(st["secondarycolour"] ?? "") ?? color,
        outlineColor: assColor(st["outlinecolour"] ?? "") ?? "#000000",
        outlinePx: clamp(Math.round(Number(st["outline"] ?? 2) * scale), 0, 20),
        shadowPx: clamp(Math.round(Number(st["shadow"] ?? 0) * scale), 0, 20),
        uppercase: false,
        positionY: Math.round(positionY * 100) / 100,
        wordsPerLine: 3,
        origin: "ass",
      });
    }
  }
  if (styles.length === 0)
    notes.add("That file has no [V4+ Styles] section, so nothing was added.");
  return { captionPresets, hookPresets, notes: [...notes] };
}

/** An Alcyo template's presets, with ids made unique to this template. */
export function importTemplate(raw: unknown): ImportedPresets & { template: Template } {
  const template = Template.parse(raw);
  const notes = new Set<string>();
  const prefix = `t-${slug(template.name)}`;
  const reId = <T extends { id: string; font: string }>(p: T): T => ({
    ...p,
    id: `${prefix}-${slug(p.id)}`.slice(0, 64),
    font: fontOf(p.font, notes),
    origin: "template",
  });
  return {
    template,
    captionPresets: template.captionPresets.map(reId),
    hookPresets: template.hookPresets.map(reId),
    notes: [...notes],
  };
}

export function exportTemplate(
  name: string,
  presets: { captionPresets: readonly CaptionPreset[]; hookPresets: readonly HookPreset[] },
  profile: CreatorProfile | null,
): Template {
  return Template.parse({
    schemaVersion: 1,
    kind: "alcyo-template",
    name: name.trim().slice(0, 80) || "My look",
    captionPresets: presets.captionPresets,
    hookPresets: presets.hookPresets,
    ...(profile === null
      ? {}
      : {
          targetLengthMs: profile.lengthMs,
          titleRules: profile.titleRules,
          ...(profile.platforms[0] === undefined ? {} : { safeArea: profile.platforms[0] }),
        }),
  });
}
