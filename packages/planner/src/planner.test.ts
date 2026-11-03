import { defaultProfile } from "@alcyo/profile";
import {
  BUILTIN_CAPTION_PRESETS,
  BUILTIN_HOOK_PRESETS,
  type Line,
  type ShortVersion,
  type Transcript,
  type Word,
  shortDuration,
} from "@alcyo/schema";
import { describe, expect, it } from "vitest";
import { type ChatInputs, applyChatAction, chatAction, chatRequest } from "./chat-actions";
import {
  FIND_FAILED,
  type PlanInputs,
  buildProposal,
  findRequest,
  findShorts,
  splitWindows,
} from "./find-shorts";
import { formatLine, promptLines } from "./lines";
import type { LlmProvider, LlmRequest } from "./llm/provider";

/** `lines` lines of 10 words, one every 4 s; line 5 follows a 2 s pause. */
function makeTranscript(lineCount: number): Transcript {
  const words: Word[] = [];
  const lines: Line[] = [];
  let t = 0;
  for (let l = 0; l < lineCount; l++) {
    if (l === 5) t += 2000;
    const ids: string[] = [];
    for (let j = 0; j < 10; j++) {
      const id = `w${String(words.length + 1).padStart(5, "0")}`;
      words.push({
        id,
        text: ` word${l}_${j}`,
        startMs: t + j * 350,
        endMs: t + j * 350 + 300,
        p: 0.9,
      });
      ids.push(id);
    }
    lines.push({
      id: `L${String(l + 1).padStart(4, "0")}`,
      startMs: t,
      endMs: t + 9 * 350 + 300,
      wordIds: ids,
    });
    t += 4000;
  }
  return { schemaVersion: 1, sourceId: "src1", language: "en", model: "small.en", words, lines };
}

function inputs(lineCount = 75): PlanInputs {
  const transcript = makeTranscript(lineCount);
  // Silences between lines, so edges have pauses to snap to.
  const silences = transcript.lines.slice(1).map((l, i) => ({
    startMs: transcript.lines[i]!.endMs,
    endMs: l.startMs,
  }));
  return {
    transcript,
    sourceDurationMs: transcript.lines.at(-1)!.endMs + 5000,
    silences,
    clips: [
      { startMs: 100_000, endMs: 110_000 },
      { startMs: 104_000, endMs: 112_000 },
    ],
    profile: { ...defaultProfile(), lengthMs: { min: 25_000, max: 40_000 } },
    presets: { captionPresets: BUILTIN_CAPTION_PRESETS, hookPresets: BUILTIN_HOOK_PRESETS },
    stream: {
      name: "My Stream",
      durationMs: 305_000,
      site: "youtube.com",
      uploaded: "2026-10-30",
      clipsMatched: 2,
    },
  };
}

/** A provider that answers from a list, and records every request. */
function scripted(answers: unknown[]): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    name: "fake",
    calls,
    complete: (req) => {
      calls.push(req);
      const next = answers[Math.min(calls.length - 1, answers.length - 1)];
      return typeof next === "function"
        ? Promise.resolve((next as (r: LlmRequest) => unknown)(req))
        : Promise.resolve(next);
    },
  };
}

const pick = (startLine: string, endLine: string, title = "No way") => ({
  title,
  hookText: "He did it again",
  reason: "Viewers clipped it.",
  startLine,
  endLine,
});
const L = (n: number) => `L${String(n).padStart(4, "0")}`;
const opts = { model: "sonnet", signal: new AbortController().signal };

describe("the lines the agent reads", () => {
  it("marks pauses and clips, with one start time per line", () => {
    const lines = promptLines(inputs().transcript, inputs().clips);
    expect(formatLine(lines[0]!)).toBe(
      "L0001 00:00:00 word0_0 word0_1 word0_2 word0_3 word0_4 word0_5 word0_6 word0_7 word0_8 word0_9",
    );
    expect(formatLine(lines[5]!)).toMatch(/^L0006 00:00:22 \[pause\] word5_0/);
    const twice = lines.find((l) => l.startMs === 106_000)!;
    expect(formatLine(twice)).toContain("[clipped x2]");
    const once = lines.find((l) => l.startMs === 98_000)!;
    expect(formatLine(once)).toMatch(/\[clipped\] /);
  });

  it("has no media bytes, paths, word ids or word times", () => {
    const i = inputs();
    const { instruction, input } = findRequest(i, promptLines(i.transcript, i.clips), {
      kind: "pick",
      count: 3,
    });
    const text = `${instruction}\n${input}`;
    expect(text).not.toMatch(/\bw\d{5,7}\b/);
    expect(text).not.toMatch(/\d+\s?ms\b/);
    expect(text).not.toMatch(/[A-Za-z]:\\|\/Users\/|\.mp4|\.wav|\.json/);
    // Printable text only: no NUL or other control bytes.
    expect(text).not.toMatch(/[\u0000-\u0008\u000B-\u001F]/); // eslint-disable-line no-control-regex
    for (const row of input.split("\n").filter((r) => /^L\d{4}/.test(r))) {
      expect(row.match(/\d\d:\d\d:\d\d/g)).toHaveLength(1);
    }
    expect(input).toContain(
      "# Stream: My Stream, 05:05, from youtube.com, uploaded 2026-10-30. 2 viewer clips matched.",
    );
    expect(input).toContain("# Pick 3 shorts, each 25 to 40 s.");
    expect(input).toContain("# Creator profile");
  });
});

