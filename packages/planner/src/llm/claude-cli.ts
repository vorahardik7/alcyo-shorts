// Claude Code, headless (plan section 16). The user's plan pays: the child
// env has no API key or token. --safe-mode is tried first; a build that
// rejects it with -p is retried once with the empty-cwd fallback.
import { scrubClaudeEnv } from "./claude-locate";
import {
  type LlmProvider,
  type LlmRequest,
  PlannerError,
  type SpawnDeps,
  parseStructuredOutput,
  rejectedSafeMode,
  withAgentDir,
} from "./provider";

export function claudeArgs(req: LlmRequest, safeMode: boolean): string[] {
  const args = ["-p", "--output-format", "json", "--json-schema", JSON.stringify(req.jsonSchema)];
  if (safeMode) args.push("--safe-mode");
  else args.push("--strict-mcp-config", "--setting-sources", "project");
  args.push(
    "--tools",
    "",
    "--disallowedTools",
    "mcp__*",
    "--max-turns",
    "3",
    "--no-session-persistence",
    "--model",
    req.model,
    req.instruction,
  );
  return args;
}

export function claudeProvider(path: string, deps: SpawnDeps): LlmProvider {
  return {
    name: "claude-cli",
    async complete(req) {
      if (req.signal.aborted) throw new PlannerError("The request was cancelled.", "cancelled");
      const first = await run(path, req, deps, true);
      const result = rejectedSafeMode(first) ? await run(path, req, deps, false) : first;
      if (result.code !== 0) throw new PlannerError("Claude Code didn't answer.", "failed");
      return parseStructuredOutput(result.stdout);
    },
  };
}

async function run(path: string, req: LlmRequest, deps: SpawnDeps, safeMode: boolean) {
  const cwd = await deps.mkdtemp();
  try {
    return await deps.spawn(path, claudeArgs(req, safeMode), {
      cwd,
      env: withAgentDir(scrubClaudeEnv(deps.env), path),
      input: req.input,
      signal: req.signal,
    });
  } finally {
    await deps.remove(cwd);
  }
}
