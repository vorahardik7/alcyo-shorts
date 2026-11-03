// What code measures on a past short (plan section 13), from the files quick
// analysis wrote. Pure: numbers and the opening words, nothing else.
import type {
  CreatorProfile,
  Loudness,
  PastShortMeasures,
  SampleFile,
  Scenes,
  Silences,
  Transcript,
} from "@alcyo/schema";

export const PAUSE_MIN_MS = 300;
export const OPENING_MS = 8_000;
/** Most past shorts the profile takes. */
export const MAX_SAMPLES = 50;

export interface SampleAnalysis {
  durationMs: number;
  transcript: Transcript | null;
  silences: Silences | null;
  scenes: Scenes | null;
  loudness: Loudness | null;
}

const SENTENCE_END = /[.!?]["')\]]?$/;

export function measurePastShort(a: SampleAnalysis): {
  measures: PastShortMeasures;
  opening: string;
} {
  const words = a.transcript?.words ?? [];
  const lengthMs = Math.max(0, Math.round(a.durationMs));
  const first = words[0];
  const last = words.at(-1);

  let firstSentence = "";
  for (const w of words) {
    firstSentence = firstSentence.length === 0 ? w.text : `${firstSentence} ${w.text}`;
    if (SENTENCE_END.test(w.text) || firstSentence.length > 240) break;
  }

  const speechMs = first !== undefined && last !== undefined ? last.endMs - first.startMs : 0;
  const cuts = a.scenes?.cutsMs.filter((t) => t > 0 && t < lengthMs).length ?? 0;
  const pauses =
    a.silences?.silences.filter(
      (s) => s.endMs - s.startMs > PAUSE_MIN_MS && s.startMs > 0 && s.endMs < lengthMs,
    ).length ?? 0;
  const opening = words
    .filter((w) => w.startMs < OPENING_MS)
    .map((w) => w.text)
    .join(" ")
    .slice(0, 600);

  return {
    measures: {
      lengthMs,
      firstWordMs: first === undefined ? null : first.startMs,
      firstSentence: firstSentence.slice(0, 300),
      wordsPerSecond: speechMs >= 1000 ? round(words.length / (speechMs / 1000), 2) : null,
      cutEveryMs: Math.round(lengthMs / (cuts + 1)),
      pausesPer10s: lengthMs > 0 ? round((pauses / lengthMs) * 10_000, 2) : 0,
      loudnessLufs:
        a.loudness !== null && Number.isFinite(a.loudness.integratedLufs)
          ? round(a.loudness.integratedLufs, 1)
          : null,
    },
    opening,
  };
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The numbers that become targets: medians over the samples. */
export function styleNumbers(
  samples: readonly SampleFile[],
): Omit<CreatorProfile["style"], "summary"> {
  const m = samples.map((s) => s.measures);
  const firstWord = median(m.flatMap((x) => (x.firstWordMs === null ? [] : [x.firstWordMs])));
  const wps = median(m.flatMap((x) => (x.wordsPerSecond === null ? [] : [x.wordsPerSecond])));
  const cut = median(m.map((x) => x.cutEveryMs));
  return {
    ...(firstWord === null ? {} : { firstWordMs: Math.round(firstWord) }),
    ...(wps === null ? {} : { wordsPerSecond: round(wps, 2) }),
    ...(cut === null ? {} : { cutEveryMs: Math.round(cut) }),
    sampleCount: samples.length,
  };
}

/** The extra medians the style prompt shows, which the profile doesn't keep. */
export function extraNumbers(samples: readonly SampleFile[]): {
  lengthMs: number | null;
  pausesPer10s: number | null;
  loudnessLufs: number | null;
} {
  const m = samples.map((s) => s.measures);
  return {
    lengthMs: median(m.map((x) => x.lengthMs)),
    pausesPer10s: median(m.map((x) => x.pausesPer10s)),
    loudnessLufs: median(m.flatMap((x) => (x.loudnessLufs === null ? [] : [x.loudnessLufs]))),
  };
}
