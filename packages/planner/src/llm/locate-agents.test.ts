import { describe, expect, it } from "vitest";
import type { LocateDeps } from "./claude-locate";
import { chooseAgent, knownAgentPaths, locateAgents, probeAgent } from "./locate-agents";

interface Call {
  file: string;
  args: readonly string[];
  env: Record<string, string | undefined>;
}

function fake(opts: {
  platform?: NodeJS.Platform;
  files?: string[];
  /** Paths whose version command exits 0. */
  works?: string[];
  /** Paths whose auth command exits 0. Defaults to every working path. */
  signedIn?: string[];
  shell?: Record<string, string>;
  where?: Record<string, string>;
}): { deps: LocateDeps; calls: Call[] } {
  const calls: Call[] = [];
  const files = new Set(opts.files ?? []);
  const works = new Set(opts.works ?? []);
  const signed = new Set(opts.signedIn ?? opts.works ?? []);
  const deps: LocateDeps = {
    platform: opts.platform ?? "darwin",
    env: {
      SHELL: "/bin/zsh",
      ANTHROPIC_API_KEY: "sk-ant",
      XAI_API_KEY: "xai",
      OPENAI_API_KEY: "sk-oai",
    },
    homedir: "/Users/me",
    isFile: (p) => Promise.resolve(files.has(p)),
    run: (file, args, o) => {
      calls.push({ file, args, env: o.env });
      if (args[0] === "-ilc") {
        const bin = args[1]?.replace("command -v ", "") ?? "";
        return Promise.resolve({ code: 0, stdout: opts.shell?.[bin] ?? "" });
      }
      if (file === "where.exe") {
        const out = opts.where?.[args[0] ?? ""] ?? "";
        return Promise.resolve({ code: out.length === 0 ? 1 : 0, stdout: out });
      }
      if (args[0] === "-v" || args[0] === "--version") {
        return Promise.resolve(
          works.has(file) ? { code: 0, stdout: "1.2.3 (agent)\n" } : { code: 1, stdout: "" },
        );
      }
      return Promise.resolve(
        signed.has(file) ? { code: 0, stdout: "token=secret" } : { code: 1, stdout: "" },
      );
    },
  };
  return { deps, calls };
}

const saved = { claudePath: null, grokPath: null, codexPath: null };

describe("knownAgentPaths", () => {
  it("lists the standard folders, and Claude's own extra folder", () => {
    expect(knownAgentPaths("grok", "darwin", {}, "/Users/me")).toEqual([
      "/Users/me/.local/bin/grok",
      "/opt/homebrew/bin/grok",
      "/usr/local/bin/grok",
    ]);
    expect(knownAgentPaths("claude", "darwin", {}, "/Users/me")).toContain(
      "/Users/me/.claude/local/claude",
    );
    expect(
      knownAgentPaths("codex", "win32", { USERPROFILE: "C:\\Users\\me" }, "C:\\Users\\me"),
    ).toEqual([
      "C:\\Users\\me\\.local\\bin\\codex.exe",
      "C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links\\codex.exe",
    ]);
  });
});

describe("locateAgents", () => {
  it("finds each agent on its own and keeps going when one is missing", async () => {
    const { deps, calls } = fake({
      files: ["/Users/me/.local/bin/claude", "/opt/homebrew/bin/codex"],
      works: ["/Users/me/.local/bin/claude", "/opt/homebrew/bin/codex"],
      signedIn: ["/Users/me/.local/bin/claude"],
    });
    const hits = await locateAgents(deps, saved);
    expect(
      hits.map((h) => ({ id: h.id, path: h.path, signedIn: h.signedIn, problem: h.problem })),
    ).toEqual([
      { id: "claude", path: "/Users/me/.local/bin/claude", signedIn: true, problem: null },
      { id: "grok", path: null, signedIn: null, problem: "missing" },
      { id: "codex", path: "/opt/homebrew/bin/codex", signedIn: false, problem: null },
    ]);
    // Auth output is not kept on the hit, and the billed keys are not passed through.
    expect(JSON.stringify(hits)).not.toContain("secret");
    const claudeAuth = calls.find((c) => c.file.endsWith("claude") && c.args[0] === "auth");
    expect(claudeAuth?.env["ANTHROPIC_API_KEY"]).toBeUndefined();
    const codexAuth = calls.find((c) => c.file.endsWith("codex") && c.args[0] === "login");
    expect(codexAuth?.env["OPENAI_API_KEY"]).toBeUndefined();
  });

  it("tries a saved Grok path before the known folders", async () => {
    const { deps } = fake({
      files: ["/custom/grok", "/Users/me/.local/bin/grok"],
      works: ["/custom/grok", "/Users/me/.local/bin/grok"],
    });
    const hits = await locateAgents(deps, { ...saved, grokPath: "/custom/grok" });
    expect(hits.find((h) => h.id === "grok")).toMatchObject({ path: "/custom/grok", via: "saved" });
  });

  it("asks for a native binary when Windows only has a command shim", async () => {
    const { deps } = fake({
      platform: "win32",
      where: { grok: "C:\\npm\\grok.cmd\r\n" },
    });
    const hits = await locateAgents(deps, saved);
    expect(hits.find((h) => h.id === "grok")?.problem).toBe("cmd-shim");
  });
});

describe("probeAgent and chooseAgent", () => {
  it("rejects a picked file that doesn't run", async () => {
    const { deps } = fake({ files: ["/bin/grok"] });
    await expect(probeAgent("grok", "/bin/grok", deps)).resolves.toMatchObject({
      path: null,
      problem: "missing",
    });
  });

  it("keeps the saved provider when that agent is signed in", () => {
    const hits = [
      {
        id: "claude" as const,
        path: "/c",
        via: "known-folder" as const,
        version: "1",
        signedIn: true,
        problem: null,
      },
      {
        id: "grok" as const,
        path: "/g",
        via: "known-folder" as const,
        version: "1",
        signedIn: true,
        problem: null,
      },
      {
        id: "codex" as const,
        path: null,
        via: "none" as const,
        version: null,
        signedIn: null,
        problem: "missing" as const,
      },
    ];
    expect(chooseAgent(hits, "grok-cli")?.id).toBe("grok");
    expect(chooseAgent(hits, "codex-cli")?.id).toBe("claude");
    expect(chooseAgent(hits, "anthropic-api")?.id).toBe("claude");
    const missing = hits[2];
    if (missing === undefined) throw new Error("missing the codex fixture");
    expect(chooseAgent([missing], null)).toBeNull();
  });
});
