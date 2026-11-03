// The onboarding interview (plan section 13). The agent asks one question at
// a time; code keeps the turns, caps them at 8, fills skipped topics with
// defaults, and checks the draft before it becomes a profile.
import {
  BUILTIN_CAPTION_PRESETS,
  BUILTIN_HOOK_PRESETS,
  type CreatorProfile,
  HOOK_FOR_CAPTION,
  type InterviewDraft,
  type Issue,
} from "@alcyo/schema";

export const MAX_QUESTIONS = 8;
/** A short is never shorter or longer than this, whatever the answer says. */
export const LENGTH_LIMITS = { min: 5_000, max: 180_000 } as const;

export interface InterviewTurn {
  question: string;
  chips: string[];
  /** Null when the creator skipped it. */
  answer: string | null;
}

/** Used for any topic the creator skips or the agent leaves out. */
export const DEFAULT_DRAFT: InterviewDraft = {
  name: "",
  streams: "Live streams",
  audience: "",
  goodMoments: ["funny", "skill", "close-call"],
  lengthMs: { min: 20_000, max: 45_000 },
  titleRules: "Short and punchy. Say what happens.",
  exampleTitles: [],
  avoid: [],
  platforms: ["tiktok", "youtube-shorts", "reels"],
};

const TOPICS = `Cover these topics, one question each, in a natural order:
1. What they stream, and who watches.
2. What makes a moment worth a short for them. Chips can be: funny, skill, rage, wholesome, story, info, close call.
3. How long their shorts usually are. Chips: "15 to 30 s", "30 to 45 s", "45 to 60 s".
4. How they title shorts. Ask them to paste two or three titles they liked.
5. Words, topics or people to keep out of shorts.
6. Where they post. Chips: TikTok, YouTube Shorts, Reels.
Do not ask about captions or fonts; the app asks that itself.`;

const DEFAULTS_TEXT = `If a topic was skipped or left vague, use these defaults:
streams "${DEFAULT_DRAFT.streams}", goodMoments ${JSON.stringify(DEFAULT_DRAFT.goodMoments)},
lengthMs ${JSON.stringify(DEFAULT_DRAFT.lengthMs)}, titleRules "${DEFAULT_DRAFT.titleRules}",
exampleTitles [], avoid [], platforms ${JSON.stringify(DEFAULT_DRAFT.platforms)}.`;

/** The instruction and the input (the turns so far) for the next step. */
export function interviewRequest(
  turns: readonly InterviewTurn[],
  opts: { finishNow?: boolean } = {},
): { instruction: string; input: string } {
  const asked = turns.length;
  const mustFinish = opts.finishNow === true || asked >= MAX_QUESTIONS;
  const instruction = [
    "You are interviewing a streamer to build their creator profile. Alcyo Shorts uses the profile to pick moments from their streams and make vertical shorts.",
    'Ask one short, friendly question at a time as {"kind":"question","text":...,"chips":[...]}. Use up to 6 chips (each under 40 characters) when answers are predictable; otherwise an empty list.',
    "Ask a follow-up only when an answer is too vague to use. Never repeat a question.",
    TOPICS,
    `You may ask at most ${MAX_QUESTIONS} questions in total.`,
    'When you have enough, return {"kind":"done","profile":{...}}. name is the creator\'s or channel\'s name only if they said it, otherwise "". lengthMs is in milliseconds (25 s is 25000). goodMoments use only: funny, skill, rage, wholesome, story, info, close-call. platforms use only: tiktok, youtube-shorts, reels. Write streams, audience and titleRules as short plain sentences in the creator\'s own terms.',
    DEFAULTS_TEXT,
    mustFinish
      ? `You have asked ${asked} questions. Finish now: return kind "done".`
      : `You have asked ${asked} of ${MAX_QUESTIONS} questions.`,
  ].join("\n\n");
  const input =
    turns.length === 0
      ? "No questions yet. Ask the first one."
      : turns
          .map(
            (t, i) =>
              `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer === null ? "(skipped: use the default)" : t.answer}`,
          )
          .join("\n\n");
  return { instruction, input };
}

/** Range checks the schema can't express. Sent back to the agent on a retry. */
export function checkDraft(draft: InterviewDraft): Issue[] {
  const issues: Issue[] = [];
  const { min, max } = draft.lengthMs;
  if (min < LENGTH_LIMITS.min || max > LENGTH_LIMITS.max) {
    issues.push({
      path: "lengthMs",
      message: `Use milliseconds between ${LENGTH_LIMITS.min} and ${LENGTH_LIMITS.max} (25 s is 25000).`,
    });
  }
  if (min > max) issues.push({ path: "lengthMs", message: "min must not be more than max." });
  return issues;
}

/** True when the agent asked a question it already asked. */
export function isRepeat(turns: readonly InterviewTurn[], question: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return turns.some((t) => norm(t.question) === norm(question));
}

function unique<T>(list: readonly T[]): T[] {
  return [...new Set(list)];
}

/**
 * A finished draft to a profile. Empty fields take the defaults, preset ids
 * come from the caption-look pick and must exist, and the style is kept.
 */
export function profileFromDraft(
  draft: InterviewDraft,
  look: { captionPresetId: string; hookPresetId?: string },
  known: { captionIds: readonly string[]; hookIds: readonly string[] },
  style: CreatorProfile["style"] = { summary: "", sampleCount: 0 },
): CreatorProfile {
  const captionPresetId = known.captionIds.includes(look.captionPresetId)
    ? look.captionPresetId
    : BUILTIN_CAPTION_PRESETS[0]!.id;
  const hookWanted = look.hookPresetId ?? HOOK_FOR_CAPTION[captionPresetId];
  const hookPresetId =
    hookWanted !== undefined && known.hookIds.includes(hookWanted)
      ? hookWanted
      : BUILTIN_HOOK_PRESETS[0]!.id;
  const text = (value: string, fallback: string) =>
    value.trim().length > 0 ? value.trim() : fallback;
  const lengthOk = checkDraft(draft).length === 0;
  return {
    schemaVersion: 1,
    name: draft.name.trim().slice(0, 80),
    streams: text(draft.streams, DEFAULT_DRAFT.streams),
    audience: draft.audience.trim(),
    goodMoments:
      draft.goodMoments.length > 0 ? unique(draft.goodMoments) : DEFAULT_DRAFT.goodMoments,
    lengthMs: lengthOk ? draft.lengthMs : DEFAULT_DRAFT.lengthMs,
    titleRules: text(draft.titleRules, DEFAULT_DRAFT.titleRules),
    exampleTitles: unique(
      draft.exampleTitles.map((t) => t.trim()).filter((t) => t.length > 0),
    ).slice(0, 5),
    avoid: unique(draft.avoid.map((t) => t.trim()).filter((t) => t.length > 0)).slice(0, 20),
    platforms: draft.platforms.length > 0 ? unique(draft.platforms) : DEFAULT_DRAFT.platforms,
    captionPresetId,
    hookPresetId,
    style,
  };
}

/** A profile with every default, for someone who skips the whole interview. */
export function defaultProfile(
  look = { captionPresetId: BUILTIN_CAPTION_PRESETS[0]!.id },
): CreatorProfile {
  return profileFromDraft(DEFAULT_DRAFT, look, {
    captionIds: BUILTIN_CAPTION_PRESETS.map((p) => p.id),
    hookIds: BUILTIN_HOOK_PRESETS.map((p) => p.id),
  });
}
