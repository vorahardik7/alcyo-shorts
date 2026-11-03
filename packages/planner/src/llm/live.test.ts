// Live agent calls. Off by default: each run is a real, billed request.
//   ALCYO_LIVE_GROK=1 pnpm --filter @alcyo/planner test
// Uses grok-4.7-build-fast at medium effort unless ALCYO_GROK_MODEL or
// ALCYO_GROK_EFFORT say otherwise.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SampleFile } from "@alcyo/schema";
import { describe, expect, it } from "vitest";
import { nextInterviewStep, writeStyleSummary } from "../interview";
import { grokProvider } from "./grok-cli";
import { realSpawnDeps } from "./spawn";

const grok = process.env["ALCYO_GROK_PATH"] ?? join(homedir(), ".local", "bin", "grok");
const live = process.env["ALCYO_LIVE_GROK"] === "1" && existsSync(grok);

const provider = () =>
  grokProvider(grok, realSpawnDeps(), {
    model: process.env["ALCYO_GROK_MODEL"] ?? "grok-4.7-build-fast",
    effort: (process.env["ALCYO_GROK_EFFORT"] as "low" | "medium" | "high" | undefined) ?? "medium",
  });
const opts = () => ({ model: "sonnet", signal: new AbortController().signal });

const schema = {
  type: "object",
  properties: {
    lineIds: { type: "array", items: { type: "string", pattern: "^L\\d{4}$" } },
    reason: { type: "string" },
  },
  required: ["lineIds", "reason"],
  additionalProperties: false,
};

describe.skipIf(!live)("Grok Build, live", () => {
  it("answers with the schema's JSON, through the real provider and spawn", async () => {
    const answer = (await provider().complete({
      instruction: "Pick the line ids that would make a good short. Answer with JSON only.",
      input: [
        "L0001 alright we are live",
        "L0002 oh no the boss just one-shot me",
        "L0003 chat that was insane, clip it",
        "L0004 ok getting water",
      ].join("\n"),
      jsonSchema: schema,
      ...opts(),
    })) as { lineIds: string[]; reason: string };
    expect(answer.lineIds.length).toBeGreaterThan(0);
    for (const id of answer.lineIds) expect(["L0001", "L0002", "L0003", "L0004"]).toContain(id);
    expect(typeof answer.reason).toBe("string");
  }, 180_000);

  it("asks a first question, then finishes with a profile that passes the checks", async () => {
    const first = await nextInterviewStep(provider(), [], opts());
    expect(first.kind).toBe("question");
    if (first.kind !== "question") return;
    console.log(`[live] Q1: ${first.text} | chips: ${first.chips.join(", ")}`);
    const turns = [
      {
        question: first.text,
        chips: first.chips,
        answer: "Minecraft hardcore, viewers are mostly 16 to 24",
      },
      {
        question: "What makes a moment worth a short?",
        chips: [],
        answer: "close calls and rage, funny chat moments",
      },
      { question: "How long are your shorts?", chips: [], answer: "30 to 45 s" },
      {
        question: "How do you title them?",
        chips: [],
        answer: "HE DID NOT SEE THAT, I CAN'T BELIEVE THIS WORKED",
      },
      { question: "Anything to avoid?", chips: [], answer: null },
    ];
    const done = await nextInterviewStep(provider(), turns, { ...opts(), finishNow: true });
    expect(done.kind).toBe("done");
    if (done.kind !== "done") return;
    console.log(`[live] draft: ${JSON.stringify(done.profile)}`);
    expect(done.profile.lengthMs.min).toBeGreaterThanOrEqual(25_000);
    expect(done.profile.lengthMs.max).toBeLessThanOrEqual(50_000);
    expect(done.profile.goodMoments).toContain("close-call");
  }, 300_000);

  it("writes a style summary from openings and numbers", async () => {
    const sample = (i: number, line: string): SampleFile => ({
      schemaVersion: 1,
      sampleId: `smp_${i}`,
      fileName: `short ${i}.mp4`,
      addedAt: "2026-11-02T12:00:00.000Z",
      measures: {
        lengthMs: 32_000,
        firstWordMs: 300,
        firstSentence: line,
        wordsPerSecond: 3.2,
        cutEveryMs: 2100,
        pausesPer10s: 0.2,
        loudnessLufs: -13.5,
      },
      opening: line,
    });
    const summary = await writeStyleSummary(
      provider(),
      [
        sample(1, "NO WAY he just did that."),
        sample(2, "Chat, look at this."),
        sample(3, "Wait for it."),
      ],
      opts(),
    );
    console.log(`[live] style: ${summary}`);
    expect(summary.length).toBeGreaterThan(20);
  }, 180_000);
});
