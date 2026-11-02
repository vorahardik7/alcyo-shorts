import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { binTarget, resolveBinDir } from "./bin";

const base = {
  resourcesPath: "/R",
  appDir: "/repo/apps/desktop",
  platform: "darwin",
  arch: "arm64",
} as const;

describe("resolveBinDir", () => {
  it("uses Resources/bin when packaged", () => {
    expect(resolveBinDir({ ...base, packaged: true, env: { ALCYO_BIN_DIR: "/x" } })).toBe(
      join("/R", "bin"),
    );
  });

  it("uses ALCYO_BIN_DIR in dev", () => {
    expect(resolveBinDir({ ...base, packaged: false, env: { ALCYO_BIN_DIR: "/x" } })).toBe("/x");
  });

  it("falls back to apps/desktop/resources/bin/<target>, not out/main", () => {
    expect(resolveBinDir({ ...base, packaged: false, env: {} })).toBe(
      join("/repo/apps/desktop", "resources", "bin", "mac-arm64"),
    );
  });

  it("names targets like fetch-binaries", () => {
    expect(binTarget("darwin", "arm64")).toBe("mac-arm64");
    expect(binTarget("win32", "x64")).toBe("win-x64");
  });
});
