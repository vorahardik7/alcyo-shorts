// File migrations. Every stored file has a schemaVersion; reading upgrades it
// one step at a time to the current version. All kinds are at version 1
// today, so the registry is empty; the first breaking change adds a step here,
// with a test.

export const FILE_KINDS = [
  "project",
  "short",
  "draft",
  "version",
  "clip",
  "source",
  "transcript",
  "silences",
  "scenes",
  "loudness",
  "steps",
  "profile",
  "preset",
  "template",
  "settings",
  "streams",
  "renders",
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const CURRENT_VERSIONS: Readonly<Record<FileKind, number>> = Object.fromEntries(
  FILE_KINDS.map((k) => [k, 1]),
) as Record<FileKind, number>;

export interface MigrationStep {
  /** Upgrades a file at `from` to `from + 1`. */
  from: number;
  up: (raw: Record<string, unknown>) => Record<string, unknown>;
}

export type MigrationRegistry = Partial<Record<FileKind, readonly MigrationStep[]>>;

export const MIGRATIONS: MigrationRegistry = {};

export type MigrateResult =
  { ok: true; value: Record<string, unknown>; from: number } | { ok: false; reason: string };

export function migrate(
  kind: FileKind,
  raw: unknown,
  registry: MigrationRegistry = MIGRATIONS,
  current: number = CURRENT_VERSIONS[kind],
): MigrateResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "The file isn't a JSON object." };
  }
  let value = raw as Record<string, unknown>;
  const version = value["schemaVersion"];
  if (version === undefined) return { ok: false, reason: "The file has no schemaVersion." };
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      reason: `schemaVersion ${JSON.stringify(version)} isn't a version number.`,
    };
  }
  if (version > current) {
    return {
      ok: false,
      reason: `This file is version ${version}, made by a newer version of Alcyo Shorts. This app reads up to version ${current}. Update the app to open it.`,
    };
  }
  const steps = registry[kind] ?? [];
  for (let v = version; v < current; v++) {
    const step = steps.find((s) => s.from === v);
    if (step === undefined) {
      return {
        ok: false,
        reason: `There's no upgrade for ${kind} files from version ${v} to ${v + 1}.`,
      };
    }
    value = { ...step.up(value), schemaVersion: v + 1 };
  }
  return { ok: true, value, from: version };
}
