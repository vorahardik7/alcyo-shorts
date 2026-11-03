// Grok Build, headless. One prompt file, no tools we can name left on, and
// the child env has no XAI_API_KEY so the signed-in Grok account pays.
import { join } from "node:path";
import {
  type LlmProvider,
  PlannerError,
  type SpawnDeps,
  parseStructuredOutput,
  withAgentDir,
} from "./provider";

/** Grok's own model and effort, e.g. grok-4.7-build-fast at medium. Unset: Grok's defaults. */
export interface GrokOptions {
  model?: string;
  effort?: "low" | "medium" | "high";
}

export function grokArgs(promptFile: string, schema: object, opts: GrokOptions = {}): string[] {
  const extra = [
    ...(opts.model === undefined ? [] : ["-m", opts.model]),
    ...(opts.effort === undefined ? [] : ["--reasoning-effort", opts.effort]),
  ];
  return [
    ...extra,
    "--no-auto-update",
    "--prompt-file",
    promptFile,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
    "--tools",
    "",
    "--max-turns",
    "3",
    "--no-subagents",
    "--disable-web-search",
    "--verbatim",
  ];
}

export function scrubGrokEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const copy = { ...env };
  delete copy["XAI_API_KEY"];
  return copy;
}

export function grokProvider(path: string, deps: SpawnDeps, opts: GrokOptions = {}): LlmProvider {
  return {
    name: "grok-cli",
    async complete(req) {
      if (req.signal.aborted) throw new PlannerError("The request was cancelled.", "cancelled");
      const cwd = await deps.mkdtemp();
      const promptFile = join(cwd, "prompt.txt");
      try {
        await deps.writeFile(promptFile, `${req.instruction}\n\n${req.input}`);
        const result = await deps.spawn(path, grokArgs(promptFile, req.jsonSchema, opts), {
          cwd,
          env: withAgentDir(scrubGrokEnv(deps.env), path),
          input: "",
          signal: req.signal,
        });
        if (result.code !== 0) throw new PlannerError("Grok didn't answer.", "failed");
        return parseStructuredOutput(result.stdout);
      } finally {
        await deps.remove(cwd);
      }
    },
  };
}
