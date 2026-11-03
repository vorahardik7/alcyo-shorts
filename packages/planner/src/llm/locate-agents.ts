// Finds the coding agents already installed on this computer (spec 5).
// Same rules as claude-locate: saved path, known folders, then the login
// shell or where.exe. Nothing here reads ~/.claude, ~/.grok or ~/.codex.
// A hit is usable when the version command exits 0 and the auth command
// exits 0. Auth output is thrown away; only the exit code is kept.
import { posix, win32 } from "node:path";
import type { LocalAgentId, ProviderId } from "@alcyo/schema";
import {
  LOGIN_SHELL_TIMEOUT_MS,
  type ClaudeVia,
  type LocateDeps,
  parseClaudeVersion,
  parseShellLookup,
  scrubClaudeEnv,
} from "./claude-locate";
import { scrubCodexEnv } from "./codex-cli";
import { scrubGrokEnv } from "./grok-cli";
import { withAgentDir } from "./provider";

export type AgentVia = ClaudeVia;

export interface AgentHit {
  id: LocalAgentId;
  path: string | null;
  via: AgentVia;
  version: string | null;
  /** null when the binary wasn't found, so sign-in couldn't be checked. */
  signedIn: boolean | null;
  problem: "missing" | "cmd-shim" | null;
}

export interface SavedAgentPaths {
  claudePath: string | null;
  grokPath: string | null;
  codexPath: string | null;
}

interface AgentSpec {
  id: LocalAgentId;
  bin: string;
  versionArgs: readonly string[];
  authArgs: readonly string[];
  /** Extra folders that belong to this agent only. */
  extras: (homedir: string) => string[];
  scrub: (env: Readonly<Record<string, string | undefined>>) => Record<string, string | undefined>;
}

const VERSION_TIMEOUT_MS = 10_000;
const AUTH_TIMEOUT_MS = 15_000;

const CLAUDE: AgentSpec = {
  id: "claude",
  bin: "claude",
  versionArgs: ["-v"],
  authArgs: ["auth", "status"],
  extras: (home) => [posix.join(home, ".claude", "local", "claude")],
  scrub: scrubClaudeEnv,
};
const GROK: AgentSpec = {
  id: "grok",
  bin: "grok",
  versionArgs: ["--version"],
  authArgs: ["models"],
  extras: () => [],
  scrub: scrubGrokEnv,
};
const CODEX: AgentSpec = {
  id: "codex",
  bin: "codex",
  versionArgs: ["--version"],
  authArgs: ["login", "status"],
  extras: () => [],
  scrub: scrubCodexEnv,
};
const AGENTS: readonly AgentSpec[] = [CLAUDE, GROK, CODEX];

