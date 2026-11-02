// The main <-> worker protocol, written against a minimal port interface so it
// runs the same on Electron's MessagePortMain and on Node's MessagePort (tests).
import { MainToWorker, type SetupReport, type SetupRequest, WorkerToMain } from "@alcyo/ipc";
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
}

const noJobs: WorkerJobs = {
  setupCheck: () => Promise.reject(new Error("This worker can't run setup checks.")),
};

/** Worker side: answers checked requests and drops anything else. */
export function serveWorker(
  port: PortLike,
  log: Log = defaultLog,
  jobs: WorkerJobs = noJobs,
): void {
  const send = (message: WorkerToMain) => port.send(WorkerToMain.parse(message));

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
    }
  });

  send({ type: "ready" });
}

export interface WorkerClient {
  /** Resolves when the worker says it's ready. */
  readonly ready: Promise<void>;
  ping(text: string): Promise<string>;
  setupCheck(request: SetupRequest): Promise<SetupReport>;
  /** Rejects every pending call, for when the worker exits. */
  close(reason: string): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
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
    else call.reject(new Error(message.message));
  });

  function request<T>(build: (id: string) => MainToWorker, waitMs: number): Promise<T> {
    if (closedReason !== undefined) return Promise.reject(new Error(closedReason));
    const id = String(nextId++);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("The worker didn't answer in time."));
      }, waitMs);
      pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      port.send(MainToWorker.parse(build(id)));
    });
  }

  return {
    ready,
    ping: (text) => request<string>((id) => ({ type: "ping", id, text }), timeoutMs),
    // Setup runs several tools and a login shell, so it gets longer.
    setupCheck: (req) =>
      request<SetupReport>((id) => ({ type: "setup-check", id, request: req }), setupTimeoutMs),
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
