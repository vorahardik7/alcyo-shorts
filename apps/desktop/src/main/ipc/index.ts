// Every ipcMain.handle goes through handle(), which checks the sender and parses
// input and output with the channel's Zod schema.
import type { Channel, EventName, EventPayload } from "@alcyo/ipc";
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
