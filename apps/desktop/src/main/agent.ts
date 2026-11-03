// Which agent answers (plan section 16, spec 5's choice): the signed-in agent
// from the setup report, or the saved API key when none is. Calls run in main
// because the key never goes to the worker; they only wait on a child process
// or a fetch.
import type { SetupReport } from "@alcyo/ipc";
import {
  type LlmProvider,
  PlannerError,
  type SpawnDeps,
  anthropicProvider,
  claudeProvider,
  codexProvider,
  grokProvider,
} from "@alcyo/planner";

export const NO_AGENT =
  "No coding agent is signed in. Open Setup to sign in to Claude Code, Grok or Codex, or save an API key in Settings.";

/** Grok Build's fast model at medium effort answers in about 10 s. */
export const GROK_OPTIONS = { effort: "medium" } as const;

const LABEL = { claude: "Claude Code", grok: "Grok", codex: "Codex" } as const;

export interface AgentDeps {
  setup: () => Promise<SetupReport>;
  apiKey: () => Promise<string | null>;
  model: () => Promise<string>;
  spawn: SpawnDeps;
  fetch?: typeof fetch;
  /** Headless tests only: a scripted agent. */
  override?: LlmProvider | null;
}

export class AgentService {
  constructor(private readonly deps: AgentDeps) {}

  /** The agent's name for the screen, or null when none can answer. */
  async label(): Promise<string | null> {
    if (this.deps.override != null) return "Test agent";
    const report = await this.deps.setup();
    if (report.chosen !== null) return LABEL[report.chosen.id];
    return report.apiKey.present ? "API key" : null;
  }

  async provider(): Promise<LlmProvider> {
    if (this.deps.override != null) return this.deps.override;
    const report = await this.deps.setup();
    const chosen = report.chosen;
    if (chosen !== null) {
      switch (chosen.id) {
        case "claude":
          return claudeProvider(chosen.path, this.deps.spawn);
        case "grok":
          return grokProvider(chosen.path, this.deps.spawn, GROK_OPTIONS);
        case "codex":
          return codexProvider(chosen.path, this.deps.spawn);
      }
    }
    const key = await this.deps.apiKey();
    if (key !== null) return anthropicProvider(key, this.deps.fetch ?? fetch);
    throw new PlannerError(NO_AGENT, "failed");
  }

  model(): Promise<string> {
    return this.deps.model();
  }
}
