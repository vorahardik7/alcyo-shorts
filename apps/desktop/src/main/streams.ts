// Streams in main: the store, the analysis queue and the thread's status
// messages, behind the IPC handlers. Electron-free, so it's tested with fakes.
import { basename, extname, join } from "node:path";
import type {
  AnalysisEvent,
  AnalysisRequest,
  AnalysisResult,
  EventName,
  EventPayload,
  StreamDetail,
  StreamSummary,
} from "@alcyo/ipc";
import type { Message, MessageBody, Source } from "@alcyo/schema";
import {
  ProjectStore,
  type SettingsFile,
  StoreError,
  type StreamEntry,
  type StreamsIndex,
  createStream,
  exists,
  newId,
} from "@alcyo/store";

export interface AnalysisWorker {
  analyze(
    request: AnalysisRequest,
    onEvent: (event: AnalysisEvent) => void,
  ): { done: Promise<AnalysisResult>; cancel: () => void };
}

export interface StreamServiceDeps {
  index: StreamsIndex;
  settings: SettingsFile;
  /** Where new stream folders go when settings don't say. */
  defaultStreamsDir: string;
  worker: () => AnalysisWorker;
  /** Everything in the request except the paths the store owns. */
  analysisBase: () => Promise<
    Omit<AnalysisRequest, "sourceId" | "sourcePath" | "analysisDir" | "cacheDir">
  >;
  chooseVideo: () => Promise<string | null>;
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  now?: () => Date;
  log?: (line: string) => void;
}

/** Status updates go to the thread at most this often, unless the stage changes. */
export const STATUS_EVERY_MS = 2000;
export const STATUS_EVERY_PCT = 5;
const PREVIEW_MAX = 120;

interface Job {
  jobId: string;
  streamId: string;
  sourceId: string;
  messageId: string;
  rev: number;
  cancel: () => void;
  cancelled: boolean;
  started: boolean;
}

