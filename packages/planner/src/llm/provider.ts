// The planner asks an agent for one JSON value and checks it afterwards.
// The agent never gets a shell through these args: each provider builds an
// args array, and the caller spawns it.
import { posix, win32 } from "node:path";
import type { ProviderId } from "@alcyo/schema";

export interface LlmRequest {
  instruction: string;
  /** Profile, numbered lines, thread context. Text only. */
  input: string;
  jsonSchema: object;
  /** Passed to Claude. Grok and Codex keep their own default model. */
  model: string;
  signal: AbortSignal;
}

export interface LlmProvider {
  readonly name: ProviderId | "fake";
  /** The structured value, or a PlannerError. The caller checks it with Zod. */
  complete(req: LlmRequest): Promise<unknown>;
}

export class PlannerError extends Error {
  readonly code: "failed" | "cancelled";

  constructor(message: string, code: "failed" | "cancelled") {
    super(message);
    this.name = "PlannerError";
    this.code = code;
  }
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** What a provider needs in order to run a command. Tests pass a fake. */
export interface SpawnDeps {
  /** Copied and scrubbed per agent. The parent environment is not changed. */
  env: Record<string, string | undefined>;
  spawn(
    file: string,
    args: readonly string[],
    opts: {
      cwd: string;
      env: Record<string, string | undefined>;
      input: string;
      signal: AbortSignal;
    },
  ): Promise<SpawnResult>;
  mkdtemp(): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  readFile(path: string): Promise<string>;
  remove(path: string): Promise<void>;
}

/**
 * Puts the agent's own folder first on PATH. npm installs of Codex (and
 * others) are `#!/usr/bin/env node` scripts, and a Finder-launched app's
 * PATH has no node. Homebrew and nvm keep node in the same folder.
 */
export function withAgentDir(
  env: Readonly<Record<string, string | undefined>>,
  agentPath: string,
  platform: NodeJS.Platform = process.platform,
): Record<string, string | undefined> {
  const path = platform === "win32" ? win32 : posix;
  const dir = path.dirname(agentPath);
  const copy = { ...env };
  // Windows env keys are case-insensitive; keep whatever casing is there.
  const key = Object.keys(copy).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const current = copy[key] ?? "";
  const parts = current.split(path.delimiter).filter((p) => p.length > 0 && p !== dir);
  copy[key] = [dir, ...parts].join(path.delimiter);
  return copy;
}

/** The CLI's JSON envelope, or the value itself when the CLI wrote it raw. */
export function parseStructuredOutput(stdout: string): unknown {
  const fenced = stdout
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(fenced);
  } catch {
    throw new PlannerError("The agent didn't return JSON.", "failed");
  }
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record["is_error"] === true) {
    throw new PlannerError("The agent reported an error.", "failed");
  }
  if ("structured_output" in record && record["structured_output"] != null) {
    return record["structured_output"];
  }
  if (record["type"] === "result" && typeof record["result"] === "string") {
    try {
      return JSON.parse(record["result"]);
    } catch {
      return record["result"];
    }
  }
  return value;
}

/** True when a Claude process rejected --safe-mode instead of answering. */
export function rejectedSafeMode(result: SpawnResult): boolean {
  if (result.code === 0 || result.stdout.trim().startsWith("{")) return false;
  return (
    /safe-mode/i.test(result.stderr) &&
    /unknown|unexpected|unrecognized|not defined/i.test(result.stderr)
  );
}
