// Parsers for ffmpeg's stderr: silencedetect, ebur128 and showinfo.
import type { SourceRange } from "@alcyo/schema";

const PREFIX = /^\[Parsed_(\w+?)_\d+ @ [^\]]+\]\s*/;

/** silencedetect start/end pairs, in ms, clamped to the audio. A trailing start closes at the end. */
export function parseSilences(lines: readonly string[], durationMs: number): SourceRange[] {
  const out: SourceRange[] = [];
  let start: number | null = null;
  const push = (s: number, e: number) => {
    const a = Math.max(0, Math.min(durationMs, s));
    const b = Math.max(0, Math.min(durationMs, e));
    if (b > a) out.push({ startMs: a, endMs: b });
  };
  for (const line of lines) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s !== null) {
      start = Math.round(Number(s[1]) * 1000);
      continue;
    }
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e !== null && start !== null) {
      push(start, Math.round(Number(e[1]) * 1000));
      start = null;
    }
  }
  if (start !== null) push(start, durationMs);
  return out;
}

/** Integrated loudness and the momentary loudness, one value (the loudest) per second. */
export function parseLoudness(lines: readonly string[]): {
  integratedLufs: number;
  momentary: Array<{ tMs: number; lufs: number }>;
} {
  const perSecond = new Map<number, number>();
  let integrated: number | null = null;
  let inSummary = false;
  for (const raw of lines) {
    const line = raw.replace(PREFIX, "");
    const frame = /^t:\s*([\d.]+)\s+.*?M:\s*(-?[\d.]+)/.exec(line);
    if (frame !== null) {
      const second = Math.floor(Number(frame[1]));
      const m = Math.max(-70, Number(frame[2]));
      const prev = perSecond.get(second);
      if (prev === undefined || m > prev) perSecond.set(second, m);
      continue;
    }
    if (/Summary:/.test(raw)) inSummary = true;
    const i = /^\s*I:\s*(-?[\d.]+)\s*LUFS/.exec(line);
    if (i !== null && inSummary && integrated === null) integrated = Number(i[1]);
  }
  return {
    integratedLufs: integrated ?? -70,
    momentary: [...perSecond.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([s, lufs]) => ({ tMs: s * 1000, lufs })),
  };
}

/** Scene-cut times from showinfo's frame lines, in ms, ascending and unique. */
export function parseScenes(lines: readonly string[]): number[] {
  const cuts = new Set<number>();
  for (const line of lines) {
    if (!line.includes("showinfo")) continue;
    const m = /\bpts_time:\s*([\d.]+)/.exec(line);
    if (m !== null) cuts.add(Math.round(Number(m[1]) * 1000));
  }
  return [...cuts].sort((a, b) => a - b);
}