export class StreamService {
  private stores = new Map<string, ProjectStore>();
  private jobs = new Map<string, Job>();
  private chain: Promise<void> = Promise.resolve();
  private readonly now: () => Date;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: StreamServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? ((line) => console.error(`[streams] ${line}`));
  }

  private async entry(streamId: string): Promise<StreamEntry> {
    return this.deps.index.get(streamId);
  }

  private async store(streamId: string): Promise<ProjectStore> {
    const cached = this.stores.get(streamId);
    if (cached !== undefined) return cached;
    const entry = await this.entry(streamId);
    const store = await ProjectStore.open(entry.folder, this.now);
    this.stores.set(streamId, store);
    return store;
  }

  private async summary(entry: StreamEntry): Promise<StreamSummary> {
    return { ...entry, missing: !(await exists(entry.folder)) };
  }

  async list(): Promise<StreamSummary[]> {
    return Promise.all((await this.deps.index.list()).map((e) => this.summary(e)));
  }

  async open(streamId: string): Promise<StreamDetail> {
    const entry = await this.entry(streamId);
    const store = await this.store(streamId);
    return {
      stream: await this.summary(entry),
      project: await store.project(),
      sources: await store.sources(),
      jobs: [...this.jobs.values()]
        .filter((j) => j.streamId === streamId)
        .map((j) => ({ jobId: j.jobId, sourceId: j.sourceId })),
    };
  }

  async markRead(streamId: string): Promise<void> {
    const entry = await this.entry(streamId);
    if (!entry.unread) return;
    await this.deps.index.update(streamId, { unread: false });
    this.deps.emit("streams:changed", {});
  }

  private async streamsDir(): Promise<string> {
    return (await this.deps.settings.read()).streamsDir ?? this.deps.defaultStreamsDir;
  }

  private async post(
    streamId: string,
    body: MessageBody,
    opts: { id?: string; rev?: number } = {},
  ): Promise<Message> {
    const message: Message = {
      id: opts.id ?? newId("m"),
      rev: opts.rev ?? 0,
      at: this.now().toISOString(),
      author: "app",
      body,
    };
    await (await this.store(streamId)).appendMessage(message);
    this.deps.emit("thread:message", { streamId, message });
    return message;
  }

  /** Choose a file: a new stream named after it (or the given stream), then analysis. */
  async chooseFile(
    streamId?: string,
  ): Promise<{ stream: StreamSummary; jobId: string } | { cancelled: true }> {
    const path = await this.deps.chooseVideo();
    if (path === null) return { cancelled: true };
    let id = streamId;
    if (id === undefined) {
      const name = basename(path, extname(path));
      const { folder, project } = await createStream({
        dir: await this.streamsDir(),
        name,
        now: this.now(),
      });
      await this.deps.index.upsert({
        streamId: project.streamId,
        folder,
        name: project.name,
        thumbnail: null,
        lastActivityAt: this.now().toISOString(),
        unread: false,
        preview: "",
      });
      id = project.streamId;
    }
    const store = await this.store(id);
    const source = await store.addFileSource(path);
    await this.post(id, {
      kind: "text",
      text: `Added ${basename(path)}. It stays where it is; nothing is copied or uploaded.`,
    });
    const { jobId } = await this.startAnalysis(id, source.sourceId);
    return { stream: await this.summary(await this.entry(id)), jobId };
  }

  async relink(
    streamId: string,
    sourceId: string,
  ): Promise<{ source: Source } | { cancelled: true } | { mismatch: true; message: string }> {
    const path = await this.deps.chooseVideo();
    if (path === null) return { cancelled: true };
    try {
      return { source: await (await this.store(streamId)).relinkSource(sourceId, path) };
    } catch (error) {
      if (error instanceof StoreError && error.code === "mismatch")
        return { mismatch: true, message: error.message };
      throw error;
    }
  }

  /** Queues analysis. One runs at a time; a status message tracks it. */
  async startAnalysis(streamId: string, sourceId: string): Promise<{ jobId: string }> {
    const store = await this.store(streamId);
    const source = await store.source(sourceId);
    const running = [...this.jobs.values()].find(
      (j) => j.streamId === streamId && j.sourceId === sourceId,
    );
    if (running !== undefined) return { jobId: running.jobId };

    const job: Job = {
      jobId: newId("job"),
      streamId,
      sourceId,
      messageId: newId("m"),
      rev: 0,
      cancel: () => undefined,
      cancelled: false,
      started: false,
    };
    this.jobs.set(job.jobId, job);
    const status = (
      label: string,
      pct: number,
      state: "running" | "done" | "failed" | "cancelled",
    ) =>
      this.post(
        streamId,
        { kind: "status", jobId: job.jobId, label, pct, state },
        { id: job.messageId, rev: job.rev++ },
      );

    await status(
      this.jobs.size > 1 ? "Waiting for the analysis before it" : "Starting analysis",
      0,
      "running",
    );
    await this.touch(streamId, "Analyzing");

    const run = async () => {
      if (job.cancelled) return;
      job.started = true;
      let last = { at: 0, pct: -100, stage: "" };
      let posting: Promise<unknown> = Promise.resolve();
      const onEvent = (event: AnalysisEvent) => {
        if (event.kind !== "progress") return;
        this.deps.emit("job:progress", {
          jobId: job.jobId,
          streamId,
          step: event.step,
          stage: event.stage,
          pct: event.overallPct,
        });
        const t = this.now().getTime();
        if (
          event.stage !== last.stage ||
          event.overallPct - last.pct >= STATUS_EVERY_PCT ||
          t - last.at >= STATUS_EVERY_MS
        ) {
          last = { at: t, pct: event.overallPct, stage: event.stage };
          posting = posting
            .then(() => status(event.stage, event.overallPct, "running"))
            .catch(() => undefined);
        }
      };
      try {
        const request: AnalysisRequest = {
          ...(await this.deps.analysisBase()),
          sourceId,
          sourcePath: source.origin.path,
          analysisDir: store.paths.analysisDir(sourceId),
          cacheDir: store.paths.cacheDir(sourceId),
        };
        const handle = this.deps.worker().analyze(request, onEvent);
        job.cancel = handle.cancel;
        if (job.cancelled) handle.cancel();
        const result = await handle.done;
        await posting;
        await store.applyAnalysis(sourceId, result);
        if (result.encoder !== null && result.encoder !== request.encoder) {
          await this.deps.settings.patch({ encoder: result.encoder });
        }
        const failed = Object.values(result.steps).some((s) => s === "failed");
        await status(
          failed ? "Analysis finished, with problems" : "Analysis finished",
          100,
          "done",
        );
        for (const p of result.problems)
          await this.post(streamId, { kind: "text", text: p.message });
        await this.touch(
          streamId,
          failed ? "Analysis finished, with problems" : "Analysis finished",
          {
            unread: true,
            thumbnail: result.poster === null ? undefined : join(request.cacheDir, result.poster),
          },
        );
      } catch (error) {
        await posting;
        const code = (error as { code?: unknown }).code;
        if (code === "cancelled" || job.cancelled) {
          await status("Analysis cancelled", 0, "cancelled");
          await this.touch(streamId, "Analysis cancelled");
        } else {
          const text = error instanceof Error ? error.message : String(error);
          this.log(`Analysis ${job.jobId} failed: ${text}`);
          await status(text.length > 0 ? text : "Analysis stopped.", 0, "failed");
          await this.touch(streamId, "Analysis stopped", { unread: true });
        }
      } finally {
        this.jobs.delete(job.jobId);
      }
    };
    this.chain = this.chain.then(run, run);
    return { jobId: job.jobId };
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job === undefined) return;
    job.cancelled = true;
    if (job.started) {
      job.cancel();
      return;
    }
    // Still queued: it never starts.
    this.jobs.delete(jobId);
    await this.post(
      job.streamId,
      { kind: "status", jobId, label: "Analysis cancelled", pct: 0, state: "cancelled" },
      { id: job.messageId, rev: job.rev++ },
    );
  }

  /** Last activity, preview, and optionally unread and thumbnail, then a sidebar refresh. */
  private async touch(
    streamId: string,
    preview: string,
    extra: { unread?: boolean; thumbnail?: string | undefined } = {},
  ): Promise<void> {
    await this.deps.index.update(streamId, {
      lastActivityAt: this.now().toISOString(),
      preview: preview.slice(0, PREVIEW_MAX),
      ...(extra.unread === undefined ? {} : { unread: extra.unread }),
      ...(extra.thumbnail === undefined ? {} : { thumbnail: extra.thumbnail }),
    });
    this.deps.emit("streams:changed", {});
  }

  // Thread, transcript and shorts: thin passes to the store.

  async messages(streamId: string, limit: number, before?: string): Promise<Message[]> {
    return (await this.store(streamId)).pageMessages(limit, before);
  }

  async forStream(streamId: string): Promise<ProjectStore> {
    return this.store(streamId);
  }

  /** Waits for every queued analysis. For tests. */
  idle(): Promise<void> {
    return this.chain;
  }
}
