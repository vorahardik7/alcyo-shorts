// The one folder the server may touch (plan section 23, spec 12). Every path
// a tool takes is resolved here, through symlinks, and refused if it lands
// outside the root.
import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export class ToolError extends Error {
  override name = "ToolError";
}

export class Root {
  private real: Promise<string> | null = null;

  constructor(readonly dir: string) {}

  /** The root's real path. Fails plainly while the folder doesn't exist. */
  private async base(): Promise<string> {
    this.real ??= realpath(this.dir).catch(() => {
      this.real = null;
      throw new ToolError(`The root folder ${this.dir} doesn't exist yet.`);
    });
    return this.real;
  }

  private inside(base: string, path: string): boolean {
    const rel = relative(base, path);
    return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  }

  /** Resolve new files through their closest existing ancestor as well. */
  async resolveAny(p: string, what = "That path"): Promise<string> {
    const base = await this.base();
    const abs = isAbsolute(p) ? resolve(p) : resolve(base, p);
    let ancestor = abs;
    let canonical: string;
    for (;;) {
      try {
        const real = await realpath(ancestor);
        canonical = resolve(real, relative(ancestor, abs));
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const entry = await lstat(ancestor).catch((e: unknown) => {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          return null;
        });
        if (entry?.isSymbolicLink()) throw new ToolError(`${what} has an unresolved link: ${p}`);
        const parent = dirname(ancestor);
        if (parent === ancestor) throw new ToolError(`${what} can't be resolved: ${p}`);
        ancestor = parent;
      }
    }
    if (!this.inside(base, canonical)) {
      throw new ToolError(`${what} is outside the root folder, so it can't be used: ${p}`);
    }
    return canonical;
  }

  async contains(p: string): Promise<boolean> {
    try {
      await this.resolveAny(p);
      return true;
    } catch {
      return false;
    }
  }

  async resolve(p: string, what = "That path"): Promise<string> {
    const path = await this.resolveAny(p, what);
    try {
      return await realpath(path);
    } catch {
      throw new ToolError(`${what} doesn't exist: ${p}`);
    }
  }

  async resolveFile(p: string, what = "That file"): Promise<string> {
    const real = await this.resolve(p, what);
    if (!(await stat(real)).isFile()) throw new ToolError(`${what} isn't a file: ${p}`);
    return real;
  }

  /** A real path inside the root, as the root-relative path tools report. */
  async show(real: string): Promise<string> {
    return (
      relative(await this.base(), real)
        .split("\\")
        .join("/") || "."
    );
  }
}
