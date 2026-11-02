import { describe, expect, it } from "vitest";
import { CURRENT_VERSIONS, FILE_KINDS, migrate, type MigrationRegistry } from "./migrate.ts";

// A made-up two-step history for project files, to exercise the chain:
// v1 had `title`, v2 renamed it to `name`, v3 added `clips`.
const registry: MigrationRegistry = {
  project: [
    { from: 1, up: ({ title, ...rest }) => ({ ...rest, name: title }) },
    { from: 2, up: (raw) => ({ ...raw, clips: [] }) },
  ],
};

describe("migrate", () => {
  it("every file kind is at version 1 today", () => {
    for (const kind of FILE_KINDS) expect(CURRENT_VERSIONS[kind]).toBe(1);
  });

  it("passes a current file through", () => {
    expect(migrate("project", { schemaVersion: 1, name: "x" })).toEqual({
      ok: true,
      value: { schemaVersion: 1, name: "x" },
      from: 1,
    });
  });

  it("runs each step in order up to the current version", () => {
    expect(migrate("project", { schemaVersion: 1, title: "Old" }, registry, 3)).toEqual({
      ok: true,
      value: { schemaVersion: 3, name: "Old", clips: [] },
      from: 1,
    });
    expect(migrate("project", { schemaVersion: 2, name: "Mid" }, registry, 3)).toEqual({
      ok: true,
      value: { schemaVersion: 3, name: "Mid", clips: [] },
      from: 2,
    });
  });

  it("names a missing step", () => {
    expect(migrate("short", { schemaVersion: 1 }, registry, 2)).toEqual({
      ok: false,
      reason: "There's no upgrade for short files from version 1 to 2.",
    });
  });

  it("rejects missing, bad and future versions with a plain reason", () => {
    expect(migrate("project", { name: "x" })).toEqual({
      ok: false,
      reason: "The file has no schemaVersion.",
    });
    expect(migrate("project", { schemaVersion: "1" }).ok).toBe(false);
    expect(migrate("project", { schemaVersion: 0 }).ok).toBe(false);
    expect(migrate("project", [])).toEqual({ ok: false, reason: "The file isn't a JSON object." });
    const future = migrate("project", { schemaVersion: 9 });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.reason).toContain("made by a newer version of Alcyo Shorts");
  });

  it("doesn't change the input object", () => {
    const raw = { schemaVersion: 1, title: "Old" };
    migrate("project", raw, registry, 3);
    expect(raw).toEqual({ schemaVersion: 1, title: "Old" });
  });
});
