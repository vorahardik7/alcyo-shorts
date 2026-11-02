import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readJson, writeFileAtomic, writeJsonAtomic } from "./files.ts";

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
