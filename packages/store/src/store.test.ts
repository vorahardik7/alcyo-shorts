import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, Short } from "@alcyo/schema";
import * as F from "@alcyo/schema/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftSaver, MAX_WAIT_MS } from "./draft-saver.ts";
import { StoreError, readProjectFile, writeJsonAtomic, writeNewFileAtomic } from "./files.ts";
import { newId } from "./ids.ts";
import { pageMessages, parseMessages } from "./messages.ts";
import { safeFolderName } from "./names.ts";
import { MISMATCH_MESSAGE, ProjectStore, createStream } from "./project.ts";
import { SettingsFile } from "./settings.ts";
import { StreamsIndex } from "./streams-index.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "alcyo-store-"));
});

const msg = (id: string, rev: number, text: string): Message => ({
  id,
  rev,
  at: F.AT,
  author: "app",
  body: { kind: "text", text },
});

describe("names and ids", () => {
  it("makes names safe on macOS and Windows", () => {
    expect(safeFolderName('My "Stream": part 1/2?')).toBe("My -Stream-- part 1-2-");
    expect(safeFolderName("CON")).toBe("CON-");
    expect(safeFolderName("ends with dots... ")).toBe("ends with dots");
    expect(safeFolderName("   ")).toBe("Stream");
    expect(safeFolderName("x".repeat(200))).toHaveLength(80);
    expect(safeFolderName("Soul47 名前 🔥")).toBe("Soul47 名前 🔥");
  });

  it("gives prefixed ids that are safe in paths and links", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId("s")));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^s_[0-9a-z]{10}$/);
  });
});

