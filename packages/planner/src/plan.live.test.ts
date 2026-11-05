// Find shorts and a chat edit, live, on a real stream's words. Off by default:
// each run is several real, billed requests.
//   ALCYO_LIVE_GROK=1 ALCYO_LIVE_WORDS=<words.json> pnpm --filter @alcyo/planner exec vitest run src/plan.live.test.ts
// Needs ALCYO_LIVE_WORDS=<path to words.json> (YouTube word times for a
// 4.7-hour VOD; local only, never in the repo).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
import { chatAction } from "./chat-actions";
import { type PlanInputs, findShorts } from "./find-shorts";
import { clock } from "./lines";
import { grokProvider } from "./llm/grok-cli";
import type { LlmProvider, LlmRequest } from "./llm/provider";
import { realSpawnDeps } from "./llm/spawn";

const grok = process.env["ALCYO_GROK_PATH"] ?? join(homedir(), ".local", "bin", "grok");
const words = process.env["ALCYO_LIVE_WORDS"] ?? "";
const live = process.env["ALCYO_LIVE_GROK"] === "1" && existsSync(grok) && existsSync(words);

/** YouTube's [startMs, text] pairs -> words and lines of at most 12 s, split at gaps. */
function fromYouTube(pairs: [number, string][]): Transcript {
  const ws: Word[] = [];
  const clean = pairs
    .map(([t, text]) => [t, text.replace(/^>>\s*/, "").trim()] as const)
    .filter(([, text]) => text.length > 0 && !/^\[.*\]$/.test(text));
  clean.forEach(([t, text], i) => {
    const next = clean[i + 1]?.[0] ?? t + 400;
    ws.push({
      id: `w${String(i + 1).padStart(5, "0")}`,
      text,
      startMs: t,
      endMs: Math.max(t + 1, Math.min(next, t + 600)),
      p: 0.9,
    });
  });
  const lines: Line[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    lines.push({
      id: `L${String(lines.length + 1).padStart(4, "0")}`,
      startMs: cur[0]!.startMs,
      endMs: cur.at(-1)!.endMs,
      wordIds: cur.map((w) => w.id),
    });
    cur = [];
  };
  for (const w of ws) {
    const first = cur[0];
    const last = cur.at(-1);
    if (
      first !== undefined &&
      (w.endMs - first.startMs > 12_000 || w.startMs - last!.endMs > 700)
    ) {
      flush();
    }
    cur.push(w);
    if (/[.?!]$/.test(w.text) && cur.length >= 6) flush();
  }
  flush();
  return { schemaVersion: 1, sourceId: "rook", language: "en", model: "youtube", words: ws, lines };
}

function inputs(): PlanInputs {
  const transcript = fromYouTube(JSON.parse(readFileSync(words, "utf8")) as [number, string][]);
  const silences = [];
  for (let i = 1; i < transcript.words.length; i++) {
    const a = transcript.words[i - 1]!;
    const b = transcript.words[i]!;
    if (b.startMs - a.endMs >= 300) silences.push({ startMs: a.endMs, endMs: b.startMs });
  }
  return {
    transcript,
    sourceDurationMs: 16_918_000,
    silences,
    clips: [],
    profile: {
      ...defaultProfile(),
      streams: "Hip-hop reaction streams: new drops, battles and beefs, with chat",
      goodMoments: ["funny", "rage", "story"],
      lengthMs: { min: 25_000, max: 45_000 },
      titleRules: "Short and punchy, all caps for the key word. Say what happens.",
    },
    presets: { captionPresets: BUILTIN_CAPTION_PRESETS, hookPresets: BUILTIN_HOOK_PRESETS },
    stream: {
      name: "EX WARCURY & JU PETER TONIGHT",
      durationMs: 16_918_000,
      site: "youtube.com",
      uploaded: "2026-10-21",
      clipsMatched: 0,
    },
  };
}

/** Grok, with each call's size and time logged. */
function counted(): LlmProvider & { calls: number } {
  const inner = grokProvider(grok, realSpawnDeps(), {
    model: "grok-4.7-build-fast",
    effort: "medium",
  });
  const out = {
    name: inner.name,
    calls: 0,
    complete: async (req: LlmRequest) => {
      out.calls++;
      const t = Date.now();
      try {
        return await inner.complete(req);
      } finally {
        console.log(`call ${out.calls}: ${req.input.length} chars in, ${Date.now() - t} ms`);
      }
    },
  };
  return out;
}

const opts = {
  model: "sonnet",
  signal: new AbortController().signal,
  log: (line: string) => console.log(line),
};

describe.skipIf(!live)("planner, live with Grok on a real VOD", () => {
  let found: ShortVersion[] = [];

  it("finds three shorts in one call", { timeout: 300_000 }, async () => {
    const i = inputs();
    const provider = counted();
    const shorts = await findShorts(provider, i, opts);
    expect(shorts).toHaveLength(3);
    for (const s of shorts) {
      const len = shortDuration(s.segments);
      console.log(
        `${clock(s.segments[0]!.srcIn)} ${Math.round(len / 1000)} s "${s.title}" / "${s.hook?.text}" / ${s.reason}`,
      );
      expect(len).toBeGreaterThanOrEqual(23_000);
      expect(len).toBeLessThanOrEqual(47_000);
    }
    found = shorts.map((short, n) => ({
      schemaVersion: 1,
      shortId: `sh_${n + 1}`,
      version: 1,
      parent: null,
      createdBy: "claude",
      createdAt: new Date().toISOString(),
      fromMessageId: null,
      note: "",
      sourceId: "rook",
      sourceFingerprint: "x",
      short,
    }));
  });

  it(
    "a reply asking for a tighter cut becomes revise_short or retime_short",
    { timeout: 300_000 },
    async () => {
      expect(found.length).toBeGreaterThan(0);
      const provider = counted();
      const result = await chatAction(
        provider,
        {
          ...inputs(),
          shorts: found,
          messages: [],
          text: "make this one punchier, cut the slow start",
          replyTo: { shortId: found[0]!.shortId, version: 1 },
        },
        opts,
      );
      console.log(
        JSON.stringify(
          result.kind === "versions"
            ? result.changes.map((c) => ({
                ...c,
                short: { title: c.short.title, segments: c.short.segments },
              }))
            : result,
        ),
      );
      expect(result.kind).toBe("versions");
      if (result.kind !== "versions") return;
      expect(result.changes[0]!.shortId).toBe(found[0]!.shortId);
      expect(shortDuration(result.changes[0]!.short.segments)).toBeLessThanOrEqual(
        shortDuration(found[0]!.short.segments),
      );
    },
  );

  it("windows the stream when told to, then picks", { timeout: 900_000 }, async () => {
    const provider = counted();
    const shorts = await findShorts(provider, inputs(), {
      ...opts,
      maxTokens: 30_000,
      windowTokens: 20_000,
      overlapTokens: 1_000,
    });
    console.log(`${provider.calls} calls`);
    expect(provider.calls).toBeGreaterThan(2);
    expect(shorts).toHaveLength(3);
    for (const s of shorts) console.log(`${clock(s.segments[0]!.srcIn)} "${s.title}"`);
  });
});
