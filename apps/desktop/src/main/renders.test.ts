import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventName, RenderEvent, RenderRequest, RenderResult } from "@alcyo/ipc";
import * as F from "@alcyo/schema/testing";
import {
  ProfileStore,
  ProjectStore,
  SettingsFile,
  StreamsIndex,
  createStream,
  writeJsonAtomic,
} from "@alcyo/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COPY, RenderService, type RenderServiceDeps } from "./renders";
import { StreamService } from "./streams";

/** A worker whose renders the test finishes, fails or watches being cancelled. */
class FakeWorker {
  jobs: Array<{
    request: RenderRequest;
    emit: (e: RenderEvent) => void;
    finish: () => Promise<void>;
    fail: (message: string) => void;
    cancelled: boolean;
  }> = [];

  render(request: RenderRequest, onEvent: (e: RenderEvent) => void) {
    let resolve!: (r: RenderResult) => void;
    let reject!: (e: unknown) => void;
    const done = new Promise<RenderResult>((a, b) => {
      resolve = a;
      reject = b;
    });
    const job = {
      request,
      emit: onEvent,
      cancelled: false,
      finish: async () => {
        await writeFile(request.outPath, "mp4");
        resolve({
          width: 1080,
          height: 1920,
          durationMs: 4000,
          videoCodec: "h264",
          audioCodec: "aac",
        });
      },
      fail: (message: string) => reject(new Error(message)),
    };
    this.jobs.push(job);
    return {
      done,
      cancel: () => {
        job.cancelled = true;
        reject(Object.assign(new Error("Cancelled."), { code: "cancelled" }));
      },
    };
  }
}

let root: string;
let store: ProjectStore;
let streamId: string;
let worker: FakeWorker;
let renders: RenderService;
let notes: string[];
let events: Array<{ event: EventName; payload: unknown }>;
let shortId: string;
let media: string;
let renderDeps: RenderServiceDeps;

const tick = () => new Promise((r) => setTimeout(r, 10));
async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ok(); i++) await tick();
  expect(ok()).toBe(true);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "alcyo-renders-"));
  const index = new StreamsIndex(root);
  events = [];
  notes = [];
  const streams = new StreamService({
    index,
    settings: new SettingsFile(root, "darwin"),
    defaultStreamsDir: join(root, "Streams"),
    worker: () => {
      throw new Error("not used");
    },
    analysisBase: () => Promise.reject(new Error("not used")),
    importBase: () => Promise.reject(new Error("not used")),
    chooseVideo: () => Promise.resolve(null),
    emit: (event, payload) => events.push({ event, payload }),
  });
  const made = await createStream({ dir: join(root, "Streams"), name: "My Stream" });
  streamId = made.project.streamId;
  await index.upsert({
    streamId,
    folder: made.folder,
    name: "My Stream",
    thumbnail: null,
    lastActivityAt: F.AT,
    unread: false,
    preview: "",
  });
  store = await streams.forStream(streamId);
  media = join(root, "recording.mp4");
  await writeFile(media, "video");
  const source = await store.addFileSource(media);
  await store.applyAnalysis(source.sourceId, {
    probe: { ...F.source.probe!, durationMs: 60_000 },
    fingerprint: { ...F.source.fingerprint },
  });
  await writeJsonAtomic(store.paths.analysis(source.sourceId, "transcript.json"), {
    ...F.transcript,
    sourceId: source.sourceId,
  });
  const v = await store.createShort({
    sourceId: source.sourceId,
    short: F.short,
    createdBy: "claude",
    note: "",
    fromMessageId: null,
  });
  shortId = v.shortId;
  worker = new FakeWorker();
  renderDeps = {
    queuePath: join(root, "render-queue.json"),
    streams,
    profiles: new ProfileStore(root),
    worker: () => worker,
    tools: () => ({ ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe", fontsDir: "/app/fonts" }),
    emit: (event, payload) => events.push({ event, payload }),
    notify: (title, body) => notes.push(`${title}: ${body}`),
    log: () => undefined,
  };
  renders = new RenderService(renderDeps);
});

