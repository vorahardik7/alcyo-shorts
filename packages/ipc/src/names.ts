// Channel and event names only, with no zod import, so the preload stays tiny.
// contract.test.ts checks these lists match the contract.

export const CHANNELS = [
  "app:info",
  "app:paths",
  "shell:openDataFolder",
  "setup:check",
  "setup:locateAgent",
  "setup:downloadModel",
  "settings:setApiKey",
  "settings:clearApiKey",
  "worker:ping",
  "streams:list",
  "stream:open",
  "stream:markRead",
  "source:chooseFile",
  "source:relink",
  "analysis:start",
  "link:add",
  "link:answer",
  "clip:chooseFile",
  "clip:place",
  "downloader:info",
  "downloader:update",
  "downloader:useBundled",
  "profile:get",
  "profile:save",
  "interview:get",
  "interview:start",
  "interview:answer",
  "interview:finish",
  "samples:add",
  "samples:remove",
  "style:write",
  "template:import",
  "template:export",
  "shorts:find",
  "chat:send",
  "job:cancel",
  "thread:messages",
  "transcript:window",
  "transcript:search",
  "short:get",
  "short:versions",
  "short:saveDraft",
  "short:saveVersion",
  "short:restore",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const EVENTS = [
  "link:open",
  "link:invalid",
  "streams:changed",
  "thread:message",
  "thread:working",
  "job:progress",
  "profile:changed",
  "model:progress",
] as const;
export type EventName = (typeof EVENTS)[number];

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNELS as readonly string[]).includes(value);
}

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && (EVENTS as readonly string[]).includes(value);
}
