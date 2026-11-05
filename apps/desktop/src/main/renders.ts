// The render queue in main (plan section 23, spec 9). One render at a time,
// across every stream: progress, cancel, retry, a notification, a render
// message in the thread, and a renders/index.json record. ffmpeg runs in the
// worker; background analysis steps wait there while it does.
// Electron-free, so it's tested with fakes.
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { RenderView as RenderViewSchema } from "@alcyo/ipc";
import { z } from "zod";
import type {
  EventName,
  EventPayload,
  RenderEvent,
  RenderRequest,
  RenderResult,
  RenderView,
} from "@alcyo/ipc";
import {
  DEFAULT_RENDER_PRESET,
  RENDER_PRESETS,
  buildAss,
  renderFileName,
  resolveShortStyles,
} from "@alcyo/render";
import { type ShortVersion, type Source } from "@alcyo/schema";
import {
  type ProfileStore,
  ProjectStore,
  StoreError,
  exists,
  newId,
  readJson,
  writeJsonAtomic,
} from "@alcyo/store";
import { playableFile, sourceUrl } from "./media-protocol";
import type { StreamService } from "./streams";

export interface ShortPreview {
  version: ShortVersion;
  /** alcyo-media:// URL of the recording or its proxy. Null while neither plays. */
  src: string | null;
  width: number;
  height: number;
  ass: string;
}

export interface RenderWorker {
  render(
    request: RenderRequest,
    onEvent: (event: RenderEvent) => void,
  ): { done: Promise<RenderResult>; cancel: () => void };
}

export interface RenderServiceDeps {
  streams: Pick<StreamService, "forStream" | "post" | "touch"> &
    Partial<Pick<StreamService, "list">>;
  queuePath?: string;
  profiles: Pick<ProfileStore, "profile" | "presets">;
  worker: () => RenderWorker;
  tools: () => { ffmpeg: string; ffprobe: string; fontsDir: string };
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  /** A system notification. Not shown in headless runs. */
  notify: (title: string, body: string) => void;
  now?: () => Date;
  log?: (line: string) => void;
}

export const COPY = {
  missingSource: "The recording isn't where it was. Locate it, then render again.",
  noVideo: "This recording has no video, so it can't be rendered.",
  notFinished: "This render didn't finish before Alcyo closed. Render it again.",
  failed: "The render stopped before it finished. Try again.",
} as const;

interface Job {
  view: RenderView;
  /** The stream store's renders folder, for the file name. */
  cancel: (() => void) | null;
  cancelled: boolean;
  generation: number;
}

/** Progress events go out at most this often, in percent. */
const EMIT_EVERY_PCT = 1;

function plain(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 300) || COPY.failed;
}