describe("the render queue", () => {
  it("renders, records it, notifies, and posts a render message", async () => {
    const { renderId } = await renders.enqueue(streamId, shortId);
    await until(() => worker.jobs.length === 1);
    const req = worker.jobs[0]!.request;
    expect(req.outPath).toBe(
      join(
        store.paths.renders,
        `${F.short.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}-v1-1080p30.mp4`,
      ),
    );
    expect(req.workDir.startsWith(store.paths.cache)).toBe(true);
    expect(req.sourcePath).toBe(media);
    expect(req.words.length).toBeGreaterThan(0);
    worker.jobs[0]!.emit({ kind: "render-progress", pct: 50 });
    expect((await renders.get(streamId, renderId))!).toMatchObject({ state: "running", pct: 50 });
    await worker.jobs[0]!.finish();
    await renders.idle();
    const view = (await renders.get(streamId, renderId))!;
    expect(view).toMatchObject({ state: "done", pct: 100, file: req.outPath, durationMs: 4000 });
    expect(await store.renders()).toMatchObject([
      { renderId, shortId, version: 1, presetId: "1080p30" },
    ]);
    expect((await store.shortFile(shortId)).status).toBe("rendered");
    expect(notes).toHaveLength(1);
    expect((await store.messages()).at(-1)!.body).toEqual({ kind: "render", renderId });
    expect(await renders.file(streamId, renderId)).toBe(req.outPath);
  });

  it("runs one render at a time and never overwrites a file", async () => {
    await renders.enqueue(streamId, shortId);
    await renders.enqueue(streamId, shortId);
    await until(() => worker.jobs.length === 1);
    expect(worker.jobs).toHaveLength(1);
    await worker.jobs[0]!.finish();
    await until(() => worker.jobs.length === 2);
    expect(worker.jobs[1]!.request.outPath).toMatch(/-v1-1080p30-2\.mp4$/);
    await worker.jobs[1]!.finish();
    await renders.idle();
    expect(renders.list().map((r) => r.state)).toEqual(["done", "done"]);
  });

  it("cancels running and queued renders, and retries in place", async () => {
    const a = await renders.enqueue(streamId, shortId);
    const b = await renders.enqueue(streamId, shortId);
    await until(() => worker.jobs.length === 1);
    renders.cancel(b.renderId);
    renders.cancel(a.renderId);
    await renders.idle();
    expect(worker.jobs).toHaveLength(1);
    expect(worker.jobs[0]!.cancelled).toBe(true);
    expect(renders.list().map((r) => r.state)).toEqual(["cancelled", "cancelled"]);
    renders.retry(a.renderId);
    await until(() => worker.jobs.length === 2);
    await worker.jobs[1]!.finish();
    await renders.idle();
    expect((await renders.get(streamId, a.renderId))!.state).toBe("done");
  });

  it("shows a failure in plain words", async () => {
    const { renderId } = await renders.enqueue(streamId, shortId);
    await until(() => worker.jobs.length === 1);
    worker.jobs[0]!.fail("The render stopped before it finished. Try again.");
    await renders.idle();
    expect((await renders.get(streamId, renderId))!).toMatchObject({
      state: "failed",
      message: "The render stopped before it finished. Try again.",
    });
    expect(await store.renders()).toEqual([]);
  });

  it("says so when the recording is missing, before queueing", async () => {
    await rm(media);
    await expect(renders.enqueue(streamId, shortId)).rejects.toThrow(COPY.missingSource);
    expect(renders.list()).toEqual([]);
  });

  it("reads finished renders from renders/index.json after a restart", async () => {
    const { renderId } = await renders.enqueue(streamId, shortId);
    await until(() => worker.jobs.length === 1);
    await worker.jobs[0]!.finish();
    await renders.idle();
    const fresh = new RenderService({
      streams: {
        forStream: () => Promise.resolve(store),
        post: () => Promise.reject(new Error()),
        touch: () => Promise.resolve(),
      },
      profiles: new ProfileStore(root),
      worker: () => worker,
      tools: () => ({ ffmpeg: "", ffprobe: "", fontsDir: "" }),
      emit: () => undefined,
      notify: () => undefined,
    });
    expect(await fresh.get(streamId, renderId)).toMatchObject({
      state: "done",
      title: F.short.title,
    });
    expect(await fresh.get(streamId, "r_unknown")).toBeNull();
  });
});

it("restores durable finished history and makes interrupted jobs retryable", async () => {
  const first = await renders.enqueue(streamId, shortId);
  await until(() => worker.jobs.length === 1);
  await worker.jobs[0]!.finish();
  await renders.idle();
  const next = new RenderService(renderDeps);
  await next.restore();
  expect(next.list()).toMatchObject([{ renderId: first.renderId, state: "done" }]);
  const second = await next.enqueue(streamId, shortId);
  await until(() => worker.jobs.length === 2);
  await expect
    .poll(async () => {
      const file = JSON.parse(await readFile(renderDeps.queuePath!, "utf8")) as {
        renders: { renderId: string; state: string }[];
      };
      return file.renders.find((r) => r.renderId === second.renderId)?.state;
    })
    .toBe("running");
  const restarted = new RenderService(renderDeps);
  await restarted.restore();
  expect(restarted.list().find((r) => r.renderId === second.renderId)).toMatchObject({
    state: "failed",
    message: COPY.notFinished,
  });
  next.cancel(second.renderId);
  await next.idle();
});

