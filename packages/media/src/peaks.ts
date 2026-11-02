// Waveform peaks (section 14 step 11): min and max as Int8 pairs, 100 per
// second, from the 16 kHz mono 16-bit WAV.
import { open } from "node:fs/promises";
import { AUDIO_RATE } from "./ffmpeg-args.ts";
import { writeFileAtomic } from "./files.ts";

export const PEAKS_PER_SECOND = 100;
const PER_BUCKET = AUDIO_RATE / PEAKS_PER_SECOND;

/** Min/max pairs for 16-bit samples, one pair per 160 samples. */
export function peaksFromPcm(samples: Int16Array): Int8Array {
  const buckets = Math.ceil(samples.length / PER_BUCKET);
  const out = new Int8Array(buckets * 2);
  for (let b = 0; b < buckets; b++) {
    let min = 0;
    let max = 0;
    const end = Math.min(samples.length, (b + 1) * PER_BUCKET);
    for (let i = b * PER_BUCKET; i < end; i++) {
      const s = samples[i]!;
      if (s < min) min = s;
      if (s > max) max = s;
    }
    out[b * 2] = min >> 8;
    out[b * 2 + 1] = max >> 8;
  }
  return out;
}

/** Finds the "data" chunk of a WAV file: [offset, length]. */
export function wavDataRange(header: Buffer): [number, number] | null {
  if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE")
    return null;
  let at = 12;
  while (at + 8 <= header.length) {
    const id = header.toString("ascii", at, at + 4);
    const size = header.readUInt32LE(at + 4);
    if (id === "data") return [at + 8, size];
    at += 8 + size + (size % 2);
  }
  return null;
}

const BLOCK = PER_BUCKET * 2 * 3200; // ~1 MB, a whole number of buckets

export async function writePeaks(
  wavPath: string,
  outPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const handle = await open(wavPath, "r");
  try {
    const header = Buffer.alloc(4096);
    await handle.read(header, 0, header.length, 0);
    const range = wavDataRange(header);
    if (range === null) throw new Error("audio.wav isn't a WAV file.");
    const [offset, declared] = range;
    const { size } = await handle.stat();
    // ffmpeg writing to a pipe can leave the size field at its max; trust the file.
    const length = Math.min(declared, size - offset);
    const parts: Int8Array[] = [];
    const buffer = Buffer.alloc(BLOCK);
    for (let at = 0; at < length; at += BLOCK) {
      if (signal?.aborted === true) throw new Error("Cancelled.");
      const want = Math.min(BLOCK, length - at) & ~1;
      const { bytesRead } = await handle.read(buffer, 0, want, offset + at);
      const samples = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(bytesRead / 2));
      parts.push(peaksFromPcm(Int16Array.from(samples)));
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const all = new Int8Array(total);
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    await writeFileAtomic(outPath, new Uint8Array(all.buffer));
  } finally {
    await handle.close();
  }
}
