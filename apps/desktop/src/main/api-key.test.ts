import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiKeyFile, type SecretCodec } from "./api-key";

const codec: SecretCodec = {
  encrypt: (plain) => Buffer.from(`enc:${plain}`, "utf8"),
  decrypt: (blob) => {
    const text = blob.toString("utf8");
    if (!text.startsWith("enc:")) throw new Error("bad");
    return text.slice(4);
  },
};

describe("ApiKeyFile", () => {
  it("round-trips a key as ciphertext and can clear it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alcyo-key-"));
    const file = new ApiKeyFile(join(dir, "anthropic-key.bin"), codec);
    expect(await file.has()).toBe(false);
    await file.write("  sk-test  ");
    const stored = await readFile(file.path);
    expect(stored.toString("utf8")).toBe("enc:sk-test");
    expect(stored.toString("utf8")).not.toBe("sk-test");
    expect(await file.read()).toBe("sk-test");
    await file.clear();
    expect(await file.has()).toBe(false);
    expect(await file.read()).toBeNull();
  });

  it("doesn't count a file it can't open as a saved key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alcyo-key-"));
    const path = join(dir, "anthropic-key.bin");
    await writeFile(path, "from another computer");
    expect(await new ApiKeyFile(path, codec).has()).toBe(false);
  });
});
