import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHANNELS, SetupReport } from "@alcyo/ipc";
import * as F from "@alcyo/schema/testing";
import { ProfileStore, SettingsFile, StreamsIndex, hashFile, writeJsonAtomic } from "@alcyo/store";
import { EditorService } from "../editor";
import { StreamService } from "../streams";
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

const paths = {
  userData: "/data",
  models: "/data/models",
  bin: "/app/bin",
  streams: "/Users/me/Movies/Alcyo Shorts",
};
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
    locateAgent: () => Promise.resolve({ cancelled: true }),
    downloadModel: () =>
      Promise.resolve({ path: "/data/models/ggml-small.en.bin", name: "small.en" }),
    setApiKey: () => Promise.resolve(),
    clearApiKey: () => Promise.resolve(),
    pingWorker: (text) => Promise.resolve(text),
    now: () => (t += 5),
    streams: {} as never,
    downloader: {} as never,
    profile: {} as never,
    planner: {
      state: () => Promise.resolve({ ready: false, working: null }),
      find: () => Promise.reject(new Error("not used")),
      send: () => Promise.reject(new Error("not used")),
      cancel: () => false,
    },
    renders: {
      enqueue: () => Promise.resolve({ renderId: "r_1" }),
      list: () => [],
      get: () => Promise.resolve(null),
      cancel: () => undefined,
      retry: () => undefined,
      file: () => Promise.resolve("/Users/me/Movies/Alcyo Shorts/s.alcyo/renders/a-v1-1080p30.mp4"),
      preview: () => Promise.reject(new Error("not used")),
    },
    drops: { take: () => null },
    editor: {} as never,
    reveal: () => undefined,
    useAgent: () => Promise.resolve(),
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
  it("render channels are checked, and reveal takes only an id", async () => {
    const revealed: string[] = [];
    const h = createHandlers(deps({ reveal: (path) => revealed.push(path) }));
    const call = <C extends (typeof CHANNELS)[number]>(c: C, input: unknown) =>
      makeHandler(c, h[c] as never)(input);
    await expect(call("render:enqueue", { streamId: "s_1", shortId: "sh_1" })).resolves.toEqual({
      renderId: "r_1",
    });
    await expect(
      call("render:enqueue", { streamId: "s_1", shortId: "sh_1", version: 0 }),
    ).rejects.toThrow();
    await expect(call("render:list", {})).resolves.toEqual([]);
    await expect(call("render:get", { streamId: "s_1", renderId: "r_1" })).resolves.toBeNull();
    await expect(call("render:cancel", { renderId: "r_1" })).resolves.toEqual({});
    await expect(call("render:retry", { renderId: "r_1" })).resolves.toEqual({});
    await expect(
      call("render:reveal", { streamId: "s_1", renderId: "r_1", path: "/etc" }),
    ).resolves.toEqual({});
    expect(revealed).toEqual(["/Users/me/Movies/Alcyo Shorts/s.alcyo/renders/a-v1-1080p30.mp4"]);
  });

  it("agent:use takes only a known provider", async () => {
    const used: string[] = [];
    const h = createHandlers(deps({ useAgent: (p) => Promise.resolve(void used.push(p)) }));
    const run = makeHandler("agent:use", h["agent:use"]);
    await expect(run({ provider: "grok-cli" })).resolves.toEqual({});
    await expect(run({ provider: "gemini-cli" })).rejects.toThrow();
    expect(used).toEqual(["grok-cli"]);
  });

  it("planner channels are checked", async () => {
    const sent: unknown[] = [];
    const h = createHandlers(
      deps({
        planner: {
          state: () => Promise.resolve({ ready: true, working: null }),
          find: () => Promise.resolve({ jobId: "job_1" }),
          send: (...a) => {
            sent.push(a);
            return Promise.resolve({ messageId: "m_1" });
          },
          cancel: () => false,
        },
      }),
    );
    const call = <C extends (typeof CHANNELS)[number]>(c: C, input: unknown) =>
      makeHandler(c, h[c] as never)(input);
    await expect(call("shorts:find", { streamId: "s_1" })).resolves.toEqual({ jobId: "job_1" });
    await expect(call("chat:send", { streamId: "s_1", text: "" })).rejects.toThrow();
    await call("chat:send", {
      streamId: "s_1",
      text: "hi",
      replyTo: { shortId: "sh_1", version: 2 },
    });
    expect(sent).toEqual([["s_1", "hi", { shortId: "sh_1", version: 2 }]]);
  });

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

