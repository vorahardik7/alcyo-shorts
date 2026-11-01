import { CHANNELS } from "@alcyo/ipc";
import { describe, expect, it } from "vitest";
import { makeHandler } from "./core";
import { createHandlers, type HandlerDeps } from "./handlers";

const info = {
  name: "Alcyo Shorts",
  version: "0.1.0",
  platform: "darwin",
  arch: "arm64",
  electron: "45.2.1",
} as const;

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  let t = 100;
  return {
    appInfo: () => info,
    pingWorker: (text) => Promise.resolve(text),
    now: () => (t += 5),
    ...overrides,
  };
}

describe("handlers", () => {
  it("has a handler for every channel", () => {
    expect(Object.keys(createHandlers(deps())).sort()).toEqual([...CHANNELS].sort());
  });

  it("app:info returns checked info", async () => {
    await expect(makeHandler("app:info", createHandlers(deps())["app:info"])({})).resolves.toEqual(
      info,
    );
  });

  it("worker:ping relays the worker's answer and timing", async () => {
    const run = makeHandler("worker:ping", createHandlers(deps())["worker:ping"]);
    await expect(run({ text: "hi" })).resolves.toEqual({ text: "hi", ms: 5 });
  });

  it("worker:ping surfaces a worker failure", async () => {
    const run = makeHandler(
      "worker:ping",
      createHandlers(deps({ pingWorker: () => Promise.reject(new Error("The worker stopped.")) }))[
        "worker:ping"
      ],
    );
    await expect(run({ text: "hi" })).rejects.toThrow("The worker stopped.");
  });
});
