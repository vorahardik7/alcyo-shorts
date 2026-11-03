// The creator profile on screen (plan section 13, spec 7): the interview's
// state, the profile with its presets and past shorts, and what's in flight.
import {
  CaptionPreset,
  CreatorProfile,
  HookPreset,
  InterviewStep,
  SampleFile,
} from "@alcyo/schema";
import { z } from "zod";

export const InterviewTurn = z.object({
  question: z.string().max(500),
  chips: z.array(z.string().max(40)).max(6),
  /** Null when skipped. */
  answer: z.string().max(1000).nullable(),
});
export type InterviewTurn = z.infer<typeof InterviewTurn>;

const Draft = InterviewStep.options[1].shape.profile;

/** userData/interview.json, and what the onboarding thread shows. */
export const InterviewState = z.object({
  schemaVersion: z.literal(1),
  /** asking: a question is waiting. look: pick a caption look. done: saved. */
  phase: z.enum(["start", "asking", "look", "done"]),
  turns: z.array(InterviewTurn).max(8),
  question: z
    .object({ text: z.string().max(500), chips: z.array(z.string().max(40)).max(6) })
    .nullable(),
  draft: Draft.nullable(),
  /** The last agent failure, in one line, with Try again on screen. */
  error: z.string().max(300).nullable(),
});
export type InterviewState = z.infer<typeof InterviewState>;

export const PendingSample = z.object({
  sampleId: z.string(),
  fileName: z.string().max(260),
  state: z.enum(["waiting", "analyzing", "failed"]),
  message: z.string().max(300).nullable(),
});
export type PendingSample = z.infer<typeof PendingSample>;

export const ProfileView = z.object({
  profile: CreatorProfile.nullable(),
  captionPresets: z.array(CaptionPreset),
  hookPresets: z.array(HookPreset),
  samples: z.array(SampleFile),
  pending: z.array(PendingSample),
  /** Who answers: "Claude Code", "Grok", "Codex", "API key", or null. */
  agent: z.string().max(40).nullable(),
});
export type ProfileView = z.infer<typeof ProfileView>;
