// Every ipcMain.handle goes through handle(), which checks the sender and parses
// input and output with the channel's Zod schema.
import {
  type Channel,
  type EventName,
  type EventPayload,
  type PreloadChannel,
  preloadContract,
} from "@alcyo/ipc";
import { z } from "zod";
import { type BrowserWindow, ipcMain, type WebFrameMain } from "electron";
import { checkEvent, type HandlerFn, isTrustedSenderUrl, makeHandler } from "./core";

export function handle<C extends Channel>(
  channel: C,
  fn: HandlerFn<C>,
  appUrl: () => string,
): void {
  const run = makeHandler(channel, fn);
  ipcMain.handle(channel, (event, raw: unknown) => {
    const frame: WebFrameMain | null = event.senderFrame;
    if (frame === null || !isTrustedSenderUrl(frame.url, appUrl())) {
      throw new Error(`${channel}: refused a call from outside the app.`);
    }
    return run(raw);
  });
}

/** Sends a checked event to the window, if it's still open. */
export function sendEvent<E extends EventName>(
  win: BrowserWindow | undefined,
  event: E,
  payload: EventPayload<E>,
): void {
  if (win === undefined || win.isDestroyed()) return;
  win.webContents.send(event, checkEvent(event, payload));
}

/** A preload-only channel: same sender check and Zod parsing, not reachable through window.alcyo. */
export function handlePreload<P extends PreloadChannel>(
  channel: P,
  fn: (input: z.output<(typeof preloadContract)[P]["input"]>) => Promise<void>,
  appUrl: () => string,
): void {
  const spec = preloadContract[channel];
  ipcMain.handle(channel, async (event, raw: unknown) => {
    const frame: WebFrameMain | null = event.senderFrame;
    if (frame === null || !isTrustedSenderUrl(frame.url, appUrl())) {
      throw new Error(`${channel}: refused a call from outside the app.`);
    }
    const input = (
      spec.input as unknown as z.ZodType<z.output<(typeof preloadContract)[P]["input"]>>
    ).safeParse(raw);
    if (!input.success) throw new Error(`${channel}: bad input. ${z.prettifyError(input.error)}`);
    await fn(input.data);
    return {};
  });
}
