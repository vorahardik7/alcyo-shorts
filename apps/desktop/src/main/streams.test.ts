import { rename, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANT_DOWNLOAD } from "@alcyo/import";
import type {
  AnalysisEvent,
  AnalysisRequest,
  AnalysisResult,
  ClipMatchRequest,
  ClipMatchResult,
  DownloadRequest,
  DownloadResult,
  EventName,
  ImportEvent,
  LinkInfoResult,
} from "@alcyo/ipc";
import type { Message } from "@alcyo/schema";
import * as F from "@alcyo/schema/testing";
import { createStream, SettingsFile, StreamsIndex, writeJsonAtomic } from "@alcyo/store";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type AnalysisWorker,
  COPY,
  type ImportWorker,
  StreamService,
  type StreamServiceDeps,
} from "./streams";

const probe = {
  durationMs: 10_000,
  container: "mov,mp4",
  video: { codec: "h264", width: 1920, height: 1080, fpsNum: 60, fpsDen: 1 },
  audio: { codec: "aac", sampleRate: 48000, channels: 2 },
  playsDirectly: true,
};

function result(req: AnalysisRequest, extra: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    sourceId: req.sourceId,
    probe,
    fingerprint: {
      sizeBytes: 5,
      headSha256: "a".repeat(64),
      tailSha256: "b".repeat(64),
      durationMs: 10_000,
      layout: "v",
    },
    steps: { probe: "done", transcript: "done" },
    problems: [],
    poster: "thumbs-002.jpg",
    encoder: "h264_videotoolbox",
    ...extra,
  };
}

const linkVideo = (durationMs: number | null, over: { isClip?: boolean; title?: string } = {}) =>
  ({
    kind: "video",
    isClip: over.isClip ?? false,
    parts: 2,
    info: {
      id: "v1",
      title: over.title ?? "Rook42 Boss Rush",
      uploader: "Rook42",
      uploadDate: "20261030",
      durationMs,
      webpageUrl: "https://www.youtube.com/watch?v=v1",
      extractor: "Youtube",
    },
  }) as const;

/** A worker whose jobs are driven by the test. */
class FakeWorker implements AnalysisWorker, ImportWorker {
  link: LinkInfoResult = { kind: "unsupported" };
  match: ClipMatchResult["match"] = null;
  matchRequests: ClipMatchRequest[] = [];
  downloads: Array<{
    request: DownloadRequest;
    emit: (e: ImportEvent) => void;
    finish: () => Promise<void>;
    cancelled: boolean;
  }> = [];

  linkInfo(): Promise<LinkInfoResult> {
    return Promise.resolve(this.link);
  }

  download(request: DownloadRequest, onEvent: (e: ImportEvent) => void) {
    let resolve!: (r: DownloadResult) => void;
    let reject!: (e: unknown) => void;
    const done = new Promise<DownloadResult>((a, b) => {
      resolve = a;
      reject = b;
    });
    const job = {
      request,
      emit: onEvent,
      cancelled: false,
      finish: async () => {
        const path = join(request.outDir, "media.mp4");
        await writeFile(path, "downloaded");
        resolve({ path, info: null });
      },
    };
    this.downloads.push(job);
    return {
      done,
      cancel: () => {
        job.cancelled = true;
        void rm(request.outDir, { recursive: true, force: true }).then(() =>
          reject(Object.assign(new Error("The download was cancelled."), { code: "cancelled" })),
        );
      },
    };
  }

  matchClip(request: ClipMatchRequest) {
    this.matchRequests.push(request);
    return { done: Promise.resolve({ match: this.match }), cancel: () => undefined };
  }

