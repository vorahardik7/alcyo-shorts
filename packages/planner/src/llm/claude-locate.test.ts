import { describe, expect, it } from "vitest";
import {
  claudeSignedIn,
  knownClaudePaths,
  type LocateDeps,
  locateClaude,
  parseClaudeVersion,
  parseShellLookup,
  scrubClaudeEnv,
} from "./claude-locate";

interface Call {
  file: string;
  args: readonly string[];
  timeoutMs: number;
  env: Record<string, string | undefined>;
}

function fakeDeps(opts: {
  platform?: NodeJS.Platform;
  files?: string[];
  works?: string[];
  shellOut?: string;
  whereOut?: string;
  env?: Record<string, string>;
}): { deps: LocateDeps; calls: Call[] } {
  const calls: Call[] = [];
  const files = new Set(opts.files ?? []);
  const works = new Set(opts.works ?? []);
  const deps: LocateDeps = {
    platform: opts.platform ?? "darwin",
    env: { SHELL: "/bin/zsh", ANTHROPIC_API_KEY: "sk-test", ...opts.env },
    homedir: "/Users/me",
    isFile: (p) => Promise.resolve(files.has(p)),
    run: (file, args, o) => {
      calls.push({ file, args, timeoutMs: o.timeoutMs, env: o.env });
      if (args[0] === "-ilc") {
        return Promise.resolve({ code: 0, stdout: opts.shellOut ?? "" });
      }
      if (file === "where.exe") {
        return Promise.resolve({
          code: opts.whereOut === undefined ? 1 : 0,
          stdout: opts.whereOut ?? "",
        });
      }
      if (args[0] === "-v") {
        return Promise.resolve(
          works.has(file) ? { code: 0, stdout: "2.1.30 (Claude Code)\n" } : { code: 1, stdout: "" },
        );
      }
      return Promise.resolve({ code: works.has(file) ? 0 : 1, stdout: "secret account info" });
    },
  };
  return { deps, calls };
}

describe("knownClaudePaths", () => {
  it("lists the macOS folders in the plan's order", () => {
    expect(knownClaudePaths("darwin", {}, "/Users/me")).toEqual([
      "/Users/me/.local/bin/claude",
      "/Users/me/.claude/local/claude",
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    ]);
  });

  it("lists only .exe paths on Windows", () => {
    const paths = knownClaudePaths(
      "win32",
      { USERPROFILE: "C:\\Users\\me", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
      "C:\\Users\\me",
    );
    expect(paths).toEqual([
      "C:\\Users\\me\\.local\\bin\\claude.exe",
      "C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe",
    ]);
  });
});

describe("parsers", () => {
  it("takes the last absolute path from noisy login-shell output", () => {
    expect(parseShellLookup("Welcome back\n/usr/bin/fortune output\n/Users/me/bin/claude\n")).toBe(
      "/Users/me/bin/claude",
    );
    expect(parseShellLookup("claude not found\n")).toBeNull();
    expect(parseShellLookup("")).toBeNull();
  });

  it("reads the version number", () => {
    expect(parseClaudeVersion("2.1.30 (Claude Code)")).toBe("2.1.30");
    expect(parseClaudeVersion("claude 3.0.0-beta.1")).toBe("3.0.0-beta.1");
    expect(parseClaudeVersion("nothing")).toBeNull();
  });

  it("removes the API key and token from the child env and keeps the rest", () => {
    const env = scrubClaudeEnv({
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "k",
      ANTHROPIC_AUTH_TOKEN: "t",
    });
    expect(env).toEqual({ PATH: "/usr/bin" });
  });
});

describe("locateClaude", () => {
  it("uses the first known folder whose claude runs, without the login shell", async () => {
    const { deps, calls } = fakeDeps({
      files: ["/Users/me/.local/bin/claude", "/opt/homebrew/bin/claude"],
      works: ["/opt/homebrew/bin/claude"],
    });
    await expect(locateClaude(deps)).resolves.toEqual({
      path: "/opt/homebrew/bin/claude",
      via: "known-folder",
      version: "2.1.30",
      problem: null,
    });
    expect(calls.some((c) => c.args[0] === "-ilc")).toBe(false);
    for (const call of calls) expect(call.env["ANTHROPIC_API_KEY"]).toBeUndefined();
  });

  it("prefers a saved path that still runs", async () => {
    const { deps } = fakeDeps({
      files: ["/custom/claude", "/Users/me/.local/bin/claude"],
      works: ["/custom/claude", "/Users/me/.local/bin/claude"],
    });
    await expect(locateClaude(deps, "/custom/claude")).resolves.toMatchObject({
      path: "/custom/claude",
      via: "saved",
    });
  });

  it("falls back to the login shell on macOS with fixed args and a 5 s timeout", async () => {
    const { deps, calls } = fakeDeps({
      files: ["/Users/me/.npm-global/bin/claude"],
      works: ["/Users/me/.npm-global/bin/claude"],
      shellOut: "motd\n/Users/me/.npm-global/bin/claude\n",
      env: { SHELL: "/bin/bash" },
    });
    await expect(locateClaude(deps)).resolves.toMatchObject({
      path: "/Users/me/.npm-global/bin/claude",
      via: "login-shell",
    });
    const shellCall = calls.find((c) => c.args[0] === "-ilc");
    expect(shellCall).toMatchObject({
      file: "/bin/bash",
      args: ["-ilc", "command -v claude"],
      timeoutMs: 5000,
    });
  });

  it("reports missing when nothing runs", async () => {
    const { deps } = fakeDeps({ files: ["/usr/local/bin/claude"] });
    await expect(locateClaude(deps)).resolves.toEqual({
      path: null,
      via: "none",
      version: null,
      problem: "missing",
    });
  });

  it("uses where.exe on Windows and accepts only claude.exe", async () => {
    const { deps, calls } = fakeDeps({
      platform: "win32",
      files: ["D:\\tools\\claude.exe"],
      works: ["D:\\tools\\claude.exe"],
      whereOut: "C:\\npm\\claude.cmd\r\nD:\\tools\\claude.exe\r\n",
    });
    await expect(locateClaude(deps)).resolves.toMatchObject({
      path: "D:\\tools\\claude.exe",
      via: "where",
    });
    expect(calls.some((c) => c.args[0] === "-ilc")).toBe(false);
  });

  it("asks for the native Claude Code when Windows only has a .cmd shim", async () => {
    const { deps, calls } = fakeDeps({
      platform: "win32",
      whereOut: "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd\r\n",
    });
    await expect(locateClaude(deps)).resolves.toMatchObject({ path: null, problem: "cmd-shim" });
    expect(calls.some((c) => c.file.endsWith(".cmd"))).toBe(false);
  });
});

describe("claudeSignedIn", () => {
  it("uses only the exit code of claude auth status, with the key removed", async () => {
    const { deps, calls } = fakeDeps({ works: ["/c"] });
    await expect(claudeSignedIn("/c", deps)).resolves.toBe(true);
    await expect(claudeSignedIn("/other", deps)).resolves.toBe(false);
    expect(calls[0]).toMatchObject({ file: "/c", args: ["auth", "status"] });
    expect(calls[0]?.env["ANTHROPIC_API_KEY"]).toBeUndefined();
  });
});
