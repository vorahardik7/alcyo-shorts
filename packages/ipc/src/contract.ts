// Renderer <-> main contract (plan section 10). Spec 1 has only the channels it
// needs; later specs add the rest of section 10 here.
import { AppLink } from "@alcyo/schema";
import { z } from "zod";
import type { Channel, EventName } from "./names";

export const AppInfo = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.enum(["darwin", "win32", "linux"]),
  arch: z.string(),
  electron: z.string(),
});
export type AppInfo = z.infer<typeof AppInfo>;

export const contract = {
  "app:info": { input: z.object({}), output: AppInfo },
  "worker:ping": {
    input: z.object({ text: z.string().max(1000) }),
    output: z.object({ text: z.string(), ms: z.number().nonnegative() }),
  },
} as const satisfies Record<Channel, { input: z.ZodType; output: z.ZodType }>;

/** Events, main -> renderer. */
export const events = {
  "link:open": z.object({ link: AppLink }),
  "link:invalid": z.object({ message: z.string().max(200) }),
} as const satisfies Record<EventName, z.ZodType>;

export type Contract = typeof contract;
export type ChannelInput<C extends Channel> = z.input<Contract[C]["input"]>;
export type ChannelOutput<C extends Channel> = z.output<Contract[C]["output"]>;
export type EventPayload<E extends EventName> = z.output<(typeof events)[E]>;

/** The shape of window.alcyo, exposed by the preload. */
export interface AlcyoBridge {
  invoke<C extends Channel>(channel: C, input: ChannelInput<C>): Promise<ChannelOutput<C>>;
  on<E extends EventName>(event: E, listener: (payload: EventPayload<E>) => void): () => void;
}
