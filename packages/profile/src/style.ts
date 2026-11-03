// The style summary prompt (plan section 13): the openings of past shorts as
// text, and the measured numbers. No video, audio, images or file paths.
import type { CreatorProfile, SampleFile } from "@alcyo/schema";
import { extraNumbers, styleNumbers } from "./measures.ts";

const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function styleRequest(samples: readonly SampleFile[]): {
  instruction: string;
  input: string;
} {
  const n = styleNumbers(samples);
  const x = extraNumbers(samples);
  const numbers = [
    x.lengthMs === null ? null : `Median length: ${s(x.lengthMs)}.`,
    n.firstWordMs === undefined ? null : `First word after: ${s(n.firstWordMs)}.`,
    n.wordsPerSecond === undefined ? null : `Words per second: ${n.wordsPerSecond}.`,
    n.cutEveryMs === undefined ? null : `A cut every ${s(n.cutEveryMs)}.`,
    x.pausesPer10s === null ? null : `Pauses over 0.3 s left in, per 10 s: ${x.pausesPer10s}.`,
    x.loudnessLufs === null ? null : `Loudness: ${x.loudnessLufs} LUFS.`,
  ].filter((line) => line !== null);
  const openings = samples
    .map(
      (sample, i) =>
        `Short ${i + 1} opens: "${sample.measures.firstSentence || sample.opening || "(no speech)"}"`,
    )
    .join("\n");
  return {
    instruction:
      'You describe how a creator edits their shorts, so new shorts can match. Write 2 to 4 short sentences in plain words, about how they open, the pace, cuts and pauses. Use the numbers as targets. No hype, no emoji, nothing about the content of the streams. Return {"summary": "..."}.',
    input: `From ${samples.length} past shorts.\n${numbers.join("\n")}\n\n${openings}`,
  };
}

/** The style a profile keeps: the agent's summary with the measured numbers. */
export function styleFrom(
  summary: string,
  samples: readonly SampleFile[],
): CreatorProfile["style"] {
  return { summary: summary.trim().slice(0, 800), ...styleNumbers(samples) };
}
