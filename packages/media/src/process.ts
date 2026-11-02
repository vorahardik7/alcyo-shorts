// Running a bundled tool: spawn with an args array (never a shell), line
// callbacks for stdout and stderr, and cancel through an AbortSignal.
import { spawn } from "node:child_process";
import { MediaError } from "./errors.ts";

export interface RunOptions {
  cwd?: string;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  /** Keep all of stdout (ffprobe JSON). Off by default; lines still stream. */
  collectStdout?: boolean;
}

export interface RunOutcome {
  code: number | null;
  stdout: string;
  /** The last lines of stderr, for the job log. */
  stderrTail: string[];
}

/** The engine runs tools only through this, so tests can fake it. */
export type Runner = (
  file: string,
  args: readonly string[],
  opts: RunOptions,
) => Promise<RunOutcome>;

const TAIL_LINES = 40;
const KILL_AFTER_MS = 2000;

function lineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let rest = "";
  return (chunk) => {
    rest += chunk;
    const parts = rest.split(/\r\n|\n|\r/);
    rest = parts.pop() ?? "";
    for (const part of parts) onLine(part);
  };
}

/**
 * The real runner. Resolves with the exit code (null when killed); rejects
 * with MediaError("cancelled") when the signal aborts, after the child exits.
 */
export const runTool: Runner = (file, args, opts) =>
  new Promise((resolve, reject) => {
    if (opts.signal?.aborted === true) {
      reject(new MediaError("cancelled", "Cancelled."));
      return;
    }
    const child = spawn(file, [...args], {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tail: string[] = [];
    let stdout = "";
    const outLine = lineSplitter((line) => opts.onStdoutLine?.(line));
    const errLine = lineSplitter((line) => {
      tail.push(line);
      if (tail.length > TAIL_LINES) tail.shift();
      opts.onStderrLine?.(line);
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (opts.collectStdout === true) stdout += chunk;
      outLine(chunk);
    });
    child.stderr.on("data", (chunk: string) => errLine(chunk));

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.once("error", (error) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new MediaError("tool-failed", `Couldn't start ${file}: ${error.message}`));
    });
    child.once("close", (code) => {
      if (killTimer !== undefined) clearTimeout(killTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted === true) {
        reject(new MediaError("cancelled", "Cancelled."));
        return;
      }
      resolve({ code, stdout, stderrTail: tail });
    });
  });
