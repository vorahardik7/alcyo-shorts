// Pure IPC helpers, testable without Electron.
import {
  type Channel,
  type ChannelOutput,
  contract,
  type EventName,
  type EventPayload,
  events,
} from "@alcyo/ipc";
import { z } from "zod";

export type HandlerInput<C extends Channel> = z.output<(typeof contract)[C]["input"]>;
export type HandlerFn<C extends Channel> = (
  input: HandlerInput<C>,
) => ChannelOutput<C> | Promise<ChannelOutput<C>>;

export class IpcError extends Error {
  override name = "IpcError";
}

/**
 * Wraps a handler so its input is parsed with the channel's schema before it
 * runs, and its output is parsed before it goes back to the renderer.
 */
export function makeHandler<C extends Channel>(
  channel: C,
  fn: HandlerFn<C>,
): (raw: unknown) => Promise<ChannelOutput<C>> {
  const spec = contract[channel] as unknown as {
    input: z.ZodType<HandlerInput<C>>;
    output: z.ZodType<ChannelOutput<C>>;
  };
  return async (raw) => {
    const input = spec.input.safeParse(raw);
    if (!input.success) {
      throw new IpcError(`${channel}: bad input. ${z.prettifyError(input.error)}`);
    }
    const output = spec.output.safeParse(await fn(input.data));
    if (!output.success) {
      throw new IpcError(
        `${channel}: the app produced a bad answer. ${z.prettifyError(output.error)}`,
      );
    }
    return output.data;
  };
}

/** Checks an event payload before it's sent to the renderer. */
export function checkEvent<E extends EventName>(
  event: E,
  payload: EventPayload<E>,
): EventPayload<E> {
  return (events[event] as unknown as z.ZodType<EventPayload<E>>).parse(payload);
}

/**
 * True when an IPC sender frame's URL is the app's own page: the dev server's
 * origin in dev, or the bundled index.html file when built.
 */
export function isTrustedSenderUrl(
  senderUrl: string,
  appUrl: string,
  // Windows paths are case-insensitive, and Chromium and Node may disagree on
  // the drive letter's case.
  caseInsensitive = process.platform === "win32",
): boolean {
  let sender: URL;
  let expected: URL;
  try {
    sender = new URL(senderUrl);
    expected = new URL(appUrl);
  } catch {
    return false;
  }
  if (expected.protocol === "file:") {
    const norm = (p: string) => {
      const decoded = decodeURIComponent(p);
      return caseInsensitive ? decoded.toLowerCase() : decoded;
    };
    return sender.protocol === "file:" && norm(sender.pathname) === norm(expected.pathname);
  }
  return sender.origin === expected.origin;
}
