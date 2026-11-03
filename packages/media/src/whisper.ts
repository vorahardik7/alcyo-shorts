// whisper-cli: args, its -ojf JSON, tokens to words, words to lines.
import { type Line, MAX_LINE_MS, type Transcript, type Word } from "@alcyo/schema";
import { z } from "zod";

export function whisperArgs(opts: {
  model: string;
  /** The --dtw preset, like "small.en". */
  modelName: string;
  vadModel: string;
  wav: string;
  /** Output path without the .json extension. */
  outBase: string;
  threads: number;
  language?: string;
  /** Silero VAD. On by default; the drift script turns it off to compare. */
  vad?: boolean;
}): string[] {
  return [
    "-m",
    opts.model,
    "-f",
    opts.wav,
    "-l",
    opts.language ?? "en",
    ...(opts.vad === false ? [] : ["--vad", "-vm", opts.vadModel]),
    "-ojf",
    "--dtw",
    opts.modelName,
    // On whisper.cpp 1.9.5, DTW times are all -1 with flash attention on.
    "-nfa",
    "-of",
    opts.outBase,
    // No -np: the VAD time map is only logged without it (see parseVadMap).
    "-pp",
    "-t",
    String(opts.threads),
  ];
}

const Token = z.looseObject({
  text: z.string(),
  offsets: z.object({ from: z.number(), to: z.number() }),
  p: z.number().optional(),
  t_dtw: z.number().optional(),
});
export type WhisperToken = z.infer<typeof Token>;

export const WhisperJson = z.looseObject({
  result: z.looseObject({ language: z.string().optional() }).optional(),
  transcription: z.array(
    z.looseObject({
      offsets: z.object({ from: z.number(), to: z.number() }),
      text: z.string(),
      tokens: z.array(Token).default([]),
    }),
  ),
});
export type WhisperJson = z.infer<typeof WhisperJson>;

/** A word before ids are given out, in source ms. */
export interface RawWord {
  text: string;
  startMs: number;
  endMs: number;
  p: number;
}

export type WordTiming = "dtw" | "offsets";

/** Longest a single word may run; whisper sometimes stretches one over a pause. */
export const MAX_WORD_MS = 3000;

const SPECIAL = /^\[_[A-Z]+_?\d*\]$|^\[_\w+\]$/;
const NON_SPEECH = /^[[(].*[\])]$/;

/** One point of whisper's VAD map: a time in the speech-only audio and in the file. */
export interface VadPoint {
  processedMs: number;
  originalMs: number;
}

const VAD_INFO =
  /vad_segment_info: orig_start: ([\d.]+), orig_end: ([\d.]+), vad_start: ([\d.]+), vad_end: ([\d.]+)/;

/**
 * whisper.cpp 1.9.5 with --vad maps segment times back to the file, but not
 * token times or t_dtw: those stay in the speech-only audio it builds after
 * cutting the silences out. It logs the segments it kept; this rebuilds its
 * map from those lines.
 */
export function parseVadMap(stderr: readonly string[]): VadPoint[] {
  const points: VadPoint[] = [];
  for (const line of stderr) {
    const m = VAD_INFO.exec(line);
    if (m === null) continue;
    const [origStart, origEnd, vadStart, vadEnd] = m
      .slice(1)
      .map((s) => Math.round(Number(s) * 1000));
    points.push({ processedMs: vadStart!, originalMs: origStart! });
    points.push({ processedMs: vadEnd!, originalMs: origEnd! });
  }
  points.sort((a, b) => a.processedMs - b.processedMs);
  return points.filter((p, i) => i === 0 || p.processedMs !== points[i - 1]!.processedMs);
}

/** whisper.cpp's map_processed_to_original_time: clamp at the ends, interpolate between points. */
export function vadToOriginal(ms: number, map: readonly VadPoint[]): number {
  if (map.length === 0) return ms;
  const first = map[0]!;
  const last = map.at(-1)!;
  if (ms <= first.processedMs) return first.originalMs + (ms - first.processedMs);
  if (ms >= last.processedMs) return last.originalMs + (ms - last.processedMs);
  let hi = map.findIndex((p) => p.processedMs >= ms);
  if (map[hi]!.processedMs === ms) return map[hi]!.originalMs;
  const a = map[--hi]!;
  const b = map[hi + 1]!;
  const span = b.processedMs - a.processedMs;
  return span === 0
    ? a.originalMs
    : a.originalMs + ((ms - a.processedMs) * (b.originalMs - a.originalMs)) / span;
}

/**
 * Puts token times (offsets and t_dtw) on the file's clock. A segment whose
 * tokens already sit inside its own range is left alone, so a whisper.cpp
 * that fixes this upstream isn't shifted twice.
 */
