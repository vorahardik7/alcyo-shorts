// Codex, non-interactive. The final message is read from a file so the JSONL
// event stream doesn't have to be parsed. The sandbox is read-only and the
// working directory is empty. OPENAI_API_KEY is removed so the Codex login pays.
import { join } from "node:path";
import {
  type LlmProvider,
  PlannerError,
  type SpawnDeps,
  parseStructuredOutput,
  withAgentDir,
} from "./provider";

export function codexArgs(schemaFile: string, lastMessage: string, cwd: string): string[] {
  return [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--json",
    "--output-schema",
    schemaFile,
    "--output-last-message",
    lastMessage,
    "-C",
    cwd,
    "-",
  ];
}

export function scrubCodexEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const copy = { ...env };
  delete copy["OPENAI_API_KEY"];
  return copy;
}

export function codexProvider(path: string, deps: SpawnDeps): LlmProvider {
  return {
    name: "codex-cli",
    async complete(req) {
      if (req.signal.aborted) throw new PlannerError("The request was cancelled.", "cancelled");
      const cwd = await deps.mkdtemp();
      const schemaFile = join(cwd, "schema.json");
      const lastMessage = join(cwd, "last.txt");
      try {
        await deps.writeFile(schemaFile, JSON.stringify(req.jsonSchema));
        const result = await deps.spawn(path, codexArgs(schemaFile, lastMessage, cwd), {
          cwd,
          env: withAgentDir(scrubCodexEnv(deps.env), path),
          input: `${req.instruction}\n\n${req.input}\n`,
          signal: req.signal,
        });
        if (result.code !== 0) throw new PlannerError("Codex didn't answer.", "failed");
        return parseStructuredOutput(await deps.readFile(lastMessage));
      } finally {
        await deps.remove(cwd);
      }
    },
  };
}
