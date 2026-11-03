import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsFile } from "@alcyo/store";
import { beforeEach, describe, expect, it } from "vitest";
import { Downloader } from "./downloader";

const BINARY = Buffer.from("#!/bin/sh\necho 2026.12.01\n");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function release(tag: string) {
  return {
    tag_name: tag,
    assets: [
      { name: "yt-dlp_macos", browser_download_url: "https://github.com/x/yt-dlp_macos" },
      { name: "yt-dlp.exe", browser_download_url: "https://github.com/x/yt-dlp.exe" },
      { name: "SHA2-256SUMS", browser_download_url: "https://github.com/x/SHA2-256SUMS" },
    ],
  };
}

let root: string;
let settings: SettingsFile;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "alcyo-dl-update-"));
  settings = new SettingsFile(join(root, "userData"), "darwin");
});

function downloader(opts: { tag: string; body?: Buffer; sums?: string; runs?: boolean }) {
  const body = opts.body ?? BINARY;
  const fetchImpl: typeof fetch = (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes("api.github.com")) return Promise.resolve(Response.json(release(opts.tag)));
    if (url.endsWith("SHA2-256SUMS"))
      return Promise.resolve(
        new Response(opts.sums ?? `${sha(BINARY)}  yt-dlp_macos\n${"0".repeat(64)}  yt-dlp.exe\n`),
      );
    return Promise.resolve(new Response(body));
  };
  return new Downloader({
    settings,
    userBinDir: join(root, "userData", "bin"),
    bundledPath: "/app/bin/yt-dlp",
    platform: "darwin",
    fetch: fetchImpl,
    versionOf: (path) =>
      Promise.resolve(
        path === "/app/bin/yt-dlp" ? "2026.10.26" : opts.runs === false ? null : "2026.12.01",
      ),
  });
}

describe("Downloader", () => {
  it("installs a newer release whose SHA-256 matches, and uses it", async () => {
    const d = downloader({ tag: "2026.12.01" });
    expect(await d.path()).toBe("/app/bin/yt-dlp");
    const info = await d.update();
    const dest = join(root, "userData", "bin", "yt-dlp-2026.12.01");
    expect(info).toMatchObject({
      version: "2026.12.01",
      bundled: "2026.10.26",
      updated: true,
      path: dest,
    });
    expect(info.note).toBe("Updated to 2026.12.01.");
    expect(await readFile(dest)).toEqual(BINARY);
    expect(await d.path()).toBe(dest);
    expect((await settings.read()).ytDlp).toEqual({ version: "2026.12.01", path: dest });

    const back = await d.useBundled();
    expect(back).toMatchObject({ updated: false, version: "2026.10.26", path: "/app/bin/yt-dlp" });
    expect(await readdir(join(root, "userData", "bin"))).toEqual([]);
  });

  it("keeps nothing when the hash doesn't match or the file doesn't run", async () => {
    await expect(
      downloader({ tag: "2026.12.01", body: Buffer.from("evil") }).update(),
    ).rejects.toThrow("didn't match");
    await expect(downloader({ tag: "2026.12.01", runs: false }).update()).rejects.toThrow(
      "bundled one stays in use",
    );
    expect(await readdir(join(root, "userData", "bin"))).toEqual([]);
    expect((await settings.read()).ytDlp.path).toBeNull();
  });

  it("says when the version in use is already the newest", async () => {
    const info = await downloader({ tag: "2026.10.26" }).update();
    expect(info).toMatchObject({ updated: false, note: "2026.10.26 is the newest version." });
  });
});
