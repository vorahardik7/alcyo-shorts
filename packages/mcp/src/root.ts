// The one folder the server may touch (plan section 23, spec 12). Every path
// a tool takes is resolved here, through symlinks, and refused if it lands
// outside the root.
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

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

  /** True when p is the root or inside it, after symlinks (when p exists). */
  async contains(p: string): Promise<boolean> {
    const base = await this.base();
    const real = await realpath(p).catch(() => p);
    const rel = relative(base, real);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  }

  /**
   * A path relative to the root (or absolute inside it) -> its real path.
   * It must exist, and must still be inside the root after symlinks.
   */
  async resolve(p: string, what = "That path"): Promise<string> {
    const base = await this.base();
    const abs = isAbsolute(p) ? p : resolve(base, p);
    let real: string;
    try {
      real = await realpath(abs);
    } catch {
      throw new ToolError(`${what} doesn't exist: ${p}`);
    }
    if (!(await this.contains(real))) {
      throw new ToolError(`${what} is outside the root folder, so it can't be used: ${p}`);
    }
    return real;
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
