// Renderer <-> main contract (plan section 10). Spec 1 has only the channels it
// needs; later specs add the rest of section 10 here.
import {
  AnalysisStepName,
  AppLink,
  ClipFile,
  CreatorProfile,
  Draft,
  Id,
  Message,
  Ms,
  ProviderId,
  Project,
  Short,
  ShortRef,
  ShortVersion,
  Source,
  TranscriptWindow,
  VersionSummary,
} from "@alcyo/schema";
import { z } from "zod";
import type { Channel, EventName } from "./names";
import { InterviewState, ProfileView } from "./profile";
import { RenderView } from "./render";
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

/** The agent working on a stream: Find shorts, or a chat message. */
export const AgentWork = z.object({ jobId: Id, label: z.string().max(120) });
export type AgentWork = z.infer<typeof AgentWork>;

export const StreamDetail = z.object({
  stream: StreamSummary,
  project: Project,
  sources: z.array(z.object({ source: Source, missing: z.boolean() })),
  /** Viewer clips, in the order they were added. */
  clips: z.array(ClipFile),
  /** Jobs running or queued for this stream. sourceId is the source or clip. */
  jobs: z.array(z.object({ jobId: Id, sourceId: Id })),
  planner: z.object({
    /** The transcript is in, so Find shorts and chat can run. */
    ready: z.boolean(),
    working: AgentWork.nullable(),
  }),
});
export type StreamDetail = z.infer<typeof StreamDetail>;

export const LineHit = z.object({ lineId: z.string(), startMs: Ms, endMs: Ms, text: z.string() });
export type LineHit = z.infer<typeof LineHit>;

export const JobRef = z.object({ jobId: Id });

const LinkUrl = z.url({ protocol: /^https?$/ }).max(2000);

export const DownloaderInfo = z.object({
  /** The version in use. */
  version: z.string().max(40).nullable(),
  /** The version bundled with the app. */
  bundled: z.string().max(40).nullable(),
  /** True when an updated copy in userData is in use. */
  updated: z.boolean(),
  path: z.string(),
  /** Set by downloader:update: what happened, in one line. */
  note: z.string().max(200).optional(),
});
export type DownloaderInfo = z.infer<typeof DownloaderInfo>;

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
  /** Which signed-in agent answers. Saved; setup:check then reports it as chosen. */
  "agent:use": { input: z.object({ provider: ProviderId }), output: z.object({}) },
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
  /**
   * A pasted link. With no streamId, the link is read first and a stream is
   * made only when it can be downloaded.
   */
  "link:add": {
    input: z.object({ streamId: Id.optional(), url: LinkUrl }),
    output: z.union([
      z.object({ streamId: Id }),
      z.object({ failed: z.literal(true), message: z.string().max(300) }),
    ]),
  },
  /** The answer to "Use this as the stream, or add it as a clip?". */
  "link:answer": {
    input: StreamRef.extend({ messageId: Id, choice: z.enum(["stream", "clip"]) }),
    output: z.object({}),
  },
  /** A file dialog in main; the file becomes a clip of this stream, referenced in place. */
  "clip:chooseFile": {
    input: StreamRef,
    output: z.union([z.object({ clipId: Id }), z.object({ cancelled: z.literal(true) })]),
  },
  /** Place by hand: where the clip starts in the stream's recording. */
  "clip:place": { input: StreamRef.extend({ clipId: Id, srcIn: Ms }), output: ClipFile },
  "downloader:info": { input: z.object({}), output: DownloaderInfo },
  /** Fetches the newest yt-dlp release and keeps it only if its SHA-256 matches. */
  "downloader:update": { input: z.object({}), output: DownloaderInfo },
  /** Goes back to the yt-dlp bundled with the app. */
  "downloader:useBundled": { input: z.object({}), output: DownloaderInfo },
  "profile:get": { input: z.object({}), output: ProfileView },
  /** Saves edits from Settings, after the schema and range checks. */
  "profile:save": { input: z.object({ profile: CreatorProfile }), output: ProfileView },
  "interview:get": { input: z.object({}), output: InterviewState },
  /** Starts (or restarts) the interview and asks the agent for the first question. */
  "interview:start": { input: z.object({}), output: InterviewState },
  /** An answer, a skip (null), or finish now; the agent asks the next question or finishes. */
  "interview:answer": {
    input: z.object({
      answer: z.string().max(1000).nullable(),
      finishNow: z.boolean().optional(),
    }),
    output: InterviewState,
  },
  /** The caption look; saves the profile from the draft. */
  "interview:finish": { input: z.object({ captionPresetId: Id }), output: ProfileView },
  /** A file dialog in main for past shorts. They are analyzed, never copied. */
  "samples:add": {
    input: z.object({}),
    output: z.union([
      z.object({ added: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() }),
      z.object({ cancelled: z.literal(true) }),
    ]),
  },
  "samples:remove": { input: z.object({ sampleId: Id }), output: ProfileView },
  /** The agent writes the style summary from the past shorts. */
  "style:write": { input: z.object({}), output: ProfileView },
  /** A file dialog in main for an .alcyo-template.json or .ass file. */
  "template:import": {
    input: z.object({}),
    output: z.union([
      z.object({ added: z.number().int().nonnegative(), notes: z.array(z.string().max(300)) }),
      z.object({ cancelled: z.literal(true) }),
    ]),
  },
  /** A save dialog in main; writes the current looks as an Alcyo template. */
  "template:export": {
    input: z.object({}),
    output: z.union([z.object({ path: z.string() }), z.object({ cancelled: z.literal(true) })]),
  },
  /** Asks the agent for shorts. Runs in the background; the result is a shorts message. */
  "shorts:find": { input: StreamRef, output: JobRef },
  /** A chat message: posted, then one checked action from the agent. Runs in turn. */
  "chat:send": {
    input: StreamRef.extend({ text: z.string().min(1).max(4000), replyTo: ShortRef.optional() }),
    output: z.object({ messageId: Id }),
  },
  /** Queues a render of a version (the head with no version). Posts a render message. */
  "render:enqueue": {
    input: ShortInput.extend({
      version: z.number().int().positive().optional(),
      presetId: Id.optional(),
    }),
    output: z.object({ renderId: Id }),
  },
  /** This session's renders, newest first. */
  "render:list": { input: z.object({}), output: z.array(RenderView) },
  /** One render, for its card. Null when it never finished and isn't queued. */
  "render:get": { input: StreamRef.extend({ renderId: Id }), output: RenderView.nullable() },
  "render:cancel": { input: z.object({ renderId: Id }), output: z.object({}) },
  /** Runs a failed or cancelled render again, in place. */
  "render:retry": { input: z.object({ renderId: Id }), output: z.object({}) },
  /** Shows the finished file in Finder or Explorer. Takes no path. */
  "render:reveal": { input: StreamRef.extend({ renderId: Id }), output: z.object({}) },
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
  /** The agent started or stopped working on a stream. */
  "thread:working": z.object({ streamId: Id, working: AgentWork.nullable() }),
  /** A render was queued, moved along, or finished. */
  "render:changed": z.object({ render: RenderView }),
  /** Past shorts moved along, or the profile changed. Reload profile:get. */
  "profile:changed": z.object({}),
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
