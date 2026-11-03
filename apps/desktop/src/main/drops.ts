// Dropped files (plan section 4, composer). The preload reads the paths of
// files dropped on the window and sends them here; the window only gets a
// token and the names, and uses the token with drop:use. So the renderer
// never sees or sends a path. Electron-free.
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { newId } from "@alcyo/store";

const KEEP = 20;
const TTL_MS = 10 * 60_000;

export class DropBox {
  private drops = new Map<string, { paths: string[]; at: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Keeps the paths that are real files. Null when none are. */
  async put(paths: readonly string[]): Promise<{ token: string; names: string[] } | null> {
    const files: string[] = [];
    for (const p of paths) {
      const st = await stat(p).catch(() => null);
      if (st?.isFile() === true) files.push(p);
    }
    if (files.length === 0) return null;
    const token = newId("m").replace(/^m_/, "drop_");
    this.drops.set(token, { paths: files, at: this.now() });
    for (const [k, v] of this.drops) {
      if (this.drops.size <= KEEP && this.now() - v.at < TTL_MS) break;
      this.drops.delete(k);
    }
    return { token, names: files.map((p) => basename(p).slice(0, 260)) };
  }

  /** The paths for a token, once. */
  take(token: string): string[] | null {
    const hit = this.drops.get(token);
    this.drops.delete(token);
    if (hit === undefined || this.now() - hit.at >= TTL_MS) return null;
    return hit.paths;
  }
}

export const EXPIRED = "That drop expired. Drop the file again.";
