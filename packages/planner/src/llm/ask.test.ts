import { z } from "zod";
import { describe, expect, it } from "vitest";
import { askChecked } from "./ask";
import { type LlmProvider, type LlmRequest, PlannerError } from "./provider";

const req: LlmRequest = {
  instruction: "Count.",
  input: "x",
  jsonSchema: {},
  model: "sonnet",
  signal: new AbortController().signal,
};
const Count = z.object({ n: z.number().int() });

function scripted(answers: unknown[]): LlmProvider & { seen: string[] } {
  const seen: string[] = [];
  return {
    name: "fake",
    seen,
    complete: (r) => {
      seen.push(r.instruction);
      return Promise.resolve(answers.shift());
    },
  };
}

describe("askChecked", () => {
  it("returns a valid answer on the first try", async () => {
    const p = scripted([{ n: 3 }]);
    await expect(askChecked(p, Count, req)).resolves.toEqual({ n: 3 });
    expect(p.seen).toEqual(["Count."]);
  });

  it("sends the Zod and check errors back once, then accepts the fix", async () => {
    const p = scripted([{ n: "three" }, { n: 30 }, { n: 4 }]);
    const check = (v: { n: number }) => (v.n > 10 ? [{ path: "n", message: "Too big." }] : []);
    await expect(askChecked(p, Count, req, check)).rejects.toBeInstanceOf(PlannerError);
    expect(p.seen).toHaveLength(2);
    expect(p.seen[1]).toContain("Your last answer was not accepted");
    expect(p.seen[1]).toContain("- n:");

    const q = scripted([{ n: 30 }, { n: 4 }]);
    await expect(askChecked(q, Count, req, check)).resolves.toEqual({ n: 4 });
    expect(q.seen[1]).toContain("- n: Too big.");
  });
});
