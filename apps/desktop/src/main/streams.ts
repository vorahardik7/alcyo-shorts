// Streams in main: the store, the job queue and the thread's status
// messages, behind the IPC handlers. Electron-free, so it's tested with fakes.
//
// One queue runs every heavy job in order: analysis, downloads, and clip
// checks (quick analysis, then matching to the VOD).
import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { CANT_DOWNLOAD, PLACED_MIN, classifyLink } from "@alcyo/import";
import type {
  AnalysisEvent,
  AnalysisRequest,
  AnalysisResult,
  ClipMatchRequest,
  ClipMatchResult,
  DownloadRequest,
  DownloadResult,
  EventName,
  EventPayload,
  ImportEvent,
  LinkInfoRequest,
  LinkInfoResult,
  StreamDetail,
  StreamSummary,
} from "@alcyo/ipc";
import type { ClipFile, Message, MessageBody, Source } from "@alcyo/schema";
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

type Handle<T> = { done: Promise<T>; cancel: () => void };

export interface AnalysisWorker {
  analyze(
    request: AnalysisRequest,
    onEvent: (event: AnalysisEvent) => void,
  ): Handle<AnalysisResult>;
}

export interface ImportWorker {
  linkInfo(request: LinkInfoRequest): Promise<LinkInfoResult>;
  download(request: DownloadRequest, onEvent: (event: ImportEvent) => void): Handle<DownloadResult>;
  matchClip(request: ClipMatchRequest): Handle<ClipMatchResult>;
}

export interface StreamServiceDeps {
  index: StreamsIndex;
  settings: SettingsFile;
  /** Where new stream folders go when settings don't say. */
  defaultStreamsDir: string;
  worker: () => AnalysisWorker & ImportWorker;
  /** Everything in the request except the paths the store owns. */
  analysisBase: () => Promise<
    Omit<AnalysisRequest, "sourceId" | "sourcePath" | "analysisDir" | "cacheDir">
  >;
  /** The yt-dlp in use (updated or bundled) and the bundled ffmpeg's folder. */
  importBase: () => Promise<{ ytDlp: string; ffmpegDir: string }>;
  chooseVideo: () => Promise<string | null>;
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  /**
   * The transcript is in ("transcript"), or analysis and the clip checks after
   * it are done ("clips"). The planner's one automatic Find shorts listens.
   */
  onReady?: (streamId: string, phase: "transcript" | "clips") => void;
  now?: () => Date;
  log?: (line: string) => void;
}

/** Status updates go to the thread at most this often, unless the stage changes. */
export const STATUS_EVERY_MS = 2000;
export const STATUS_EVERY_PCT = 5;
const PREVIEW_MAX = 120;

export const COPY = {
  permission: "Only download videos you own or have permission to use.",
  playlist:
    "That's a playlist or a clips page. Paste one video or clip link at a time. Picking from a page comes later.",
  hasSource:
    "This stream already has its recording. To work on that video, start a new stream from Home.",
  expired:
    "That question was already answered or has expired. Paste the link again if you need to.",
  waitForVod: "This clip will be placed once the stream's recording is in and analyzed.",
  askChips: ["Use as the stream", "Add as a clip"],
  notVideo: "That isn't a video file. Drop a recording or a clip, like an .mp4 or .mov.",
} as const;

/** File types Alcyo opens, the same as the Choose a file dialog. */
export const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".flv", ".ts"]);

export type LinkChoice = "stream" | "clip";

type LinkVideo = Extract<LinkInfoResult, { kind: "video" }>;
type Status = "running" | "done" | "failed" | "cancelled";

interface Job {
  jobId: string;
  streamId: string;
  /** The source or clip the job works on. */
  targetId: string;
  kind: JobKind;
  messageId: string;
  rev: number;
  cancel: () => void;
  cancelled: boolean;
  started: boolean;
  cancelledLabel: string;
}

type JobKind = "analysis" | "download" | "clip";

interface JobLabels {
  start: string;
  cancelled: string;
  /** Sidebar preview when it fails. */
  stopped: string;
}

type PostStatus = (label: string, pct: number, state: Status) => Promise<unknown>;

