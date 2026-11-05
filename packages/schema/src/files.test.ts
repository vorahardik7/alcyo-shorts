import { describe, expect, it } from "vitest";
import { fileKindOf, parseProjectFile } from "./files.ts";
import * as F from "./testing/fixtures.ts";

describe("fileKindOf", () => {
  it.each([
    ["My Stream.alcyo/project.json", "project"],
    ["shorts/sh1/short.json", "short"],
    ["shorts/sh1/draft.json", "draft"],
    ["shorts/sh1/versions/0001.claude.json", "version"],
    ["shorts\\sh1\\versions\\0003.user.json", "version"],
    ["clips/c1/clip.json", "clip"],
    ["sources/s1/source.json", "source"],
    ["sources/s1/analysis/transcript.json", "transcript"],
    ["sources/s1/analysis/steps.json", "steps"],
    ["thread/messages.jsonl", "messages"],
    ["examples/demo-profile.json", "profile"],
    ["userData/profile.json", "profile"],
    ["templates/rook.alcyo-template.json", "template"],
    ["bold.preset.json", "preset"],
    ["My Stream.alcyo/renders/index.json", "renders"],
    ["userData/streams.json", "streams"],
  ])("%s is %s", (path, kind) => {
    expect(fileKindOf(path)).toBe(kind);
  });

  it.each(["package.json", "index.json", "0001.json", "versions/0001.kiro.json", "notes.md"])(
    "%s isn't a project file",
    (path) => {
      expect(fileKindOf(path)).toBeNull();
    },
  );
});

describe("parseProjectFile", () => {
  const json = (v: unknown) => JSON.stringify(v, null, 2);

  it("parses good files with no issues", () => {
    expect(parseProjectFile("version", json(F.version)).issues).toEqual([]);
    expect(parseProjectFile("profile", json(F.profile)).issues).toEqual([]);
    expect(parseProjectFile("transcript", json(F.transcript)).issues).toEqual([]);
    expect(parseProjectFile("template", json(F.template)).issues).toEqual([]);
  });

  it("reports schema problems with paths", () => {
    const bad = { ...F.version, short: { ...F.short, segments: [{ srcIn: 10, srcOut: 5 }] } };
    expect(parseProjectFile("version", json(bad)).issues).toEqual([
      { path: "short.segments[0]", message: "srcOut must be after srcIn" },
    ]);
  });

  it("runs the file's own checks after the schema", () => {
    const bad = {
      ...F.version,
      short: {
        ...F.short,
        segments: [
          { srcIn: 5000, srcOut: 6000 },
          { srcIn: 1000, srcOut: 2000 },
        ],
      },
    };
    expect(parseProjectFile("version", json(bad)).issues.map((i) => i.path)).toEqual([
      "short.segments[1].srcIn",
    ]);
    const profile = { ...F.profile, lengthMs: { min: 9, max: 1 } };
    expect(parseProjectFile("profile", json(profile)).issues[0]?.path).toBe("lengthMs");
  });

  it("reports bad JSON, missing versions and future versions", () => {
    expect(parseProjectFile("project", "{ nope").issues[0]?.message).toContain("Not valid JSON");
    expect(parseProjectFile("project", json({ name: "x" })).issues).toEqual([
      { path: "schemaVersion", message: "The file has no schemaVersion." },
    ]);
    expect(
      parseProjectFile("project", json({ ...F.project, schemaVersion: 4 })).issues[0]?.message,
    ).toContain("newer version");
  });

  it("checks messages.jsonl line by line and ignores a torn last line", () => {
    const lines = F.messages.map((m) => JSON.stringify(m));
    const good = parseProjectFile("messages", `${lines.join("\n")}\n{"id":"m9","rev":0,"at":"2026`);
    expect(good.issues).toEqual([]);
    expect(good.value).toHaveLength(F.messages.length);

    const bad = parseProjectFile(
      "messages",
      `${lines[0]}\nnot json\n${JSON.stringify({ ...F.messages[0], author: "kiro" })}\n`,
    );
    expect(bad.issues.map((i) => i.path)).toEqual(["line 2", "line 3.author"]);
  });
});
