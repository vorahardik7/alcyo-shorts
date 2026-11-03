// Live agent calls. Off by default: each run is a real, billed request.
//   ALCYO_LIVE_GROK=1 pnpm --filter @alcyo/planner test
// Uses grok-4.7-build-fast at medium effort unless ALCYO_GROK_MODEL or
// ALCYO_GROK_EFFORT say otherwise.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { grokProvider } from "./grok-cli";
import { realSpawnDeps } from "./spawn";

const grok = process.env["ALCYO_GROK_PATH"] ?? join(homedir(), ".local", "bin", "grok");
const live = process.env["ALCYO_LIVE_GROK"] === "1" && existsSync(grok);

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
    const provider = grokProvider(grok, realSpawnDeps(), {
      model: process.env["ALCYO_GROK_MODEL"] ?? "grok-4.7-build-fast",
      effort:
        (process.env["ALCYO_GROK_EFFORT"] as "low" | "medium" | "high" | undefined) ?? "medium",
    });
    const answer = (await provider.complete({
      instruction: "Pick the line ids that would make a good short. Answer with JSON only.",
      input: [
        "L0001 alright we are live",
        "L0002 oh no the boss just one-shot me",
        "L0003 chat that was insane, clip it",
        "L0004 ok getting water",
      ].join("\n"),
      jsonSchema: schema,
      model: "sonnet",
      signal: new AbortController().signal,
    })) as { lineIds: string[]; reason: string };
    expect(answer.lineIds.length).toBeGreaterThan(0);
    for (const id of answer.lineIds) expect(["L0001", "L0002", "L0003", "L0004"]).toContain(id);
    expect(typeof answer.reason).toBe("string");
  }, 180_000);
});
