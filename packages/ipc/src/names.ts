// Channel and event names only, with no zod import, so the preload stays tiny.
// contract.test.ts checks these lists match the contract.

export const CHANNELS = ["app:info", "worker:ping"] as const;
export type Channel = (typeof CHANNELS)[number];

export const EVENTS = ["link:open", "link:invalid"] as const;
export type EventName = (typeof EVENTS)[number];

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNELS as readonly string[]).includes(value);
}

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && (EVENTS as readonly string[]).includes(value);
}
