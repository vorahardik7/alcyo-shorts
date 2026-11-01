// alcyo:// link intake: argv parsing, the pending queue, and the event to send.
// Pure, so it's testable without Electron.
import type { EventName, EventPayload } from "@alcyo/ipc";
import { BAD_LINK_MESSAGE, LINK_SCHEME, parseAppLink } from "@alcyo/schema";

const PREFIX = `${LINK_SCHEME}://`;

/**
 * Finds the alcyo:// link in a process argv. On Windows the link arrives as an
 * argument, on first launch and in `second-instance`, possibly after
 * Chromium switches.
 */
export function findLinkInArgv(argv: readonly string[]): string | undefined {
  return argv.find((arg) => arg.slice(0, PREFIX.length).toLowerCase() === PREFIX);
}

export type LinkEvent =
  | { event: Extract<EventName, "link:open">; payload: EventPayload<"link:open"> }
  | { event: Extract<EventName, "link:invalid">; payload: EventPayload<"link:invalid"> };

/** Turns a received URL into the event the renderer gets. */
export function linkEvent(url: string): LinkEvent {
  const link = parseAppLink(url);
  return link === null
    ? { event: "link:invalid", payload: { message: BAD_LINK_MESSAGE } }
    : { event: "link:open", payload: { link } };
}

const MAX_PENDING = 20;

/** Holds links that arrive before the window is ready, then delivers them in order. */
export class LinkQueue {
  private pending: string[] = [];
  private deliver: ((url: string) => void) | undefined;

  push(url: string): void {
    if (this.deliver !== undefined) {
      this.deliver(url);
      return;
    }
    this.pending.push(url);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
  }

  attach(deliver: (url: string) => void): void {
    this.deliver = deliver;
    for (const url of this.pending.splice(0)) deliver(url);
  }

  detach(): void {
    this.deliver = undefined;
  }
}