describe("findShorts", () => {
  it("maps line ids to word edges, snaps, and builds version 1", async () => {
    const provider = scripted([
      { shorts: [pick(L(1), L(8)), pick(L(20), L(27)), pick(L(40), L(47))] },
    ]);
    const i = inputs();
    const shorts = await findShorts(provider, i, opts);
    expect(provider.calls).toHaveLength(1);
    expect(shorts).toHaveLength(3);
    const first = shorts[0]!;
    // L0001 starts at 0; L0008 ends at 2000 + 7*4000 + 3450 = 33450, snapped to the silence start there.
    expect(first.segments).toEqual([{ srcIn: 0, srcOut: 33_450 }]);
    expect(first.hook).toEqual({
      text: "He did it again",
      start: 0,
      end: 3000,
      presetId: i.profile.hookPresetId,
    });
    expect(first.captions.presetId).toBe(i.profile.captionPresetId);
    expect(first.crop.keys).toEqual([{ t: 0, x: 0.5, ease: "hold" }]);
  });

  it("sends the problems back once, then accepts a fixed answer", async () => {
    const provider = scripted([
      { shorts: [pick(L(1), L(30)), pick(L(20), L(27)), pick(L(22), L(29))] },
      { shorts: [pick(L(1), L(8)), pick(L(20), L(27)), pick(L(40), L(47))] },
    ]);
    const shorts = await findShorts(provider, inputs(), opts);
    expect(shorts).toHaveLength(3);
    const retry = provider.calls[1]!.instruction;
    expect(retry).toContain("Your last answer was not accepted");
    expect(retry).toMatch(/shorts\[0\]: Runs 1\d\d s/);
    expect(retry).toContain("shorts[2]: Overlaps shorts[1]");
  });

  it("fails plainly after two bad answers", async () => {
    const provider = scripted([{ shorts: [pick(L(1), L(2))] }]);
    await expect(findShorts(provider, inputs(), opts)).rejects.toThrow(FIND_FAILED);
    expect(provider.calls).toHaveLength(2);
  });

  it("rejects unknown lines and overlap with existing shorts", () => {
    const i = inputs();
    const rules = {
      count: { min: 2, max: 2 },
      range: { min: 25_000, max: 40_000 },
      exclude: [{ startMs: 80_000, endMs: 110_000 }],
    };
    const out = buildProposal({ shorts: [pick(L(1), L(999)), pick(L(20), L(27))] }, i, rules);
    expect(out.shorts).toEqual([]);
    expect(out.problems.map((p) => p.message)).toEqual([
      "Line L0999 isn't in the transcript.",
      expect.stringMatching(/^Overlaps an existing short \(L0020 to L0027\)/),
    ]);
  });

  it("asks for the new request and avoids existing shorts", async () => {
    const provider = scripted([{ shorts: [pick(L(40), L(47))] }]);
    await findShorts(provider, inputs(), {
      ...opts,
      count: 1,
      request: "the boss fight",
      exclude: [{ startMs: 0, endMs: 30_000 }],
    });
    const ins = provider.calls[0]!.instruction;
    expect(ins).toContain('The creator asked for: "the boss fight"');
    expect(ins).toContain("Don't overlap them: L0001 to L0007");
  });

  it("windows a long stream, keeps clipped lines in every window, then picks", async () => {
    const i = inputs(300);
    const provider = scripted([
      (req: LlmRequest) => {
        if (req.input.includes("# Candidates")) {
          // The third row of each of the first three candidates, and 7 rows on.
          const picks = req.input
            .split("## Candidate ")
            .slice(1, 4)
            .map((section) => {
              const rows = section.split("\n").filter((r) => /^L\d{4} /.test(r));
              const n = Number(rows[2]!.slice(1, 5));
              return pick(L(n), L(n + 7));
            });
          return { shorts: picks };
        }
        // Each window: one candidate from its own first rows.
        const first = /^(L\d{4}) /m.exec(req.input.split("# Transcript\n")[1]!)![1]!;
        const n = Number(first.slice(1)) + 1;
        return { shorts: [pick(L(n), L(n + 7))] };
      },
    ]);
    const shorts = await findShorts(provider, i, {
      ...opts,
      maxTokens: 3000,
      windowTokens: 2000,
      overlapTokens: 200,
    });
    const windows = provider.calls.filter((c) => !c.input.includes("# Candidates"));
    expect(windows.length).toBeGreaterThan(2);
    for (const w of windows) expect(w.input).toMatch(/\[clipped x2\]/);
    expect(provider.calls.at(-1)!.input).toContain("## Candidate 1:");
    expect(shorts).toHaveLength(3);
  });

  it("splits windows that overlap and cover every line", () => {
    const lines = promptLines(
      makeTranscript(200).lines.length ? makeTranscript(200) : makeTranscript(1),
      [],
    );
    const wins = splitWindows(lines, 1500, 200);
    expect(wins[0]!.from).toBe(0);
    expect(wins.at(-1)!.to).toBe(lines.length);
    for (let k = 1; k < wins.length; k++) {
      expect(wins[k]!.from).toBeLessThan(wins[k - 1]!.to);
      expect(wins[k]!.from).toBeGreaterThan(wins[k - 1]!.from);
    }
  });
});

