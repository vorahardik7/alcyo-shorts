// Matches one clip to the VOD from the files analysis wrote (plan section 12).
// Transcript candidate, then audio refine within ±5 s. No speech: a coarse
// envelope over the whole VOD, then the same refine.
import { access } from "node:fs/promises";
import type { ClipMatchRequest, ClipMatchResult } from "@alcyo/ipc";
import { type ClipMatch, Transcript } from "@alcyo/schema";
import { readJson } from "@alcyo/store";
import { COARSE_HOP, FINE_HOP, bestLag, hopMs, wavEnvelope } from "./envelope.ts";
import { PLACED_MIN, type TimedWord, transcriptCandidate } from "./match.ts";

/** Search this far either side of a candidate. */
export const REFINE_MS = 5000;

async function words(path: string | null): Promise<TimedWord[]> {
  if (path === null) return [];
  const t = await readJson(path, Transcript).catch(() => null);
  return t?.words ?? [];
}

async function present(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Audio refine around a VOD time. Returns the clip's start in the VOD and r. */
async function refine(
  req: ClipMatchRequest,
  clipEnv: Float32Array,
  aroundMs: number,
  signal?: AbortSignal,
): Promise<{ offsetMs: number; r: number } | null> {
  const fromMs = Math.max(0, aroundMs - REFINE_MS);
  const toMs = Math.min(req.vodDurationMs, aroundMs + req.clipDurationMs + REFINE_MS);
  const vod = await wavEnvelope(req.vodAudio, FINE_HOP, {
    fromMs,
    toMs,
    ...(signal === undefined ? {} : { signal }),
  });
  const best = bestLag(clipEnv, vod);
  if (best === null) return null;
  return { offsetMs: fromMs + best.lag * hopMs(FINE_HOP), r: best.r };
}

function toMatch(
  offsetMs: number,
  req: ClipMatchRequest,
  confidence: number,
  method: ClipMatch["method"],
): ClipMatch | null {
  const srcIn = Math.max(0, Math.round(offsetMs));
  const srcOut = Math.min(req.vodDurationMs, srcIn + req.clipDurationMs);
  if (srcOut <= srcIn) return null;
  return { srcIn, srcOut, confidence: Math.round(confidence * 1000) / 1000, method };
}

export async function matchClipFiles(
  req: ClipMatchRequest,
  signal?: AbortSignal,
): Promise<ClipMatchResult> {
  const opt = signal === undefined ? {} : { signal };
  const audio = (await present(req.vodAudio)) && (await present(req.clipAudio));
  const candidate = transcriptCandidate(
    await words(req.clipTranscript),
    await words(req.vodTranscript),
  );

  if (candidate !== null) {
    if (audio) {
      const clipEnv = await wavEnvelope(req.clipAudio, FINE_HOP, opt);
      const refined = await refine(req, clipEnv, candidate.offsetMs, signal);
      if (refined !== null && refined.r >= PLACED_MIN) {
        return { match: toMatch(refined.offsetMs, req, refined.r, "transcript") };
      }
    }
    return { match: toMatch(candidate.offsetMs, req, candidate.score, "transcript") };
  }

  if (!audio) return { match: null };
  // No usable speech: coarse over the whole VOD, then refine.
  const [clipCoarse, vodCoarse] = await Promise.all([
    wavEnvelope(req.clipAudio, COARSE_HOP, opt),
    wavEnvelope(req.vodAudio, COARSE_HOP, opt),
  ]);
  const coarse = bestLag(clipCoarse, vodCoarse);
  if (coarse === null) return { match: null };
  const clipEnv = await wavEnvelope(req.clipAudio, FINE_HOP, opt);
  const refined = await refine(req, clipEnv, coarse.lag * hopMs(COARSE_HOP), signal);
  if (refined === null) {
    return { match: toMatch(coarse.lag * hopMs(COARSE_HOP), req, coarse.r, "audio") };
  }
  return { match: toMatch(refined.offsetMs, req, refined.r, "audio") };
}