describe("files", () => {
  it("never overwrites with writeNewFileAtomic, even when two race", async () => {
    const target = join(root, "0002.user.json");
    const results = await Promise.allSettled([
      writeNewFileAtomic(target, "first"),
      writeNewFileAtomic(target, "second"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect((failed as PromiseRejectedResult).reason).toMatchObject({ code: "exists" });
    expect(["first", "second"]).toContain(await readFile(target, "utf8"));
    expect(await readdir(root)).toEqual(["0002.user.json"]);
  });

  it("keeps a bad file in place, copies it to .bad, and says which file and why", async () => {
    const path = join(root, "project.json");
    await writeFile(path, JSON.stringify({ ...F.project, name: "" }));
    const error = await readProjectFile(path, "project").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StoreError);
    expect((error as StoreError).message).toMatch(
      /^project\.json couldn't be read: name: .+ A copy was kept as project\.json\.bad\.$/,
    );
    expect((await readdir(root)).sort()).toEqual(["project.json", "project.json.bad"]);
    await writeFile(path, "{ torn");
    await expect(readProjectFile(path, "project")).rejects.toThrow("Not valid JSON");
  });
});

describe("messages.jsonl", () => {
  it("keeps the highest rev per id in first-seen order, and drops a torn last line", () => {
    const lines = [msg("m1", 0, "a"), msg("m2", 0, "b"), msg("m1", 2, "a2"), msg("m1", 1, "old")]
      .map((m) => JSON.stringify(m))
      .join("\n");
    const { messages, skipped } = parseMessages(`${lines}\n{"id":"m3","re`);
    expect(messages.map((m) => [m.id, m.rev])).toEqual([
      ["m1", 2],
      ["m2", 0],
    ]);
    expect(skipped).toEqual([]);
  });

  it("skips a bad line in the middle and reports it", () => {
    const text = `${JSON.stringify(msg("m1", 0, "a"))}\nnot json\n${JSON.stringify(msg("m2", 0, "b"))}\n`;
    const { messages, skipped } = parseMessages(text);
    expect(messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(skipped).toEqual([2]);
  });

  it("pages with before and limit", () => {
    const all = ["a", "b", "c", "d", "e"].map((id) => msg(id, 0, id));
    expect(pageMessages(all, 2).map((m) => m.id)).toEqual(["d", "e"]);
    expect(pageMessages(all, 2, "d").map((m) => m.id)).toEqual(["b", "c"]);
    expect(pageMessages(all, 10, "b").map((m) => m.id)).toEqual(["a"]);
  });
});

describe("streams index", () => {
  it("lists newest activity first, updates, and loses nothing to concurrent writes", async () => {
    const index = new StreamsIndex(root);
    const entry = (id: string, at: string) => ({
      streamId: id,
      folder: join(root, `${id}.alcyo`),
      name: id,
      thumbnail: null,
      lastActivityAt: at,
      unread: false,
      preview: "",
    });
    await Promise.all([
      index.upsert(entry("a", "2026-11-01T10:00:00.000Z")),
      index.upsert(entry("b", "2026-11-01T12:00:00.000Z")),
      index.upsert(entry("c", "2026-11-01T11:00:00.000Z")),
    ]);
    expect((await index.list()).map((s) => s.streamId)).toEqual(["b", "c", "a"]);
    await index.update("a", { lastActivityAt: "2026-11-01T13:00:00.000Z", unread: true });
    expect((await index.list())[0]).toMatchObject({ streamId: "a", unread: true });
    await expect(index.get("nope")).rejects.toThrow("That stream isn't in this app.");
  });
});

describe("settings", () => {
  it("reads defaults, patches, and keeps other fields", async () => {
    const settings = new SettingsFile(root, "darwin");
    expect((await settings.read()).streamsDir).toBeNull();
    await settings.patch({ encoder: "h264_videotoolbox" });
    await settings.patch({ streamsDir: "/x" });
    expect(await settings.read()).toMatchObject({ encoder: "h264_videotoolbox", streamsDir: "/x" });
  });
});

describe("a stream folder", () => {
  let video: string;
  let store: ProjectStore;
  const clock = { t: Date.parse(F.AT) };
  const now = () => new Date((clock.t += 1000));

  beforeEach(async () => {
    const elsewhere = join(root, "Videos 名前");
    await mkdir(elsewhere);
    video = join(elsewhere, "soul47 stream.mp4");
    await writeFile(video, Buffer.alloc(9 * 1024 * 1024, 7));
    const { folder } = await createStream({ dir: join(root, "Streams"), name: "Soul47: EX Peter" });
    store = await ProjectStore.open(folder, now);
  });

  it("is created in the section 15 layout, with a unique safe name", async () => {
    expect(store.folder).toBe(join(root, "Streams", "Soul47- EX Peter.alcyo"));
    expect((await readdir(store.folder)).sort()).toEqual(["project.json", "thread"]);
    expect((await store.project()).name).toBe("Soul47: EX Peter");
    const second = await createStream({ dir: join(root, "Streams"), name: "Soul47: EX Peter" });
    expect(second.folder).toBe(join(root, "Streams", "Soul47- EX Peter 2.alcyo"));
    expect(second.project.streamId).not.toBe((await store.project()).streamId);
  });

  it("says plainly when the folder has moved", async () => {
    await expect(ProjectStore.open(join(root, "gone.alcyo"))).rejects.toThrow(
      "This stream's folder isn't where it was.",
    );
  });

  it("references a file in place, writes nothing next to it, and copies only when asked", async () => {
    const source = await store.addFileSource(video);
    expect(source.origin).toEqual({ kind: "file", path: video, copied: false });
    expect(source.fingerprint.sizeBytes).toBe(9 * 1024 * 1024);
    expect(await readdir(join(root, "Videos 名前"))).toEqual(["soul47 stream.mp4"]);
    expect((await store.project()).sources).toEqual([{ sourceId: source.sourceId }]);

    const copied = await store.addFileSource(video, { copy: true });
    expect(copied.origin).toMatchObject({ copied: true });
    expect(copied.origin.path).toBe(join(store.paths.sourceDir(copied.sourceId), "media.mp4"));
    expect((await readdir(join(root, "Videos 名前"))).length).toBe(1);
  });

  it("registers a download inside the project with its info", async () => {
    const sourceId = "src_dl";
    const path = join(store.paths.sourceDir(sourceId), "media.mp4");
    await mkdir(store.paths.sourceDir(sourceId), { recursive: true });
    await writeFile(path, "video bytes");
    const info = {
      id: "abc",
      title: "Long stream",
      uploader: null,
      uploadDate: "20261030",
      durationMs: 3_600_000,
      webpageUrl: "https://www.youtube.com/watch?v=abc",
      extractor: "Youtube",
    };
    const url = "https://www.youtube.com/watch?v=abc";
    const source = await store.addDownloadedSource({ sourceId, url, path, info });
    expect(source.origin).toEqual({ kind: "url", url, path });
    expect(source.info).toEqual(info);
    expect((await store.project()).sources).toEqual([{ sourceId }]);
    expect((await store.sources())[0]?.missing).toBe(false);
  });

  it("adds clips in order and saves a match", async () => {
    const media = join(store.paths.clipDir("clip_a"), "media.mp4");
    await store.addClip({
      clipId: "clip_a",
      origin: { kind: "url", url: "https://clips.twitch.tv/Abc", path: media },
      title: "Big play",
      durationMs: 30_000,
    });
    await store.addClip({ clipId: "clip_b", origin: { kind: "file", path: video }, durationMs: 0 });
    expect((await store.clips()).map((c) => c.clipId)).toEqual(["clip_a", "clip_b"]);
    expect((await store.project()).clips).toEqual(["clip_a", "clip_b"]);
    const match = { srcIn: 1000, srcOut: 31_000, confidence: 0.9, method: "audio" as const };
    const saved = await store.updateClip("clip_a", { match });
    expect((await store.clip("clip_a")).match).toEqual(match);
    expect(ProjectStore.clipMedia(saved)).toBe(media);
    // A file clip stays where it is; nothing is written next to it.
    expect(await readdir(join(root, "Videos 名前"))).toEqual(["soul47 stream.mp4"]);
  });

  it("relinks a moved source only to the same file", async () => {
    const source = await store.addFileSource(video);
    const moved = join(root, "moved.mp4");
    await writeFile(moved, await readFile(video));
    await writeFile(video, "gone");
    const views = await store.sources();
    expect(views[0]!.missing).toBe(false);

    const other = join(root, "other.mp4");
    await writeFile(other, Buffer.alloc(9 * 1024 * 1024, 8));
    await expect(store.relinkSource(source.sourceId, other)).rejects.toThrow(MISMATCH_MESSAGE);
    const relinked = await store.relinkSource(source.sourceId, moved);
    expect(relinked.origin.path).toBe(moved);
  });

  it("reports a missing source", async () => {
    const source = await store.addFileSource(video);
    await writeFile(video, "");
    const { rm } = await import("node:fs/promises");
    await rm(video);
    expect(await store.sources()).toEqual([{ source, missing: true }]);
  });

  it("appends to the thread and reads it back", async () => {
    await store.appendMessage(msg("m1", 0, "Reading the file"));
    await store.appendMessage(msg("m1", 1, "Transcribing"));
    await store.appendMessage(msg("m2", 0, "Done"));
    expect(
      (await store.messages()).map((m) => (m.body.kind === "text" ? m.body.text : "")),
    ).toEqual(["Transcribing", "Done"]);
  });

  describe("with a transcript", () => {
    let sourceId: string;
    beforeEach(async () => {
      sourceId = (await store.addFileSource(video)).sourceId;
      await writeJsonAtomic(store.paths.analysis(sourceId, "transcript.json"), {
        ...F.transcript,
        sourceId,
      });
      await store.applyAnalysis(sourceId, {
        probe: {
          durationMs: 10_000,
          container: "mov,mp4",
          video: null,
          audio: null,
          playsDirectly: false,
        },
        fingerprint: {
          ...(await store.source(sourceId)).fingerprint,
          durationMs: 10_000,
          layout: "v",
        },
      });
    });

    it("returns only the words and lines in a window", async () => {
      const w = await store.transcriptWindow(sourceId, 1300, 5100);
      expect(w.words.map((x) => x.id)).toEqual(["w00001", "w00002", "w00003", "w00004"]);
      expect(w.lines.map((x) => x.id)).toEqual(["L0001", "L0002"]);
      const none = await store.transcriptWindow(sourceId, 2200, 4900);
      expect(none.words).toEqual([]);
    });

    it("searches lines case-insensitively", async () => {
      expect(await store.searchTranscript(sourceId, "NO WAY")).toEqual([
        { lineId: "L0002", startMs: 5000, endMs: 6300, text: "no way did you" },
      ]);
      expect(await store.searchTranscript(sourceId, "   ")).toEqual([]);
    });

    const edit = (title: string): Short => ({ ...F.short, title });

    it("never overwrites versions; each records parent, author and message", async () => {
      const v1 = await store.createShort({
        sourceId,
        short: F.short,
        createdBy: "claude",
        note: "Claude's proposal",
        fromMessageId: "m1",
      });
      const id = v1.shortId;
      const [a, b] = await Promise.all([
        store.saveVersion(id, {
          short: edit("A"),
          createdBy: "claude",
          note: "punchier",
          fromMessageId: "m2",
        }),
        store.saveVersion(id, {
          short: edit("B"),
          createdBy: "user",
          note: "editor",
          fromMessageId: null,
        }),
      ]);
      expect([a.version, b.version]).toEqual([2, 3]);
      expect(b.parent).toBe(2);
      expect((await readdir(store.paths.versions(id))).sort()).toEqual([
        "0001.claude.json",
        "0002.claude.json",
        "0003.user.json",
      ]);
      expect(await store.versions(id)).toMatchObject([
        { version: 1, parent: null, createdBy: "claude", fromMessageId: "m1" },
        { version: 2, parent: 1, createdBy: "claude", fromMessageId: "m2" },
        { version: 3, parent: 2, createdBy: "user", fromMessageId: null },
      ]);
      expect((await store.version(id)).short.title).toBe("B");
      expect((await store.project()).shorts).toEqual([{ shortId: id, head: 3 }]);
      expect((await store.shortFile(id)).status).toBe("edited");
    });

    it("restores by making a new version that copies the old one", async () => {
      const v1 = await store.createShort({
        sourceId,
        short: F.short,
        createdBy: "claude",
        note: "",
        fromMessageId: null,
      });
      await store.saveVersion(v1.shortId, {
        short: edit("Later"),
        createdBy: "user",
        note: "",
        fromMessageId: null,
      });
      const restored = await store.restore(v1.shortId, 1);
      expect(restored).toMatchObject({
        version: 3,
        parent: 1,
        createdBy: "user",
        note: "Restored v1",
      });
      expect(restored.short).toEqual(F.short);
      await expect(store.version(v1.shortId, 9)).rejects.toThrow(
        "Version 9 of this short doesn't exist.",
      );
    });

    it("rejects a short that runs past the source", async () => {
      await expect(
        store.createShort({
          sourceId,
          short: { ...F.short, segments: [{ srcIn: 1000, srcOut: 20_000 }] },
          createdBy: "claude",
          note: "",
          fromMessageId: null,
        }),
      ).rejects.toThrow("past the end of the source");
    });

    it("returns a draft newer than the head, and drops it when a version is saved", async () => {
      const v1 = await store.createShort({
        sourceId,
        short: F.short,
        createdBy: "claude",
        note: "",
        fromMessageId: null,
      });
      expect(await store.draft(v1.shortId)).toBeNull();
      await store.saveDraft(v1.shortId, edit("Draft"));
      expect((await store.draft(v1.shortId))?.short.title).toBe("Draft");
      await store.saveVersion(v1.shortId, {
        short: edit("Saved"),
        createdBy: "user",
        note: "",
        fromMessageId: null,
      });
      expect(await store.draft(v1.shortId)).toBeNull();
    });
  });
});

describe("draft saver", () => {
  afterEach(() => vi.useRealTimers());

  it("saves within 1 s of the first edit even while edits keep coming", async () => {
    vi.useFakeTimers();
    const saved: Array<{ value: number; at: number }> = [];
    const saver = new DraftSaver<number>(
      (value) => {
        saved.push({ value, at: Date.now() });
        return Promise.resolve();
      },
      () => Date.now(),
    );
    const start = Date.now();
    for (let i = 0; i < 20; i++) {
      saver.edit(i);
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved.length).toBeGreaterThanOrEqual(2);
    expect(saved[0]!.at - start).toBeLessThanOrEqual(MAX_WAIT_MS);
    expect(saved.at(-1)!.value).toBe(19);
  });

  it("flushes now, once", async () => {
    const saved: number[] = [];
    const saver = new DraftSaver<number>((v) => {
      saved.push(v);
      return Promise.resolve();
    });
    saver.edit(1);
    saver.edit(2);
    await saver.flush();
    await saver.flush();
    expect(saved).toEqual([2]);
  });
});
