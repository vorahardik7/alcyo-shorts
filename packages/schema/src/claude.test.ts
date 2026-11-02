// The JSON Schemas Claude is given (requirement 6).
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { ChatAction, ClaudeProposal, claudeJsonSchemas, InterviewStep } from "./claude.ts";
import * as F from "./testing/fixtures.ts";

const ajv = new Ajv2020({ strict: false, allErrors: true });

const cases: Array<{
  name: keyof typeof claudeJsonSchemas;
  zod: z.ZodType;
  good: unknown[];
  bad: unknown[];
}> = [
  {
    name: "proposal",
    zod: ClaudeProposal,
    good: [F.proposal],
    bad: [
      { shorts: [] },
      { shorts: [{ ...F.proposal.shorts[0], startLine: "line 1" }] },
      { shorts: [{ ...F.proposal.shorts[0], startMs: 1000 }].map(({ startLine: _s, ...r }) => r) },
      { shorts: Array(6).fill(F.proposal.shorts[0]) },
    ],
  },
  {
    name: "chatAction",
    zod: ChatAction,
    good: F.chatActions,
    bad: [
      { action: "run", command: "ffmpeg -i x" },
      {
        action: "revise_short",
        shortId: "sh1",
        title: "t",
        hookText: "h",
        whatChanged: "w",
        keep: [],
      },
      { action: "retime_short", shortId: "sh1", startWord: "12" },
      { action: "new_shorts", request: "x", count: 0 },
    ],
  },
  {
    name: "interviewStep",
    zod: InterviewStep,
    good: F.interviewSteps,
    bad: [
      { kind: "question", text: "x" },
      { kind: "done", profile: { name: "x" } },
      { kind: "next" },
    ],
  },
];

describe("claudeJsonSchemas", () => {
  for (const c of cases) {
    it(`${c.name}: accepts and rejects the same answers as Zod`, () => {
      const validate = ajv.compile(claudeJsonSchemas[c.name]);
      for (const value of c.good) {
        expect(c.zod.safeParse(value).success).toBe(true);
        expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
      }
      for (const value of c.bad) {
        expect(c.zod.safeParse(value).success).toBe(false);
        expect(validate(value)).toBe(false);
      }
    });
  }

  it("keep the line and word id patterns", () => {
    const text = JSON.stringify(claudeJsonSchemas);
    expect(text).toContain(JSON.stringify("^L\\d{4,6}$"));
    expect(text).toContain(JSON.stringify("^w\\d{5,7}$"));
  });

  it("have no time fields and no command fields", () => {
    const keys = new Set<string>();
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node !== null && typeof node === "object") {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (k === "properties" && v !== null && typeof v === "object") {
            for (const name of Object.keys(v)) keys.add(name);
          }
          walk(v);
        }
      }
    };
    walk(claudeJsonSchemas);
    const timeLike = [...keys].filter(
      (k) => /Ms$/.test(k) || ["srcIn", "srcOut", "start", "end", "t", "time"].includes(k),
    );
    const commandLike = [...keys].filter((k) => /command|args|ffmpeg|shell|exec|script/i.test(k));
    // The profile draft's length range is the one allowed number of ms: it's
    // the creator's answer, not a time in the video.
    expect(timeLike).toEqual(["lengthMs"]);
    expect(commandLike).toEqual([]);
  });

  it("are JSON Schema draft 2020-12 and plain JSON", () => {
    for (const schema of Object.values(claudeJsonSchemas)) {
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(JSON.parse(JSON.stringify(schema)) as unknown).toEqual(schema);
    }
  });
});
