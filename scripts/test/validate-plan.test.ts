import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as F from "../../packages/schema/src/testing/fixtures.ts";
import { formatReport, hookFilePath, validate } from "../validate-plan.ts";

const SCRIPT = resolve(import.meta.dirname, "..", "validate-plan.ts");
let dir: string;

function put(rel: string, value: unknown) {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return path;
}

/** A small, valid project folder in the section 15 layout. */
function goodProject(root = "My Stream.alcyo") {
  put(`${root}/project.json`, F.project);
  put(`${root}/thread/messages.jsonl`, `${F.messages.map((m) => JSON.stringify(m)).join("\n")}\n`);
  put(`${root}/sources/src1/source.json`, F.source);
  put(`${root}/sources/src1/analysis/transcript.json`, F.transcript);
  put(`${root}/shorts/sh1/short.json`, F.shortFile);
  put(`${root}/shorts/sh1/draft.json`, F.draft);
  put(`${root}/shorts/sh1/versions/0001.claude.json`, F.version);
  put(`${root}/clips/c1/clip.json`, F.clipFile);
  put(`${root}/renders/index.json`, F.renderIndex);
  put("demo-profile.json", F.profile);
  put("soul.alcyo-template.json", F.template);
  // Not project files: ignored.
  put("package.json", { name: "x" });
  put(`${root}/cache/project.json`, "garbage");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alcyo-validate-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("validate", () => {
  it("passes a good project", async () => {
    goodProject();
    const reports = await validate([dir]);
    expect(reports).toHaveLength(11);
    expect(reports.filter((r) => r.issues.length > 0)).toEqual([]);
  });

  it("reports file, path and reason for each bad file", async () => {
    goodProject();
    put("My Stream.alcyo/shorts/sh1/versions/0002.user.json", {
      ...F.version,
      version: 2,
      createdBy: "robot",
    });
    put("My Stream.alcyo/clips/c1/clip.json", {
      ...F.clipFile,
      match: { ...F.clipFile.match, confidence: 2 },
    });
    const bad = (await validate([dir])).filter((r) => r.issues.length > 0);
    expect(
      bad.map((r) => [
        r.file.slice(dir.length + 1).replaceAll("\\", "/"),
        r.issues.map((i) => i.path),
      ]),
    ).toEqual([
      ["My Stream.alcyo/clips/c1/clip.json", ["match.confidence"]],
      ["My Stream.alcyo/shorts/sh1/versions/0002.user.json", ["createdBy"]],
    ]);
  });

  it("checks versions against their source's length and transcript", async () => {
    goodProject();
    put("My Stream.alcyo/shorts/sh1/versions/0002.user.json", {
      ...F.version,
      version: 2,
      parent: 1,
      short: {
        ...F.short,
        segments: [{ srcIn: 9000, srcOut: 12_000 }],
        hook: undefined,
        captions: { ...F.short.captions, overrides: [{ wordId: "w04040", hidden: true }] },
      },
    });
    const [report] = (await validate([dir])).filter((r) => r.issues.length > 0);
    expect(report?.issues).toEqual([
      {
        path: "short.segments[0].srcOut",
        message: "Ends at 12000 ms, past the end of the source at 10000 ms.",
      },
      {
        path: "short.captions.overrides[0].wordId",
        message: "Word w04040 isn't in the transcript.",
      },
    ]);
  });

  it("checks messages.jsonl by line and ignores a torn last line", async () => {
    goodProject();
    const lines = F.messages.map((m) => JSON.stringify(m));
    put("My Stream.alcyo/thread/messages.jsonl", `${lines.join("\n")}\n{"id":"m9","rev":0,"at":`);
    expect((await validate([dir])).every((r) => r.issues.length === 0)).toBe(true);
    put("My Stream.alcyo/thread/messages.jsonl", `${lines[0]}\n{"id":"m2"}\n`);
    const [bad] = (await validate([dir])).filter((r) => r.issues.length > 0);
    expect(bad?.issues.every((i) => i.path.startsWith("line 2"))).toBe(true);
  });

  it("adds an extra file named by the hook, and skips ones that don't exist", async () => {
    const saved = put("elsewhere/profile.json", { ...F.profile, lengthMs: { min: 5, max: 1 } });
    const reports = await validate(
      [join(dir, "nothing-here")],
      [saved, join(dir, "gone/profile.json")],
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]?.issues[0]?.path).toBe("lengthMs");
  });
});

describe("hookFilePath", () => {
  it("reads Kiro's file_path", () => {
    expect(hookFilePath({ hook_event_name: "PostFileSave", file_path: "/r/project.json" })).toBe(
      "/r/project.json",
    );
    expect(hookFilePath({})).toBeUndefined();
    expect(hookFilePath(null)).toBeUndefined();
  });
});

describe("formatReport", () => {
  it("says when there's nothing to check, and when all is good", () => {
    expect(formatReport([], "/", "examples/")).toBe("No project files found in examples/.");
    expect(formatReport([{ file: "/a/project.json", issues: [] }], "/a", "x")).toBe(
      "1 project file checked. All good.",
    );
  });
});

// Each test starts node a few times; shared CI runners need more than 5 s.
describe("the command", { timeout: 30_000 }, () => {
  const run = (args: string[], input?: string) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { input: input ?? "", encoding: "utf8" });

  it("exits 0 for good files and 1 with file: path: reason for bad ones", () => {
    goodProject();
    const good = run([dir]);
    expect(good.status).toBe(0);
    expect(good.stdout).toContain("11 project files checked. All good.");

    put("My Stream.alcyo/project.json", { ...F.project, schemaVersion: 7 });
    const bad = run([dir]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/project\.json: schemaVersion: This file is version 7/);
    expect(bad.stderr).toContain("1 of 11 project files have problems.");
  });

  it("checks the file named in hook JSON on stdin", () => {
    const saved = put("x/0001.claude.json", { ...F.version, note: "x".repeat(201) });
    const result = run(
      [join(dir, "empty")],
      JSON.stringify({ hook_event_name: "PostFileSave", file_path: saved }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("0001.claude.json: note:");
  });
});
