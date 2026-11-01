// Pure helpers for fetch-binaries: the lock file schema, output lists, and
// the plain-English checksum failure message.
import { createHash } from "node:crypto";
import { z } from "zod";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters");
const RelPath = z
  .string()
  .min(1)
  .refine(
    (p) => !p.startsWith("/") && !p.split(/[\\/]/).includes(".."),
    "must be a relative path inside the folder",
  );

const Base = { version: z.string().min(1), url: z.url({ protocol: /^https$/ }), sha256: Sha256 };

export const Tool = z.discriminatedUnion("kind", [
  z.object({
    ...Base,
    kind: z.literal("file"),
    output: RelPath,
    executable: z.boolean().optional(),
  }),
  z.object({ ...Base, kind: z.literal("archive"), extract: z.record(RelPath, RelPath) }),
  z.object({
    ...Base,
    kind: z.literal("cmake"),
    sourceDir: RelPath,
    cmakeArgs: z.array(z.string()),
    cmakeTarget: z.string().min(1),
    built: z.record(RelPath, RelPath),
  }),
]);
export type Tool = z.infer<typeof Tool>;

export const TARGETS = ["mac-arm64", "win-x64"] as const;
export type Target = (typeof TARGETS)[number];

export const Lock = z.object({
  version: z.literal(1),
  targets: z.object({
    "mac-arm64": z.record(z.string(), Tool),
    "win-x64": z.record(z.string(), Tool),
  }),
});
export type Lock = z.infer<typeof Lock>;

export const Manifest = z.object({
  target: z.enum(TARGETS),
  tools: z.record(
    z.string(),
    z.object({ version: z.string(), lockHash: Sha256, files: z.record(RelPath, Sha256) }),
  ),
});
export type Manifest = z.infer<typeof Manifest>;

export function parseLock(json: unknown): Lock {
  const result = Lock.safeParse(json);
  if (!result.success) {
    throw new Error(`scripts/binaries.lock.json is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** The files a tool puts in the bin folder, relative to it. */
export function outputsOf(tool: Tool): string[] {
  switch (tool.kind) {
    case "file":
      return [tool.output];
    case "archive":
      return Object.values(tool.extract);
    case "cmake":
      return Object.values(tool.built);
  }
}

/** A stable hash of a lock entry, so a changed pin forces a re-fetch. */
export function lockHash(tool: Tool): string {
  return createHash("sha256").update(JSON.stringify(tool)).digest("hex");
}

export function hostTarget(platform: NodeJS.Platform, arch: string): Target | undefined {
  if (platform === "darwin" && arch === "arm64") return "mac-arm64";
  if (platform === "win32" && arch === "x64") return "win-x64";
  return undefined;
}

export function isTarget(value: string): value is Target {
  return (TARGETS as readonly string[]).includes(value);
}

export class ChecksumError extends Error {
  override name = "ChecksumError";
}

export function checksumMessage(
  file: string,
  url: string,
  expected: string,
  actual: string,
): string {
  return [
    `Checksum mismatch for ${file}`,
    `  from:     ${url}`,
    `  expected: ${expected}`,
    `  actual:   ${actual}`,
    `The download was kept as ${file}.bad and not used.`,
    `Run pnpm fetch-binaries again. If it still fails, the upstream file changed:`,
    `check it, then update url and sha256 in scripts/binaries.lock.json together.`,
  ].join("\n");
}

/** Problems with an installed bin folder, compared to the lock and manifest. */
export function verifyProblems(
  tools: Record<string, Tool>,
  manifest: Manifest | undefined,
  actualSha: (rel: string) => string | undefined,
): string[] {
  if (manifest === undefined) return ["No manifest.json. Run pnpm fetch-binaries."];
  const problems: string[] = [];
  for (const [name, tool] of Object.entries(tools)) {
    const entry = manifest.tools[name];
    if (entry === undefined || entry.lockHash !== lockHash(tool)) {
      problems.push(`${name} doesn't match scripts/binaries.lock.json. Run pnpm fetch-binaries.`);
      continue;
    }
    for (const rel of outputsOf(tool)) {
      const sha = actualSha(rel);
      if (sha === undefined) problems.push(`${rel} is missing. Run pnpm fetch-binaries.`);
      else if (sha !== entry.files[rel]) {
        problems.push(`${rel} changed since it was fetched. Run pnpm fetch-binaries.`);
      }
    }
  }
  return problems;
}
