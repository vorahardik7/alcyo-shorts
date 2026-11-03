// The main <-> worker protocol, written against a minimal port interface so it
// runs the same on Electron's MessagePortMain and on Node's MessagePort (tests).
import {
  type AnalysisEvent,
  type AnalysisRequest,
  type AnalysisResult,
  type ClipMatchRequest,
  type ClipMatchResult,
  type DownloadRequest,
  type DownloadResult,
  type ImportEvent,
  type JobEvent,
  type LinkInfoRequest,
  type LinkInfoResult,
  MainToWorker,
  type RenderEvent,
  type RenderRequest,
  type RenderResult,
  type SetupReport,
  type SetupRequest,
  WorkerToMain,
} from "@alcyo/ipc";
import type { MessagePortMain } from "electron";

export interface PortLike {
  send(message: unknown): void;
  onMessage(listener: (data: unknown) => void): void;
}

type Log = (message: string) => void;
const defaultLog: Log = (message) => console.error(`[worker-protocol] ${message}`);

/** Wraps an Electron MessagePortMain and starts it. */
export function electronPort(port: MessagePortMain): PortLike {
  const like: PortLike = {
    send: (message) => port.postMessage(message),
    onMessage: (listener) => port.on("message", (event) => listener(event.data)),
  };
  port.start();
  return like;
}

function idOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("id" in data)) return undefined;
  const id = data.id;
  return typeof id === "string" && id.length > 0 && id.length <= 64 ? id : undefined;
}

/** Jobs the worker can run. Injected so the protocol tests need no processes. */
export interface WorkerJobs {
  setupCheck: (request: SetupRequest) => Promise<SetupReport>;
  analyze: (
    request: AnalysisRequest,
    onEvent: (event: AnalysisEvent) => void,
    signal: AbortSignal,
  ) => Promise<AnalysisResult>;
  linkInfo: (request: LinkInfoRequest) => Promise<LinkInfoResult>;
  download: (
    request: DownloadRequest,
    onEvent: (event: ImportEvent) => void,
    signal: AbortSignal,
  ) => Promise<DownloadResult>;
  matchClip: (request: ClipMatchRequest, signal: AbortSignal) => Promise<ClipMatchResult>;
  render: (
    request: RenderRequest,
    onEvent: (event: RenderEvent) => void,
    signal: AbortSignal,
  ) => Promise<RenderResult>;
}

const noJobs: WorkerJobs = {
  setupCheck: () => Promise.reject(new Error("This worker can't run setup checks.")),
  analyze: () => Promise.reject(new Error("This worker can't run analysis.")),
  linkInfo: () => Promise.reject(new Error("This worker can't read links.")),
  download: () => Promise.reject(new Error("This worker can't download.")),
  matchClip: () => Promise.reject(new Error("This worker can't match clips.")),
  render: () => Promise.reject(new Error("This worker can't render.")),
};

/** An error's plain message and code, when it carries them (MediaError does). */
function describeError(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      message: error.message.slice(0, 500),
      ...(typeof code === "string" ? { code: code.slice(0, 40) } : {}),
    };
  }
  return { message: "The job stopped unexpectedly." };
}

