import { describe, expect, it } from "vitest";
import type { z } from "zod";
import * as S from "./index.ts";
import * as F from "./testing/fixtures.ts";

const ok = (schema: z.ZodType, value: unknown) =>
  expect(schema.safeParse(value).success).toBe(true);
const bad = (schema: z.ZodType, value: unknown) =>
  expect(schema.safeParse(value).success).toBe(false);

describe("valid fixtures parse", () => {
  it.each([
    ["Short", S.Short, F.short],
    ["ShortVersion", S.ShortVersion, F.version],
    ["ShortFile", S.ShortFile, F.shortFile],
    ["Draft", S.Draft, F.draft],
    ["Source", S.Source, F.source],
    ["Transcript", S.Transcript, F.transcript],
    ["CreatorProfile", S.CreatorProfile, F.profile],
    ["Project", S.Project, F.project],
    ["ClipFile", S.ClipFile, F.clipFile],
    ["PresetFile", S.PresetFile, F.presets],
    ["Template", S.Template, F.template],
    ["Settings", S.Settings, F.settings],
    ["StreamsIndex", S.StreamsIndex, F.streamsIndex],
    ["RenderIndex", S.RenderIndex, F.renderIndex],
    ["ClaudeProposal", S.ClaudeProposal, F.proposal],
  ] as const)("%s", (_name, schema, value) => {
    expect((schema as z.ZodType).parse(value)).toEqual(value);
  });

  it("every message, chat action and interview step", () => {
    for (const m of F.messages) ok(S.Message, m);
    for (const a of F.chatActions) ok(S.ChatAction, a);
    for (const s of F.interviewSteps) ok(S.InterviewStep, s);
  });

  it("default settings for each OS", () => {
    expect(S.defaultSettings("darwin").whisperModel).toBe("small.en");
    expect(S.defaultSettings("win32").whisperModel).toBe("base.en");
    ok(S.Settings, S.defaultSettings("linux"));
  });
});

describe("times are integer ms", () => {
  it("rejects fractional, negative and string times", () => {
    bad(S.Segment, { srcIn: 1.5, srcOut: 10 });
    bad(S.Segment, { srcIn: -1, srcOut: 10 });
    bad(S.Segment, { srcIn: "0", srcOut: 10 });
    bad(S.CropKey, { t: 0.5, x: 0.5, ease: "hold" });
    bad(S.Word, { id: "w00001", text: "a", startMs: 1, endMs: 2.2, p: 1 });
    bad(S.Probe, { ...F.source.probe, durationMs: 10.5 });
  });
});

