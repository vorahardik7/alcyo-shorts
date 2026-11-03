// A scripted agent for headless e2e runs (ALCYO_TEST_AGENT=script), so tests
// don't depend on a signed-in agent or spend money. Never used otherwise.
import type { LlmProvider, LlmRequest } from "@alcyo/planner";
import { type ProposalShort, claudeJsonSchemas } from "@alcyo/schema";

const QUESTIONS = [
  { text: "What do you stream, and who watches?", chips: [] },
  {
    text: "What makes a moment worth a short for you?",
    chips: ["Funny", "Skill", "Rage", "Close calls"],
  },
  { text: "How long are your shorts usually?", chips: ["15 to 30 s", "30 to 45 s", "45 to 60 s"] },
];

const sec = (clock: string) => {
  const [h, m, x] = clock.split(":").map(Number);
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (x ?? 0);
};

/** Picks spans of rows that fit the asked length, spread out, avoiding existing shorts. */
function propose(req: LlmRequest): unknown {
  const ask = /# Pick (?:up to )?(\d+) [^,]*, each (\d+) to (\d+) s\./.exec(req.input);
  const count = Number(ask?.[1] ?? 3);
  const min = Number(ask?.[2] ?? 20);
  const max = Number(ask?.[3] ?? 45);
  const body = req.input.split(/^# (?:Transcript|Candidates)$/m)[1] ?? "";
  const rows = [...body.matchAll(/^(L\d{4,6}) (\d\d:\d\d:\d\d) /gm)].map((m) => ({
    id: m[1]!,
    t: sec(m[2]!),
  }));
  const taken = [...req.instruction.matchAll(/(L\d{4,6}) to (L\d{4,6})/g)].map((m) => [
    m[1]!,
    m[2]!,
  ]);
  const blocked = new Set<string>();
  for (const [a, b] of taken) {
    const i = rows.findIndex((r) => r.id === a);
    const j = rows.findIndex((r) => r.id === b);
    if (i !== -1 && j !== -1)
      for (let k = Math.max(0, i - 1); k <= j + 1; k++) blocked.add(rows[k]!.id);
  }
  const target = (min + max) / 2;
  const shorts: ProposalShort[] = [];
  let i = 0;
  while (i < rows.length && shorts.length < count) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1]!.t - rows[i]!.t < target) j++;
    const span = rows.slice(i, j + 2);
    if (j + 1 < rows.length && !span.some((r) => blocked.has(r.id))) {
      const n = shorts.length + 1;
      shorts.push({
        title: `Moment ${n}`,
        hookText: `Wait for it ${n}`,
        reason: "It opens on the reaction and ends on the payoff.",
        startLine: rows[i]!.id,
        endLine: rows[j]!.id,
      });
      i = j + 3;
    } else i++;
  }
  return { shorts };
}

/** One chat action, from keywords in the creator's message. */
function chat(req: LlmRequest): unknown {
  const msg = /# The creator's message(?: \(replying to (sh_\w+)\))?\n([\s\S]*)$/.exec(req.input);
  const text = (msg?.[2] ?? "").toLowerCase();
  const ids = [...req.input.matchAll(/^(sh_\w+) v\d+ /gm)].map((m) => m[1]!);
  const target = msg?.[1] ?? ids[0];
  const words = (id: string | undefined) => {
    const part =
      id === undefined ? "" : (req.input.split(`## Words of ${id}.`)[1] ?? "").split(/^#/m)[0]!;
    return [...part.matchAll(/(\()?(w\d{5,7}):/g)].map((m) => ({
      id: m[2]!,
      kept: m[1] === undefined,
    }));
  };
  if (text.includes("?")) {
    return {
      action: "answer",
      text: "I picked it because it opens on the reaction and ends on the payoff.",
    };
  }
  if (/more|another/.test(text))
    return { action: "new_shorts", request: text.slice(0, 300), count: 1 };
  if (/caption/.test(text)) {
    const looks = [...(/^# Caption looks: (.*)$/m.exec(req.input)?.[1] ?? "").matchAll(/(\S+) "/g)];
    return { action: "set_style", scope: "all", captionPresetId: looks[1]?.[1] ?? looks[0]?.[1] };
  }
  const all = words(target);
  const kept = all.filter((w) => w.kept);
  if (target !== undefined && kept.length > 0 && /earlier/.test(text)) {
    const first = all.findIndex((w) => w.kept);
    return { action: "retime_short", shortId: target, startWord: all[Math.max(0, first - 8)]!.id };
  }
  if (target !== undefined && kept.length > 0 && /punch|short|tight/.test(text)) {
    return {
      action: "revise_short",
      shortId: target,
      title: "Straight to it",
      hookText: "Watch this",
      whatChanged: "Cut the slow start",
      keep: [{ fromWord: kept[Math.floor(kept.length * 0.25)]!.id, toWord: kept.at(-1)!.id }],
    };
  }
  return { action: "clarify", question: "Which short do you mean? Reply to its card." };
}

export function scriptedAgent(): LlmProvider {
  return {
    name: "fake",
    complete: (req) => {
      if (req.jsonSchema === claudeJsonSchemas.proposal) return Promise.resolve(propose(req));
      if (req.jsonSchema === claudeJsonSchemas.chatAction) return Promise.resolve(chat(req));
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