/** Worker side: answers checked requests and drops anything else. */
export function serveWorker(
  port: PortLike,
  log: Log = defaultLog,
  given: Partial<WorkerJobs> = {},
): void {
  const jobs: WorkerJobs = { ...noJobs, ...given };
  const send = (message: WorkerToMain) => port.send(WorkerToMain.parse(message));
  const running = new Map<string, AbortController>();

  /** A cancellable job: events go out as job-event, then one reply or an error. */
  const runJob = (
    id: string,
    jobId: string,
    what: string,
    start: (emit: (event: JobEvent) => void, signal: AbortSignal) => Promise<WorkerToMain>,
  ) => {
    if (running.has(jobId)) {
      send({ type: "error", id, message: "That job is already running." });
      return;
    }
    const controller = new AbortController();
    running.set(jobId, controller);
    start((event) => send({ type: "job-event", jobId, event }), controller.signal)
      .then(send, (error: unknown) => {
        const { message: text, code } = describeError(error);
        if (code !== "cancelled") log(`${what} ${jobId} failed: ${text}`);
        send({ type: "error", id, message: text, ...(code === undefined ? {} : { code }) });
      })
      .finally(() => running.delete(jobId));
  };

  port.onMessage((data) => {
    const parsed = MainToWorker.safeParse(data);
    if (!parsed.success) {
      log(`Dropped a message that doesn't match the contract: ${parsed.error.issues[0]?.message}`);
      const id = idOf(data);
      send({
        type: "error",
        ...(id === undefined ? {} : { id }),
        message: "The worker got a message it doesn't understand.",
      });
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "ping":
        send({ type: "pong", id: message.id, text: message.text });
        return;
      case "setup-check": {
        const { id } = message;
        jobs.setupCheck(message.request).then(
          (report) => send({ type: "setup-report", id, report }),
          (error: unknown) => {
            log(`Setup check failed: ${String(error)}`);
            send({ type: "error", id, message: "The setup check stopped unexpectedly." });
          },
        );
        return;
      }
      case "analysis-run": {
        const { request } = message;
        runJob(message.id, message.jobId, "Analysis", (emit, signal) =>
          jobs
            .analyze(request, emit, signal)
            .then((result) => ({ type: "analysis-result", id: message.id, result }) as const),
        );
        return;
      }
      case "download-run": {
        const { request } = message;
        runJob(message.id, message.jobId, "Download", (emit, signal) =>
          jobs
            .download(request, emit, signal)
            .then((result) => ({ type: "download-result", id: message.id, result }) as const),
        );
        return;
      }
      case "clip-match-run": {
        const { request } = message;
        runJob(message.id, message.jobId, "Clip match", (_emit, signal) =>
          jobs
            .matchClip(request, signal)
            .then((result) => ({ type: "clip-match-result", id: message.id, result }) as const),
        );
        return;
      }
      case "render-run": {
        const { request } = message;
        runJob(message.id, message.jobId, "Render", (emit, signal) =>
          jobs
            .render(request, emit, signal)
            .then((result) => ({ type: "render-result", id: message.id, result }) as const),
        );
        return;
      }
      case "link-info": {
        const { id } = message;
        jobs.linkInfo(message.request).then(
          (result) => send({ type: "link-info-result", id, result }),
          (error: unknown) => {
            const { message: text, code } = describeError(error);
            send({ type: "error", id, message: text, ...(code === undefined ? {} : { code }) });
          },
        );
        return;
      }
      case "job-cancel":
        running.get(message.jobId)?.abort();
        return;
    }
  });

  send({ type: "ready" });
}

export interface WorkerClient {
  /** Resolves when the worker says it's ready. */
  readonly ready: Promise<void>;
  ping(text: string): Promise<string>;
  setupCheck(request: SetupRequest): Promise<SetupReport>;
  /**
   * Starts an analysis job. Events stream to onEvent; done rejects with an
   * Error whose code is "cancelled" after cancel(). No reply timeout.
   */
  analyze(
    request: AnalysisRequest,
    onEvent: (event: AnalysisEvent) => void,
  ): { jobId: string; done: Promise<AnalysisResult>; cancel: () => void };
  /** Asks yt-dlp what a link is. A minute at most. */
  linkInfo(request: LinkInfoRequest): Promise<LinkInfoResult>;
  download(
    request: DownloadRequest,
    onEvent: (event: ImportEvent) => void,
  ): { jobId: string; done: Promise<DownloadResult>; cancel: () => void };
  matchClip(request: ClipMatchRequest): {
    jobId: string;
    done: Promise<ClipMatchResult>;
    cancel: () => void;
  };
  render(
    request: RenderRequest,
    onEvent: (event: RenderEvent) => void,
  ): { jobId: string; done: Promise<RenderResult>; cancel: () => void };
  /** Rejects every pending call, for when the worker exits. */
  close(reason: string): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** A worker failure, with the engine's code when there is one. */
export class WorkerError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "WorkerError";
    this.code = code;
  }
}

