// Finds the user's `claude` (plan section 16). A Mac app opened from Finder
// doesn't get the terminal's PATH, so the resolver tries, in order:
//   1. the saved path (settings.json, spec 5),
//   2. known folders for the OS,
//   3. macOS: the login shell, once, with a 5 s timeout,
//   4. Windows: where.exe.
// A candidate works when `claude -v` exits 0. Nothing here reads files under
// ~/.claude: known paths are only checked for existence and then run.
import { posix, win32 } from "node:path";

export type ClaudeVia = "saved" | "known-folder" | "login-shell" | "where" | "none";

export interface RunResult {
  /** Exit code, or null when the process couldn't start or timed out. */
  code: number | null;
  stdout: string;
}

export interface LocateDeps {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  homedir: string;
  isFile: (path: string) => Promise<boolean>;
  /** execFile with an args array. Never a shell string. */
  run: (
    file: string,
    args: readonly string[],
    opts: { timeoutMs: number; env: Record<string, string | undefined> },
  ) => Promise<RunResult>;
}

export interface ClaudeLocation {
  path: string | null;
  via: ClaudeVia;
  version: string | null;
  /** Why nothing usable was found. */
  problem: "missing" | "cmd-shim" | null;
}

export const LOGIN_SHELL_TIMEOUT_MS = 5000;
const VERSION_TIMEOUT_MS = 10_000;
const AUTH_TIMEOUT_MS = 15_000;

/** Known install folders for `claude`, in the order the plan lists them. */
export function knownClaudePaths(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  homedir: string,
): string[] {
  if (platform === "win32") {
    const home = env["USERPROFILE"] ?? homedir;
    const local = env["LOCALAPPDATA"] ?? win32.join(home, "AppData", "Local");
    return [
      win32.join(home, ".local", "bin", "claude.exe"),
      win32.join(local, "Microsoft", "WinGet", "Links", "claude.exe"),
    ];
  }
  return [
    posix.join(homedir, ".local", "bin", "claude"),
    posix.join(homedir, ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
}

/** The last line of a login shell's output that is an absolute path. */
export function parseShellLookup(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("/") && !/\s/.test(l));
  return lines.at(-1) ?? null;
}

/** "2.1.30 (Claude Code)" -> "2.1.30". */
export function parseClaudeVersion(stdout: string): string | null {
  const match = /(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/.exec(stdout);
  return match?.[1] ?? null;
}

/** The env for any claude child: no API key or token, so the user's plan pays. */
export function scrubClaudeEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const copy = { ...env };
  delete copy["ANTHROPIC_API_KEY"];
  delete copy["ANTHROPIC_AUTH_TOKEN"];
  return copy;
}

async function version(path: string, deps: LocateDeps): Promise<string | null | undefined> {
  const result = await deps.run(path, ["-v"], {
    timeoutMs: VERSION_TIMEOUT_MS,
    env: scrubClaudeEnv(deps.env),
  });
  if (result.code !== 0) return undefined;
  return parseClaudeVersion(result.stdout);
}

/** Tries one candidate. Returns a location when `claude -v` exits 0. */
async function tryPath(
  path: string,
  via: ClaudeVia,
  deps: LocateDeps,
): Promise<ClaudeLocation | null> {
  if (!(await deps.isFile(path))) return null;
  const v = await version(path, deps);
  if (v === undefined) return null;
  return { path, via, version: v, problem: null };
}

export async function locateClaude(
  deps: LocateDeps,
  savedPath: string | null = null,
): Promise<ClaudeLocation> {
  if (savedPath !== null) {
    const found = await tryPath(savedPath, "saved", deps);
    if (found !== null) return found;
  }

  for (const path of knownClaudePaths(deps.platform, deps.env, deps.homedir)) {
    const found = await tryPath(path, "known-folder", deps);
    if (found !== null) return found;
  }

  if (deps.platform === "win32") {
    const where = await deps.run("where.exe", ["claude"], {
      timeoutMs: LOGIN_SHELL_TIMEOUT_MS,
      env: deps.env,
    });
    const hits = where.code === 0 ? where.stdout.split(/\r?\n/).map((l) => l.trim()) : [];
    for (const hit of hits.filter((h) => h.toLowerCase().endsWith(".exe"))) {
      const found = await tryPath(hit, "where", deps);
      if (found !== null) return found;
    }
    // An npm install leaves a .cmd shim. It needs a shell to run, so it isn't used.
    const shim = hits.some((h) => /\.(cmd|bat|ps1)$/i.test(h));
    return { path: null, via: "none", version: null, problem: shim ? "cmd-shim" : "missing" };
  }

  // The one allowed shell use: a fixed command in the user's login shell.
  const shell = deps.env["SHELL"] ?? "/bin/zsh";
  const lookup = await deps.run(shell, ["-ilc", "command -v claude"], {
    timeoutMs: LOGIN_SHELL_TIMEOUT_MS,
    env: deps.env,
  });
  const fromShell = lookup.code === 0 ? parseShellLookup(lookup.stdout) : null;
  if (fromShell !== null) {
    const found = await tryPath(fromShell, "login-shell", deps);
    if (found !== null) return found;
  }
  return { path: null, via: "none", version: null, problem: "missing" };
}

/**
 * Runs `claude auth status` without the API key or token. Exit 0 means signed
 * in. Only the exit code is used; the output is never read or kept.
 */
export async function claudeSignedIn(path: string, deps: LocateDeps): Promise<boolean> {
  const result = await deps.run(path, ["auth", "status"], {
    timeoutMs: AUTH_TIMEOUT_MS,
    env: scrubClaudeEnv(deps.env),
  });
  return result.code === 0;
}
