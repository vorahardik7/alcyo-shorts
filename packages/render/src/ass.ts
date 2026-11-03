// The caption and hook file (plan section 18). One builder for the preview
// (JASSUB) and the render (ffmpeg's subtitles filter). Pure and Node-free.
//
// Captions use only the words the short keeps, with the creator's overrides,
// in short time. Each word gets its own event showing its whole line with
// that word in the highlight color.
import {
  type CaptionPreset,
  FALLBACK_FONT,
  type HookPreset,
  type Short,
  type Word,
  isBundledFont,
  sourceToShort,
} from "@alcyo/schema";

export const PLAY_W = 1080;
export const PLAY_H = 1920;
/** A gap in speech this long ends a caption line. */
export const LINE_GAP_MS = 600;
/** How long the last word of a line stays up after it's said, at most. */
export const LINE_TAIL_MS = 300;
const MARGIN_X = 80;

export interface CaptionWord {
  id: string;
  text: string;
  /** Short time. */
  startMs: number;
  endMs: number;
}

const kept = (short: Short, w: Pick<Word, "startMs" | "endMs">) => {
  const mid = Math.floor((w.startMs + w.endMs) / 2);
  return short.segments.some((s) => mid >= s.srcIn && mid < s.srcOut);
};

/**
 * The words a short shows, in short time: kept words (by their midpoint),
 * minus hidden ones, with text and time overrides applied, clamped to the
 * segment each one sits in.
 */
export function captionWords(short: Short, words: readonly Word[]): CaptionWord[] {
  const overrides = new Map(short.captions.overrides.map((o) => [o.wordId, o]));
  const out: CaptionWord[] = [];
  for (const w of words) {
    if (!kept(short, w)) continue;
    const o = overrides.get(w.id);
    if (o?.hidden === true) continue;
    const mid = Math.floor((w.startMs + w.endMs) / 2);
    const seg = short.segments.find((s) => mid >= s.srcIn && mid < s.srcOut)!;
    const start = Math.max(seg.srcIn, Math.min(seg.srcOut - 1, w.startMs + (o?.startDelta ?? 0)));
    const end = Math.max(start + 1, Math.min(seg.srcOut, w.endMs + (o?.endDelta ?? 0)));
    const text = (o?.text ?? w.text).replace(/\s+/g, " ").trim();
    if (text.length === 0) continue;
    const s = sourceToShort(short.segments, start);
    const e = sourceToShort(short.segments, end - 1);
    if (s === null || e === null) continue;
    out.push({ id: w.id, text, startMs: s, endMs: e + 1 });
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}

/** Words grouped into caption lines: wordsPerLine at most, split at gaps and sentence ends. */
export function captionLines(words: readonly CaptionWord[], wordsPerLine: number): CaptionWord[][] {
  const lines: CaptionWord[][] = [];
  let cur: CaptionWord[] = [];
  for (const w of words) {
    const last = cur.at(-1);
    if (
      last !== undefined &&
      (cur.length >= wordsPerLine ||
        w.startMs - last.endMs > LINE_GAP_MS ||
        /[.?!]$/.test(last.text))
    ) {
      lines.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

/** #RRGGBB or #RRGGBBAA -> &HAABBGGRR, where ASS alpha 00 is opaque. */
export function assColor(hex: string): string {
  const h = hex.replace("#", "");
  const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  const a = h.length === 8 ? 255 - parseInt(h.slice(6, 8), 16) : 0;
  return `&H${a.toString(16).padStart(2, "0")}${b}${g}${r}`.toUpperCase();
}

/** #RRGGBB -> &HBBGGRR&, for a \1c override tag (color only, no alpha). */
export function assColorTag(hex: string): string {
  const h = hex.replace("#", "");
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
}

/** h:mm:ss.cc, rounded to the centisecond ASS uses. */
export function assTime(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}.${p(c)}`;
}

/** Text that can't start override tags or line breaks. */
export function assText(text: string): string {
  return text.replace(/[{}]/g, "").replace(/\\/g, "/").replace(/\s+/g, " ").trim();
}

const font = (name: string) => (isBundledFont(name) ? name : FALLBACK_FONT);
const y = (positionY: number) => Math.round(Math.min(1, Math.max(0, positionY)) * PLAY_H);

const FORMAT =
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";

function captionStyle(p: CaptionPreset): string {
  return [
    "Style: Caption",
    font(p.font),
    p.sizePx,
    assColor(p.color),
    assColor(p.highlightColor),
    assColor(p.outlineColor),
    "&H80000000",
    0, 0, 0, 0, 100, 100, 0, 0,
    1,
    p.outlinePx,
    p.shadowPx,
    5,
    MARGIN_X, MARGIN_X, 0, 1,
  ].join(","); // prettier-ignore
}

function hookStyle(p: HookPreset): string {
  const boxed = p.background !== null;
  return [
    "Style: Hook",
    font(p.font),
    p.sizePx,
    assColor(p.color),
    assColor(p.color),
    // An opaque box (BorderStyle 3) is drawn in the outline color.
    assColor(boxed ? p.background! : "#000000"),
    assColor(boxed ? p.background! : "#00000080"),
    0, 0, 0, 0, 100, 100, 0, 0,
    boxed ? 3 : 1,
    boxed ? 18 : 4,
    0,
    5,
    MARGIN_X, MARGIN_X, 0, 1,
  ].join(","); // prettier-ignore
}

export interface AssInput {
  short: Short;
  /** Transcript words around the short, in source time. Others are ignored. */
  words: readonly Word[];
  caption: CaptionPreset;
  hook: HookPreset;
}

/** The whole .ass file. The same input gives the same text, byte for byte. */
export function buildAss({ short, words, caption, hook }: AssInput): string {
  const events: string[] = [];
  const up = (t: string) => (caption.uppercase ? t.toUpperCase() : t);
  const at = `{\\an5\\pos(${PLAY_W / 2},${y(caption.positionY)})}`;
  const lines = captionLines(captionWords(short, words), short.captions.wordsPerLine);
  lines.forEach((line, li) => {
    const nextLine = lines[li + 1]?.[0];
    line.forEach((w, wi) => {
      const next = line[wi + 1];
      const tail = Math.min(LINE_TAIL_MS, (nextLine?.startMs ?? Infinity) - w.endMs);
      const end = next !== undefined ? next.startMs : w.endMs + Math.max(0, tail);
      if (end <= w.startMs) return;
      const text = line
        .map((x, xi) =>
          xi === wi
            ? `{\\1c${assColorTag(caption.highlightColor)}}${assText(up(x.text))}{\\r}`
            : assText(up(x.text)),
        )
        .join(" ");
      events.push(`Dialogue: 0,${assTime(w.startMs)},${assTime(end)},Caption,,0,0,0,,${at}${text}`);
    });
  });

  if (short.hook !== undefined && short.hook.end > short.hook.start) {
    const text = assText(hook.uppercase ? short.hook.text.toUpperCase() : short.hook.text);
    events.push(
      `Dialogue: 1,${assTime(short.hook.start)},${assTime(short.hook.end)},Hook,,0,0,0,,{\\an5\\pos(${PLAY_W / 2},${y(hook.positionY)})}${text}`,
    );
  }

  return [
    "[Script Info]",
    "; Made by Alcyo Shorts. The preview and the render draw this same file.",
    "ScriptType: v4.00+",
    `PlayResX: ${PLAY_W}`,
    `PlayResY: ${PLAY_H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    FORMAT,
    captionStyle(caption),
    hookStyle(hook),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
