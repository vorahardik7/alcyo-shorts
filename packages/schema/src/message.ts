// One line of thread/messages.jsonl (plan section 22). Status messages update
// by appending the same id with a higher rev.
import { z } from "zod";
import { Id, IsoDateTime } from "./primitives.ts";
import { ShortRef } from "./short.ts";

export const MessageBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().max(4000) }),
  z.object({
    kind: z.literal("status"),
    jobId: Id,
    label: z.string(),
    pct: z.number().min(0).max(100),
    state: z.enum(["running", "done", "failed", "cancelled"]),
  }),
  z.object({
    kind: z.literal("shorts"),
    intro: z.string().max(1000),
    shorts: z.array(ShortRef).min(1).max(5),
  }),
  z.object({ kind: z.literal("version"), ref: ShortRef, whatChanged: z.string().max(300) }),
  z.object({ kind: z.literal("render"), renderId: Id }),
  z.object({ kind: z.literal("clips"), clipIds: z.array(Id) }),
  z.object({
    kind: z.literal("question"),
    text: z.string().max(500),
    chips: z.array(z.string().max(40)).max(6),
  }),
]);
export type MessageBody = z.infer<typeof MessageBody>;

export const Message = z.object({
  id: Id,
  rev: z.number().int().nonnegative(),
  at: IsoDateTime,
  author: z.enum(["user", "claude", "app"]),
  replyTo: ShortRef.optional(),
  body: MessageBody,
});
export type Message = z.infer<typeof Message>;