describe("chat actions", () => {
  const base = inputs();
  const head = (shortId: string, srcIn: number, srcOut: number, version = 1): ShortVersion => ({
    schemaVersion: 1,
    shortId,
    version,
    parent: null,
    createdBy: "claude",
    createdAt: "2026-11-01T12:00:00.000Z",
    fromMessageId: null,
    note: "",
    sourceId: "src1",
    sourceFingerprint: "x",
    short: {
      title: `Short ${shortId}`,
      reason: "r",
      segments: [{ srcIn, srcOut }],
      crop: { keys: [{ t: 0, x: 0.5, ease: "hold" }] },
      captions: { presetId: base.profile.captionPresetId, wordsPerLine: 3, overrides: [] },
      hook: { text: "hook", start: 0, end: 3000, presetId: base.profile.hookPresetId },
    },
  });
  // sh_a covers lines 7 to 14 (26000 to 57450); sh_b lines 31 to 38.
  const chat = (over: Partial<ChatInputs> = {}): ChatInputs => ({
    ...base,
    shorts: [head("sh_a", 26_000, 57_450, 2), head("sh_b", 122_000, 153_450)],
    messages: [
      {
        id: "m1",
        rev: 0,
        at: "2026-11-01T12:00:00.000Z",
        author: "claude",
        body: { kind: "shorts", intro: "Here", shorts: [{ shortId: "sh_a", version: 1 }] },
      },
      {
        id: "m2",
        rev: 0,
        at: "2026-11-01T12:00:00.000Z",
        author: "app",
        body: { kind: "status", jobId: "j", label: "x", pct: 1, state: "running" },
      },
    ],
    text: "make it punchier",
    ...over,
  });
  const w = (n: number) => `w${String(n).padStart(5, "0")}`;

  it("sends the shorts, history and the reply target's words only", () => {
    const { input } = chatRequest(chat({ replyTo: { shortId: "sh_b", version: 1 } }));
    expect(input).toContain(
      'sh_a v2 "Short sh_a". 00:00:26 to 00:00:57 (31 s), lines L0007 to L0014.',
    );
    expect(input).toContain('You: proposed sh_a "Short sh_a"');
    expect(input).not.toContain("App: x");
    expect(input).toContain("## Words of sh_b.");
    expect(input).not.toContain("## Words of sh_a.");
    expect(input).toContain("# The creator's message (replying to sh_b)\nmake it punchier");
    // Words outside the short are in parentheses.
    expect(input).toMatch(/\(w00\d{3}:word29_0\)/);
    expect(input).toMatch(/ w00\d{3}:word31_0 /);
  });

  it("revise_short keeps word ranges and records the new title and hook", async () => {
    const provider = scripted([
      {
        action: "revise_short",
        shortId: "sh_a",
        title: "Tighter",
        hookText: "Watch this",
        whatChanged: "Cut the intro",
        keep: [{ fromWord: w(81), toWord: w(140) }],
      },
    ]);
    const out = await chatAction(
      provider,
      chat({ replyTo: { shortId: "sh_a", version: 2 } }),
      opts,
    );
    expect(out.kind).toBe("versions");
    if (out.kind !== "versions") return;
    const c = out.changes[0]!;
    expect(c).toMatchObject({ shortId: "sh_a", createdBy: "claude", whatChanged: "Cut the intro" });
    expect(c.short.title).toBe("Tighter");
    expect(c.short.hook).toMatchObject({ text: "Watch this", start: 0, end: 3000 });
    // w00081 is line 9's first word (34000); w00140 ends line 14 (57450).
    expect(c.short.segments).toEqual([{ srcIn: 34_000, srcOut: 57_450 }]);
  });

  it("retries a change to a short other than the reply target, or words outside its window", async () => {
    const provider = scripted([
      { action: "retime_short", shortId: "sh_b", startWord: w(300) },
      { action: "retime_short", shortId: "sh_a", startWord: w(299) },
    ]);
    await expect(
      chatAction(provider, chat({ replyTo: { shortId: "sh_a", version: 2 } }), opts),
    ).rejects.toThrow(/twice/);
    expect(provider.calls[1]!.instruction).toContain(
      "The creator replied to sh_a. Change that short.",
    );
    const second = applyChatAction(
      { action: "retime_short", shortId: "sh_a", startWord: w(299) },
      chat({ replyTo: { shortId: "sh_a", version: 2 } }),
    );
    expect(second.problems[0]!.message).toBe("Word w00299 isn't in the words of sh_a.");
  });

  it("keeps a revised short in the profile's range unless the creator names a length", () => {
    // w00081 to w00100: lines 9 and 10, about 7 s.
    const tiny = {
      action: "revise_short" as const,
      shortId: "sh_a",
      title: "t",
      hookText: "h",
      whatChanged: "w",
      keep: [{ fromWord: w(81), toWord: w(100) }],
    };
    const out = applyChatAction(tiny, chat({ text: "make it punchier" }));
    expect(out.problems[0]!.message).toBe(
      "That short would run 7.5 s. Keep it between 25 s and 40 s, the creator's usual length, since they didn't ask for another.",
    );
    expect(applyChatAction(tiny, chat({ text: "cut it to 8 seconds" })).problems).toEqual([]);
  });

  it("rejects an unknown short id", () => {
    const out = applyChatAction(
      {
        action: "revise_short",
        shortId: "sh_x",
        title: "t",
        hookText: "h",
        whatChanged: "w",
        keep: [{ fromWord: w(1), toWord: w(2) }],
      },
      chat(),
    );
    expect(out.problems[0]!.message).toBe("There's no short sh_x in this stream.");
  });

  it("retime_short moves the start earlier and keeps the hook at the opening", () => {
    // w00051 is line 6's first word, at 22000.
    const out = applyChatAction(
      { action: "retime_short", shortId: "sh_a", startWord: w(51) },
      chat(),
    );
    expect(out.problems).toEqual([]);
    const c = out.result!.kind === "versions" ? out.result!.changes[0]! : null;
    expect(c!.short.segments[0]!.srcIn).toBe(22_000);
    expect(c!.whatChanged).toBe("Starts 4 s earlier.");
    expect(c!.short.hook).toMatchObject({ start: 0, end: 3000 });
    expect(shortDuration(c!.short.segments)).toBe(35_450);
  });

  it("set_style applies a known look to every short, and refuses an unknown one", () => {
    const look = BUILTIN_CAPTION_PRESETS[1]!;
    const out = applyChatAction(
      { action: "set_style", scope: "all", captionPresetId: look.id },
      chat(),
    );
    expect(out.result!.kind).toBe("versions");
    if (out.result!.kind !== "versions") return;
    expect(
      out.result!.changes.map((c) => [c.shortId, c.short.captions.presetId, c.createdBy]),
    ).toEqual([
      ["sh_a", look.id, "user"],
      ["sh_b", look.id, "user"],
    ]);
    const bad = applyChatAction(
      { action: "set_style", scope: "all", captionPresetId: "nope" },
      chat(),
    );
    expect(bad.problems[0]!.message).toBe("There's no caption look nope.");
  });

  it("passes new_shorts, answer and clarify through", () => {
    expect(
      applyChatAction({ action: "new_shorts", request: "boss fight", count: 2 }, chat()).result,
    ).toEqual({
      kind: "new_shorts",
      request: "boss fight",
      count: 2,
    });
    expect(
      applyChatAction({ action: "answer", text: "Because viewers clipped it." }, chat()).result,
    ).toEqual({
      kind: "answer",
      text: "Because viewers clipped it.",
    });
    expect(applyChatAction({ action: "clarify", question: "Which one?" }, chat()).result).toEqual({
      kind: "clarify",
      text: "Which one?",
    });
  });
});
