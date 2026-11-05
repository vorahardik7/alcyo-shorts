// Handlers for every channel in @alcyo/ipc's contract.
import type {
  AgentSelection,
  AppInfo,
  AppPaths,
  Channel,
  LocalAgentId,
  SetupReport,
  WhisperModelName,
} from "@alcyo/ipc";
import { AGENT_MODELS, type ProviderId } from "@alcyo/schema";
import type { Downloader } from "../downloader";
import type { PlannerService } from "../planner";
import type { ProfileService } from "../profile";
import { type DropBox, EXPIRED } from "../drops";
import type { EditorService } from "../editor";
import type { RenderService } from "../renders";
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
  useAgent(provider: ProviderId): Promise<void>;
  agentSelection(): Promise<AgentSelection>;
  setAgentModel(agent: LocalAgentId, model: string): Promise<void>;
  setApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;
  pingWorker(text: string): Promise<string>;
  now(): number;
  streams: StreamService;
  downloader: Pick<Downloader, "info" | "update" | "useBundled">;
  profile: ProfileService;
  planner: Pick<PlannerService, "state" | "find" | "send" | "cancel">;
  renders: Pick<
    RenderService,
    "enqueue" | "list" | "get" | "cancel" | "retry" | "file" | "preview"
  >;
  drops: Pick<DropBox, "take">;
  editor: Pick<EditorService, "open" | "save" | "restore">;
  /** Shows a file in Finder or Explorer. */
  reveal(path: string): void;
  /** Copies the demo stream in the first time; its id. */
  openDemo(): Promise<string>;
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
    "agent:use": async ({ provider }) => {
      await deps.useAgent(provider);
      return {};
    },
    "agent:get": () => deps.agentSelection(),
    "agent:setModel": async ({ agent, model }) => {
      if (!AGENT_MODELS[agent].models.some((m) => m.id === model)) {
        throw new Error(`${AGENT_MODELS[agent].label} has no model called ${model}.`);
      }
      await deps.setAgentModel(agent, model);
      return {};
    },
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
    "stream:open": async ({ streamId }) => ({
      ...(await deps.streams.open(streamId)),
      planner: await deps.planner.state(streamId),
    }),
    "stream:locate": ({ streamId }) => deps.streams.locate(streamId),
    "demo:open": async () => {
      const streamId = await deps.openDemo();
      const stream = (await deps.streams.list()).find((s) => s.streamId === streamId);
      if (stream === undefined) throw new Error("The demo stream didn't open. Try again.");
      return { stream };
    },
    "stream:markRead": async ({ streamId }) => {
      await deps.streams.markRead(streamId);
      return {};
    },
    "source:chooseFile": ({ streamId, copy }) => deps.streams.chooseFile(streamId, copy),
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
    "profile:get": () => deps.profile.view(),
    "profile:save": ({ profile }) => deps.profile.save(profile),
    "interview:get": () => deps.profile.interview(),
    "interview:start": () => deps.profile.start(),
    "interview:answer": ({ answer, finishNow }) => deps.profile.answer(answer, finishNow === true),
    "interview:finish": ({ captionPresetId }) => deps.profile.finish(captionPresetId),
    "samples:add": () => deps.profile.addSamples(),
    "samples:remove": ({ sampleId }) => deps.profile.removeSample(sampleId),
    "style:write": () => deps.profile.writeStyle(),
    "template:import": () => deps.profile.importTemplate(),
    "template:export": () => deps.profile.exportTemplate(),
    "shorts:find": ({ streamId }) => deps.planner.find(streamId),
    "chat:send": ({ streamId, text, replyTo }) => deps.planner.send(streamId, text, replyTo),
    "render:enqueue": ({ streamId, shortId, version, presetId }) =>
      deps.renders.enqueue(streamId, shortId, {
        ...(version === undefined ? {} : { version }),
        ...(presetId === undefined ? {} : { presetId }),
      }),
    "render:list": () => deps.renders.list(),
    "render:get": ({ streamId, renderId }) => deps.renders.get(streamId, renderId),
    "render:cancel": ({ renderId }) => {
      deps.renders.cancel(renderId);
      return {};
    },
    "render:retry": ({ renderId }) => {
      deps.renders.retry(renderId);
      return {};
    },
    "render:reveal": async ({ streamId, renderId }) => {
      deps.reveal(await deps.renders.file(streamId, renderId));
      return {};
    },
    "job:cancel": async ({ jobId }) => {
      // Agent jobs and queue jobs share one Cancel; each ignores ids it doesn't know.
      if (!deps.planner.cancel(jobId)) await deps.streams.cancel(jobId);
      return {};
    },
    "thread:messages": ({ streamId, limit, before }) =>
      deps.streams.messages(streamId, limit, before),
    "thread:locate": ({ streamId, target }) => deps.streams.locateMessage(streamId, target),
    "transcript:window": async ({ streamId, sourceId, fromMs, toMs }) =>
      (await deps.streams.forStream(streamId)).transcriptWindow(sourceId, fromMs, toMs),
    "transcript:search": async ({ streamId, sourceId, query }) =>
      (await deps.streams.forStream(streamId)).searchTranscript(sourceId, query),
    "short:get": async ({ streamId, shortId, version }) => {
      const store = await deps.streams.forStream(streamId);
      const v = await store.version(shortId, version);
      // A draft only applies to the head.
      const draft =
        version === undefined || version === v.version
          ? await store.draft(shortId, v.version)
          : null;
      return { version: v, draft };
    },
    "short:versions": async ({ streamId, shortId }) =>
      (await deps.streams.forStream(streamId)).versions(shortId),
    "short:preview": ({ streamId, shortId, version }) =>
      deps.renders.preview(streamId, shortId, version),
    "drop:use": async ({ token, streamId, copy }) => {
      const paths = deps.drops.take(token);
      if (paths === null) return { failed: true, message: EXPIRED };
      return deps.streams.useFiles(paths, streamId, copy);
    },
    "short:saveDraft": async ({ streamId, shortId, short, baseVersion }) => {
      await (await deps.streams.forStream(streamId)).saveDraft(shortId, short, baseVersion);
      return {};
    },
    "short:clearDraft": async ({ streamId, shortId, baseVersion }) => {
      await (await deps.streams.forStream(streamId)).clearDraft(shortId, baseVersion);
      return {};
    },
    "short:saveVersion": ({ streamId, shortId, short, note, parent }) =>
      deps.editor.save(streamId, shortId, {
        short,
        note,
        ...(parent === undefined ? {} : { parent }),
      }),
    "editor:open": ({ streamId, shortId, version, range }) =>
      deps.editor.open(streamId, shortId, version, range),
    "short:restore": ({ streamId, shortId, version }) =>
      deps.editor.restore(streamId, shortId, version),
  };
}
