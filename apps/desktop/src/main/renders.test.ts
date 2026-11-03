import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventName, RenderEvent, RenderRequest, RenderResult } from "@alcyo/ipc";
import * as F from "@alcyo/schema/testing";
import {
  ProfileStore,
  type ProjectStore,
  SettingsFile,
  StreamsIndex,
  createStream,
  writeJsonAtomic,
} from "@alcyo/store";
import { beforeEach, describe, expect, it } from "vitest";
import { COPY, RenderService } from "./renders";
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
  renders = new RenderService({
    streams,
    profiles: new ProfileStore(root),
    worker: () => worker,
    tools: () => ({ ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe", fontsDir: "/app/fonts" }),
    emit: (event, payload) => events.push({ event, payload }),
    notify: (title, body) => notes.push(`${title}: ${body}`),
    log: () => undefined,
  });
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
