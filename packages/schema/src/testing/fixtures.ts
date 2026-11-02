// Valid sample values for tests and plan:validate fixtures. Test-only.
import type { ChatAction, ClaudeProposal, InterviewStep } from "../claude.ts";
import type { ClipFile } from "../clip.ts";
import type { Message } from "../message.ts";
import type { CreatorProfile } from "../profile.ts";
import type { PresetFile, Template } from "../presets.ts";
import type { Project, RenderIndex, Settings, StreamsIndex } from "../project.ts";
import type { Draft, Short, ShortFile, ShortVersion } from "../short.ts";
import type { Source } from "../source.ts";
import type { Transcript } from "../transcript.ts";

const SHA = "a".repeat(64);
export const AT = "2026-11-01T12:00:00.000Z";

/** Six words in two lines: "alright we're live" / "no way did you". */
export const transcript: Transcript = {
  schemaVersion: 1,
  sourceId: "src1",
  language: "en",
  model: "small.en",
  words: [
    { id: "w00001", text: "alright", startMs: 1000, endMs: 1400, p: 0.9 },
    { id: "w00002", text: "we're", startMs: 1450, endMs: 1700, p: 0.9 },
    { id: "w00003", text: "live", startMs: 1750, endMs: 2100, p: 0.95 },
    { id: "w00004", text: "no", startMs: 5000, endMs: 5200, p: 0.9 },
    { id: "w00005", text: "way", startMs: 5250, endMs: 5600, p: 0.9 },
    { id: "w00006", text: "did", startMs: 5700, endMs: 5900, p: 0.8 },
    { id: "w00007", text: "you", startMs: 5950, endMs: 6300, p: 0.8 },
  ],
  lines: [
    { id: "L0001", startMs: 1000, endMs: 2100, wordIds: ["w00001", "w00002", "w00003"] },
    { id: "L0002", startMs: 5000, endMs: 6300, wordIds: ["w00004", "w00005", "w00006", "w00007"] },
  ],
};

export const short: Short = {
  title: "HE DID NOT SEE THAT",
  reason: "Chat clipped it three times.",
  segments: [
    { srcIn: 1000, srcOut: 2100 },
    { srcIn: 5000, srcOut: 6300 },
  ],
  crop: { keys: [{ t: 0, x: 0.5, ease: "hold" }] },
  captions: {
    presetId: "bold-pop",
    wordsPerLine: 3,
    overrides: [{ wordId: "w00005", text: "WAY" }],
  },
  hook: { text: "NO WAY", start: 0, end: 1500, presetId: "hook-bold" },
};

export const version: ShortVersion = {
  schemaVersion: 1,
  shortId: "sh1",
  version: 1,
  parent: null,
  createdBy: "claude",
  createdAt: AT,
  fromMessageId: null,
  note: "Claude's proposal",
  sourceId: "src1",
  sourceFingerprint: "fp1",
  short,
};

export const shortFile: ShortFile = {
  schemaVersion: 1,
  shortId: "sh1",
  sourceId: "src1",
  status: "proposed",
  head: 1,
  createdAt: AT,
};

export const draft: Draft = {
  schemaVersion: 1,
  shortId: "sh1",
  sourceId: "src1",
  baseVersion: 1,
  savedAt: AT,
  short,
};

export const source: Source = {
  schemaVersion: 1,
  sourceId: "src1",
  addedAt: AT,
  origin: { kind: "file", path: "/Users/me/Movies/stream.mp4", copied: false },
  fingerprint: {
    sizeBytes: 1_000_000,
    headSha256: SHA,
    tailSha256: SHA,
    durationMs: 10_000,
    layout: "h264 1920x1080 + aac 48000 2ch",
  },
  probe: {
    durationMs: 10_000,
    container: "mov,mp4,m4a,3gp,3g2,mj2",
    video: { codec: "h264", width: 1920, height: 1080, fpsNum: 30, fpsDen: 1 },
    audio: { codec: "aac", sampleRate: 48_000, channels: 2 },
    playsDirectly: true,
  },
  info: null,
};

export const profile: CreatorProfile = {
  schemaVersion: 1,
  name: "Soul",
  streams: "Minecraft hardcore and chat hangouts",
  audience: "Viewers 16 to 24",
  goodMoments: ["funny", "rage", "close-call"],
  lengthMs: { min: 25_000, max: 40_000 },
  titleRules: "Short, caps, no emoji.",
  exampleTitles: ["HE DID NOT SEE THAT"],
  avoid: ["sponsor mentions"],
  platforms: ["tiktok", "youtube-shorts"],
  captionPresetId: "bold-pop",
  hookPresetId: "hook-bold",
  style: { summary: "Opens on the reaction.", firstWordMs: 1500, sampleCount: 12 },
};

