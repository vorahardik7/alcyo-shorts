// The interview and the style summary through the signed-in agent. Prompts
// and checks live in @alcyo/profile; this sends them and checks the answer.
import {
  type InterviewTurn,
  MAX_QUESTIONS,
  checkDraft,
  interviewRequest,
  isRepeat,
  styleRequest,
} from "@alcyo/profile";
import { InterviewStep, type SampleFile, StyleSummary, claudeJsonSchemas } from "@alcyo/schema";
import { type Problem, askChecked } from "./llm/ask";
import type { LlmProvider } from "./llm/provider";

export interface CallOpts {
  /** The model setting, sent to Claude only. */
  model: string;
  signal: AbortSignal;
}

export function nextInterviewStep(
  provider: LlmProvider,
  turns: readonly InterviewTurn[],
  opts: CallOpts & { finishNow?: boolean },
): Promise<InterviewStep> {
  const { instruction, input } = interviewRequest(
    turns,
    opts.finishNow === undefined ? {} : { finishNow: opts.finishNow },
  );
  const mustFinish = opts.finishNow === true || turns.length >= MAX_QUESTIONS;
  const check = (step: InterviewStep): Problem[] => {
    if (step.kind === "done") return checkDraft(step.profile);
    if (mustFinish)
      return [{ path: "kind", message: 'Finish now: return kind "done" with the profile.' }];
    if (step.text.trim().length === 0) return [{ path: "text", message: "Ask a question." }];
    if (isRepeat(turns, step.text))
      return [
        {
          path: "text",
          message: "That question was already asked. Ask about something else, or finish.",
        },
      ];
    return [];
  };
  return askChecked(
    provider,
    InterviewStep,
    {
      instruction,
      input,
      jsonSchema: claudeJsonSchemas.interviewStep,
      model: opts.model,
      signal: opts.signal,
    },
    check,
    "The agent's interview answer didn't fit, twice. Try again, or skip the question.",
  );
}

export async function writeStyleSummary(
  provider: LlmProvider,
  samples: readonly SampleFile[],
  opts: CallOpts,
): Promise<string> {
  const { instruction, input } = styleRequest(samples);
  const out = await askChecked(
    provider,
    StyleSummary,
    {
      instruction,
      input,
      jsonSchema: claudeJsonSchemas.styleSummary,
      model: opts.model,
      signal: opts.signal,
    },
    () => [],
    "The agent's style summary didn't fit, twice. Try again.",
  );
  return out.summary.trim();
}
