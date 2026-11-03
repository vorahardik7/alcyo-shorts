// Spawns one agent with an args array. No shell. Cancel sends SIGINT, then
// SIGTERM if the process is still there after the grace period.
import { spawn } from "node:child_process";
import { PlannerError, type SpawnResult } from "./provider";

const MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 5_000;

export interface SpawnCommandOpts {
  cwd: string;
  env: Record<string, string | undefined>;
  input: string;
  signal: AbortSignal;
  /** Milliseconds between SIGINT and SIGTERM. Tests pass a short value. */
  killGraceMs?: number;
}

export function spawnCommand(
  file: string,
  args: readonly string[],
  opts: SpawnCommandOpts,
): Promise<SpawnResult> {
  if (opts.signal.aborted) {
    return Promise.reject(new PlannerError("The request was cancelled.", "cancelled"));
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts.env)) {
    if (value !== undefined) env[key] = value;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      cwd: opts.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let tooBig = false;
    const take = (which: "stdout" | "stderr", chunk: string) => {
      if (tooBig) return;
      if (which === "stdout") stdout += chunk;
      else stderr += chunk;
      if (stdout.length + stderr.length > MAX_BYTES) {
        tooBig = true;
        child.kill("SIGTERM");
      }
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => take("stdout", chunk));
    child.stderr?.on("data", (chunk: string) => take("stderr", chunk));
    // An agent that exits before reading stdin gives EPIPE here. The exit code
    // already says what happened; an unhandled 'error' would crash the worker.
    child.stdin?.on("error", () => {});
    child.stdin?.end(opts.input);

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let askedToStop = false;
    const onAbort = () => {
      if (askedToStop) return;
      askedToStop = true;
      child.kill("SIGINT");
      killTimer = setTimeout(() => {
        child.kill("SIGTERM");
      }, opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
    };
    opts.signal.addEventListener("abort", onAbort, { once: true });

    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (killTimer !== undefined) clearTimeout(killTimer);
      opts.signal.removeEventListener("abort", onAbort);
      fn();
    };
    child.on("error", () => {
      done(() => {
        reject(
          new PlannerError(
            opts.signal.aborted ? "The request was cancelled." : "The agent didn't start.",
            opts.signal.aborted ? "cancelled" : "failed",
          ),
        );
      });
    });
    child.on("close", (code) => {
      done(() => {
        if (opts.signal.aborted) {
          reject(new PlannerError("The request was cancelled.", "cancelled"));
          return;
        }
        if (tooBig) {
          reject(new PlannerError("The agent wrote too much.", "failed"));
          return;
        }
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });
  });
}
