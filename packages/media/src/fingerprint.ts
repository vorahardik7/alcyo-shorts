// Source fingerprint (plan section 15): size, SHA-256 of the first and last
// 4 MB, the ffprobe duration and the stream layout.
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { Fingerprint, Probe } from "@alcyo/schema";
import { layoutOf } from "./probe.ts";

const PART = 4 * 1024 * 1024;

export async function fingerprint(path: string, probe: Probe): Promise<Fingerprint> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const read = async (position: number) => {
      const length = Math.min(PART, size - position);
      const buffer = Buffer.alloc(Math.max(0, length));
      if (length > 0) await handle.read(buffer, 0, length, position);
      return createHash("sha256").update(buffer).digest("hex");
    };
    return {
      sizeBytes: size,
      headSha256: await read(0),
      tailSha256: await read(Math.max(0, size - PART)),
      durationMs: probe.durationMs,
      layout: layoutOf(probe),
    };
  } finally {
    await handle.close();
  }
}
