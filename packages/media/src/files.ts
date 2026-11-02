// Atomic writes (temp in the same folder, fsync, rename) and checked reads.
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { z } from "zod";

const RETRY_MS = 2000;
const RETRY_STEP_MS = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A temp path next to `target`, for a tool to write before renameInto. */
export function tempPathFor(target: string): string {
  return join(dirname(target), `.${basename(target)}.${randomBytes(4).toString("hex")}.part`);
}

/** Renames temp onto target. On Windows, retries EPERM and EBUSY for up to 2 s. */
export async function renameInto(temp: string, target: string): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      await rename(temp, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retryable = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!retryable || Date.now() - started > RETRY_MS) throw error;
      await sleep(RETRY_STEP_MS);
    }
  }
}

export async function writeFileAtomic(target: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temp = tempPathFor(target);
  try {
    const handle = await open(temp, "w");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameInto(temp, target);
  } catch (error) {
    await removeQuietly(temp);
    throw error;
  }
}

export function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  return writeFileAtomic(target, `${JSON.stringify(value, null, 2)}\n`);
}

/** Reads and parses a JSON file with its schema. Null when missing or bad. */
export async function readJson<T extends z.ZodType>(
  path: string,
  schema: T,
): Promise<z.infer<T> | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function removeQuietly(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true }).catch(() => undefined);
}
