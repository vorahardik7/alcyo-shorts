// The whisper model download (spec 5). The bytes are checked against the
// Hugging Face git-lfs sha256 before the file is kept. small.en's hash also
// matches the copy already in userData (plan section 36's sha1 is the same file).
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { WhisperModelName } from "@alcyo/ipc";
import { renameInto } from "@alcyo/store";

/** model:progress goes over IPC; one event per network chunk is too many. */
const PROGRESS_EVERY_MS = 200;

export interface ModelPin {
  url: string;
  sha256: string;
}

export const WHISPER_PINS: Record<WhisperModelName, ModelPin> = {
  "small.en": {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
  },
  "base.en": {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
  },
};

export function modelFile(modelsDir: string, name: WhisperModelName): string {
  return join(modelsDir, `ggml-${name}.bin`);
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function fileMatches(path: string, pin: ModelPin): Promise<boolean> {
  try {
    await stat(path);
  } catch {
    return false;
  }
  return (await sha256(path)) === pin.sha256;
}

/**
 * Downloads one pinned model. A file that's already the right hash is left
 * alone. A bad download is deleted and the previous file, if any, stays.
 */
export async function downloadWhisperModel(opts: {
  name: WhisperModelName;
  modelsDir: string;
  /** Tests pass a stand-in pin. The app uses WHISPER_PINS. */
  pin?: ModelPin;
  fetch?: typeof fetch;
  onProgress?: (received: number, total: number | null) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const pin = opts.pin ?? WHISPER_PINS[opts.name];
  const dest = modelFile(opts.modelsDir, opts.name);
  if (await fileMatches(dest, pin)) return dest;

  const fetchImpl = opts.fetch ?? fetch;
  const partial = `${dest}.partial`;
  await mkdir(dirname(dest), { recursive: true });
  const init: RequestInit = { redirect: "follow" };
  if (opts.signal !== undefined) init.signal = opts.signal;
  const response = await fetchImpl(pin.url, init);
  if (!response.ok || response.body === null) {
    throw new Error(`The model download failed (${response.status}).`);
  }
  const totalHeader = response.headers.get("content-length");
  const parsed = totalHeader === null ? NaN : Number(totalHeader);
  const total = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  const hash = createHash("sha256");
  let received = 0;
  let lastReport = -Infinity;
  const report = (final: boolean) => {
    const now = Date.now();
    if (!final && now - lastReport < PROGRESS_EVERY_MS) return;
    lastReport = now;
    opts.onProgress?.(received, total);
  };
  const source = Readable.fromWeb(response.body);
  const count = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buf.length;
      hash.update(buf);
      report(false);
      callback(null, buf);
    },
  });
  try {
    await pipeline(source, count, createWriteStream(partial));
    if (hash.digest("hex") !== pin.sha256) {
      throw new Error("The download didn't match the pinned model. Nothing was kept.");
    }
    const handle = await open(partial, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameInto(partial, dest);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  report(true);
  return dest;
}