export function agentSpec(id: LocalAgentId): AgentSpec {
  switch (id) {
    case "claude":
      return CLAUDE;
    case "grok":
      return GROK;
    case "codex":
      return CODEX;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function providerForAgent(id: LocalAgentId): ProviderId {
  switch (id) {
    case "claude":
      return "claude-cli";
    case "grok":
      return "grok-cli";
    case "codex":
      return "codex-cli";
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function agentForProvider(provider: ProviderId): LocalAgentId | null {
  switch (provider) {
    case "claude-cli":
      return "claude";
    case "grok-cli":
      return "grok";
    case "codex-cli":
      return "codex";
    case "anthropic-api":
      return null;
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/** Known install folders for one agent, in the order they're tried. */
export function knownAgentPaths(
  id: LocalAgentId,
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  homedir: string,
): string[] {
  const spec = agentSpec(id);
  if (platform === "win32") {
    const home = env["USERPROFILE"] ?? homedir;
    const local = env["LOCALAPPDATA"] ?? win32.join(home, "AppData", "Local");
    const exe = `${spec.bin}.exe`;
    return [
      win32.join(home, ".local", "bin", exe),
      win32.join(local, "Microsoft", "WinGet", "Links", exe),
    ];
  }
  return [
    posix.join(homedir, ".local", "bin", spec.bin),
    ...spec.extras(homedir),
    `/opt/homebrew/bin/${spec.bin}`,
    `/usr/local/bin/${spec.bin}`,
  ];
}

function agentEnv(spec: AgentSpec, path: string, deps: LocateDeps) {
  return withAgentDir(spec.scrub(deps.env), path, deps.platform);
}

async function versionOf(
  spec: AgentSpec,
  path: string,
  deps: LocateDeps,
): Promise<string | null | undefined> {
  const result = await deps.run(path, spec.versionArgs, {
    timeoutMs: VERSION_TIMEOUT_MS,
    env: agentEnv(spec, path, deps),
  });
  if (result.code !== 0) return undefined;
  return parseClaudeVersion(result.stdout);
}

interface Found {
  path: string;
  via: AgentVia;
  version: string | null;
  problem: null;
}

async function tryPath(
  spec: AgentSpec,
  path: string,
  via: AgentVia,
  deps: LocateDeps,
): Promise<Found | null> {
  if (!(await deps.isFile(path))) return null;
  const version = await versionOf(spec, path, deps);
  if (version === undefined) return null;
  return { path, via, version, problem: null };
}

async function signedIn(spec: AgentSpec, path: string, deps: LocateDeps): Promise<boolean> {
  const result = await deps.run(path, spec.authArgs, {
    timeoutMs: AUTH_TIMEOUT_MS,
    env: agentEnv(spec, path, deps),
  });
  return result.code === 0;
}

async function locateOne(
  spec: AgentSpec,
  deps: LocateDeps,
  savedPath: string | null,
): Promise<AgentHit> {
  const found = async (): Promise<Found | "shim" | null> => {
    if (savedPath !== null) {
      const hit = await tryPath(spec, savedPath, "saved", deps);
      if (hit !== null) return hit;
    }
    for (const path of knownAgentPaths(spec.id, deps.platform, deps.env, deps.homedir)) {
      const hit = await tryPath(spec, path, "known-folder", deps);
      if (hit !== null) return hit;
    }
    if (deps.platform === "win32") {
      const where = await deps.run("where.exe", [spec.bin], {
        timeoutMs: LOGIN_SHELL_TIMEOUT_MS,
        env: deps.env,
      });
      const hits = where.code === 0 ? where.stdout.split(/\r?\n/).map((l) => l.trim()) : [];
      for (const hit of hits.filter((h) => h.toLowerCase().endsWith(".exe"))) {
        const located = await tryPath(spec, hit, "where", deps);
        if (located !== null) return located;
      }
      if (hits.some((h) => /\.(cmd|bat|ps1)$/i.test(h))) return "shim";
      return null;
    }
    const shell = deps.env["SHELL"] ?? "/bin/zsh";
    const lookup = await deps.run(shell, ["-ilc", `command -v ${spec.bin}`], {
      timeoutMs: LOGIN_SHELL_TIMEOUT_MS,
      env: deps.env,
    });
    const fromShell = lookup.code === 0 ? parseShellLookup(lookup.stdout) : null;
    if (fromShell !== null) {
      const hit = await tryPath(spec, fromShell, "login-shell", deps);
      if (hit !== null) return hit;
    }
    return null;
  };

  const location = await found();
  if (location === "shim") {
    return {
      id: spec.id,
      path: null,
      via: "none",
      version: null,
      signedIn: null,
      problem: "cmd-shim",
    };
  }
  if (location === null) {
    return {
      id: spec.id,
      path: null,
      via: "none",
      version: null,
      signedIn: null,
      problem: "missing",
    };
  }
  return { id: spec.id, ...location, signedIn: await signedIn(spec, location.path, deps) };
}

/** Looks up Claude Code, Grok and Codex. One missing agent doesn't stop the others. */
export function locateAgents(deps: LocateDeps, saved: SavedAgentPaths): Promise<AgentHit[]> {
  return Promise.all(
    AGENTS.map((spec) =>
      locateOne(
        spec,
        deps,
        spec.id === "claude"
          ? saved.claudePath
          : spec.id === "grok"
            ? saved.grokPath
            : saved.codexPath,
      ),
    ),
  );
}

/** Checks one path the user picked with Locate. It still has to run. */
export async function probeAgent(
  id: LocalAgentId,
  path: string,
  deps: LocateDeps,
): Promise<AgentHit> {
  const spec = agentSpec(id);
  const hit = await tryPath(spec, path, "saved", deps);
  if (hit === null) {
    return { id, path: null, via: "none", version: null, signedIn: null, problem: "missing" };
  }
  return { id, ...hit, signedIn: await signedIn(spec, hit.path, deps) };
}

/** The saved provider if that agent is signed in, otherwise the first one that is. */
export function chooseAgent(
  hits: readonly AgentHit[],
  provider: ProviderId | null,
): (AgentHit & { path: string }) | null {
  const ready = (hit: AgentHit): hit is AgentHit & { path: string } =>
    hit.path !== null && hit.signedIn === true;
  const preferred = provider === null ? null : agentForProvider(provider);
  if (preferred !== null) {
    const saved = hits.find((hit) => hit.id === preferred);
    if (saved !== undefined && ready(saved)) return saved;
  }
  return hits.find(ready) ?? null;
}
