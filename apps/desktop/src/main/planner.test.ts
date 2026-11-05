import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventName } from "@alcyo/ipc";
import { FIND_FAILED, type LlmProvider, PlannerError } from "@alcyo/planner";
import {
  type Line,
  type Message,
  type Transcript,
  type Word,
  claudeJsonSchemas,
} from "@alcyo/schema";
import {
  ProfileStore,
  type ProjectStore,
  SettingsFile,
  StreamsIndex,
  createStream,
  writeJsonAtomic,
} from "@alcyo/store";
import { beforeEach, describe, expect, it } from "vitest";
import { NOT_READY, PlannerService, STOPPED } from "./planner";
import { StreamService } from "./streams";
import { scriptedAgent } from "./test-agent";

/** 75 lines of 10 words, one line every 4 s. */
function transcript(sourceId: string): Transcript {
  const words: Word[] = [];
  const lines: Line[] = [];
  for (let l = 0; l < 75; l++) {
    const t = l * 4000;
    const ids: string[] = [];
    for (let j = 0; j < 10; j++) {
      const id = `w${String(words.length + 1).padStart(5, "0")}`;
      words.push({
        id,
        text: `word${l}_${j}`,
        startMs: t + j * 350,
        endMs: t + j * 350 + 300,
        p: 0.9,
      });
      ids.push(id);
    }
    lines.push({
      id: `L${String(l + 1).padStart(4, "0")}`,
      startMs: t,
      endMs: t + 3450,
      wordIds: ids,
    });
  }
  return { schemaVersion: 1, sourceId, language: "en", model: "small.en", words, lines };
}

let root: string;
let streams: StreamService;
let planner: PlannerService;
let store: ProjectStore;
let streamId: string;
let sourceId: string;
let provider: LlmProvider;
let calls: string[];
let events: Array<{ event: EventName; payload: unknown }>;

async function addTranscript() {
  const t = transcript(sourceId);
  await writeJsonAtomic(store.paths.analysis(sourceId, "transcript.json"), t);
  await writeJsonAtomic(store.paths.analysis(sourceId, "silences.json"), {
    schemaVersion: 1,
    sourceId,
    silences: t.lines.slice(1).map((l, i) => ({ startMs: t.lines[i]!.endMs, endMs: l.startMs })),
  });
}

const thread = async (): Promise<Message[]> => store.messages();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "alcyo-planner-"));
  const index = new StreamsIndex(root);
  events = [];
  calls = [];
  streams = new StreamService({
    index,
    settings: new SettingsFile(root, "darwin"),
    defaultStreamsDir: join(root, "Streams"),
    worker: () => {
      throw new Error("no worker in this test");
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
    lastActivityAt: new Date().toISOString(),
    unread: false,
    preview: "",
  });
  store = await streams.forStream(streamId);
  const media = join(root, "stream.mp4");
  await writeFile(media, "not really a video");
  sourceId = (await store.addFileSource(media)).sourceId;
  const scripted = scriptedAgent();
  provider = {
    name: "fake",
    complete: (req) => {
      calls.push(req.jsonSchema === claudeJsonSchemas.proposal ? "proposal" : "chat");
      return scripted.complete(req);
    },
  };
  planner = new PlannerService({
    streams,
    agent: {
      provider: () => Promise.resolve(provider),
      model: () => Promise.resolve("sonnet"),
      label: () => Promise.resolve("Grok"),
    },
    profiles: new ProfileStore(root),
    emit: (event, payload) => events.push({ event, payload }),
    log: () => undefined,
  });
});

describe("Find shorts", () => {
  it("waits for the transcript", async () => {
    expect((await planner.state(streamId)).ready).toBe(false);
    await expect(planner.find(streamId)).rejects.toThrow(NOT_READY);
  });

  it("saves version 1 of each short and posts one shorts message", async () => {
    await addTranscript();
    expect((await planner.state(streamId)).ready).toBe(true);
    await planner.find(streamId);
    await planner.idle(streamId);
    const project = await store.project();
    expect(project.shorts).toHaveLength(3);
    const v = await store.version(project.shorts[0]!.shortId);
    expect(v).toMatchObject({ version: 1, createdBy: "claude", fromMessageId: null });
    const last = (await thread()).at(-1)!;
    expect(last.author).toBe("claude");
    expect(last.body).toMatchObject({
      kind: "shorts",
      shorts: project.shorts.map((s) => ({ shortId: s.shortId, version: 1 })),
    });
    const working = events.filter((e) => e.event === "thread:working").map((e) => e.payload);
    expect(working).toEqual([
      {
        streamId,
        working: { jobId: expect.any(String) as string, label: "Grok is finding shorts" },
      },
      { streamId, working: null },
    ]);
  });

  it("writes nothing when the answer fails twice", async () => {
    await addTranscript();
    provider = { name: "fake", complete: () => Promise.resolve({ shorts: [] }) };
    await planner.find(streamId);
    await planner.idle(streamId);
    expect((await store.project()).shorts).toEqual([]);
    expect(await readdir(store.paths.folder)).not.toContain("shorts");
    expect((await thread()).at(-1)).toMatchObject({
      author: "app",
      body: { kind: "text", text: FIND_FAILED },
    });
  });

  it("runs by itself once", async () => {
    await addTranscript();
    await planner.ready(streamId, "transcript");
    await planner.ready(streamId, "clips");
    await planner.idle(streamId);
    await planner.ready(streamId, "clips");
    await planner.idle(streamId);
    expect(calls).toEqual(["proposal"]);
    expect((await store.project()).autoFindAt).not.toBeNull();
  });

  it("waits for clips that aren't placed yet", async () => {
    await addTranscript();
    await store.addClip({
      clipId: "clip_1",
      origin: { kind: "file", path: join(root, "c.mp4") },
      durationMs: 0,
    });
    await planner.ready(streamId, "transcript");
    await planner.idle(streamId);
    expect(calls).toEqual([]);
    await planner.ready(streamId, "clips");
    await planner.idle(streamId);
    expect(calls).toEqual(["proposal"]);
  });

  it("stops on Cancel and says nothing changed", async () => {
    await addTranscript();
    provider = {
      name: "fake",
      complete: (req) =>
        new Promise((_, reject) => {
          // Like the real providers: reject at once if the signal is already aborted.
          const stop = () => reject(new PlannerError("The request was cancelled.", "cancelled"));
          if (req.signal.aborted) stop();
          else req.signal.addEventListener("abort", stop, { once: true });
        }),
    };
    const { jobId } = await planner.find(streamId);
    await new Promise((r) => setTimeout(r, 20));
    expect((await planner.state(streamId)).working?.jobId).toBe(jobId);
    expect(planner.cancel(jobId)).toBe(true);
    await planner.idle(streamId);
    expect((await thread()).at(-1)!.body).toEqual({ kind: "text", text: STOPPED });
    expect((await store.project()).shorts).toEqual([]);
  });
});

