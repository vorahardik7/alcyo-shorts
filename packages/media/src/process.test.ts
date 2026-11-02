import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MediaError } from "./errors.ts";
import { readJson, writeFileAtomic, writeJsonAtomic } from "./files.ts";
import { runTool } from "./process.ts";

const node = process.execPath;

describe("runTool", () => {
  it("passes args to the child unchanged, with no shell in between", async () => {
    const awkward = [`a "quoted" arg`, "it's", "$HOME", "名前 — ok", "; rm -rf /", "-v"];
    const out = await runTool(
      node,
      ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...awkward],
      {
        collectStdout: true,
      },
    );
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual(awkward);
  });

  it("streams lines and keeps a stderr tail", async () => {
    const lines: string[] = [];
    const out = await runTool(
      node,
      [
        "-e",
        "for (let i = 0; i < 60; i++) console.error('e' + i); console.log('a\\nb'); process.exit(3)",
      ],
      { onStdoutLine: (l) => lines.push(l) },
    );
    expect(out.code).toBe(3);
    expect(lines).toEqual(["a", "b"]);
    expect(out.stderrTail).toHaveLength(40);
    expect(out.stderrTail.at(-1)).toBe("e59");
  });

  it("kills the child when cancelled, and rejects with cancelled", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = runTool(node, ["-e", "setInterval(() => {}, 1000)"], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("rejects at once when already cancelled, and plainly when the tool is missing", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runTool(node, ["-v"], { signal: controller.signal })).rejects.toBeInstanceOf(
      MediaError,
    );
    await expect(runTool("/no/such/tool", [], {})).rejects.toMatchObject({ code: "tool-failed" });
  });
});

describe("atomic files", () => {
  it("writes into place and leaves no temp files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alcyo-files-"));
    const target = join(dir, "deep", "x.json");
    await writeJsonAtomic(target, { a: 1 });
    await writeFileAtomic(join(dir, "deep", "y.bin"), new Uint8Array([1, 2]));
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ a: 1 });
    expect((await readdir(join(dir, "deep"))).sort()).toEqual(["x.json", "y.bin"]);
  });

  it("reads with a schema, returning null for missing, broken or wrong files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alcyo-files-"));
    const schema = z.object({ a: z.number() });
    await writeFile(join(dir, "ok.json"), '{"a":1}');
    await writeFile(join(dir, "torn.json"), '{"a":');
    await writeFile(join(dir, "wrong.json"), '{"a":"x"}');
    expect(await readJson(join(dir, "ok.json"), schema)).toEqual({ a: 1 });
    expect(await readJson(join(dir, "torn.json"), schema)).toBeNull();
    expect(await readJson(join(dir, "wrong.json"), schema)).toBeNull();
    expect(await readJson(join(dir, "missing.json"), schema)).toBeNull();
  });
});
