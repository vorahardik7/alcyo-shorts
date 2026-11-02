import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnalysisEvent, AnalysisRequest, AnalysisResult, EventName } from "@alcyo/ipc";
import type { Message } from "@alcyo/schema";
import { SettingsFile, StreamsIndex } from "@alcyo/store";
import { beforeEach, describe, expect, it } from "vitest";
import { type AnalysisWorker, StreamService, type StreamServiceDeps } from "./streams";

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

/** A worker whose jobs are driven by the test. */
class FakeWorker implements AnalysisWorker {
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

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "alcyo-service-"));
  video = join(root, "Soul47 stream.mp4");
  await writeFile(video, "video");
  worker = new FakeWorker();
  events = [];
  clock = Date.parse("2026-11-01T12:00:00.000Z");
  chosen = video;
  settings = new SettingsFile(join(root, "userData"), "darwin");
  index = new StreamsIndex(join(root, "userData"));
  service = new StreamService({
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
    emit: (event, payload) => events.push({ event, payload }),
    now: () => new Date(clock),
    log: () => undefined,
  });
});

const statuses = (messages: Message[]) =>
  messages.flatMap((m) => (m.body.kind === "status" ? [m.body] : []));

describe("StreamService", () => {
  it("chooses a file, makes a stream named after it, and runs analysis to the end", async () => {
    const out = await service.chooseFile();
    if ("cancelled" in out) throw new Error("cancelled");
    expect(out.stream).toMatchObject({ name: "Soul47 stream", missing: false });
    expect(out.stream.folder).toBe(join(root, "Streams", "Soul47 stream.alcyo"));
    await until(() => worker.jobs.length === 1);

    const job = worker.jobs[0]!;
    expect(job.request.sourcePath).toBe(video);
    expect(job.request.analysisDir).toContain(join("Soul47 stream.alcyo", "sources"));
    job.emit(progress(10));
    job.finish();
    await service.idle();

    const detail = await service.open(out.stream.streamId);
    expect(detail.sources[0]!.source.probe).toEqual(probe);
    expect(detail.jobs).toEqual([]);
    const messages = await service.messages(out.stream.streamId, 50);
    expect(messages[0]!.body).toMatchObject({ kind: "text" });
    expect(statuses(messages)).toEqual([
      { kind: "status", jobId: out.jobId, label: "Analysis finished", pct: 100, state: "done" },
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
