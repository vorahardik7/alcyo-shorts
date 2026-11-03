import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { downloadWhisperModel } from "./whisper-download";

describe("downloadWhisperModel", () => {
  it("keeps a download only when the hash matches, and skips a second time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alcyo-model-"));
    const body = Buffer.from("not the real model, just a stand-in");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const pin = { url: "https://example.test/ggml-base.en.bin", sha256 };
    let fetches = 0;
    const fetchImpl: typeof fetch = () => {
      fetches += 1;
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "content-length": String(body.length) } }),
      );
    };
    const seen: number[] = [];
    const path = await downloadWhisperModel({
      name: "base.en",
      modelsDir: dir,
      pin,
      fetch: fetchImpl,
      onProgress: (received) => seen.push(received),
    });
    expect(path).toBe(join(dir, "ggml-base.en.bin"));
    expect(await readFile(path)).toEqual(body);
    expect(seen.at(-1)).toBe(body.length);
    await downloadWhisperModel({ name: "base.en", modelsDir: dir, pin, fetch: fetchImpl });
    expect(fetches).toBe(1);

    await expect(
      downloadWhisperModel({
        name: "base.en",
        modelsDir: dir,
        pin: { url: pin.url, sha256: "deadbeef" },
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(/didn't match/);
    expect(await stat(path)).toBeTruthy();
    await expect(stat(`${path}.partial`)).rejects.toThrow();
  });
});