  jobs: Array<{
    request: AnalysisRequest;
    emit: (e: AnalysisEvent) => void;
    finish: (r?: Partial<AnalysisResult>) => void;
    fail: (e: Error & { code?: string }) => void;
    cancelled: boolean;
  }> = [];
  analyze(request: AnalysisRequest, onEvent: (e: AnalysisEvent) => void) {
    let resolve!: (r: AnalysisResult) => void;
    let reject!: (e: unknown) => void;
    const done = new Promise<AnalysisResult>((a, b) => {
      resolve = a;
      reject = b;
    });
    const job = {
      request,
      emit: onEvent,
      finish: (r: Partial<AnalysisResult> = {}) => resolve(result(request, r)),
      fail: (e: Error) => reject(e),
      cancelled: false,
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

const progress = (pct: number, stage = "Transcribing"): AnalysisEvent => ({
  kind: "progress",
  step: "transcript",
  stage,
  pct,
  overallPct: pct,
});

const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await tick();
  expect(check()).toBe(true);
}

let root: string;
let video: string;
let worker: FakeWorker;
let service: StreamService;
let events: Array<{ event: EventName; payload: unknown }>;
let clock: number;
let chosen: string | null;
let settings: SettingsFile;
let index: StreamsIndex;
let deps: StreamServiceDeps;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "alcyo-service-"));
  video = join(root, "Rook42 stream.mp4");
  await writeFile(video, "video");
  worker = new FakeWorker();
  events = [];
  clock = Date.parse("2026-11-01T12:00:00.000Z");
  chosen = video;
  settings = new SettingsFile(join(root, "userData"), "darwin");
  index = new StreamsIndex(join(root, "userData"));
  deps = {
    index,
    settings,
    defaultStreamsDir: join(root, "Streams"),
    worker: () => worker,
    analysisBase: async () => ({
      tools: { ffmpeg: "/b/ffmpeg", ffprobe: "/b/ffprobe", whisper: "/b/whisper-cli" },
      toolVersions: { ffmpeg: "9.0.2", whisper: "1.9.5" },
      model: null,
      vadModel: "/b/models/silero.bin",
      mode: "full",
      encoder: (await settings.read()).encoder,
      threads: 4,
    }),
    chooseVideo: () => Promise.resolve(chosen),
    importBase: () => Promise.resolve({ ytDlp: "/b/yt-dlp", ffmpegDir: "/b" }),
    emit: (event, payload) => events.push({ event, payload }),
    now: () => new Date(clock),
    log: () => undefined,
  };
  service = new StreamService(deps);
});

const statuses = (messages: Message[]) =>
  messages.flatMap((m) => (m.body.kind === "status" ? [m.body] : []));

