import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDemoOptions, prepareDemoInput } from "../../scripts/demo-options";

describe("demo options", () => {
  it.each([
    [[], { agent: "grok", newClip: false, generateStandIn: false }],
    [["--new-clip"], { agent: "grok", newClip: true, generateStandIn: false }],
    [["--agent", "codex", "--new-clip"], { agent: "codex", newClip: true, generateStandIn: false }],
    [
      ["--generate-stand-in", "--agent", "script"],
      { agent: "script", newClip: false, generateStandIn: true },
    ],
  ])("parses %j", (args, expected) => {
    expect(parseDemoOptions(args)).toEqual(expected);
  });
  it.each(
    [
      ["--agent"],
      ["--agent", "--new-clip"],
      ["--agent", "other"],
      ["--unknown"],
      ["--new-clip", "--generate-stand-in"],
    ].map((args) => ({ args })),
  )("rejects $args before starting work", ({ args }) => {
    expect(() => parseDemoOptions(args)).toThrow();
  });
});

describe("demo input protection", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "alcyo-demo-input-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("preserves replacement bytes for both rebuild forms", async () => {
    const path = join(root, "clip.mp4");
    const footage = Buffer.alloc(8192, 137);
    await writeFile(path, footage);
    const generate = vi.fn(() => Promise.resolve());
    for (const newClip of [false, true])
      await prepareDemoInput(path, { newClip, generateStandIn: false }, generate);
    expect(generate).not.toHaveBeenCalled();
    expect(await readFile(path)).toEqual(footage);
    await expect(
      prepareDemoInput(path, { newClip: false, generateStandIn: true }, generate),
    ).rejects.toThrow("already exists");
    expect(await readFile(path)).toEqual(footage);
  });

  it("requires replacement input and does not mistake a folder for footage", async () => {
    const path = join(root, "clip.mp4");
    const generate = vi.fn(() => Promise.resolve());
    await expect(
      prepareDemoInput(path, { newClip: true, generateStandIn: false }, generate),
    ).rejects.toThrow("replacement recording");
    await mkdir(path);
    await expect(
      prepareDemoInput(path, { newClip: false, generateStandIn: false }, generate),
    ).rejects.toThrow("isn't a file");
    expect(generate).not.toHaveBeenCalled();
  });

  it("generates absent footage, and cleans up failed generation", async () => {
    const path = join(root, "clip.mp4");
    await expect(
      prepareDemoInput(path, { newClip: false, generateStandIn: false }, async (out) => {
        await writeFile(out, "partial");
        throw new Error("generation failed");
      }),
    ).rejects.toThrow("generation failed");
    expect(await readdir(root)).toEqual([]);
    await prepareDemoInput(path, { newClip: false, generateStandIn: true }, (out) =>
      writeFile(out, "generated"),
    );
    expect(await readFile(path, "utf8")).toBe("generated");
    expect(await readdir(root)).toEqual(["clip.mp4"]);
  });

  it("cannot overwrite a recording created during generation", async () => {
    const path = join(root, "clip.mp4");
    await expect(
      prepareDemoInput(path, { newClip: false, generateStandIn: true }, async (out) => {
        await writeFile(out, "generated");
        await writeFile(path, "replacement");
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(path, "utf8")).toBe("replacement");
    expect(await readdir(root)).toEqual(["clip.mp4"]);
  });
});
