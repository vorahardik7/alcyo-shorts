// What the agent reads (plan section 16): one row per transcript line with its
// id, start time, markers and words. No word ids, no word times, no paths.
import type { CreatorProfile, SourceSpan, Transcript } from "@alcyo/schema";

/** A gap in speech this long before a line marks it [pause]. */
export const PAUSE_MS = 1000;

export interface PromptLine {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  /** How many placed viewer clips overlap the line. */
  clipped: number;
  pause: boolean;
}

/** 00:00:04, always with hours, like the plan's example. */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 35 s, or 1.5 s under 10 s. */
export function seconds(ms: number): string {
  const v = ms / 1000;
  return v >= 10 || Number.isInteger(v) ? `${Math.round(v)} s` : `${v.toFixed(1)} s`;
}

/** Words joined into text, with whisper's stray spaces removed. */
export function wordText(words: readonly { text: string }[]): string {
  return words
    .map((w) => w.text.trim())
    .filter((t) => t.length > 0)
    .join(" ");
}

export function promptLines(
  transcript: Pick<Transcript, "words" | "lines">,
  clips: readonly SourceSpan[],
): PromptLine[] {
  const byId = new Map(transcript.words.map((w) => [w.id, w]));
  return transcript.lines.map((line, i) => {
    const prev = transcript.lines[i - 1];
    const words = line.wordIds.map((id) => byId.get(id)).filter((w) => w !== undefined);
    return {
      id: line.id,
      startMs: line.startMs,
      endMs: line.endMs,
      text: wordText(words),
      clipped: clips.filter((c) => c.startMs < line.endMs && c.endMs > line.startMs).length,
      pause: prev !== undefined && line.startMs - prev.endMs >= PAUSE_MS,
    };
  });
}

export function formatLine(line: PromptLine): string {
  const marks = [
    line.pause ? "[pause]" : null,
    line.clipped > 1 ? `[clipped x${line.clipped}]` : line.clipped === 1 ? "[clipped]" : null,
  ].filter((m) => m !== null);
  return [line.id, clock(line.startMs), ...marks, line.text].join(" ");
}

export interface StreamFacts {
  name: string;
  durationMs: number;
  /** "youtube.com", or null for a local file. */
  site: string | null;
  /** YYYY-MM-DD, when the link said. */
  uploaded: string | null;
  clipsMatched: number;
}

/** The "# Stream: ..." header line. */
export function streamHeader(s: StreamFacts): string {
  const parts = [
    s.name.replace(/\s+/g, " ").trim().slice(0, 120),
    clock(s.durationMs).replace(/^00:/, ""),
    s.site === null ? "from a local file" : `from ${s.site}`,
  ];
  if (s.uploaded !== null) parts.push(`uploaded ${s.uploaded}`);
  const clips =
    s.clipsMatched === 0
      ? "No viewer clips matched."
      : `${s.clipsMatched} viewer clip${s.clipsMatched === 1 ? "" : "s"} matched.`;
  return `# Stream: ${parts.join(", ")}. ${clips}`;
}

/** The length range the planner aims for: the profile's, or 15 to 60 s. */
export function lengthRange(profile: Pick<CreatorProfile, "lengthMs"> | null): {
  min: number;
  max: number;
} {
  const r = profile?.lengthMs;
  return r !== undefined && r.min <= r.max ? r : { min: 15_000, max: 60_000 };
}

/** Prompt size, estimated at characters / 4 (plan section 16). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
