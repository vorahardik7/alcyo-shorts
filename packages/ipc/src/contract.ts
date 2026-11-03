// Renderer <-> main contract (plan section 10). Spec 1 has only the channels it
// needs; later specs add the rest of section 10 here.
import {
  AnalysisStepName,
  AppLink,
  Draft,
  Id,
  Message,
  Ms,
  Project,
  Short,
  ShortVersion,
  Source,
  TranscriptWindow,
  VersionSummary,
} from "@alcyo/schema";
import { z } from "zod";
import type { Channel, EventName } from "./names";
import { LocalAgentId, WhisperModelName, SetupReport } from "./setup";

export const AppInfo = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.enum(["darwin", "win32", "linux"]),
  arch: z.string(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
});
export type AppInfo = z.infer<typeof AppInfo>;

/** Folders the app uses. Shown in Settings > Storage. */
export const AppPaths = z.object({
  userData: z.string(),
  models: z.string(),
  bin: z.string(),
  /** Where new stream folders go. */
  streams: z.string(),
});
export type AppPaths = z.infer<typeof AppPaths>;

/** A sidebar row. */
export const StreamSummary = z.object({
  streamId: Id,
  name: z.string(),
  folder: z.string(),
  thumbnail: z.string().nullable(),
  lastActivityAt: z.string(),
  unread: z.boolean(),
  preview: z.string(),
  /** The stream's folder isn't where the index says. */
  missing: z.boolean(),
});
export type StreamSummary = z.infer<typeof StreamSummary>;

export const StreamDetail = z.object({
  stream: StreamSummary,
  project: Project,
  sources: z.array(z.object({ source: Source, missing: z.boolean() })),
  /** Analysis jobs running or queued for this stream. */
  jobs: z.array(z.object({ jobId: Id, sourceId: Id })),
});
export type StreamDetail = z.infer<typeof StreamDetail>;

export const LineHit = z.object({ lineId: z.string(), startMs: Ms, endMs: Ms, text: z.string() });
export type LineHit = z.infer<typeof LineHit>;

export const JobRef = z.object({ jobId: Id });

const StreamRef = z.object({ streamId: Id });
const ShortInput = StreamRef.extend({ shortId: Id });

export const contract = {
  "app:info": { input: z.object({}), output: AppInfo },
  "app:paths": { input: z.object({}), output: AppPaths },
  /** Opens the app's own data folder in Finder or Explorer. Takes no path. */
  "shell:openDataFolder": { input: z.object({}), output: z.object({}) },
  /** The cached setup report, or a new one with fresh: true. */
  "setup:check": {
    input: z.object({ fresh: z.boolean().optional() }),
    output: SetupReport,
  },
  /** Opens a file dialog in main and keeps the path only if that agent runs. */
  "setup:locateAgent": {
    input: z.object({ id: LocalAgentId }),
    output: z.union([
      z.object({ path: z.string() }),
      z.object({ cancelled: z.literal(true) }),
      z.object({ rejected: z.literal(true), message: z.string().max(300) }),
    ]),
  },
  /** Downloads the whisper model for this platform into the models folder. */
  "setup:downloadModel": {
    input: z.object({}),
    output: z.object({ path: z.string(), name: WhisperModelName }),
  },
  /** Stores the backup key with the OS. The renderer never reads it back. */
  "settings:setApiKey": {
    input: z.object({ key: z.string().min(1).max(500) }),
    output: z.object({}),
  },
  "settings:clearApiKey": { input: z.object({}), output: z.object({}) },
  "worker:ping": {
    input: z.object({ text: z.string().max(1000) }),
    output: z.object({ text: z.string(), ms: z.number().nonnegative() }),
  },
  "streams:list": { input: z.object({}), output: z.array(StreamSummary) },
  "stream:open": { input: StreamRef, output: StreamDetail },
  "stream:markRead": { input: StreamRef, output: z.object({}) },
  /**
   * Opens a file dialog in main. With no streamId, makes a new stream named
   * after the file. Starts analysis. The renderer never sends a path.
   */
  "source:chooseFile": {
    input: z.object({ streamId: Id.optional() }),
    output: z.union([
      z.object({ stream: StreamSummary, jobId: Id }),
      z.object({ cancelled: z.literal(true) }),
    ]),
  },
  /** Locate file: a dialog in main; accepts only the same file. */
  "source:relink": {
    input: StreamRef.extend({ sourceId: Id }),
    output: z.union([
      z.object({ source: Source }),
      z.object({ cancelled: z.literal(true) }),
      z.object({ mismatch: z.literal(true), message: z.string() }),
    ]),
  },
  "analysis:start": { input: StreamRef.extend({ sourceId: Id }), output: JobRef },
  "job:cancel": { input: JobRef, output: z.object({}) },
  "thread:messages": {
    input: StreamRef.extend({ before: Id.optional(), limit: z.number().int().min(1).max(200) }),
    output: z.array(Message),
  },
  "transcript:window": {
    input: StreamRef.extend({ sourceId: Id, fromMs: Ms, toMs: Ms }),
    output: TranscriptWindow,
  },
  "transcript:search": {
    input: StreamRef.extend({ sourceId: Id, query: z.string().max(200) }),
    output: z.array(LineHit),
  },
  /** A version (the head with no version), plus a newer autosaved draft if there is one. */
  "short:get": {
    input: ShortInput.extend({ version: z.number().int().positive().optional() }),
    output: z.object({ version: ShortVersion, draft: Draft.nullable() }),
  },
  "short:versions": { input: ShortInput, output: z.array(VersionSummary) },
  "short:saveDraft": { input: ShortInput.extend({ short: Short }), output: z.object({}) },
  "short:saveVersion": {
    input: ShortInput.extend({ short: Short, note: z.string().max(200) }),
    output: ShortVersion,
  },
  "short:restore": {
    input: ShortInput.extend({ version: z.number().int().positive() }),
    output: ShortVersion,
  },
} as const satisfies Record<Channel, { input: z.ZodType; output: z.ZodType }>;

/** Events, main -> renderer. */
export const events = {
  "link:open": z.object({ link: AppLink }),
  "link:invalid": z.object({ message: z.string().max(200) }),
  /** The sidebar list changed: a stream was added, renamed, read or got news. */
  "streams:changed": z.object({}),
  /** A new message, or a new rev of one (status updates). */
  "thread:message": z.object({ streamId: Id, message: Message }),
  "job:progress": z.object({
    jobId: Id,
    streamId: Id,
    step: AnalysisStepName,
    stage: z.string(),
    pct: z.number().min(0).max(100),
  }),
  "model:progress": z.object({
    received: z.number().int().nonnegative(),
    total: z.number().int().positive().nullable(),
  }),
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
