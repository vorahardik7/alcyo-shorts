// Backup when no local agent is signed in. The key is passed in by the caller
// and is never written into an error or a log line.
//
// The schema goes in output_config.format (structured outputs). Forced
// tool_choice is not used: Claude Sonnet 5.5 and Opus 5.5 reject it with a 400.
import { type LlmProvider, type LlmRequest, PlannerError } from "./provider";

const API = "https://api.anthropic.com/v1/messages";

/** Claude Code accepts aliases; the Messages API needs a model id. */
const API_MODELS: Record<string, string> = {
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
  haiku: "claude-haiku-5-5",
};

export function apiModelFor(model: string): string {
  return API_MODELS[model.trim().toLowerCase()] ?? model;
}

export function anthropicBody(req: LlmRequest): unknown {
  return {
    model: apiModelFor(req.model),
    max_tokens: 8192,
    output_config: { format: { type: "json_schema", schema: req.jsonSchema } },
    messages: [{ role: "user", content: `${req.instruction}\n\n${req.input}` }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The JSON in the reply's text block, which is the structured answer. */
export function parseAnthropicMessage(body: unknown): unknown {
  if (!isRecord(body) || !Array.isArray(body["content"])) {
    throw new PlannerError("Claude's API returned something unexpected.", "failed");
  }
  if (body["stop_reason"] === "refusal") {
    throw new PlannerError("Claude declined the request.", "failed");
  }
  if (body["stop_reason"] === "max_tokens") {
    throw new PlannerError("Claude's answer was cut off.", "failed");
  }
  const text = body["content"]
    .filter((block) => isRecord(block) && block["type"] === "text")
    .map((block) => (block as Record<string, unknown>)["text"])
    .filter((t): t is string => typeof t === "string")
    .join("");
  if (text.trim().length === 0) {
    throw new PlannerError("Claude's API didn't return the result.", "failed");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PlannerError("Claude's API didn't return JSON.", "failed");
  }
}

export function anthropicProvider(
  apiKey: string,
  fetchImpl: typeof fetch,
  deps: { model?: string } = {},
): LlmProvider {
  return {
    name: "anthropic-api",
    async complete(req) {
      if (req.signal.aborted) throw new PlannerError("The request was cancelled.", "cancelled");
      let response: Response;
      try {
        response = await fetchImpl(API, {
          method: "POST",
          redirect: "error",
          signal: req.signal,
          headers: {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": apiKey,
          },
          body: JSON.stringify(anthropicBody({ ...req, model: deps.model ?? req.model })),
        });
      } catch {
        if (req.signal.aborted) throw new PlannerError("The request was cancelled.", "cancelled");
        throw new PlannerError("Couldn't reach Claude's API.", "failed");
      }
      if (!response.ok) {
        throw new PlannerError(`Claude's API refused the request (${response.status}).`, "failed");
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new PlannerError("Claude's API returned something unexpected.", "failed");
      }
      return parseAnthropicMessage(body);
    },
  };
}