describe("StreamService", () => {
  it("chooses a file, makes a stream named after it, and runs analysis to the end", async () => {
    const out = await service.chooseFile();
    if ("cancelled" in out) throw new Error("cancelled");
    expect(out.stream).toMatchObject({ name: "Rook42 stream", missing: false });
    expect(out.stream.folder).toBe(join(root, "Streams", "Rook42 stream.alcyo"));
    await until(() => worker.jobs.length === 1);

    const job = worker.jobs[0]!;
    expect(job.request.sourcePath).toBe(video);
    expect(job.request.analysisDir).toContain(join("Rook42 stream.alcyo", "sources"));
    job.emit(progress(10));
    job.finish();
    await service.idle();

    const detail = await service.open(out.stream.streamId);
    expect(detail.sources[0]!.source.probe).toEqual(probe);
    expect(detail.jobs).toEqual([]);
    const messages = await service.messages(out.stream.streamId, 50);
    expect(messages[0]!.body).toMatchObject({ kind: "text" });
    expect(statuses(messages)).toEqual([
      {
        kind: "status",
        jobId: out.jobId,
        label: "Analysis finished",
        pct: 100,
        state: "done",
        jobKind: "analysis",
        targetId: detail.sources[0]!.source.sourceId,
      },
    ]);
    const [entry] = await service.list();
    expect(entry).toMatchObject({ unread: true, preview: "Analysis finished" });
    expect(entry!.thumbnail).toMatch(/thumbs-002\.jpg$/);
    expect((await settings.read()).encoder).toBe("h264_videotoolbox");
    expect(events.some((e) => e.event === "streams:changed")).toBe(true);
  });

  it("does nothing when the dialog is cancelled", async () => {
    chosen = null;
    expect(await service.chooseFile()).toEqual({ cancelled: true });
    expect(await service.list()).toEqual([]);
  });

  it("updates one status message in place, at most every 5 % or 2 s unless the stage changes", async () => {
    const out = await service.chooseFile();
    if ("cancelled" in out) throw new Error("cancelled");
    await until(() => worker.jobs.length === 1);
    const job = worker.jobs[0]!;
    for (let pct = 1; pct <= 40; pct++) job.emit(progress(pct));
    clock += 2500;
    job.emit(progress(40.5));
    job.emit(progress(41, "Finding scene cuts"));
    const statusEvents = () =>
      events.filter(
        (e) =>
          e.event === "thread:message" &&
          (e.payload as { message: Message }).message.body.kind === "status",
      ).length;
    await until(() => statusEvents() === 11);
    const posted = events
      .filter((e) => e.event === "thread:message")
      .map((e) => (e.payload as { message: Message }).message);
    const statusRevs = posted.filter((m) => m.body.kind === "status");
    expect(new Set(statusRevs.map((m) => m.id)).size).toBe(1);
    // Start, then 1, 6, 11 … 36 (8), the 2 s one, and the stage change.
    expect(statusRevs.length).toBe(1 + 8 + 1 + 1);
    expect(statusRevs.map((m) => m.rev)).toEqual(statusRevs.map((_, i) => i));
    expect(events.filter((e) => e.event === "job:progress")).toHaveLength(42);
    job.finish();
    await service.idle();
    const file = await readFile(join(out.stream.folder, "thread", "messages.jsonl"), "utf8");
    expect(file.trim().split("\n").length).toBe(1 + statusRevs.length + 1);
  });

  it("runs one analysis at a time, and cancels a queued one before it starts", async () => {
    const a = await service.chooseFile();
    const b = await service.chooseFile();
    if ("cancelled" in a || "cancelled" in b) throw new Error("cancelled");
    await until(() => worker.jobs.length === 1);
    await service.cancel(b.jobId);
    worker.jobs[0]!.finish();
    await service.idle();
    expect(worker.jobs).toHaveLength(1);
    const bStatus = statuses(await service.messages(b.stream.streamId, 50));
    expect(bStatus.at(-1)).toMatchObject({ state: "cancelled", label: "Analysis cancelled" });
  });

  it("cancels a running analysis", async () => {
    const out = await service.chooseFile();
    if ("cancelled" in out) throw new Error("cancelled");
    await until(() => worker.jobs.length === 1);
    await service.cancel(out.jobId);
    await service.idle();
    expect(worker.jobs[0]!.cancelled).toBe(true);
    expect(statuses(await service.messages(out.stream.streamId, 50)).at(-1)).toMatchObject({
      state: "cancelled",
    });
  });

  it("says plainly when the file can't be read, and posts each problem", async () => {
    const out = await service.chooseFile();
    if ("cancelled" in out) throw new Error("cancelled");
    await until(() => worker.jobs.length === 1);
    worker.jobs[0]!.fail(
      Object.assign(new Error("This file couldn't be read. It may be damaged or not a video."), {
        code: "unreadable",
      }),
    );
    await service.idle();
    expect(statuses(await service.messages(out.stream.streamId, 50)).at(-1)).toMatchObject({
      state: "failed",
      label: "This file couldn't be read. It may be damaged or not a video.",
    });

    await service.startAnalysis(
      out.stream.streamId,
      (await service.open(out.stream.streamId)).sources[0]!.source.sourceId,
    );
    await until(() => worker.jobs.length === 2);
    worker.jobs[1]!.finish({
      steps: { transcript: "not-needed" },
      problems: [
        {
          step: "transcript",
          message: "The transcription model isn't downloaded yet. Open Setup to get it.",
        },
      ],
    });
    await service.idle();
    const last = (await service.messages(out.stream.streamId, 50)).at(-1)!;
    expect(last.body).toEqual({
      kind: "text",
      text: "The transcription model isn't downloaded yet. Open Setup to get it.",
    });
  });

  it("marks a stream read", async () => {
    const out = await service.chooseFile();
    if ("cancelled" in out) throw new Error("cancelled");
    await until(() => worker.jobs.length === 1);
    worker.jobs[0]!.finish();
    await service.idle();
    await service.markRead(out.stream.streamId);
    expect((await service.list())[0]!.unread).toBe(false);
  });

  it("says when a stream's folder has moved", async () => {
    const out = await service.chooseFile();
    if ("cancelled" in out) throw new Error("cancelled");
    await until(() => worker.jobs.length === 1);
    worker.jobs[0]!.finish();
    await service.idle();
    await index.update(out.stream.streamId, { folder: join(root, "gone.alcyo") });
    const fresh = new StreamService((service as unknown as { deps: StreamServiceDeps }).deps);
    expect((await fresh.list())[0]!.missing).toBe(true);
    await expect(fresh.open(out.stream.streamId)).rejects.toThrow("isn't where it was");
  });
});

