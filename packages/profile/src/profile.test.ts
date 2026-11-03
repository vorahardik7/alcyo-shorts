import {
  BUILTIN_CAPTION_PRESETS,
  BUILTIN_HOOK_PRESETS,
  CreatorProfile,
  type SampleFile,
  Template,
} from "@alcyo/schema";
import * as F from "@alcyo/schema/testing";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRAFT,
  MAX_QUESTIONS,
  checkDraft,
  defaultProfile,
  interviewRequest,
  isRepeat,
  profileFromDraft,
} from "./interview.ts";
import { measurePastShort, styleNumbers } from "./measures.ts";
import { styleFrom, styleRequest } from "./style.ts";
import { assColor, exportTemplate, importTemplate, parseAss } from "./templates.ts";
import { profileText } from "./text.ts";

const known = {
  captionIds: BUILTIN_CAPTION_PRESETS.map((p) => p.id),
  hookIds: BUILTIN_HOOK_PRESETS.map((p) => p.id),
};

describe("interview", () => {
  const turn = (i: number) => ({
    question: `Question ${i}?`,
    chips: [],
    answer: i % 2 ? null : "yes",
  });

  it("lists the turns, marks skips, and makes the agent finish at 8", () => {
    const three = interviewRequest([turn(1), turn(2), turn(3)]);
    expect(three.input).toContain("A1: (skipped: use the default)");
    expect(three.input).toContain("A2: yes");
    expect(three.instruction).toContain("You have asked 3 of 8 questions.");
    const eight = interviewRequest(Array.from({ length: MAX_QUESTIONS }, (_, i) => turn(i + 1)));
    expect(eight.instruction).toContain('Finish now: return kind "done".');
    expect(interviewRequest([], { finishNow: true }).instruction).toContain("Finish now");
    expect(interviewRequest([]).input).toBe("No questions yet. Ask the first one.");
    expect(isRepeat([turn(1)], "question 1")).toBe(true);
  });

  it("checks lengths given in seconds or the wrong way round", () => {
    expect(checkDraft(DEFAULT_DRAFT)).toEqual([]);
    expect(checkDraft({ ...DEFAULT_DRAFT, lengthMs: { min: 25, max: 40 } })[0]?.message).toContain(
      "25 s is 25000",
    );
    expect(checkDraft({ ...DEFAULT_DRAFT, lengthMs: { min: 50_000, max: 30_000 } })).toHaveLength(
      1,
    );
  });

  it("fills empty answers with defaults and takes preset ids from the look, not the agent", () => {
    const p = profileFromDraft(
      { ...DEFAULT_DRAFT, streams: " ", goodMoments: [], exampleTitles: ["A", "A", " "] },
      { captionPresetId: "punch" },
      known,
    );
    expect(CreatorProfile.parse(p)).toEqual(p);
    expect(p.streams).toBe(DEFAULT_DRAFT.streams);
    expect(p.goodMoments).toEqual(DEFAULT_DRAFT.goodMoments);
    expect(p.exampleTitles).toEqual(["A"]);
    expect([p.captionPresetId, p.hookPresetId]).toEqual(["punch", "hook-plain"]);
    const missing = profileFromDraft(DEFAULT_DRAFT, { captionPresetId: "gone" }, known);
    expect(missing.captionPresetId).toBe("bold-pop");
    expect(defaultProfile().lengthMs).toEqual(DEFAULT_DRAFT.lengthMs);
  });
});

const word = (id: number, text: string, startMs: number, endMs: number) => ({
  id: `w${String(id).padStart(5, "0")}`,
  text,
  startMs,
  endMs,
  p: 0.9,
});

describe("measures", () => {
  const transcript = {
    ...F.transcript,
    words: [
      word(1, "No", 600, 800),
      word(2, "way.", 800, 1100),
      word(3, "He", 1500, 1700),
      word(4, "missed", 1700, 2100),
      word(5, "it", 2100, 2600),
    ],
    lines: [],
  };

  it("measures a short from its analysis", () => {
    const { measures, opening } = measurePastShort({
      durationMs: 20_000,
      transcript,
      silences: {
        schemaVersion: 1,
        sourceId: "s",
        silences: [
          { startMs: 0, endMs: 600 },
          { startMs: 1100, endMs: 1500 },
          { startMs: 3000, endMs: 3200 },
        ],
      },
      scenes: { schemaVersion: 1, sourceId: "s", cutsMs: [5000, 10_000, 15_000] },
      loudness: { schemaVersion: 1, sourceId: "s", integratedLufs: -14.04, momentary: [] },
    });
    expect(measures).toEqual({
      lengthMs: 20_000,
      firstWordMs: 600,
      firstSentence: "No way.",
      wordsPerSecond: 2.5,
      cutEveryMs: 5000,
      // Only the 400 ms pause counts: the first starts at 0 and one is too short.
      pausesPer10s: 0.5,
      loudnessLufs: -14,
    });
    expect(opening).toBe("No way. He missed it");
  });

  it("handles a short with no speech or analysis", () => {
    const { measures } = measurePastShort({
      durationMs: 12_000,
      transcript: null,
      silences: null,
      scenes: null,
      loudness: null,
    });
    expect(measures).toMatchObject({ firstWordMs: null, wordsPerSecond: null, cutEveryMs: 12_000 });
  });
});

