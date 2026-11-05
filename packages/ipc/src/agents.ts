// What answers now, for the composer's model picker. The catalog is
// AGENT_MODELS in @alcyo/schema.
import { z } from "zod";
import { ProviderId } from "@alcyo/schema";

/** What answers now: the provider and each agent's model. */
export const AgentSelection = z.object({
  provider: ProviderId,
  models: z.object({
    claude: z.string().min(1).max(100),
    grok: z.string().min(1).max(100),
    codex: z.string().min(1).max(100),
  }),
});
export type AgentSelection = z.infer<typeof AgentSelection>;