describe("links and clips", () => {
  const texts = (messages: Message[]) =>
    messages.flatMap((m) => (m.body.kind === "text" ? [`${m.author}: ${m.body.text}`] : []));

  /** A stream whose recording is analyzed and has audio, ready for clips. */
  async function analyzedStream() {
    const out = await service.chooseFile();
    if ("cancelled" in out) throw new Error("cancelled");
    await until(() => worker.jobs.length === 1);
    worker.jobs[0]!.finish();
    await service.idle();
    const streamId = out.stream.streamId;
    const store = await service.forStream(streamId);
    const sourceId = (await store.sources())[0]!.source.sourceId;
    await mkdir(store.paths.cacheDir(sourceId), { recursive: true });
    await writeFile(join(store.paths.cacheDir(sourceId), "audio.wav"), "wav");
    return { streamId, store, sourceId };
  }

  it("makes no stream for a link that can't be downloaded", async () => {
    worker.link = { kind: "unsupported" };
    expect(await service.addLink(undefined, "https://x.test/private")).toEqual({
      failed: true,
      message: CANT_DOWNLOAD,
    });
    worker.link = { kind: "playlist", title: "Clips", count: 30 };
    expect(await service.addLink(undefined, "https://x.test/clips")).toEqual({
      failed: true,
      message: COPY.playlist,
    });
    expect(await service.list()).toEqual([]);
  });

  it("downloads a long video as the source of a new stream, then analyzes it", async () => {
    worker.link = linkVideo(3 * 3_600_000);
    const url = "https://www.youtube.com/watch?v=v1";
    const out = await service.addLink(undefined, url);
    if (!("streamId" in out)) throw new Error("failed");
    const [entry] = await service.list();
    expect(entry).toMatchObject({ name: "Rook42 Boss Rush" });
    await until(() => worker.downloads.length === 1);
    const dl = worker.downloads[0]!;
    expect(dl.request).toMatchObject({ url, ytDlp: "/b/yt-dlp", ffmpegDir: "/b", parts: 2 });
    expect(dl.request.outDir).toContain(join("Rook42 Boss Rush.alcyo", "sources", "src_"));
    dl.emit({ kind: "import-progress", stage: "Downloading", pct: 40 });
    await dl.finish();
    await until(() => worker.jobs.length === 1);
    expect(worker.jobs[0]!.request.sourcePath).toBe(join(dl.request.outDir, "media.mp4"));
    worker.jobs[0]!.finish();
    await service.idle();

    const detail = await service.open(out.streamId);
    expect(detail.sources[0]!.source.origin).toEqual({
      kind: "url",
      url,
      path: join(dl.request.outDir, "media.mp4"),
    });
    expect(detail.sources[0]!.source.info?.title).toBe("Rook42 Boss Rush");
    const messages = await service.messages(out.streamId, 50);
    expect(texts(messages).slice(0, 2)).toEqual([`user: ${url}`, `app: ${COPY.permission}`]);
    expect(statuses(messages).map((s) => s.label)).toEqual(["Downloaded", "Analysis finished"]);

    // The permission note is posted once, ever.
    worker.link = linkVideo(3 * 3_600_000);
    const again = await service.addLink(undefined, url);
    if (!("streamId" in again)) throw new Error("failed");
    expect(texts(await service.messages(again.streamId, 50))).not.toContain(
      `app: ${COPY.permission}`,
    );
  });

  it("cancels a download, removes its folder, and registers nothing", async () => {
    worker.link = linkVideo(3 * 3_600_000);
    const out = await service.addLink(undefined, "https://www.youtube.com/watch?v=v1");
    if (!("streamId" in out)) throw new Error("failed");
    await until(() => worker.downloads.length === 1);
    await writeFile(join(worker.downloads[0]!.request.outDir, "media.f137.mp4.part"), "x");
    const job = (await service.open(out.streamId)).jobs[0]!;
    await service.cancel(job.jobId);
    await service.idle();
    expect(worker.downloads[0]!.cancelled).toBe(true);
    const detail = await service.open(out.streamId);
    expect(detail.sources).toEqual([]);
    expect(await readdir(join(detail.stream.folder, "sources")).catch(() => [])).toEqual([]);
    expect(statuses(await service.messages(out.streamId, 50)).at(-1)).toMatchObject({
      state: "cancelled",
      label: "Download cancelled",
    });
  });

  it("asks about a short link with no source, and answers once", async () => {
    worker.link = linkVideo(45_000);
    const out = await service.addLink(undefined, "https://x.test/short");
    if (!("streamId" in out)) throw new Error("failed");
    const question = (await service.messages(out.streamId, 50)).find(
      (m) => m.body.kind === "question",
    )!;
    expect(question.body).toEqual({
      kind: "question",
      text: "“Rook42 Boss Rush” is 45 s long. Use this as the stream, or add it as a clip?",
      chips: ["Use as the stream", "Add as a clip"],
    });
    await service.answer(out.streamId, question.id, "clip");
    await until(() => worker.downloads.length === 1);
    expect(worker.downloads[0]!.request.outDir).toContain(join("clips", "clip_"));
    await worker.downloads[0]!.finish();
    await until(() => worker.jobs.length === 1);
    expect(worker.jobs[0]!.request.mode).toBe("quick");
    worker.jobs[0]!.finish();
    await service.idle();
    const messages = await service.messages(out.streamId, 50);
    expect(texts(messages)).toContain("user: Add as a clip");
    expect(texts(messages).at(-1)).toBe(`app: ${COPY.waitForVod}`);
    const [clip] = (await service.open(out.streamId)).clips;
    expect(clip).toMatchObject({ title: "Rook42 Boss Rush", clippedBy: "Rook42", match: null });

    await service.answer(out.streamId, question.id, "stream");
    expect(texts(await service.messages(out.streamId, 50)).at(-1)).toBe(`app: ${COPY.expired}`);
  });

  it("checks a clip file, matches it to the analyzed VOD, and posts a clips message", async () => {
    const { streamId, store, sourceId } = await analyzedStream();
    const clipFile = join(root, "viewer clip.mp4");
    await writeFile(clipFile, "clip");
    chosen = clipFile;
    worker.match = { srcIn: 61_000, srcOut: 81_000, confidence: 0.91, method: "transcript" };
    const out = await service.chooseClipFile(streamId);
    if (!("clipId" in out)) throw new Error("cancelled");
    await until(() => worker.jobs.length === 2);
    const quick = worker.jobs[1]!.request;
    expect(quick).toMatchObject({
      mode: "quick",
      sourceId: out.clipId,
      sourcePath: clipFile,
      analysisDir: store.paths.clipAnalysisDir(out.clipId),
      cacheDir: store.paths.cacheDir(out.clipId),
    });
    worker.jobs[1]!.finish();
    await service.idle();
    expect(worker.matchRequests[0]).toMatchObject({
      vodAudio: join(store.paths.cacheDir(sourceId), "audio.wav"),
      clipAudio: join(store.paths.cacheDir(out.clipId), "audio.wav"),
      clipDurationMs: 10_000,
      vodDurationMs: 10_000,
    });
    const messages = await service.messages(streamId, 50);
    expect(messages.at(-1)!.body).toEqual({ kind: "clips", clipIds: [out.clipId] });
    expect(statuses(messages).at(-1)?.label).toBe("Placed the clip in the stream");
    expect((await store.clip(out.clipId)).match).toEqual(worker.match);
    expect(await readdir(root)).toContain("viewer clip.mp4");
  });

  it("says when a clip couldn't be placed, and places it by hand", async () => {
    const { streamId, store } = await analyzedStream();
    chosen = video;
    worker.match = { srcIn: 0, srcOut: 10_000, confidence: 0.31, method: "audio" };
    const out = await service.chooseClipFile(streamId);
    if (!("clipId" in out)) throw new Error("cancelled");
    await until(() => worker.jobs.length === 2);
    worker.jobs[1]!.finish();
    await service.idle();
    expect(statuses(await service.messages(streamId, 50)).at(-1)?.label).toBe("Checked the clip");
    expect((await service.list())[0]!.preview).toBe("Couldn't place the clip");
    const placed = await service.placeClip(streamId, out.clipId, 2_000);
    expect(placed.match).toEqual({ srcIn: 2_000, srcOut: 10_000, confidence: 1, method: "manual" });
    expect((await store.clip(out.clipId)).match?.method).toBe("manual");
    await expect(service.placeClip(streamId, out.clipId, 10_000)).rejects.toThrow(
      "past the end of the stream (0:10)",
    );
  });

  it("won't take a second recording, and adds a short link as a clip", async () => {
    const { streamId } = await analyzedStream();
    worker.link = linkVideo(2 * 3_600_000);
    await service.addLink(streamId, "https://www.youtube.com/watch?v=v2");
    expect(texts(await service.messages(streamId, 50)).at(-1)).toBe(`app: ${COPY.hasSource}`);
    worker.link = linkVideo(30_000, { isClip: true });
    await service.addLink(streamId, "https://clips.twitch.tv/Abc");
    await until(() => worker.downloads.length === 1);
    expect(worker.downloads[0]!.request.outDir).toContain(join("clips", "clip_"));
  });
});