/** Main side: sends checked requests and matches checked replies by id. */
export function createWorkerClient(
  port: PortLike,
  {
    timeoutMs = 10_000,
    setupTimeoutMs = 60_000,
    log = defaultLog,
  }: { timeoutMs?: number; setupTimeoutMs?: number; log?: Log } = {},
): WorkerClient {
  const pending = new Map<string, Pending>();
  const listeners = new Map<string, (event: JobEvent) => void>();
  let nextId = 1;
  let closedReason: string | undefined;
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  port.onMessage((data) => {
    const parsed = WorkerToMain.safeParse(data);
    if (!parsed.success) {
      log(`Dropped a worker message that doesn't match the contract.`);
      return;
    }
    const message = parsed.data;
    if (message.type === "ready") {
      markReady();
      return;
    }
    if (message.type === "job-event") {
      listeners.get(message.jobId)?.(message.event);
      return;
    }
    if (message.id === undefined) {
      log(`Worker error: ${message.type === "error" ? message.message : "unknown"}`);
      return;
    }
    const call = pending.get(message.id);
    if (call === undefined) return;
    pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.type === "pong") call.resolve(message.text);
    else if (message.type === "setup-report") call.resolve(message.report);
    else if (message.type === "error") call.reject(new WorkerError(message.message, message.code));
    else call.resolve(message.result);
  });

  function request<T>(build: (id: string) => MainToWorker, waitMs: number | null): Promise<T> {
    if (closedReason !== undefined) return Promise.reject(new Error(closedReason));
    const id = String(nextId++);
    return new Promise<T>((resolve, reject) => {
      const timer =
        waitMs === null
          ? undefined
          : setTimeout(() => {
              pending.delete(id);
              reject(new Error("The worker didn't answer in time."));
            }, waitMs);
      pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      port.send(MainToWorker.parse(build(id)));
    });
  }

  /** A job with no reply timeout. Events stream to onEvent until it settles. */
  function job<T>(
    onEvent: (event: JobEvent) => void,
    build: (id: string, jobId: string) => MainToWorker,
  ): { jobId: string; done: Promise<T>; cancel: () => void } {
    const jobId = `job-${nextId++}`;
    listeners.set(jobId, onEvent);
    const done = request<T>((id) => build(id, jobId), null).finally(() => listeners.delete(jobId));
    return {
      jobId,
      done,
      cancel: () => {
        if (closedReason === undefined)
          port.send(MainToWorker.parse({ type: "job-cancel", jobId }));
      },
    };
  }

  return {
    ready,
    ping: (text) => request<string>((id) => ({ type: "ping", id, text }), timeoutMs),
    // Setup runs several tools and a login shell, so it gets longer.
    setupCheck: (req) =>
      request<SetupReport>((id) => ({ type: "setup-check", id, request: req }), setupTimeoutMs),
    analyze(req, onEvent) {
      return job<AnalysisResult>(
        (event) => {
          if (event.kind !== "import-progress" && event.kind !== "render-progress") onEvent(event);
        },
        (id, jobId) => ({ type: "analysis-run", id, jobId, request: req }),
      );
    },
    linkInfo: (req) =>
      request<LinkInfoResult>((id) => ({ type: "link-info", id, request: req }), setupTimeoutMs),
    download(req, onEvent) {
      return job<DownloadResult>(
        (event) => {
          if (event.kind === "import-progress") onEvent(event);
        },
        (id, jobId) => ({ type: "download-run", id, jobId, request: req }),
      );
    },
    matchClip(req) {
      return job<ClipMatchResult>(
        () => undefined,
        (id, jobId) => ({ type: "clip-match-run", id, jobId, request: req }),
      );
    },
    render(req, onEvent) {
      return job<RenderResult>(
        (event) => {
          if (event.kind === "render-progress") onEvent(event);
        },
        (id, jobId) => ({ type: "render-run", id, jobId, request: req }),
      );
    },
    close(reason) {
      closedReason = reason;
      for (const call of pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error(reason));
      }
      pending.clear();
    },
  };
}