describe("stream channels", () => {
  async function setup() {
    const root = await mkdtemp(join(tmpdir(), "alcyo-handlers-"));
    const video = join(root, "clip.mp4");
    await writeFile(video, "x");
    const content = await hashFile(video);
    const settings = new SettingsFile(join(root, "u"), "darwin");
    const streams = new StreamService({
      index: new StreamsIndex(join(root, "u")),
      settings,
      defaultStreamsDir: join(root, "Streams"),
      worker: () => ({
        analyze: (req) => ({
          done: Promise.resolve({
            sourceId: req.sourceId,
            probe: {
              durationMs: 10_000,
              container: "mov,mp4",
              video: null,
              audio: null,
              playsDirectly: false,
            },
            fingerprint: { ...content, durationMs: 10_000, layout: "" },
            steps: {},
            problems: [],
            poster: null,
            encoder: null,
          }),
          cancel: () => undefined,
        }),
        linkInfo: () => Promise.resolve({ kind: "unsupported" as const }),
        download: () => ({ done: Promise.reject(new Error("no")), cancel: () => undefined }),
        matchClip: () => ({ done: Promise.resolve({ match: null }), cancel: () => undefined }),
      }),
      importBase: () => Promise.resolve({ ytDlp: "/b/yt-dlp", ffmpegDir: "/b" }),
      analysisBase: () =>
        Promise.resolve({
          tools: { ffmpeg: "f", ffprobe: "p", whisper: "w" },
          toolVersions: { ffmpeg: "1", whisper: "1" },
          model: null,
          vadModel: "v",
          mode: "full",
          encoder: null,
          threads: 1,
        }),
      chooseVideo: () => Promise.resolve(video),
      emit: () => undefined,
      log: () => undefined,
    });
    const h = createHandlers(
      deps({
        streams,
        editor: new EditorService({
          streams,
          profiles: new ProfileStore(await mkdtemp(join(tmpdir(), "alcyo-p-"))),
        }),
      }),
    );
    const call = <C extends (typeof CHANNELS)[number]>(c: C, input: unknown) =>
      makeHandler(c, h[c] as never)(input);
    const out = (await call("source:chooseFile", {})) as { stream: { streamId: string } };
    await streams.idle();
    const streamId = out.stream.streamId;
    const detail = (await call("stream:open", { streamId })) as {
      sources: Array<{ source: { sourceId: string } }>;
    };
    const sourceId = detail.sources[0]!.source.sourceId;
    const store = await streams.forStream(streamId);
    await writeJsonAtomic(store.paths.analysis(sourceId, "transcript.json"), {
      ...F.transcript,
      sourceId,
    });
    return { call, streamId, sourceId, store, F };
  }

  it("takes only http(s) links, so an option can't reach yt-dlp", async () => {
    const { call, streamId } = await setup();
    for (const url of [
      "--exec=rm -rf ~",
      "-https://x.test",
      "file:///etc/passwd",
      "javascript:x",
    ]) {
      await expect(call("link:add", { url })).rejects.toThrow("bad input");
    }
    expect(await call("link:add", { streamId, url: "https://x.test/v" })).toEqual({ streamId });
    expect(await call("link:add", { url: "https://x.test/v" })).toMatchObject({ failed: true });
  });

  it("list, open, messages, mark read and transcript reads are checked end to end", async () => {
    const { call, streamId, sourceId } = await setup();
    expect(await call("streams:list", {})).toMatchObject([
      { streamId, name: "clip", unread: true },
    ]);
    await call("stream:markRead", { streamId });
    expect(await call("streams:list", {})).toMatchObject([{ unread: false }]);
    const messages = (await call("thread:messages", { streamId, limit: 10 })) as unknown[];
    expect(messages.length).toBe(2);
    await expect(call("thread:messages", { streamId, limit: 500 })).rejects.toThrow("bad input");
    expect(
      await call("transcript:window", { streamId, sourceId, fromMs: 4000, toMs: 5300 }),
    ).toMatchObject({ words: [{ id: "w00004" }, { id: "w00005" }] });
    expect(await call("transcript:search", { streamId, sourceId, query: "LIVE" })).toEqual([
      { lineId: "L0001", startMs: 1000, endMs: 2100, text: "alright we're live" },
    ]);
    await expect(call("stream:open", { streamId: "s_nope" })).rejects.toThrow(
      "That stream isn't in this app.",
    );
  });

  it("short channels save drafts and versions, list and restore", async () => {
    const { call, streamId, sourceId, store, F } = await setup();
    const v1 = await store.createShort({
      sourceId,
      short: F.short,
      createdBy: "claude",
      note: "",
      fromMessageId: null,
    });
    const shortId = v1.shortId;
    const draft = { ...F.short, title: "Draft title" };
    await call("short:saveDraft", { streamId, shortId, short: draft });
    expect(await call("short:get", { streamId, shortId })).toMatchObject({
      version: { version: 1 },
      draft: { short: { title: "Draft title" } },
    });
    expect(
      await call("short:saveVersion", { streamId, shortId, short: draft, note: "Editor" }),
    ).toMatchObject({ version: 2, createdBy: "user", parent: 1 });
    // Saving posts a version message, by the creator.
    const thread = (await call("thread:messages", { streamId, limit: 50 })) as Array<{
      author: string;
      body: { kind: string };
    }>;
    expect(thread.at(-1)).toMatchObject({
      author: "user",
      body: { kind: "version", ref: { shortId, version: 2 }, whatChanged: "Editor" },
    });
    // A branch from v1 records v1 as its parent.
    expect(
      await call("short:saveVersion", {
        streamId,
        shortId,
        short: draft,
        note: "Branch",
        parent: 1,
      }),
    ).toMatchObject({ version: 3, parent: 1 });
    const view = (await call("editor:open", { streamId, shortId, version: 1 })) as {
      version: { version: number };
      head: number;
      draft: unknown;
      versions: unknown[];
      words: unknown[];
      source: { src: string | null; thumbs: { count: number } };
    };
    expect(view).toMatchObject({ version: { version: 1 }, head: 3, draft: null });
    expect(view.versions).toHaveLength(3);
    expect(view.words.length).toBeGreaterThan(0);
    expect(await call("short:restore", { streamId, shortId, version: 1 })).toMatchObject({
      version: 4,
      note: "Restored v1",
    });
    expect(((await call("short:versions", { streamId, shortId })) as unknown[]).length).toBe(4);
    await expect(
      call("short:saveDraft", { streamId, shortId, short: { ...draft, segments: [] } }),
    ).rejects.toThrow("bad input");
  });

  it("chooseFile and relink take no path from the renderer", async () => {
    const { call, streamId, sourceId } = await setup();
    // Extra keys are stripped, so a path can't sneak in.
    expect(await call("source:relink", { streamId, sourceId, path: "/etc/passwd" })).toMatchObject({
      source: { sourceId },
    });
  });
});