describe("audit recovery and project flows", () => {
  it("keeps partial analysis retryable and reuses the completed step cache", async () => {
    const out = await service.chooseFile();
    if ("cancelled" in out) throw new Error("cancelled");
    await until(() => worker.jobs.length === 1);
    worker.jobs[0]!.finish({
      steps: { probe: "done", transcript: "done", proxy: "failed" },
      problems: [{ step: "proxy", message: "The preview step stopped." }],
    });
    await service.idle();
    const last = statuses(await service.messages(out.stream.streamId, 50)).at(-1)!;
    expect(last).toMatchObject({
      state: "failed",
      jobKind: "analysis",
      label: "Analysis finished, with problems",
    });
    await service.startAnalysis(out.stream.streamId, last.targetId!);
    await until(() => worker.jobs.length === 2);
    expect(worker.jobs[1]!.request.cacheDir).toBe(worker.jobs[0]!.request.cacheDir);
    worker.jobs[1]!.finish();
    await service.idle();
    expect(statuses(await service.messages(out.stream.streamId, 50)).at(-1)!.state).toBe("done");
  });

  it("recovers partial failures marked done by older builds", async () => {
    const out = await service.chooseFile();
    if ("cancelled" in out) throw new Error("cancelled");
    await until(() => worker.jobs.length === 1);
    worker.jobs[0]!.finish();
    await service.idle();
    const sourceId = (await service.open(out.stream.streamId)).project.sources[0]!.sourceId;
    await service.post(out.stream.streamId, {
      kind: "status",
      jobId: "job_partialold",
      label: "Analysis finished, with problems",
      pct: 100,
      state: "done",
      jobKind: "analysis",
      targetId: sourceId,
    });
    const restarted = new StreamService(deps);
    await restarted.open(out.stream.streamId);
    expect(statuses(await restarted.messages(out.stream.streamId, 50)).at(-1)).toMatchObject({
      state: "failed",
      targetId: sourceId,
      label: "Analysis finished, with problems",
    });
  });

  it("copies a chosen recording and relocates the whole project without losing its media", async () => {
    const out = await service.chooseFile(undefined, true);
    if ("cancelled" in out) throw new Error("cancelled");
    await until(() => worker.jobs.length === 1);
    worker.jobs[0]!.finish();
    await service.idle();
    const before = await service.open(out.stream.streamId);
    expect(before.sources[0]!.source.origin).toMatchObject({ kind: "file", copied: true });
    expect(before.project.settings.copyIntoProject).toBe(true);
    expect(await readFile(video, "utf8")).toBe("video");
    const moved = join(root, "Moved.alcyo");
    await rename(out.stream.folder, moved);
    deps.chooseFolder = () => Promise.resolve(moved);
    expect(await service.locate(out.stream.streamId)).toMatchObject({
      stream: { folder: moved, missing: false },
    });
    const after = await service.open(out.stream.streamId);
    expect(after.sources[0]!.missing).toBe(false);
    expect(after.sources[0]!.source.origin.path.startsWith(moved)).toBe(true);
    expect(await readFile(after.sources[0]!.source.origin.path, "utf8")).toBe("video");
  });

  it("refuses rebinding a stream id to a different project", async () => {
    const out = await service.chooseFile();
    if ("cancelled" in out) throw new Error("cancelled");
    await service.cancel(out.jobId);
    await service.idle();
    const other = await createStream({ dir: root, name: "Other" });
    deps.chooseFolder = () => Promise.resolve(other.folder);
    expect(await service.locate(out.stream.streamId)).toMatchObject({ mismatch: true });
    expect((await index.get(out.stream.streamId)).folder).toBe(out.stream.folder);
  });

  it("reconciles interrupted statuses, hydrates a cached probe, and resumes the existing cache", async () => {
    const out = await service.chooseFile();
    if ("cancelled" in out) throw new Error("cancelled");
    await until(() => worker.jobs.length === 1);
    await service.cancel(out.jobId);
    await service.idle();
    const store = await service.forStream(out.stream.streamId);
    const source = (await store.sources())[0]!.source;
    await writeJsonAtomic(store.paths.analysis(source.sourceId, "probe.json"), {
      schemaVersion: 1,
      sourceId: source.sourceId,
      probe,
      fingerprint: { ...source.fingerprint, durationMs: probe.durationMs, layout: "v+a" },
    });
    await service.post(out.stream.streamId, {
      kind: "status",
      jobId: "job_interrupted",
      label: "Transcribing",
      pct: 45,
      state: "running",
      jobKind: "analysis",
      targetId: source.sourceId,
    });
    const restarted = new StreamService(deps);
    const view = await restarted.open(out.stream.streamId);
    expect(view.sources[0]!.source.probe).toEqual(probe);
    expect(view.jobs).toEqual([]);
    expect((await restarted.messages(out.stream.streamId, 50)).at(-1)!.body).toMatchObject({
      state: "failed",
      jobId: "job_interrupted",
    });
    await restarted.startAnalysis(out.stream.streamId, source.sourceId);
    await until(() => worker.jobs.length === 2);
    expect(worker.jobs[1]!.request.cacheDir).toBe(worker.jobs[0]!.request.cacheDir);
    worker.jobs[1]!.finish();
    await restarted.idle();
  });

  it("locates a real older card directly and resolves unposted latest versions", async () => {
    const out = await service.chooseFile();
    if ("cancelled" in out) throw new Error("cancelled");
    await service.cancel(out.jobId);
    await service.idle();
    const store = await service.forStream(out.stream.streamId);
    const sourceId = (await store.project()).sources[0]!.sourceId;
    const v1 = await store.createShort({
      sourceId,
      short: F.short,
      createdBy: "user",
      note: "First",
      fromMessageId: null,
    });
    const old = await service.post(out.stream.streamId, {
      kind: "shorts",
      intro: "First",
      shorts: [{ shortId: v1.shortId, version: 1 }],
    });
    for (let i = 0; i < 250; i++)
      await service.post(out.stream.streamId, { kind: "text", text: String(i) });
    const found = await service.locateMessage(out.stream.streamId, {
      shortId: v1.shortId,
      version: 1,
    });
    expect(found.message?.id).toBe(old.id);
    const v2 = await store.restore(v1.shortId, 1);
    expect(await service.locateMessage(out.stream.streamId, { shortId: v1.shortId })).toMatchObject(
      { ref: { version: v2.version }, message: { body: { kind: "version", ref: { version: 2 } } } },
    );
  });
});