export class RenderService {
  private jobs = new Map<string, Job>();
  private order: string[] = [];
  private chain: Promise<void> = Promise.resolve();
  private persisting: Promise<void> = Promise.resolve();
  private historyHydration: Promise<void> | null = null;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: RenderServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? ((line) => console.error(`[renders] ${line}`));
  }

  /** Only the durable queue is needed before opening the window. */
  async restore(): Promise<void> {
    if (this.deps.queuePath !== undefined) {
      const file = await readJson(
        this.deps.queuePath,
        z.object({ renders: z.array(RenderViewSchema) }),
      );
      // persist() stores newest first; order is maintained oldest first.
      for (const view of [...(file?.renders ?? [])].reverse()) {
        const interrupted = view.state === "queued" || view.state === "running";
        this.jobs.set(view.renderId, {
          view: interrupted
            ? { ...view, state: "failed", pct: 0, message: COPY.notFinished, file: null }
            : view,
          cancel: null,
          cancelled: false,
          generation: 0,
        });
        this.order.push(view.renderId);
      }
    }
    await this.persist();
  }

  /** Older project/MCP history hydrates after the window opens, four projects at a time. */
  hydrateHistory(): Promise<void> {
    this.historyHydration ??= (async () => {
      const entries = (await this.deps.streams.list?.()) ?? [];
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, entries.length) }, async () => {
          for (;;) {
            const entry = entries[next++];
            if (entry === undefined) return;
            if (entry.missing) continue;
            try {
              // The index entry already gives us the folder. Avoid rereading
              // and sorting the full index for every cold forStream() call.
              const store = await ProjectStore.open(entry.folder, this.now);
              for (const record of await store.renders()) {
                const existing = this.jobs.get(record.renderId);
                const interrupted = () =>
                  existing?.view.state === "failed" &&
                  existing.view.message === COPY.notFinished &&
                  existing.generation === 0;
                if (existing !== undefined && !interrupted()) continue;
                const title =
                  existing?.view.title ??
                  (await store
                    .version(record.shortId, record.version)
                    .then((v) => v.short.title)
                    .catch(() => basename(record.file)));
                // A retry or a new job may have changed state while reading.
                if (this.jobs.get(record.renderId) !== existing) continue;
                if (existing !== undefined && !interrupted()) continue;
                const view: RenderView = {
                  renderId: record.renderId,
                  streamId: entry.streamId,
                  shortId: record.shortId,
                  version: record.version,
                  presetId: record.presetId,
                  title,
                  state: "done",
                  pct: 100,
                  file: join(store.paths.renders, record.file),
                  durationMs: record.probe.durationMs,
                  message: null,
                  createdAt: record.createdAt,
                };
                if (existing === undefined) this.order.push(view.renderId);
                const job: Job = { view, cancel: null, cancelled: false, generation: 0 };
                this.jobs.set(view.renderId, job);
                this.changed(job);
              }
            } catch (error) {
              this.log(`Couldn't restore render history: ${plain(error)}`);
            }
          }
        }),
      );
      await this.persist();
    })();
    return this.historyHydration;
  }

  async relocate(streamId: string): Promise<void> {
    const store = await this.deps.streams.forStream(streamId);
    for (const job of this.jobs.values()) {
      if (job.view.streamId !== streamId || job.view.file === null) continue;
      job.view = { ...job.view, file: join(store.paths.renders, basename(job.view.file)) };
      this.changed(job);
    }
    await this.persist();
  }

  private persist(): Promise<void> {
    const path = this.deps.queuePath;
    if (path === undefined) return Promise.resolve();
    const renders = this.list();
    this.persisting = this.persisting
      .catch(() => undefined)
      .then(() => writeJsonAtomic(path, { renders }));
    return this.persisting;
  }

  list(): RenderView[] {
    return [...this.order].reverse().map((id) => this.jobs.get(id)!.view);
  }

  /** A render from this session, or a finished one from renders/index.json. */
  async get(streamId: string, renderId: string): Promise<RenderView | null> {
    const job = this.jobs.get(renderId);
    if (job !== undefined) return job.view;
    const store = await this.deps.streams.forStream(streamId);
    const record = (await store.renders()).find((r) => r.renderId === renderId);
    if (record === undefined) return null;
    const title = await store
      .version(record.shortId, record.version)
      .then((v) => v.short.title)
      .catch(() => basename(record.file));
    return {
      renderId,
      streamId,
      shortId: record.shortId,
      version: record.version,
      presetId: record.presetId,
      title,
      state: "done",
      pct: 100,
      file: join(store.paths.renders, record.file),
      durationMs: record.probe.durationMs,
      message: null,
      createdAt: record.createdAt,
    };
  }

  private changed(job: Job): void {
    this.deps.emit("render:changed", { render: job.view });
  }

  private set(job: Job, patch: Partial<RenderView>): void {
    job.view = { ...job.view, ...patch };
    this.changed(job);
    if (patch.state !== undefined) void this.persist().catch((e: unknown) => this.log(plain(e)));
  }

  /** Queues a render of a version (the head with no version) and posts its message. */
  async enqueue(
    streamId: string,
    shortId: string,
    opts: { version?: number; presetId?: string } = {},
  ): Promise<{ renderId: string }> {
    const store = await this.deps.streams.forStream(streamId);
    const v = await store.version(shortId, opts.version);
    // Check the source now, so a missing file says so before anything is queued.
    await this.sourceFor(store, v);
    const preset = RENDER_PRESETS.find((p) => p.id === opts.presetId) ?? DEFAULT_RENDER_PRESET;
    const renderId = newId("r");
    const job: Job = {
      view: {
        renderId,
        streamId,
        shortId,
        version: v.version,
        presetId: preset.id,
        title: v.short.title,
        state: "queued",
        pct: 0,
        file: null,
        durationMs: null,
        message: null,
        createdAt: this.now().toISOString(),
      },
      cancel: null,
      cancelled: false,
      generation: 0,
    };
    this.jobs.set(renderId, job);
    this.order.push(renderId);
    this.changed(job);
    await this.persist();
    await this.deps.streams.post(streamId, { kind: "render", renderId });
    this.schedule(job);
    return { renderId };
  }

  private schedule(job: Job): void {
    const generation = job.generation;
    const run = () =>
      generation === job.generation
        ? this.run(job, generation).catch((error: unknown) => this.log(plain(error)))
        : Promise.resolve();
    this.chain = this.chain.then(run, run);
  }

  private async sourceFor(store: ProjectStore, v: ShortVersion): Promise<Source> {
    const source = await store.source(v.sourceId);
    if (!(await exists(source.origin.path))) throw new StoreError("missing", COPY.missingSource);
    if (source.probe?.video == null) throw new StoreError("bad-file", COPY.noVideo);
    return source;
  }

  /** The presets and words a version renders with. The preview uses the same. */
  private async looks(store: ProjectStore, v: ShortVersion) {
    const presets = await this.deps.profiles.presets();
    const styles =
      v.short.styles ??
      (await store.freezeStyles(v.shortId, v.version, resolveShortStyles(v.short, presets)));
    const { caption, hook } = styles;
    const from = v.short.segments[0]!.srcIn;
    const to = v.short.segments.at(-1)!.srcOut;
    const words = await store
      .transcript(v.sourceId)
      .then((t) => t.words.filter((w) => w.endMs > from && w.startMs < to))
      .catch(() => []);
    return { caption, hook, words };
  }

  /** What a card or the editor needs to play a version: the media URL and the same .ass the render burns. */
  async preview(streamId: string, shortId: string, version?: number): Promise<ShortPreview> {
    const store = await this.deps.streams.forStream(streamId);
    const v = await store.version(shortId, version);
    const source = await store.source(v.sourceId);
    const video = source.probe?.video ?? null;
    const { caption, hook, words } = await this.looks(store, v);
    const file = await playableFile(store, v.sourceId).catch(() => null);
    return {
      version: v,
      src:
        file === null || video === null
          ? null
          : sourceUrl(streamId, v.sourceId, source.mediaRevision),
      width: video?.width ?? 1920,
      height: video?.height ?? 1080,
      ass: buildAss({ short: v.short, words, caption, hook }),
    };
  }

  private async outPath(store: ProjectStore, title: string, version: number): Promise<string> {
    const preset = DEFAULT_RENDER_PRESET;
    const name = renderFileName(title, version, preset);
    // ffmpeg doesn't make folders.
    await mkdir(store.paths.renders, { recursive: true });
    let path = join(store.paths.renders, name);
    for (let n = 2; await exists(path); n++) {
      path = join(store.paths.renders, name.replace(/\.mp4$/, `-${n}.mp4`));
    }
    return path;
  }

  private async run(job: Job, generation: number): Promise<void> {
    if (job.cancelled || generation !== job.generation) return;
    const { streamId, shortId, version, renderId } = job.view;
    try {
      const store = await this.deps.streams.forStream(streamId);
      const v = await store.version(shortId, version);
      const source = await this.sourceFor(store, v);
      const probe = source.probe!;
      const video = probe.video!;
      const preset =
        RENDER_PRESETS.find((p) => p.id === job.view.presetId) ?? DEFAULT_RENDER_PRESET;
      const { caption, hook, words } = await this.looks(store, v);
      const outPath = await this.outPath(store, v.short.title, v.version);
      const tools = this.deps.tools();
      // Cancel/retry may happen while the queued job is preparing files.
      if (job.cancelled || generation !== job.generation) return;
      this.set(job, { state: "running", pct: 0, message: null, file: null });
      let last = 0;
      const handle = this.deps.worker().render(
        {
          ...tools,
          workDir: join(store.paths.cache, `render-${renderId}`),
          sourcePath: source.origin.path,
          source: {
            width: video.width,
            height: video.height,
            fpsNum: video.fpsNum,
            fpsDen: video.fpsDen,
            hasAudio: probe.audio !== null,
          },
          short: v.short,
          words,
          caption,
          hook,
          presetId: preset.id,
          outPath,
        },
        (event) => {
          if (event.pct - last >= EMIT_EVERY_PCT || event.pct === 100) {
            last = event.pct;
            this.set(job, { pct: event.pct });
          }
        },
      );
      job.cancel = handle.cancel;
      if (job.cancelled) handle.cancel();
      const result = await handle.done;
      await store.addRender({
        renderId,
        shortId,
        version: v.version,
        presetId: preset.id,
        file: basename(outPath),
        createdAt: this.now().toISOString(),
        probe: {
          width: result.width,
          height: result.height,
          durationMs: result.durationMs,
          videoCodec: result.videoCodec,
          audioCodec: result.audioCodec,
        },
      });
      this.set(job, { state: "done", pct: 100, file: outPath, durationMs: result.durationMs });
      await this.deps.streams.touch(streamId, `Rendered “${v.short.title}”`, { unread: true });
      this.deps.notify("Render finished", `“${v.short.title}” is ready.`);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (job.cancelled || code === "cancelled") {
        this.set(job, { state: "cancelled", pct: 0, message: null });
      } else {
        this.log(`Render ${renderId} failed: ${plain(error)}`);
        this.set(job, { state: "failed", pct: 0, message: plain(error) });
        await this.deps.streams
          .touch(streamId, `Render stopped: ${job.view.title}`, { unread: true })
          .catch(() => undefined);
      }
    } finally {
      job.cancel = null;
    }
  }

  cancel(renderId: string): void {
    const job = this.jobs.get(renderId);
    if (job === undefined) return;
    if (job.view.state === "queued") {
      job.cancelled = true;
      job.generation++;
      this.set(job, { state: "cancelled" });
    } else if (job.view.state === "running") {
      job.cancelled = true;
      job.cancel?.();
    }
  }

  retry(renderId: string): void {
    const job = this.jobs.get(renderId);
    if (job === undefined) throw new StoreError("not-found", COPY.notFinished);
    if (job.view.state !== "failed" && job.view.state !== "cancelled") return;
    job.cancelled = false;
    job.generation++;
    this.set(job, { state: "queued", pct: 0, message: null });
    this.schedule(job);
  }

  /** The finished file's path, for Show in Finder. */
  async file(streamId: string, renderId: string): Promise<string> {
    const view = await this.get(streamId, renderId);
    if (view?.file == null || !(await exists(view.file))) {
      throw new StoreError("missing", "That file isn't there anymore. Render the short again.");
    }
    return view.file;
  }

  /** Waits for every queued render. For tests. */
  async idle(): Promise<void> {
    let seen: Promise<void> | undefined;
    while (seen !== this.chain) {
      seen = this.chain;
      await seen;
    }
    await this.persisting;
  }
}