const sample = (i: number, firstWordMs: number, wps: number, cut: number): SampleFile => ({
  schemaVersion: 1,
  sampleId: `smp_${i}`,
  fileName: `/Users/me/Movies/short ${i}.mp4`,
  addedAt: F.AT,
  measures: {
    lengthMs: 30_000,
    firstWordMs,
    firstSentence: `Opening line ${i}.`,
    wordsPerSecond: wps,
    cutEveryMs: cut,
    pausesPer10s: 1,
    loudnessLufs: -14,
  },
  opening: `Opening line ${i}. more words`,
});

describe("style", () => {
  const samples = [sample(1, 400, 3, 2000), sample(2, 1200, 3.4, 3000), sample(3, 800, 2.6, 2500)];

  it("keeps the medians as targets", () => {
    expect(styleNumbers(samples)).toEqual({
      firstWordMs: 800,
      wordsPerSecond: 3,
      cutEveryMs: 2500,
      sampleCount: 3,
    });
    expect(styleFrom("  Opens fast. ", samples).summary).toBe("Opens fast.");
  });

  it("sends openings and numbers as text, never file names", () => {
    const { input } = styleRequest(samples);
    expect(input).toContain("From 3 past shorts.");
    expect(input).toContain("A cut every 2.5 s.");
    expect(input).toContain('Short 2 opens: "Opening line 2."');
    expect(input).not.toContain("/Users/");
    expect(input).not.toContain(".mp4");
  });
});

describe("profileText", () => {
  it("is the section 13 text block, with no paths or media", () => {
    const text = profileText({ ...F.profile, style: { ...F.profile.style, cutEveryMs: 2400 } });
    expect(text).toBe(
      [
        "# Creator profile",
        "Streams: Soul: Minecraft hardcore and chat hangouts. Viewers: Viewers 16 to 24",
        "Good moments: funny, rage, close calls.",
        'Length: 25 to 40 s. Titles: Short, caps, no emoji. Examples: "HE DID NOT SEE THAT"',
        "Avoid: sponsor mentions.",
        "Posts to: TikTok, YouTube Shorts.",
        "Style from 12 past shorts: Opens on the reaction. Targets: first word within 1.5 s; a cut every 2.4 s.",
      ].join("\n"),
    );
    // Text only: printable characters and newlines, nothing that looks like a path.
    expect(text).toMatch(/^[\x20-\x7E\n]*$/);
    expect(text).not.toMatch(/\/Users\/|[A-Z]:\\|\.mp4|\.wav|bold-pop/);
  });
});

const ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Anton,96,&H00FFFFFF,&H0015CCFA,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,40,40,480,1
Style: Hook Title,Comic Sans MS,80,&H00000000,&H00FFFFFF,&H00000000,&H00FFFFFF,-1,0,0,0,100,100,0,0,3,0,0,8,40,40,300,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

describe("templates", () => {
  it("reads .ass colors as BGR", () => {
    expect(assColor("&H0015CCFA")).toBe("#FACC15");
    expect(assColor("&HFFFFFF&")).toBe("#FFFFFF");
    expect(assColor("nope")).toBeNull();
  });

  it("turns [V4+ Styles] into caption and hook presets, with a font fallback note", () => {
    const got = parseAss(ASS, "Soul look.ass");
    expect(got.captionPresets).toEqual([
      {
        id: "ass-soul-look-ass-default",
        name: "Default",
        font: "Anton",
        sizePx: 96,
        color: "#FFFFFF",
        highlightColor: "#FACC15",
        outlineColor: "#000000",
        outlinePx: 6,
        shadowPx: 2,
        uppercase: false,
        positionY: 0.7,
        wordsPerLine: 3,
        origin: "ass",
      },
    ]);
    expect(got.hookPresets[0]).toMatchObject({
      name: "Hook Title",
      font: "Inter",
      background: "#FFFFFF",
      positionY: 0.21,
    });
    expect(got.notes).toEqual(["Comic Sans MS isn't bundled, so Inter is used instead."]);
    expect(parseAss("[Events]\n", "x").notes[0]).toContain("no [V4+ Styles]");
  });

  it("exports and re-imports a template with unique ids", () => {
    const t = exportTemplate("Soul's look", F.presets, F.profile);
    expect(Template.parse(t)).toEqual(t);
    expect(t).toMatchObject({ targetLengthMs: F.profile.lengthMs, safeArea: "tiktok" });
    const back = importTemplate(JSON.parse(JSON.stringify(t)));
    expect(back.captionPresets[0]).toMatchObject({
      id: "t-soul-s-look-bold-pop",
      origin: "template",
    });
    expect(() => importTemplate({ kind: "something else" })).toThrow();
  });
});
