import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const AGENTS = ["grok", "claude", "codex", "script"] as const;
export interface DemoOptions {
  agent: (typeof AGENTS)[number];
  newClip: boolean;
  generateStandIn: boolean;
}

export function parseDemoOptions(args: readonly string[]): DemoOptions {
  const options: DemoOptions = { agent: "grok", newClip: false, generateStandIn: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--agent": {
        const agent = args[++i];
        if (!AGENTS.some((name) => name === agent))
          throw new Error("--agent needs grok, claude, codex or script.");
        options.agent = agent as DemoOptions["agent"];
        break;
      }
      case "--new-clip":
        options.newClip = true;
        break;
      case "--generate-stand-in":
        options.generateStandIn = true;
        break;
      default:
        throw new Error(`Unknown demo option: ${args[i]}`);
    }
  }
  if (options.newClip && options.generateStandIn)
    throw new Error("Use either --new-clip or --generate-stand-in, not both.");
  return options;
}

/** Rebuilding always keeps existing footage. Generation never replaces it. */
export async function prepareDemoInput(
  path: string,
  options: Pick<DemoOptions, "newClip" | "generateStandIn">,
  generate: (output: string) => Promise<void>,
): Promise<void> {
  const existing = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (existing !== null) {
    if (!existing.isFile()) throw new Error(`The demo recording isn't a file: ${path}`);
    if (options.generateStandIn)
      throw new Error(
        `A recording already exists at ${path}. Move it before generating a stand-in.`,
      );
    return;
  }
  if (options.newClip) throw new Error(`Put your replacement recording at ${path} first.`);
  await mkdir(dirname(path), { recursive: true });
  const work = await mkdtemp(join(dirname(path), ".demo-input-"));
  try {
    const temp = join(work, "clip.mp4");
    await generate(temp);
    // Also protect a recording created while generation was running, without
    // loading a potentially large file into memory.
    await copyFile(temp, path, constants.COPYFILE_EXCL);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
