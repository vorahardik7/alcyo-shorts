// Audio envelopes for clip matching (plan section 12, step 3). Reads the
// 16 kHz mono s16le audio.wav that analysis already wrote, so no tool runs.
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { wavDataRange } from "@alcyo/media";

export const RATE = 16_000;
/** 5 ms: the fine hop. */
export const FINE_HOP = 80;
/** 50 ms: the coarse hop for a search over the whole VOD. */
export const COARSE_HOP = 800;

export const hopMs = (hop: number) => (hop * 1000) / RATE;

interface WavData {
  offset: number;
  bytes: number;
}

async function wavData(path: string): Promise<WavData> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const range = wavDataRange(header.subarray(0, bytesRead));
    if (range === null) throw new Error(`Not a WAV file: ${path}`);
    const size = (await handle.stat()).size;
    const [offset, len] = range;
    // Streaming writers leave the size at 0 or 0xFFFFFFFF; trust the file size then.
    const bytes = len === 0 || len === 0xffffffff || offset + len > size ? size - offset : len;
    return { offset, bytes: bytes - (bytes % 2) };
  } finally {
    await handle.close();
  }
}

/** Duration of a 16 kHz mono s16 WAV, in ms. */
export async function wavDurationMs(path: string): Promise<number> {
  const { bytes } = await wavData(path);
  return Math.floor((bytes / 2 / RATE) * 1000);
}

/**
 * Mean absolute sample per hop, then log1p, so loud moments don't swamp the
 * correlation. fromMs and toMs pick a slice; the default is the whole file.
 */
export async function wavEnvelope(
  path: string,
  hop: number,
  opts: { fromMs?: number; toMs?: number; signal?: AbortSignal } = {},
): Promise<Float32Array> {
  const { offset, bytes } = await wavData(path);
  const total = bytes / 2;
  const from = Math.max(0, Math.floor(((opts.fromMs ?? 0) * RATE) / 1000));
  const to = Math.min(total, Math.ceil(((opts.toMs ?? Infinity) * RATE) / 1000));
  const count = Math.max(0, Math.floor((to - from) / hop));
  const out = new Float32Array(count);
  if (count === 0) return out;

  const stream = createReadStream(path, {
    start: offset + from * 2,
    end: offset + (from + count * hop) * 2 - 1,
    highWaterMark: 1 << 20,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });
  let index = 0;
  let inHop = 0;
  let sum = 0;
  let carry: number | null = null;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    let at = 0;
    if (carry !== null) {
      const sample = ((((chunk[0] ?? 0) << 8) | carry) << 16) >> 16;
      carry = null;
      at = 1;
      sum += Math.abs(sample);
      if (++inHop === hop) {
        if (index < count) out[index++] = Math.log1p(sum / hop);
        inHop = 0;
        sum = 0;
      }
    }
    for (; at + 1 < chunk.length; at += 2) {
      sum += Math.abs(chunk.readInt16LE(at));
      if (++inHop === hop) {
        if (index < count) out[index++] = Math.log1p(sum / hop);
        inHop = 0;
        sum = 0;
      }
    }
    if (at < chunk.length) carry = chunk[at]!;
  }
  return index === count ? out : out.subarray(0, index);
}

/**
 * The lag (in hops, with a parabola through the peak) where `clip` lines up
 * best with `vod`, searching lags lagFrom..lagTo, and the Pearson r there.
 */
export function bestLag(
  clip: Float32Array,
  vod: Float32Array,
  lagFrom = 0,
  lagTo = vod.length - clip.length,
): { lag: number; r: number } | null {
  const m = clip.length;
  const lo = Math.max(0, Math.floor(lagFrom));
  const hi = Math.min(vod.length - m, Math.ceil(lagTo));
  if (m < 8 || hi < lo) return null;

  let clipSum = 0;
  let clipSq = 0;
  for (let i = 0; i < m; i++) {
    clipSum += clip[i]!;
    clipSq += clip[i]! * clip[i]!;
  }
  const clipMean = clipSum / m;
  const clipVar = clipSq - m * clipMean * clipMean;
  if (clipVar <= 1e-9) return null;
  const centered = new Float64Array(m);
  for (let i = 0; i < m; i++) centered[i] = clip[i]! - clipMean;

  // Prefix sums give each window's mean and variance in O(1).
  const pre = new Float64Array(vod.length + 1);
  const preSq = new Float64Array(vod.length + 1);
  for (let i = 0; i < vod.length; i++) {
    pre[i + 1] = pre[i]! + vod[i]!;
    preSq[i + 1] = preSq[i]! + vod[i]! * vod[i]!;
  }

  const rAt = (lag: number): number => {
    const s = pre[lag + m]! - pre[lag]!;
    const sq = preSq[lag + m]! - preSq[lag]!;
    const varW = sq - (s * s) / m;
    if (varW <= 1e-9) return 0;
    let dot = 0;
    for (let i = 0; i < m; i++) dot += centered[i]! * vod[lag + i]!;
    return dot / Math.sqrt(clipVar * varW);
  };

  let best = lo;
  let bestR = -Infinity;
  const rs = new Float64Array(hi - lo + 1);
  for (let lag = lo; lag <= hi; lag++) {
    const r = rAt(lag);
    rs[lag - lo] = r;
    if (r > bestR) {
      bestR = r;
      best = lag;
    }
  }
  let lag = best;
  if (best > lo && best < hi) {
    const a = rs[best - lo - 1]!;
    const b = rs[best - lo]!;
    const c = rs[best - lo + 1]!;
    const denom = a - 2 * b + c;
    if (denom < 0) lag = best + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
  }
  return { lag, r: Math.max(0, Math.min(1, bestR)) };
}
