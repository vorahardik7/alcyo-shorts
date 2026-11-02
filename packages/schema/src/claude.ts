// What Claude may answer (plan sections 16, 17 and 22): line ids, word ids and
// one action from a fixed list. Never times, never commands. Code checks every
// answer with these schemas and checks.ts.
import { z } from "zod";
import { Id, LineId, WordId } from "./primitives.ts";
import { CreatorProfile } from "./profile.ts";

/** Find shorts. */
export const ClaudeProposal = z.object({
  shorts: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        hookText: z.string().min(1).max(80),
        reason: z.string().min(1).max(300),
        startLine: LineId,
        endLine: LineId,
      }),
    )
    .min(1)
    .max(5),
});
export type ClaudeProposal = z.infer<typeof ClaudeProposal>;
export type ProposalShort = ClaudeProposal["shorts"][number];

export const KeepRange = z.object({ fromWord: WordId, toWord: WordId });
export type KeepRange = z.infer<typeof KeepRange>;

/** One chat message becomes one of these. */
export const ChatAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("revise_short"),
    shortId: Id,
    title: z.string().min(1).max(80),
    hookText: z.string().min(1).max(80),
    whatChanged: z.string().min(1).max(300),
    keep: z.array(KeepRange).min(1),
  }),
  z.object({
    action: z.literal("new_shorts"),
    request: z.string().max(300),
    count: z.number().int().min(1).max(5),
  }),
  z.object({
    action: z.literal("retime_short"),
    shortId: Id,
    startWord: WordId.optional(),
    endWord: WordId.optional(),
  }),
  z.object({
    action: z.literal("set_style"),
    scope: z.enum(["short", "all"]),
    shortId: Id.optional(),
    captionPresetId: Id.optional(),
    hookPresetId: Id.optional(),
  }),
  z.object({ action: z.literal("answer"), text: z.string().min(1).max(2000) }),
  z.object({ action: z.literal("clarify"), question: z.string().min(1).max(500) }),
]);
export type ChatAction = z.infer<typeof ChatAction>;

/** Onboarding interview: the next question, or the finished profile draft. */
export const InterviewStep = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("question"),
    text: z.string().max(500),
    chips: z.array(z.string().max(40)).max(6),
  }),
  z.object({
    kind: z.literal("done"),
    profile: CreatorProfile.omit({ schemaVersion: true, style: true }),
  }),
]);
export type InterviewStep = z.infer<typeof InterviewStep>;

const toJson = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" });

/**
 * JSON Schemas passed to `claude -p --json-schema` and to the API provider's
 * tool input. They only shape the answer; Zod and checks.ts check it after.
 */
export const claudeJsonSchemas = {
  proposal: toJson(ClaudeProposal),
  chatAction: toJson(ChatAction),
  interviewStep: toJson(InterviewStep),
} as const;