export function remapTokens(json: WhisperJson, map: readonly VadPoint[]): WhisperJson {
  if (map.length === 0) return json;
  const SLACK_MS = 1500;
  return {
    ...json,
    transcription: json.transcription.map((seg) => {
      const speech = seg.tokens.filter((t) => !SPECIAL.test(t.text.trim()));
      const inside = speech.every(
        (t) =>
          t.offsets.from >= seg.offsets.from - SLACK_MS &&
          t.offsets.from <= seg.offsets.to + SLACK_MS,
      );
      if (speech.length === 0 || inside) return seg;
      return {
        ...seg,
        tokens: seg.tokens.map((t) => ({
          ...t,
          offsets: {
            from: Math.round(vadToOriginal(t.offsets.from, map)),
            to: Math.round(vadToOriginal(t.offsets.to, map)),
          },
          ...(t.t_dtw !== undefined && t.t_dtw >= 0
            ? { t_dtw: Math.round(vadToOriginal(t.t_dtw * 10, map)) / 10 }
            : {}),
        })),
      };
    }),
  };
}

/**
 * Merges tokens into words. A token starting with a space starts a word;
 * others (punctuation, "'s") join the word before. Times are shifted by
 * offsetMs (the chunk's start). Bracketed non-speech like [BLANK_AUDIO] is
 * dropped.
 */
export function tokensToWords(
  tokens: readonly WhisperToken[],
  offsetMs: number,
  timing: WordTiming = "dtw",
): RawWord[] {
  interface Acc {
    text: string;
    start: number;
    end: number;
    ps: number[];
  }
  const acc: Acc[] = [];
  for (const t of tokens) {
    if (SPECIAL.test(t.text.trim())) continue;
    const dtw = t.t_dtw !== undefined && t.t_dtw >= 0 ? t.t_dtw * 10 : null;
    const start = timing === "dtw" && dtw !== null ? dtw : t.offsets.from;
    const startsWord = t.text.startsWith(" ") || acc.length === 0;
    if (startsWord) {
      acc.push({ text: t.text.trim(), start, end: t.offsets.to, ps: [t.p ?? 1] });
    } else {
      const w = acc.at(-1)!;
      w.text += t.text;
      w.end = Math.max(w.end, t.offsets.to);
      w.ps.push(t.p ?? 1);
    }
  }

  const words: RawWord[] = [];
  for (const w of acc) {
    const text = w.text.trim();
    if (text.length === 0 || NON_SPEECH.test(text)) continue;
    words.push({
      text: text.slice(0, 100),
      startMs: Math.max(0, Math.round(w.start + offsetMs)),
      endMs: Math.round(w.end + offsetMs),
      p: Math.min(1, Math.max(0, w.ps.reduce((a, b) => a + b, 0) / w.ps.length)),
    });
  }
  return fixWordTimes(words);
}

/**
 * Makes times usable: starts never go backwards, each end is after its start,
 * no later than the next word's start, and at most MAX_WORD_MS after it.
 */
export function fixWordTimes(words: readonly RawWord[]): RawWord[] {
  const out = words.map((w) => ({ ...w }));
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!;
    if (out[i]!.startMs < prev.startMs) out[i]!.startMs = prev.startMs;
  }
  for (let i = 0; i < out.length; i++) {
    const w = out[i]!;
    const next = out[i + 1];
    let end = Math.min(w.endMs, w.startMs + MAX_WORD_MS);
    if (next !== undefined && next.startMs > w.startMs) end = Math.min(end, next.startMs);
    w.endMs = Math.max(end, w.startMs + 1);
  }
  return out;
}

export const LINE_MIN_FOR_SENTENCE_MS = 2000;
export const LINE_BREAK_GAP_MS = 1200;

/**
 * Groups words into lines (by index). A line closes after a sentence end once
 * it's 2 s long, before a gap over 1.2 s, or before a word that would take it
 * past 12 s.
 */
export function groupLines(
  words: readonly { text: string; startMs: number; endMs: number }[],
): number[][] {
  const lines: number[][] = [];
  let current: number[] = [];
  const startOf = () => words[current[0]!]!.startMs;
  words.forEach((w, i) => {
    if (current.length > 0) {
      const prev = words[i - 1]!;
      const tooLong = w.endMs - startOf() > MAX_LINE_MS;
      const gap = w.startMs - prev.endMs > LINE_BREAK_GAP_MS;
      const sentence =
        /[.?!]["')\]]*$/.test(prev.text) && prev.endMs - startOf() >= LINE_MIN_FOR_SENTENCE_MS;
      if (tooLong || gap || sentence) {
        lines.push(current);
        current = [];
      }
    }
    current.push(i);
  });
  if (current.length > 0) lines.push(current);
  return lines;
}

export const wordId = (n: number) => `w${String(n).padStart(5, "0")}`;
export const lineId = (n: number) => `L${String(n).padStart(4, "0")}`;

export function buildTranscript(opts: {
  sourceId: string;
  language: string;
  model: string;
  words: readonly RawWord[];
}): Transcript {
  const words: Word[] = opts.words.map((w, i) => ({ id: wordId(i + 1), ...w }));
  const lines: Line[] = groupLines(words).map((idx, i) => ({
    id: lineId(i + 1),
    startMs: words[idx[0]!]!.startMs,
    endMs: words[idx.at(-1)!]!.endMs,
    wordIds: idx.map((j) => words[j]!.id),
  }));
  return {
    schemaVersion: 1,
    sourceId: opts.sourceId,
    language: opts.language.slice(0, 20),
    model: opts.model.slice(0, 50),
    words,
    lines,
  };
}
