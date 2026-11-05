// The agents and models the composer's picker offers. Pure data: main
// passes the chosen model to the agent's CLI as one argument, never a shell.
import type { LocalAgentId } from "./project.ts";

export interface AgentModel {
  /** Passed to the CLI. "default" means: pass nothing, the agent picks. */
  id: string;
  label: string;
  /** One short line under the name. */
  hint?: string;
}

export const AGENT_MODELS: Record<LocalAgentId, { label: string; models: AgentModel[] }> = {
  claude: {
    label: "Claude Code",
    models: [
      { id: "sonnet", label: "Sonnet", hint: "Fast and good. The default." },
      { id: "opus", label: "Opus", hint: "Slower, more careful picks." },
      { id: "haiku", label: "Haiku", hint: "Fastest." },
    ],
  },
  grok: {
    label: "Grok",
    models: [
      { id: "default", label: "Default", hint: "Grok's own choice." },
      { id: "grok-4.7", label: "Grok 4.7" },
      { id: "grok-4.7-build-fast", label: "Grok 4.7 Fast" },
    ],
  },
  codex: {
    label: "Codex",
    models: [
      { id: "default", label: "Default", hint: "Codex's own choice." },
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
      { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
    ],
  },
};
