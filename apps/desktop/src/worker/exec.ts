// Real process and file deps for the worker. execFile with an args array and a
// timeout; never a shell string.
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import type { RunResult } from "@alcyo/planner";
import type { SetupDeps } from "./setup";

function run(
  file: string,
  args: readonly string[],
  opts: { timeoutMs: number; env: Record<string, string | undefined> },
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        timeout: opts.timeoutMs,
        env: opts.env,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error === null) {
          resolve({ code: 0, stdout });
          return;
        }
        // A numeric code is the exit status; anything else (ENOENT, a timeout
        // kill) means it didn't run.
        const code = typeof error.code === "number" && error.killed !== true ? error.code : null;
        resolve({ code, stdout: typeof stdout === "string" ? stdout : "" });
      },
    );
  });
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function realSetupDeps(): SetupDeps {
  return {
    platform: process.platform,
    env: process.env,
    homedir: homedir(),
    isFile,
    run,
    listDir: (path) => readdir(path),
  };
}