describe("chat", () => {
  beforeEach(async () => {
    await addTranscript();
    await planner.find(streamId);
    await planner.idle(streamId);
  });

  it("a reply to a card revises that short and records the message id", async () => {
    const target = (await store.project()).shorts[1]!.shortId;
    const { messageId } = await planner.send(streamId, "make it punchier", {
      shortId: target,
      version: 1,
    });
    await planner.idle(streamId);
    const v = await store.version(target);
    expect(v).toMatchObject({
      version: 2,
      createdBy: "claude",
      fromMessageId: messageId,
      note: "Cut the slow start",
    });
    expect(v.short.title).toBe("Straight to it");
    const msgs = await thread();
    expect(msgs.find((m) => m.id === messageId)).toMatchObject({
      author: "user",
      replyTo: { shortId: target, version: 1 },
    });
    expect(msgs.at(-1)).toMatchObject({
      author: "claude",
      body: {
        kind: "version",
        ref: { shortId: target, version: 2 },
        whatChanged: "Cut the slow start",
      },
    });
    // The other shorts didn't change.
    expect(
      (await store.project()).shorts.filter((s) => s.head === 2).map((s) => s.shortId),
    ).toEqual([target]);
  });

  it("new_shorts adds shorts that don't overlap the old ones", async () => {
    const before = (await store.project()).shorts.map((s) => s.shortId);
    const { messageId } = await planner.send(streamId, "find one more");
    await planner.idle(streamId);
    const after = (await store.project()).shorts;
    expect(after).toHaveLength(4);
    const added = after.find((s) => !before.includes(s.shortId))!;
    const v = await store.version(added.shortId);
    expect(v.fromMessageId).toBe(messageId);
    const spans = await Promise.all(
      after.map(async (s) => (await store.version(s.shortId)).short.segments[0]!),
    );
    for (const a of spans) {
      for (const b of spans)
        if (a !== b) expect(a.srcIn >= b.srcOut || b.srcIn >= a.srcOut).toBe(true);
    }
    expect((await thread()).at(-1)!.body).toMatchObject({
      kind: "shorts",
      shorts: [{ shortId: added.shortId, version: 1 }],
    });
  });

  it("answers a question without changing anything", async () => {
    await planner.send(streamId, "why did you pick the first one?");
    await planner.idle(streamId);
    expect((await store.project()).shorts.every((s) => s.head === 1)).toBe(true);
    expect((await thread()).at(-1)).toMatchObject({ author: "claude", body: { kind: "text" } });
  });

  it("set_style makes a new version of every short", async () => {
    await planner.send(streamId, "use the other captions on all of these");
    await planner.idle(streamId);
    const project = await store.project();
    expect(project.shorts.every((s) => s.head === 2)).toBe(true);
    const v = await store.version(project.shorts[0]!.shortId);
    expect(v.createdBy).toBe("user");
    expect((await thread()).filter((m) => m.body.kind === "version")).toHaveLength(3);
  });

  it("handles messages in the order they were sent", async () => {
    await planner.send(streamId, "why this one?");
    await planner.send(streamId, "find another");
    await planner.idle(streamId);
    const kinds = (await thread()).slice(-4).map((m) => `${m.author}:${m.body.kind}`);
    expect(kinds).toEqual(["user:text", "user:text", "claude:text", "claude:shorts"]);
  });
});

it("branches chat from the explicitly replied-to version", async () => {
  await addTranscript();
  await planner.find(streamId);
  await planner.idle(streamId);
  const shortId = (await store.project()).shorts[0]!.shortId;
  const old = await store.version(shortId, 1);
  await store.saveVersion(shortId, {
    short: { ...old.short, crop: { keys: [{ t: 0, x: 0.9, ease: "hold" }] } },
    createdBy: "user",
    note: "Later crop",
    fromMessageId: null,
  });
  await planner.send(streamId, "make it punchier", { shortId, version: 1 });
  await planner.idle(streamId);
  const next = await store.version(shortId);
  expect(next).toMatchObject({ version: 3, parent: 1 });
  expect(next.short.crop.keys.every((k) => k.x === old.short.crop.keys[0]!.x)).toBe(true);
});
