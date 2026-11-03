// A scripted agent for headless e2e runs (ALCYO_TEST_AGENT=script), so tests
// don't depend on a signed-in agent or spend money. Never used otherwise.
import type { LlmProvider } from "@alcyo/planner";
import { claudeJsonSchemas } from "@alcyo/schema";

const QUESTIONS = [
  { text: "What do you stream, and who watches?", chips: [] },
  {
    text: "What makes a moment worth a short for you?",
    chips: ["Funny", "Skill", "Rage", "Close calls"],
  },
  { text: "How long are your shorts usually?", chips: ["15 to 30 s", "30 to 45 s", "45 to 60 s"] },
];

export function scriptedAgent(): LlmProvider {
  return {
    name: "fake",
    complete: (req) => {
      if (req.jsonSchema === claudeJsonSchemas.styleSummary) {
        return Promise.resolve({ summary: "Opens on the reaction. Fast cuts, few pauses." });
      }
      if (req.jsonSchema === claudeJsonSchemas.interviewStep) {
        const asked = (req.input.match(/^Q\d+:/gm) ?? []).length;
        const finish = /Finish now/.test(req.instruction);
        const next = QUESTIONS[asked];
        if (next !== undefined && !finish) return Promise.resolve({ kind: "question", ...next });
        const answers = [...req.input.matchAll(/^A\d+: (.*)$/gm)].map((m) => m[1] ?? "");
        return Promise.resolve({
          kind: "done",
          profile: {
            name: "",
            streams: answers[0]?.startsWith("(skipped") === false ? answers[0] : "Live streams",
            audience: "",
            goodMoments: ["funny", "close-call"],
            lengthMs: { min: 30_000, max: 45_000 },
            titleRules: "Short, caps.",
            exampleTitles: [],
            avoid: [],
            platforms: ["tiktok"],
          },
        });
      }
      return Promise.reject(new Error("The test agent doesn't know that request."));
    },
  };
}
