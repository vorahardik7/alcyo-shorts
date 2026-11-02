// Cache keys and analysis/steps.json (section 14).
import { createHash } from "node:crypto";
import { AnalysisSteps, type AnalysisStepName, type Fingerprint } from "@alcyo/schema";
import { readJson, writeJsonAtomic } from "./files.ts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * SHA-256 over the step, the source fingerprint, the step's settings, the
 * tool version and the keys of the steps it reads. Key order doesn't matter.
 */
export function stepKey(
  step: AnalysisStepName,
  parts: {
    fingerprint: Fingerprint;
    settings: Record<string, unknown>;
    toolVersion: string;
    inputs: readonly string[];
  },
): string {
  return createHash("sha256")
    .update(canonical({ step, ...parts }))
    .digest("hex");
}

export type StepsFile = AnalysisSteps;

export async function readSteps(path: string, sourceId: string): Promise<StepsFile> {
  const file = await readJson(path, AnalysisSteps);
  return file !== null && file.sourceId === sourceId
    ? file
    : { schemaVersion: 1, sourceId, steps: {} };
}

export function writeSteps(path: string, file: StepsFile): Promise<void> {
  return writeJsonAtomic(path, AnalysisSteps.parse(file));
}