describe("section 22 rules", () => {
  it("segments must end after they start", () => {
    bad(S.Segment, { srcIn: 10, srcOut: 10 });
    bad(S.Segment, { srcIn: 10, srcOut: 5 });
    ok(S.Segment, { srcIn: 10, srcOut: 11 });
  });

  it("a short needs a segment and a crop key", () => {
    bad(S.Short, { ...F.short, segments: [] });
    bad(S.Short, { ...F.short, crop: { keys: [] } });
    bad(S.Short, { ...F.short, captions: { ...F.short.captions, wordsPerLine: 5 } });
  });

  it("crop x stays inside 0 to 1, overrides stay in range", () => {
    bad(S.CropKey, { t: 0, x: 1.01, ease: "hold" });
    bad(S.CropKey, { t: 0, x: 0.5, ease: "bounce" });
    bad(S.WordOverride, { wordId: "w1", startDelta: 1001 });
    bad(S.WordOverride, { wordId: "w1", text: "" });
  });

  it("versions are positive, from claude or user, with an ISO time", () => {
    bad(S.ShortVersion, { ...F.version, version: 0 });
    bad(S.ShortVersion, { ...F.version, createdBy: "kiro" });
    bad(S.ShortVersion, { ...F.version, createdAt: "yesterday" });
    bad(S.ShortVersion, { ...F.version, schemaVersion: 2 });
  });

  it("messages: known kinds only, at most 5 shorts", () => {
    bad(S.Message, { ...F.messages[0], body: { kind: "video", url: "x" } });
    bad(S.Message, {
      ...F.messages[2],
      body: {
        kind: "shorts",
        intro: "",
        shorts: Array.from({ length: 6 }, (_, i) => ({ shortId: `s${i}`, version: 1 })),
      },
    });
    bad(S.Message, { ...F.messages[1], body: { ...F.messages[1]!.body, pct: 101 } });
  });

  it("clip origins are an http(s) URL or a path", () => {
    bad(S.Clip, { ...F.clipFile, origin: { kind: "url", url: "file:///etc/passwd" } });
    bad(S.Clip, { ...F.clipFile, origin: { kind: "url", url: "javascript:alert(1)" } });
    bad(S.ClipMatch, { srcIn: 5, srcOut: 5, confidence: 0.5, method: "audio" });
    bad(S.ClipMatch, { srcIn: 1, srcOut: 5, confidence: 1.5, method: "audio" });
  });

  it("Claude answers use ids, never times", () => {
    bad(S.ClaudeProposal, { shorts: [] });
    bad(S.ClaudeProposal, { shorts: [{ ...F.proposal.shorts[0], startLine: "1" }] });
    bad(S.ClaudeProposal, { shorts: [{ ...F.proposal.shorts[0], startLine: 1000 }] });
    bad(S.ChatAction, { action: "run_ffmpeg", args: ["-i", "x"] });
    bad(S.ChatAction, { ...F.chatActions[0], keep: [{ fromWord: "w1", toWord: "w2" }] });
    bad(S.ChatAction, { ...F.chatActions[0], keep: [] });
    bad(S.ChatAction, { action: "new_shorts", request: "x", count: 6 });
    bad(S.InterviewStep, { kind: "question", text: "x", chips: Array(7).fill("a") });
  });

  it("the interview's done profile has no schemaVersion or style", () => {
    const done = F.interviewSteps[1]!;
    expect(S.InterviewStep.parse({ ...done, profile: { ...F.profile } })).toEqual(done);
  });

  it("the profile keeps the section 22 limits", () => {
    bad(S.CreatorProfile, { ...F.profile, goodMoments: ["sad"] });
    bad(S.CreatorProfile, { ...F.profile, platforms: ["twitter"] });
    bad(S.CreatorProfile, { ...F.profile, exampleTitles: Array(6).fill("x") });
  });

  it("presets check colors and sizes", () => {
    const preset = F.presets.captionPresets[0]!;
    bad(S.CaptionPreset, { ...preset, color: "white" });
    bad(S.CaptionPreset, { ...preset, sizePx: 4 });
    ok(S.CaptionPreset, { ...preset, color: "#FFFFFF80" });
    bad(S.Template, { ...F.template, kind: "other" });
  });

  it("sources: a fingerprint needs real hashes, a URL source a URL", () => {
    bad(S.Source, { ...F.source, fingerprint: { ...F.source.fingerprint, headSha256: "x" } });
    bad(S.Source, { ...F.source, origin: { kind: "url", url: "ftp://x", path: "/p" } });
    ok(S.Source, {
      ...F.source,
      origin: { kind: "url", url: "https://www.youtube.com/watch?v=x", path: "media.mp4" },
      info: {
        id: "x",
        title: "My Stream",
        uploader: "Soul",
        uploadDate: "20261030",
        durationMs: 10_000,
        webpageUrl: "https://www.youtube.com/watch?v=x",
        extractor: "youtube",
      },
    });
  });

  it("analysis steps only name known steps", () => {
    ok(S.AnalysisSteps, {
      schemaVersion: 1,
      sourceId: "s",
      steps: { probe: { key: "k", toolVersion: "9.0.2", finishedAt: F.AT } },
    });
    bad(S.AnalysisSteps, {
      schemaVersion: 1,
      sourceId: "s",
      steps: { upload: { key: "k", toolVersion: "1", finishedAt: F.AT } },
    });
  });
});

describe("fields added after the first release", () => {
  it("parse old settings and streams files without them", () => {
    const { streamsDir: _s, ...oldSettings } = F.settings;
    expect(S.Settings.parse(oldSettings).streamsDir).toBeNull();
    const { preview: _p, ...oldEntry } = F.streamsIndex.streams[0]!;
    expect(
      S.StreamsIndex.parse({ schemaVersion: 1, streams: [oldEntry] }).streams[0]!.preview,
    ).toBe("");
  });
});
