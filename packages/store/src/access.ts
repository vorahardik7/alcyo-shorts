// Optional per-async-operation file boundary. Desktop projects may reference
// media anywhere; MCP installs a resolver for its own calls only. No global
// mutable root and no recursive scan of potentially large project caches.
import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type PathResolver = (path: string) => Promise<string>;
const access = new AsyncLocalStorage<{ resolve: PathResolver; denied?: Error }>();

export function withFileAccess<T>(resolve: PathResolver, run: () => Promise<T>): Promise<T> {
  const context: { resolve: PathResolver; denied?: Error } = { resolve };
  return access.run(context, async () => {
    try {
      const result = await run();
      if (context.denied !== undefined) throw context.denied;
      return result;
    } catch (error) {
      throw context.denied ?? error;
    }
  });
}

/** Metadata can describe an external recording without probing its existence. */
export async function canAccessFile(path: string): Promise<boolean> {
  const context = access.getStore();
  if (context === undefined) return true;
  try {
    await context.resolve(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveFileAccess(path: string): Promise<string> {
  return (await checked(path)) as string;
}

async function checked(path: unknown): Promise<unknown> {
  const context = access.getStore();
  if (context === undefined) return path;
  if (context.denied !== undefined) throw context.denied;
  const name =
    typeof path === "string"
      ? path
      : path instanceof URL
        ? fileURLToPath(path)
        : Buffer.isBuffer(path)
          ? path.toString()
          : null;
  // A FileHandle has already passed the check at open().
  if (name === null) return path;
  try {
    return await context.resolve(name);
  } catch (error) {
    context.denied ??=
      error instanceof Error ? error : new Error("File access denied", { cause: error });
    throw error;
  }
}

function guard<F extends (...args: never[]) => unknown>(fn: F, paths = 1): F {
  return (async (...args: unknown[]) => {
    for (let i = 0; i < paths; i++) args[i] = await checked(args[i]);
    return Reflect.apply(fn, undefined, args) as unknown;
  }) as unknown as F;
}

export const readFile = guard(fs.readFile);
export const writeFile = guard(fs.writeFile);
export const appendFile = guard(fs.appendFile);
export const open = guard(fs.open);
export const stat = guard(fs.stat);
export const readdir = guard(fs.readdir);
export const mkdir = guard(fs.mkdir);
export const rm = guard(fs.rm);
export const rename = guard(fs.rename, 2);
export const link = guard(fs.link, 2);
export const copyFile = guard(fs.copyFile, 2);
