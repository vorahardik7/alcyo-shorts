import { CHANNELS, SetupReport } from "@alcyo/ipc";
import { describe, expect, it } from "vitest";
import { makeHandler } from "./core";
import { fixtureKind, fixtureReport } from "../setup-fixture";
import { SetupService } from "../setup-service";
import { createHandlers, type HandlerDeps } from "./handlers";

const info = {
  name: "Alcyo Shorts",
  version: "0.1.0",
  platform: "darwin",
  arch: "arm64",
  electron: "45.2.1",
  chrome: "142.0.0.0",
  node: "24.11.0",
} as const;

const paths = { userData: "/data", models: "/data/models", bin: "/app/bin" };
const request = {
  binDir: "/app/bin",
  modelsDir: "/data/models",
  platform: "darwin",
  arch: "arm64",
} as const;
const at = new Date("2026-11-01T12:00:00.000Z");

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  let t = 100;
  return {
    appInfo: () => info,
    appPaths: () => paths,
    openDataFolder: () => Promise.resolve(),
    setupCheck: (fresh) => Promise.resolve(fixtureReport(fresh ? "fail" : "pass", request, at)),
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

describe("new channels", () => {
  it("app:paths returns the checked folders", async () => {
    const run = makeHandler("app:paths", createHandlers(deps())["app:paths"]);
    await expect(run({})).resolves.toEqual(paths);
  });

  it("shell:openDataFolder takes no path and opens the data folder", async () => {
    let opened = 0;
    const run = makeHandler(
      "shell:openDataFolder",
      createHandlers(deps({ openDataFolder: () => Promise.resolve(void opened++) }))[
        "shell:openDataFolder"
      ],
    );
    await expect(run({})).resolves.toEqual({});
    expect(opened).toBe(1);
    // Extra keys are stripped by the schema, so a path can't sneak in.
    await expect(run({ path: "/etc" })).resolves.toEqual({});
    await expect(run(null)).rejects.toThrow("bad input");
  });

  it("setup:check passes fresh through and checks the report", async () => {
    const run = makeHandler("setup:check", createHandlers(deps())["setup:check"]);
    await expect(run({})).resolves.toMatchObject({ complete: true });
    await expect(run({ fresh: true })).resolves.toMatchObject({ complete: false });
    await expect(run({ fresh: "yes" })).rejects.toThrow("bad input");
  });

  it("setup:check rejects a malformed report", async () => {
    const run = makeHandler(
      "setup:check",
      createHandlers(deps({ setupCheck: () => Promise.resolve({ complete: true } as never) }))[
        "setup:check"
      ],
    );
    await expect(run({})).rejects.toThrow("bad answer");
  });
});

describe("SetupService", () => {
  it("caches one report, reruns on fresh, and retries after a failure", async () => {
    let runs = 0;
    let fail = true;
    const service = new SetupService(() => {
      runs++;
      if (fail) return Promise.reject(new Error("worker gone"));
      return Promise.resolve(fixtureReport("pass", request, at));
    });
    await expect(service.get()).rejects.toThrow("worker gone");
    fail = false;
    await service.get();
    await service.get();
    expect(runs).toBe(2);
    await service.get(true);
    expect(runs).toBe(3);
  });
});

describe("setup fixtures", () => {
  it("are used only in headless mode with a known value", () => {
    expect(fixtureKind({ ALCYO_TEST_SETUP: "pass" }, true)).toBe("pass");
    expect(fixtureKind({ ALCYO_TEST_SETUP: "fail" }, true)).toBe("fail");
    expect(fixtureKind({ ALCYO_TEST_SETUP: "pass" }, false)).toBeNull();
    expect(fixtureKind({ ALCYO_TEST_SETUP: "real" }, true)).toBeNull();
  });

  it("match the report schema, and fail has a fix line on every failure", () => {
    for (const kind of ["pass", "fail"] as const) {
      const report = fixtureReport(kind, request, at);
      expect(SetupReport.parse(report)).toEqual(report);
      expect(report.complete).toBe(kind === "pass");
      for (const c of report.checks) if (c.state === "fail") expect(c.fix).not.toBeNull();
    }
  });
});