it("restores the durable queue without accessing project drives", async () => {
  const list = vi.fn(() => Promise.reject(new Error("drive unavailable")));
  const fresh = new RenderService({
    ...renderDeps,
    streams: {
      ...renderDeps.streams,
      forStream: () => Promise.resolve(store),
      post: () => Promise.reject(new Error()),
      touch: () => Promise.resolve(),
      list,
    },
  });
  await fresh.restore();
  expect(list).not.toHaveBeenCalled();
  expect(fresh.list()).toEqual([]);
});

it("hydrates older history in bounded parallel work, emits it and reads the index only once", async () => {
  const record = {
    renderId: "r_external",
    shortId,
    version: 1,
    presetId: "1080p30",
    file: "external.mp4",
    createdAt: F.AT,
    probe: { width: 1080, height: 1920, durationMs: 4000, videoCodec: "h264", audioCodec: "aac" },
  };
  await store.addRender(record);
  const entry = (await renderDeps.streams.list!())[0]!;
  const list = vi.fn(() => Promise.resolve(Array.from({ length: 9 }, () => entry)));
  const forStream = vi.fn(() => Promise.reject(new Error("must reuse the loaded index entry")));
  const fresh = new RenderService({
    ...renderDeps,
    streams: {
      ...renderDeps.streams,
      forStream,
      post: () => Promise.reject(new Error()),
      touch: () => Promise.resolve(),
      list,
    },
  });
  let active = 0;
  let peak = 0;
  let release!: () => void;
  const barrier = new Promise<void>((r) => {
    release = r;
  });
  const open = ProjectStore.open.bind(ProjectStore);
  const spy = vi.spyOn(ProjectStore, "open").mockImplementation(async (...args) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await barrier;
      return await open(...args);
    } finally {
      active--;
    }
  });
  try {
    await fresh.restore();
    expect(spy).not.toHaveBeenCalled();
    const loading = fresh.hydrateHistory();
    expect(fresh.hydrateHistory()).toBe(loading);
    await until(() => active === 4);
    release();
    await loading;
    expect(peak).toBe(4);
    expect(list).toHaveBeenCalledTimes(1);
    expect(forStream).not.toHaveBeenCalled();
    expect(fresh.list()).toMatchObject([{ renderId: "r_external", state: "done" }]);
    expect(events.some((e) => e.event === "render:changed")).toBe(true);
  } finally {
    release();
    spy.mockRestore();
  }
});

it("does not execute a cancelled queued render twice when retried before its turn", async () => {
  await renders.enqueue(streamId, shortId);
  await until(() => worker.jobs.length === 1);
  const queued = await renders.enqueue(streamId, shortId);
  renders.cancel(queued.renderId);
  renders.retry(queued.renderId);
  await worker.jobs[0]!.finish();
  await until(() => worker.jobs.length === 2);
  await worker.jobs[1]!.finish();
  await renders.idle();
  expect(worker.jobs).toHaveLength(2);
});

it("does not replace a retried job with older history arriving in the background", async () => {
  const first = await renders.enqueue(streamId, shortId);
  await until(() => worker.jobs.length === 1);
  await worker.jobs[0]!.finish();
  await renders.idle();
  const saved = renders.list()[0]!;
  await writeJsonAtomic(renderDeps.queuePath!, {
    renders: [{ ...saved, state: "running", file: null, pct: 50 }],
  });
  const fresh = new RenderService(renderDeps);
  await fresh.restore();
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((r) => {
    enter = r;
  });
  const barrier = new Promise<void>((r) => {
    release = r;
  });
  const read = store.renders.bind(store);
  const spy = vi.spyOn(ProjectStore.prototype, "renders").mockImplementation(async () => {
    enter();
    await barrier;
    return read();
  });
  try {
    const history = fresh.hydrateHistory();
    await entered;
    fresh.retry(first.renderId);
    await until(() => worker.jobs.length === 2);
    release();
    await history;
    expect(await fresh.get(streamId, first.renderId)).toMatchObject({ state: "running" });
    await worker.jobs[1]!.finish();
    await fresh.idle();
  } finally {
    release();
    spy.mockRestore();
  }
});

it("does not run an invalidated render that was still preparing when cancelled and retried", async () => {
  let enter!: () => void;
  let release!: () => void;
  const preparing = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const version = store.version.bind(store);
  let calls = 0;
  vi.spyOn(store, "version").mockImplementation(async (...args) => {
    if (++calls === 2) {
      enter();
      await barrier;
    }
    return version(...args);
  });
  const job = await renders.enqueue(streamId, shortId);
  await preparing;
  renders.cancel(job.renderId);
  renders.retry(job.renderId);
  release();
  await until(() => worker.jobs.length === 1);
  await worker.jobs[0]!.finish();
  await renders.idle();
  expect(worker.jobs).toHaveLength(1);
});
