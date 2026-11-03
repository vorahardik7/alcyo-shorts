// Handlers for every channel in @alcyo/ipc's contract.
import type {
  AppInfo,
  AppPaths,
  Channel,
  LocalAgentId,
  SetupReport,
  WhisperModelName,
} from "@alcyo/ipc";
import type { Downloader } from "../downloader";
import type { StreamService } from "../streams";
import type { HandlerFn } from "./core";

export interface HandlerDeps {
  appInfo(): AppInfo;
  appPaths(): AppPaths | Promise<AppPaths>;
  openDataFolder(): Promise<void>;
  setupCheck(fresh: boolean): Promise<SetupReport>;
  locateAgent(
    id: LocalAgentId,
  ): Promise<{ path: string } | { cancelled: true } | { rejected: true; message: string }>;
  downloadModel(): Promise<{ path: string; name: WhisperModelName }>;
  setApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;
  pingWorker(text: string): Promise<string>;
  now(): number;
  streams: StreamService;
  downloader: Pick<Downloader, "info" | "update" | "useBundled">;
}

type Handlers = { [C in Channel]: HandlerFn<C> };

export function createHandlers(deps: HandlerDeps): Handlers {
  return {
    "app:info": () => deps.appInfo(),
    "app:paths": () => deps.appPaths(),
    "shell:openDataFolder": async () => {
      await deps.openDataFolder();
      return {};
    },
    "setup:check": ({ fresh }) => deps.setupCheck(fresh === true),
    "setup:locateAgent": ({ id }) => deps.locateAgent(id),
    "setup:downloadModel": () => deps.downloadModel(),
    "settings:setApiKey": async ({ key }) => {
      await deps.setApiKey(key);
      return {};
    },
    "settings:clearApiKey": async () => {
      await deps.clearApiKey();
      return {};
    },
    "worker:ping": async ({ text }) => {
      const started = deps.now();
      const reply = await deps.pingWorker(text);
      return { text: reply, ms: Math.max(0, Math.round(deps.now() - started)) };
    },

    "streams:list": () => deps.streams.list(),
    "stream:open": ({ streamId }) => deps.streams.open(streamId),
    "stream:markRead": async ({ streamId }) => {
      await deps.streams.markRead(streamId);
      return {};
    },
    "source:chooseFile": ({ streamId }) => deps.streams.chooseFile(streamId),
    "source:relink": ({ streamId, sourceId }) => deps.streams.relink(streamId, sourceId),
    "analysis:start": ({ streamId, sourceId }) => deps.streams.startAnalysis(streamId, sourceId),
    "link:add": ({ streamId, url }) => deps.streams.addLink(streamId, url),
    "link:answer": async ({ streamId, messageId, choice }) => {
      await deps.streams.answer(streamId, messageId, choice);
      return {};
    },
    "clip:chooseFile": ({ streamId }) => deps.streams.chooseClipFile(streamId),
    "clip:place": ({ streamId, clipId, srcIn }) => deps.streams.placeClip(streamId, clipId, srcIn),
    "downloader:info": () => deps.downloader.info(),
    "downloader:update": () => deps.downloader.update(),
    "downloader:useBundled": () => deps.downloader.useBundled(),
    "job:cancel": async ({ jobId }) => {
      await deps.streams.cancel(jobId);
      return {};
    },
    "thread:messages": ({ streamId, limit, before }) =>
      deps.streams.messages(streamId, limit, before),
    "transcript:window": async ({ streamId, sourceId, fromMs, toMs }) =>
      (await deps.streams.forStream(streamId)).transcriptWindow(sourceId, fromMs, toMs),
    "transcript:search": async ({ streamId, sourceId, query }) =>
      (await deps.streams.forStream(streamId)).searchTranscript(sourceId, query),
    "short:get": async ({ streamId, shortId, version }) => {
      const store = await deps.streams.forStream(streamId);
      const v = await store.version(shortId, version);
      // A draft only applies to the head.
      const draft =
        version === undefined || version === v.version ? await store.draft(shortId) : null;
      return { version: v, draft };
    },
    "short:versions": async ({ streamId, shortId }) =>
      (await deps.streams.forStream(streamId)).versions(shortId),
    "short:saveDraft": async ({ streamId, shortId, short }) => {
      await (await deps.streams.forStream(streamId)).saveDraft(shortId, short);
      return {};
    },
    "short:saveVersion": async ({ streamId, shortId, short, note }) =>
      (await deps.streams.forStream(streamId)).saveVersion(shortId, {
        short,
        note,
        createdBy: "user",
        fromMessageId: null,
      }),
    "short:restore": async ({ streamId, shortId, version }) =>
      (await deps.streams.forStream(streamId)).restore(shortId, version),
  };
}
