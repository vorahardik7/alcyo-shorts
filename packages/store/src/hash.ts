// The content part of a source fingerprint (plan section 15): size and the
// SHA-256 of the first and last 4 MB. Locate file compares these; it needs no
// ffprobe.
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { Fingerprint } from "@alcyo/schema";

const PART = 4 * 1024 * 1024;

export type ContentHash = Pick<Fingerprint, "sizeBytes" | "headSha256" | "tailSha256">;

export async function hashFile(path: string): Promise<ContentHash> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const read = async (position: number) => {
      const length = Math.max(0, Math.min(PART, size - position));
      const buffer = Buffer.alloc(length);
      if (length > 0) await handle.read(buffer, 0, length, position);
      return createHash("sha256").update(buffer).digest("hex");
    };
    return {
      sizeBytes: size,
      headSha256: await read(0),
      tailSha256: await read(Math.max(0, size - PART)),
    };
  } finally {
    await handle.close();
  }
}

export function sameContent(a: ContentHash, b: ContentHash): boolean {
  return (
    a.sizeBytes === b.sizeBytes && a.headSha256 === b.headSha256 && a.tailSha256 === b.tailSha256
  );
}
