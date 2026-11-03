import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlannerError } from "./provider";
import { spawnCommand } from "./spawn";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function cwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "alcyo-spawn-"));
  dirs.push(dir);
  return dir;
}

describe("spawnCommand", () => {
  it("returns stdout from an args array and writes stdin", async () => {
    const result = await spawnCommand(
      process.execPath,
      [
        "-e",
        "let s=''; process.stdin.on('data', (c) => { s += c; }); process.stdin.on('end', () => process.stdout.write(s + ' out'));",
      ],
      {
        cwd: await cwd(),
        env: { PATH: process.env["PATH"] },
        input: "in",
        signal: new AbortController().signal,
      },
    );
    expect(result).toMatchObject({ code: 0, stdout: "in out" });
  });

  it("fails when the program is missing, without a shell", async () => {
    const error = await spawnCommand(join(await cwd(), "missing-agent"), [], {
      cwd: await cwd(),
      env: {},
      input: "",
      signal: new AbortController().signal,
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PlannerError);
    expect(error instanceof PlannerError ? error.code : "").toBe("failed");
  });

  it("reports the exit code when the program exits before reading a large stdin", async () => {
    const result = await spawnCommand(process.execPath, ["-e", "process.exit(3)"], {
      cwd: await cwd(),
      env: {},
      input: "x".repeat(2 * 1024 * 1024),
      signal: new AbortController().signal,
    });
    expect(result.code).toBe(3);
  });

  it("cancels with SIGINT", async () => {
    const controller = new AbortController();
    const pending = spawnCommand(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], {
      cwd: await cwd(),
      env: {},
      input: "",
      signal: controller.signal,
      killGraceMs: 50,
    });
    controller.abort();
    const error = await pending.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PlannerError);
    expect(error instanceof PlannerError ? error.code : "").toBe("cancelled");
  });
});
