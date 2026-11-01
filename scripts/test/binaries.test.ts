import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checksumMessage,
  hostTarget,
  lockHash,
  type Manifest,
  outputsOf,
  parseLock,
  verifyProblems,
} from "../lib/binaries.ts";

const lock = parseLock(
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "binaries.lock.json"), "utf8")),
);

describe("binaries.lock.json", () => {
  it("pins every tool for both targets", () => {
    for (const target of ["mac-arm64", "win-x64"] as const) {
      expect(Object.keys(lock.targets[target]).sort()).toEqual(
        ["ffmpeg", "ffprobe", "silero-vad", "whisper-cli", "yt-dlp"].filter(
          (t) => target === "mac-arm64" || t !== "ffprobe",
        ),
      );
    }
    const win = Object.values(lock.targets["win-x64"]).flatMap(outputsOf);
    expect(win).toEqual(
      expect.arrayContaining(["ffmpeg.exe", "ffprobe.exe", "whisper-cli.exe", "yt-dlp.exe"]),
    );
  });

  it("rejects bad checksums and paths that escape the folder", () => {
    const bad = structuredClone(lock) as unknown as {
      targets: { "mac-arm64": { ffmpeg: { sha256: string; extract: Record<string, string> } } };
    };
    bad.targets["mac-arm64"].ffmpeg.sha256 = "abc";
    expect(() => parseLock(bad)).toThrow("sha256");
    bad.targets["mac-arm64"].ffmpeg.sha256 = "0".repeat(64);
    bad.targets["mac-arm64"].ffmpeg.extract = { ffmpeg: "../../evil" };
    expect(() => parseLock(bad)).toThrow("relative path");
  });
});

describe("checksumMessage", () => {
  it("names the file, both checksums and what to do", () => {
    const text = checksumMessage(
      "/c/ffmpeg.zip",
      "https://x/ffmpeg.zip",
      "a".repeat(64),
      "b".repeat(64),
    );
    expect(text).toContain("/c/ffmpeg.zip");
    expect(text).toContain("a".repeat(64));
    expect(text).toContain("b".repeat(64));
    expect(text).toContain("scripts/binaries.lock.json");
  });
});

describe("verifyProblems", () => {
  const tools = lock.targets["win-x64"];
  const manifest: Manifest = {
    target: "win-x64",
    tools: Object.fromEntries(
      Object.entries(tools).map(([name, tool]) => [
        name,
        {
          version: tool.version,
          lockHash: lockHash(tool),
          files: Object.fromEntries(outputsOf(tool).map((rel) => [rel, "1".repeat(64)])),
        },
      ]),
    ),
  };

  it("passes when every file matches", () => {
    expect(verifyProblems(tools, manifest, () => "1".repeat(64))).toEqual([]);
  });

  it("reports missing, changed and out-of-date files", () => {
    expect(verifyProblems(tools, undefined, () => undefined)[0]).toContain("No manifest");
    expect(
      verifyProblems(tools, manifest, (rel) => (rel === "ffmpeg.exe" ? undefined : "1".repeat(64))),
    ).toEqual(["ffmpeg.exe is missing. Run pnpm fetch-binaries."]);
    expect(
      verifyProblems(tools, manifest, (rel) =>
        rel === "yt-dlp.exe" ? "2".repeat(64) : "1".repeat(64),
      ),
    ).toEqual(["yt-dlp.exe changed since it was fetched. Run pnpm fetch-binaries."]);
    const stale = structuredClone(manifest);
    stale.tools["yt-dlp"]!.lockHash = "3".repeat(64);
    expect(verifyProblems(tools, stale, () => "1".repeat(64))).toEqual([
      "yt-dlp doesn't match scripts/binaries.lock.json. Run pnpm fetch-binaries.",
    ]);
  });
});

describe("hostTarget", () => {
  it("maps supported machines", () => {
    expect(hostTarget("darwin", "arm64")).toBe("mac-arm64");
    expect(hostTarget("win32", "x64")).toBe("win-x64");
    expect(hostTarget("darwin", "x64")).toBeUndefined();
  });
});