function lengthText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s long`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s long`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min long`;
}

export function clockText(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export class StreamService {
  private stores = new Map<string, ProjectStore>();
  private jobs = new Map<string, Job>();
  private chain: Promise<void> = Promise.resolve();
  /** Link questions waiting for an answer, by message id. Gone after a restart. */
  private asks = new Map<string, { streamId: string; url: string; link: LinkVideo }>();
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

  async open(streamId: string): Promise<Omit<StreamDetail, "planner">> {
    const entry = await this.entry(streamId);
    const store = await this.store(streamId);
    return {
      stream: await this.summary(entry),
      project: await store.project(),
      sources: await store.sources(),
      clips: await store.clips(),
      jobs: [...this.jobs.values()]
        .filter((j) => j.streamId === streamId)
        .map((j) => ({ jobId: j.jobId, sourceId: j.targetId })),
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

  async post(
    streamId: string,
    body: MessageBody,
    opts: {
      id?: string;
      rev?: number;
      author?: Message["author"];
      replyTo?: Message["replyTo"];
    } = {},
  ): Promise<Message> {
    const message: Message = {
      id: opts.id ?? newId("m"),
      rev: opts.rev ?? 0,
      at: this.now().toISOString(),
      author: opts.author ?? "app",
      ...(opts.replyTo === undefined ? {} : { replyTo: opts.replyTo }),
      body,
    };
    await (await this.store(streamId)).appendMessage(message);
    this.deps.emit("thread:message", { streamId, message });
    return message;
  }

  private async newStream(name: string): Promise<string> {
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
    return project.streamId;
  }

  /** Choose a file: a new stream named after it (or the given stream), then analysis. */
  async chooseFile(
    streamId?: string,
  ): Promise<{ stream: StreamSummary; jobId: string } | { cancelled: true }> {
    const path = await this.deps.chooseVideo();
    if (path === null) return { cancelled: true };
    return this.addFile(path, streamId);
  }

  /** A file as a new stream (or the given stream's recording), then analysis. */
  async addFile(
    path: string,
    streamId?: string,
  ): Promise<{ stream: StreamSummary; jobId: string }> {
    const id = streamId ?? (await this.newStream(basename(path, extname(path))));
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

  // The queue

  /**
   * Queues a job with one status message. The body posts its own "done"
   * status. A cancel or a thrown error is posted here.
   */
  private async enqueue(
    streamId: string,
    targetId: string,
    kind: JobKind,
    labels: JobLabels,
    body: (job: Job, status: PostStatus) => Promise<void>,
  ): Promise<{ jobId: string }> {
    // The same job for the same target, queued or running, isn't queued twice.
    const same = [...this.jobs.values()].find(
      (j) => j.streamId === streamId && j.targetId === targetId && j.kind === kind,
    );
    if (same !== undefined) return { jobId: same.jobId };
    const job: Job = {
      jobId: newId("job"),
      streamId,
      targetId,
      kind,
      messageId: newId("m"),
      rev: 0,
      cancel: () => undefined,
      cancelled: false,
      started: false,
      cancelledLabel: labels.cancelled,
    };
    this.jobs.set(job.jobId, job);
    const status: PostStatus = (label, pct, state) =>
      this.post(
        streamId,
        { kind: "status", jobId: job.jobId, label, pct, state },
        { id: job.messageId, rev: job.rev++ },
      );
    await status(this.jobs.size > 1 ? "Waiting for the job before it" : labels.start, 0, "running");

    const run = async () => {
      if (job.cancelled) return;
      job.started = true;
      try {
        await body(job, status);
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === "cancelled" || job.cancelled) {
          await status(labels.cancelled, 0, "cancelled");
          await this.touch(streamId, labels.cancelled);
        } else {
          const text = error instanceof Error ? error.message : String(error);
          this.log(`Job ${job.jobId} failed: ${text}`);
          await status(text.length > 0 ? text : `${labels.stopped}.`, 0, "failed");
          await this.touch(streamId, labels.stopped, { unread: true });
        }
      } finally {
        this.jobs.delete(job.jobId);
      }
    };
    this.chain = this.chain.then(run, run);
    return { jobId: job.jobId };
  }

  /** Posts a new status rev when the stage changes, every 5 %, or every 2 s. */
  private throttled(status: PostStatus): {
    update: (stage: string, pct: number) => void;
    flush: () => Promise<unknown>;
  } {
    let last = { at: 0, pct: -100, stage: "" };
    let posting: Promise<unknown> = Promise.resolve();
    return {
      update: (stage, pct) => {
        const t = this.now().getTime();
        if (
          stage !== last.stage ||
          pct - last.pct >= STATUS_EVERY_PCT ||
          t - last.at >= STATUS_EVERY_MS
        ) {
          last = { at: t, pct, stage };
          posting = posting.then(() => status(stage, pct, "running")).catch(() => undefined);
        }
      },
      flush: () => posting,
    };
  }

  /** Queues analysis. One job runs at a time; a status message tracks it. */
  async startAnalysis(streamId: string, sourceId: string): Promise<{ jobId: string }> {
    const store = await this.store(streamId);
    const source = await store.source(sourceId);
    const queued = await this.enqueue(
      streamId,
      sourceId,
      "analysis",
      { start: "Starting analysis", cancelled: "Analysis cancelled", stopped: "Analysis stopped" },
      async (job, status) => {
        const progress = this.throttled(status);
        const request: AnalysisRequest = {
          ...(await this.deps.analysisBase()),
          sourceId,
          sourcePath: source.origin.path,
          analysisDir: store.paths.analysisDir(sourceId),
          cacheDir: store.paths.cacheDir(sourceId),
        };
        const handle = this.deps.worker().analyze(request, (event) => {
          if (event.kind === "step-done" && event.step === "transcript") {
            this.deps.onReady?.(streamId, "transcript");
          }
          if (event.kind !== "progress") return;
          this.deps.emit("job:progress", {
            jobId: job.jobId,
            streamId,
            step: event.step,
            stage: event.stage,
            pct: event.overallPct,
          });
          progress.update(event.stage, event.overallPct);
        });
        job.cancel = handle.cancel;
        if (job.cancelled) handle.cancel();
        let result: AnalysisResult;
        try {
          result = await handle.done;
        } finally {
          await progress.flush();
        }
        await store.applyAnalysis(sourceId, result);
        if (result.encoder !== null && result.encoder !== request.encoder) {
          await this.deps.settings.patch({ encoder: result.encoder });
        }
        const failed = Object.values(result.steps).some((s) => s === "failed");
        const label = failed ? "Analysis finished, with problems" : "Analysis finished";
        await status(label, 100, "done");
        for (const p of result.problems)
          await this.post(streamId, { kind: "text", text: p.message });
        await this.touch(streamId, label, {
          unread: true,
          thumbnail: result.poster === null ? undefined : join(request.cacheDir, result.poster),
        });
        // Clips added before the recording was analyzed can be placed now.
        for (const clip of await store.clips()) {
          if (clip.match === null) await this.checkClip(streamId, clip.clipId);
        }
        // After those checks, which are queued behind this job.
        void this.runExclusive(() => Promise.resolve(this.deps.onReady?.(streamId, "clips")));
      },
    );
    await this.touch(streamId, "Analyzing");
    return queued;
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
      { kind: "status", jobId, label: job.cancelledLabel, pct: 0, state: "cancelled" },
      { id: job.messageId, rev: job.rev++ },
    );
  }

  // Links (plan section 11)

  /**
   * A pasted link. With no stream, the link is read first and a stream is
   * made only when it can be downloaded. Then it becomes the source, a clip,
   * or a question.
   */
  async addLink(
    streamId: string | undefined,
    url: string,
  ): Promise<{ streamId: string } | { failed: true; message: string }> {
    const base = await this.deps.importBase();
    if (streamId === undefined) {
      let link: LinkInfoResult;
      try {
        link = await this.deps.worker().linkInfo({ ...base, url });
      } catch (error) {
        return { failed: true, message: error instanceof Error ? error.message : CANT_DOWNLOAD };
      }
      if (link.kind === "unsupported") return { failed: true, message: CANT_DOWNLOAD };
      if (link.kind === "playlist") return { failed: true, message: COPY.playlist };
      const id = await this.newStream(link.info.title);
      await this.post(id, { kind: "text", text: url }, { author: "user" });
      await this.route(id, url, link);
      return { streamId: id };
    }

    await this.post(streamId, { kind: "text", text: url }, { author: "user" });
    const checkId = newId("m");
    const check = (label: string, state: Status, rev: number) =>
      this.post(
        streamId,
        { kind: "status", jobId: checkId, label, pct: state === "running" ? 0 : 100, state },
        { id: checkId, rev },
      );
    await check("Reading the link", "running", 0);
    let link: LinkInfoResult;
    try {
      link = await this.deps.worker().linkInfo({ ...base, url });
    } catch (error) {
      await check(error instanceof Error ? error.message : CANT_DOWNLOAD, "failed", 1);
      return { streamId };
    }
    if (link.kind !== "video") {
      await check(link.kind === "playlist" ? COPY.playlist : CANT_DOWNLOAD, "failed", 1);
      return { streamId };
    }
    await check(`Found “${link.info.title.slice(0, 80)}”`, "done", 1);
    await this.route(streamId, url, link);
    return { streamId };
  }

  private async route(streamId: string, url: string, link: LinkVideo): Promise<void> {
    const hasSource = (await (await this.store(streamId)).project()).sources.length > 0;
    const role = classifyLink(link, hasSource);
    if (role === "ask") {
      const title = `“${link.info.title.slice(0, 120)}”`;
      const what =
        link.info.durationMs === null
          ? `The link doesn't say how long ${title} is.`
          : `${title} is ${lengthText(link.info.durationMs)}.`;
      const message = await this.post(streamId, {
        kind: "question",
        text: `${what} Use this as the stream, or add it as a clip?`,
        chips: [...COPY.askChips],
      });
      this.asks.set(message.id, { streamId, url, link });
      await this.touch(streamId, "Use this as the stream, or add it as a clip?");
      return;
    }
    if (role === "source" && hasSource) {
      await this.post(streamId, { kind: "text", text: COPY.hasSource });
      return;
    }
    await this.permissionNote(streamId);
    if (role === "source") await this.downloadSource(streamId, url, link);
    else await this.downloadClip(streamId, url, link);
  }

  /** The answer to "Use this as the stream, or add it as a clip?". */
  async answer(streamId: string, messageId: string, choice: LinkChoice): Promise<void> {
    const ask = this.asks.get(messageId);
    if (ask === undefined || ask.streamId !== streamId) {
      await this.post(streamId, { kind: "text", text: COPY.expired });
      return;
    }
    this.asks.delete(messageId);
    await this.post(
      streamId,
      { kind: "text", text: choice === "stream" ? COPY.askChips[0] : COPY.askChips[1] },
      { author: "user" },
    );
    const hasSource = (await (await this.store(streamId)).project()).sources.length > 0;
    if (choice === "stream" && hasSource) {
      await this.post(streamId, { kind: "text", text: COPY.hasSource });
      return;
    }
    await this.permissionNote(streamId);
    if (choice === "stream") await this.downloadSource(streamId, ask.url, ask.link);
    else await this.downloadClip(streamId, ask.url, ask.link);
  }

  private async permissionNote(streamId: string): Promise<void> {
    if ((await this.deps.settings.read()).urlNoteShown) return;
    await this.post(streamId, { kind: "text", text: COPY.permission });
    await this.deps.settings.patch({ urlNoteShown: true });
  }

  private async download(
    job: Job,
    status: PostStatus,
    url: string,
    link: LinkVideo,
    outDir: string,
  ): Promise<DownloadResult> {
    const progress = this.throttled(status);
    await mkdir(outDir, { recursive: true });
    const handle = this.deps
      .worker()
      .download({ ...(await this.deps.importBase()), url, outDir, parts: link.parts }, (event) =>
        progress.update(event.stage, event.pct),
      );
    job.cancel = handle.cancel;
    if (job.cancelled) handle.cancel();
    try {
      return await handle.done;
    } finally {
      await progress.flush();
    }
  }

  private async downloadSource(streamId: string, url: string, link: LinkVideo): Promise<void> {
    const store = await this.store(streamId);
    const sourceId = newId("src");
    await this.enqueue(
      streamId,
      sourceId,
      "download",
      {
        start: "Starting the download",
        cancelled: "Download cancelled",
        stopped: "Download stopped",
      },
      async (job, status) => {
        const got = await this.download(job, status, url, link, store.paths.sourceDir(sourceId));
        await store.addDownloadedSource({
          sourceId,
          url,
          path: got.path,
          info: got.info ?? link.info,
        });
        await status("Downloaded", 100, "done");
        await this.touch(streamId, "Downloaded");
        await this.startAnalysis(streamId, sourceId);
      },
    );
    await this.touch(streamId, "Downloading");
  }

  private async downloadClip(streamId: string, url: string, link: LinkVideo): Promise<void> {
    const store = await this.store(streamId);
    const clipId = newId("clip");
    await this.enqueue(
      streamId,
      clipId,
      "download",
      {
        start: "Starting the clip download",
        cancelled: "Clip download cancelled",
        stopped: "Clip download stopped",
      },
      async (job, status) => {
        const got = await this.download(job, status, url, link, store.paths.clipDir(clipId));
        const info = got.info ?? link.info;
        await store.addClip({
          clipId,
          origin: { kind: "url", url, path: got.path },
          title: info.title.slice(0, 200),
          ...(info.uploader === null ? {} : { clippedBy: info.uploader.slice(0, 100) }),
          durationMs: info.durationMs ?? 0,
        });
        await status("Downloaded the clip", 100, "done");
        await this.checkClip(streamId, clipId);
      },
    );
    await this.touch(streamId, "Downloading a clip");
  }

  /**
   * Dropped files: with no stream, the first becomes a new stream. In a
   * stream without a recording, the first is the recording and the rest are
   * clips; otherwise they're all clips.
   */
  async useFiles(
    paths: readonly string[],
    streamId?: string,
  ): Promise<{ streamId: string } | { failed: true; message: string }> {
    const videos = paths.filter((p) => VIDEO_EXT.has(extname(p).toLowerCase()));
    if (videos.length === 0) {
      return { failed: true, message: COPY.notVideo };
    }
    let id = streamId;
    let rest = videos;
    if (id === undefined || (await (await this.store(id)).project()).sources.length === 0) {
      const added = await this.addFile(videos[0]!, id);
      id = added.stream.streamId;
      rest = videos.slice(1);
    }
    for (const path of rest) await this.addClipFile(id, path);
    return { streamId: id };
  }

  // Clips (plan section 12)

  /** Choose a file as a clip of this stream. It is referenced in place. */
  async chooseClipFile(streamId: string): Promise<{ clipId: string } | { cancelled: true }> {
    const path = await this.deps.chooseVideo();
    if (path === null) return { cancelled: true };
    return this.addClipFile(streamId, path);
  }

  /** A file as a clip of this stream, referenced in place. */
  async addClipFile(streamId: string, path: string): Promise<{ clipId: string }> {
    const store = await this.store(streamId);
    const clipId = newId("clip");
    await store.addClip({
      clipId,
      origin: { kind: "file", path },
      title: basename(path, extname(path)).slice(0, 200),
      durationMs: 0,
    });
    await this.post(streamId, {
      kind: "text",
      text: `Added ${basename(path)} as a clip. It stays where it is; nothing is copied or uploaded.`,
    });
    await this.checkClip(streamId, clipId);
    return { clipId };
  }

  /** Quick analysis of a clip, then matching it to the VOD once there is one. */
  async checkClip(streamId: string, clipId: string): Promise<{ jobId: string }> {
    const store = await this.store(streamId);
    return this.enqueue(
      streamId,
      clipId,
      "clip",
      {
        start: "Checking the clip",
        cancelled: "Clip check cancelled",
        stopped: "Clip check stopped",
      },
      async (job, status) => {
        const clip = await store.clip(clipId);
        const media = ProjectStore.clipMedia(clip);
        if (media === null || !(await exists(media))) {
          throw new Error("The clip's file isn't where it was. Add it again.");
        }
        const progress = this.throttled(status);
        const base = await this.deps.analysisBase();
        const request: AnalysisRequest = {
          ...base,
          mode: "quick",
          sourceId: clipId,
          sourcePath: media,
          analysisDir: store.paths.clipAnalysisDir(clipId),
          cacheDir: store.paths.cacheDir(clipId),
        };
        const analysis = this.deps.worker().analyze(request, (event) => {
          if (event.kind === "progress")
            progress.update(`Clip: ${event.stage}`, event.overallPct * 0.8);
        });
        job.cancel = analysis.cancel;
        if (job.cancelled) analysis.cancel();
        let result: AnalysisResult;
        try {
          result = await analysis.done;
        } finally {
          await progress.flush();
        }
        const clipMs = result.probe.durationMs;
        await store.updateClip(clipId, { durationMs: clipMs });

        const vod = (await store.sources()).find((s) => s.source.probe !== null && !s.missing);
        const vodAudio =
          vod === undefined ? null : join(store.paths.cacheDir(vod.source.sourceId), "audio.wav");
        if (vod === undefined || vodAudio === null || !(await exists(vodAudio)) || clipMs <= 0) {
          await status("Checked the clip", 100, "done");
          await this.post(streamId, { kind: "text", text: COPY.waitForVod });
          return;
        }
        await status("Finding the clip in the stream", 85, "running");
        const vodId = vod.source.sourceId;
        const clipTranscript = join(store.paths.clipAnalysisDir(clipId), "transcript.json");
        const vodTranscript = store.paths.analysis(vodId, "transcript.json");
        const matching = this.deps.worker().matchClip({
          clipAudio: join(store.paths.cacheDir(clipId), "audio.wav"),
          clipTranscript: (await exists(clipTranscript)) ? clipTranscript : null,
          vodAudio,
          vodTranscript: (await exists(vodTranscript)) ? vodTranscript : null,
          clipDurationMs: clipMs,
          vodDurationMs: vod.source.probe!.durationMs,
        });
        job.cancel = matching.cancel;
        if (job.cancelled) matching.cancel();
        const { match } = await matching.done;
        await store.updateClip(clipId, { match });
        const placed = match !== null && match.confidence >= PLACED_MIN;
        const label = placed ? "Placed the clip in the stream" : "Couldn't place the clip";
        // The check mark means the job finished; the clips message says whether it was placed.
        await status(placed ? label : "Checked the clip", 100, "done");
        await this.post(streamId, { kind: "clips", clipIds: [clipId] });
        await this.touch(streamId, label, { unread: true });
      },
    );
  }

  /** Place by hand: the clip starts at srcIn in the VOD. */
  async placeClip(streamId: string, clipId: string, srcIn: number): Promise<ClipFile> {
    const store = await this.store(streamId);
    const clip = await store.clip(clipId);
    const vod = (await store.sources()).find((s) => s.source.probe !== null);
    if (vod === undefined) {
      throw new StoreError("not-found", "Add the stream's recording first, then place the clip.");
    }
    const vodMs = vod.source.probe!.durationMs;
    const srcOut = Math.min(vodMs, srcIn + Math.max(1000, clip.durationMs));
    if (srcIn < 0 || srcOut <= srcIn) {
      throw new StoreError(
        "mismatch",
        `That time is past the end of the stream (${clockText(vodMs)}).`,
      );
    }
    const saved = await store.updateClip(clipId, {
      match: { srcIn, srcOut, confidence: 1, method: "manual" },
    });
    await this.post(streamId, { kind: "clips", clipIds: [clipId] });
    await this.touch(streamId, `Placed ${saved.title ?? "the clip"} by hand`);
    return saved;
  }

  /** Last activity, preview, and optionally unread and thumbnail, then a sidebar refresh. */
  async touch(
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

  /** Runs fn on the job queue, so other work (past shorts) waits its turn too. */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Waits for every queued job, including ones queued while waiting. For tests. */
  async idle(): Promise<void> {
    let seen: Promise<void> | undefined;
    while (seen !== this.chain) {
      seen = this.chain;
      await seen;
    }
  }
}