export const messages: Message[] = [
  { id: "m1", rev: 0, at: AT, author: "user", body: { kind: "text", text: "find shorts" } },
  {
    id: "m2",
    rev: 1,
    at: AT,
    author: "app",
    body: { kind: "status", jobId: "j1", label: "Transcript", pct: 100, state: "done" },
  },
  {
    id: "m3",
    rev: 0,
    at: AT,
    author: "claude",
    body: { kind: "shorts", intro: "Three picks.", shorts: [{ shortId: "sh1", version: 1 }] },
  },
  {
    id: "m4",
    rev: 0,
    at: AT,
    author: "user",
    replyTo: { shortId: "sh1", version: 1 },
    body: { kind: "text", text: "make it punchier" },
  },
];

export const project: Project = {
  schemaVersion: 1,
  streamId: "st1",
  name: "My Stream",
  createdAt: AT,
  sources: [{ sourceId: "src1" }],
  shorts: [{ shortId: "sh1", head: 1 }],
  clips: ["c1"],
  settings: { copyIntoProject: false },
};

export const clipFile: ClipFile = {
  schemaVersion: 1,
  clipId: "c1",
  origin: { kind: "url", url: "https://clips.twitch.tv/Abc" },
  title: "NO WAY",
  durationMs: 30_000,
  match: { srcIn: 4000, srcOut: 34_000, confidence: 0.92, method: "transcript" },
};

export const presets: PresetFile = {
  schemaVersion: 1,
  captionPresets: [
    {
      id: "bold-pop",
      name: "Bold pop",
      font: "Inter Black",
      sizePx: 88,
      color: "#FFFFFF",
      highlightColor: "#FACC15",
      outlineColor: "#000000",
      outlinePx: 6,
      shadowPx: 0,
      uppercase: true,
      positionY: 0.72,
      wordsPerLine: 3,
      origin: "builtin",
    },
  ],
  hookPresets: [
    {
      id: "hook-bold",
      name: "Bold",
      font: "Inter Black",
      sizePx: 72,
      color: "#000000",
      background: "#FFFFFF",
      uppercase: true,
      positionY: 0.18,
      origin: "builtin",
    },
  ],
};

export const template: Template = {
  schemaVersion: 1,
  kind: "alcyo-template",
  name: "Soul's look",
  captionPresets: presets.captionPresets,
  hookPresets: presets.hookPresets,
  targetLengthMs: { min: 25_000, max: 40_000 },
  safeArea: "tiktok",
};

export const settings: Settings = {
  schemaVersion: 1,
  provider: "claude-cli",
  claudePath: "/Users/me/.local/bin/claude",
  model: "sonnet",
  whisperModel: "small.en",
  encoder: "h264_videotoolbox",
  ytDlp: { version: "2026.10.26", path: null },
  theme: "dark",
};

export const streamsIndex: StreamsIndex = {
  schemaVersion: 1,
  streams: [
    {
      streamId: "st1",
      folder: "/Users/me/Shorts/My Stream.alcyo",
      name: "My Stream",
      thumbnail: null,
      lastActivityAt: AT,
      unread: true,
    },
  ],
};

export const renderIndex: RenderIndex = {
  schemaVersion: 1,
  renders: [
    {
      renderId: "r1",
      shortId: "sh1",
      version: 1,
      presetId: "1080p30",
      file: "HE DID NOT SEE THAT-v1-1080p30.mp4",
      createdAt: AT,
      probe: { width: 1080, height: 1920, durationMs: 2400, videoCodec: "h264", audioCodec: "aac" },
    },
  ],
};

export const proposal: ClaudeProposal = {
  shorts: [
    {
      title: "NO WAY",
      hookText: "He did not see that",
      reason: "Clipped three times",
      startLine: "L0001",
      endLine: "L0002",
    },
  ],
};

export const chatActions: ChatAction[] = [
  {
    action: "revise_short",
    shortId: "sh1",
    title: "NO WAY",
    hookText: "Wait for it",
    whatChanged: "Cut the intro",
    keep: [{ fromWord: "w00004", toWord: "w00007" }],
  },
  { action: "new_shorts", request: "two more about the boss fight", count: 2 },
  { action: "retime_short", shortId: "sh1", startWord: "w00002" },
  { action: "set_style", scope: "all", captionPresetId: "clean" },
  { action: "answer", text: "Because chat clipped it." },
  { action: "clarify", question: "Which one, the first or the second?" },
];

export const interviewSteps: InterviewStep[] = [
  { kind: "question", text: "How long are your shorts usually?", chips: ["15 to 30 s"] },
  {
    kind: "done",
    profile: {
      name: profile.name,
      streams: profile.streams,
      audience: profile.audience,
      goodMoments: profile.goodMoments,
      lengthMs: profile.lengthMs,
      titleRules: profile.titleRules,
      exampleTitles: profile.exampleTitles,
      avoid: profile.avoid,
      platforms: profile.platforms,
      captionPresetId: profile.captionPresetId,
      hookPresetId: profile.hookPresetId,
    },
  },
];
