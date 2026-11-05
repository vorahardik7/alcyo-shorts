// One checked request (claude.md): the answer is parsed with Zod and checked
// by code. On a failure the errors go back once; a second failure is a plain
// PlannerError and nothing is used.
import type { z } from "zod";
import { type LlmProvider, type LlmRequest, PlannerError } from "./provider";

export interface Problem {
  path: string;
  message: string;
}

const MAX_PROBLEMS = 12;

function zodProblems(error: z.ZodError): Problem[] {
  return error.issues.map((i) => ({
    path: i.path.map(String).join(".") || "(root)",
    message: i.message,
  }));
}

export function retryInstruction(instruction: string, problems: readonly Problem[]): string {
  const lines = problems
    .slice(0, MAX_PROBLEMS)
    .map((p) => `- ${p.path}: ${p.message}`)
    .join("\n");
  return `${instruction}\n\nYour last answer was not accepted:\n${lines}\nAnswer again with JSON that fixes these.`;
}

export async function askChecked<S extends z.ZodType>(
  provider: LlmProvider,
  schema: S,
  req: LlmRequest,
  check: (value: z.output<S>) => Problem[] = () => [],
  failure = "The agent's answer didn't fit, twice. Try again.",
): Promise<z.output<S>> {
  let instruction = req.instruction;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Cancelled before the call (say, while inputs were read): don't start the agent.
    if (req.signal.aborted) throw new PlannerError("The request was cancelled.", "cancelled");
    let raw: unknown;
    try {
      raw = await provider.complete({ ...req, instruction });
    } catch (error) {
      // A failed call isn't retried with errors; there's nothing to correct.
      if (error instanceof PlannerError) throw error;
      throw new PlannerError("The agent didn't answer.", "failed");
    }
    const parsed = schema.safeParse(raw);
    const problems = parsed.success ? check(parsed.data) : zodProblems(parsed.error);
    if (parsed.success && problems.length === 0) return parsed.data;
    if (req.signal.aborted) throw new PlannerError("The request was cancelled.", "cancelled");
    instruction = retryInstruction(req.instruction, problems);
  }
  throw new PlannerError(failure, "failed");
}
