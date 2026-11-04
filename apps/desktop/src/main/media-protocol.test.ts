import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as F from "@alcyo/schema/testing";
import { type ProjectStore, SettingsFile, StreamsIndex, createStream } from "@alcyo/store";
import { beforeEach, describe, expect, it } from "vitest";
import { DropBox, EXPIRED } from "./drops";
import { fileResponse, mediaHandler, parseRange, resolveMedia, sourceUrl } from "./media-protocol";
import { COPY, StreamService } from "./streams";

let root: string;
let store: ProjectStore;
let streams: StreamService;
let streamId: string;
let sourceId: string;
let fontsDir: string;
let media: string;
let thumb: string | null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "alcyo-media-"));
  const index = new StreamsIndex(root);
  streams = new StreamService({
    index,
    settings: new SettingsFile(root, "darwin"),
    defaultStreamsDir: join(root, "Streams"),
    worker: () => ({
      analyze: () => ({ done: new Promise(() => undefined), cancel: () => undefined }),
      linkInfo: () => Promise.reject(new Error("no")),
      download: () => ({ done: Promise.reject(new Error("no")), cancel: () => undefined }),
      matchClip: () => ({ done: Promise.resolve({ match: null }), cancel: () => undefined }),
    }),
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
    importBase: () => Promise.reject(new Error("no")),
    chooseVideo: () => Promise.resolve(null),
    emit: () => undefined,
    log: () => undefined,
  });
  const made = await createStream({ dir: join(root, "Streams"), name: "Stream" });
  streamId = made.project.streamId;
  await index.upsert({
    streamId,
    folder: made.folder,
    name: "Stream",
    thumbnail: null,
    lastActivityAt: F.AT,
    unread: false,
    preview: "",
  });
  store = await streams.forStream(streamId);
  media = join(root, "Stream recordings 名前", "it's live.mp4");
  await mkdir(join(media, ".."), { recursive: true });
  await writeFile(media, "0123456789");
  sourceId = (await store.addFileSource(media)).sourceId;
  await store.applyAnalysis(sourceId, {
    probe: { ...F.source.probe!, playsDirectly: true },
    fingerprint: F.source.fingerprint,
  });
  fontsDir = join(root, "fonts");
  await mkdir(fontsDir);
  await writeFile(join(fontsDir, "Inter-Black.ttf"), "font");
  thumb = join(store.paths.cacheDir(sourceId), "thumbs-002.jpg");
  await mkdir(store.paths.cacheDir(sourceId), { recursive: true });
  await writeFile(thumb, "jpg");
});

const deps = () => ({
  forStream: (id: string) => streams.forStream(id),
  thumbnail: () => Promise.resolve(thumb),
  fontsDir,
});

describe("alcyo-media://", () => {
  it("resolves sources, thumbnails and fonts by id only", async () => {
    expect(await resolveMedia(sourceUrl(streamId, sourceId), deps())).toBe(media);
    expect(await resolveMedia(`alcyo-media://thumb/${streamId}`, deps())).toBe(thumb);
    expect(await resolveMedia("alcyo-media://fonts/Inter-Black.ttf", deps())).toBe(
      join(fontsDir, "Inter-Black.ttf"),
    );
  });

  it("refuses anything else", async () => {
    const no = [
      "alcyo-media://fonts/../secret.ttf",
      "alcyo-media://fonts/Missing.ttf",
      `alcyo-media://source/${streamId}/src_nothere12`,
      `alcyo-media://source/${streamId}/${sourceId}/extra`,
      "alcyo-media://source/s_nosuchstrm/src_nothere12",
      "alcyo-media://file/etc/passwd",
      `alcyo-media://source/${encodeURIComponent("../..")}/${sourceId}`,
      "file:///etc/passwd",
    ];
    for (const url of no) expect(await resolveMedia(url, deps()), url).toBeNull();
    // A thumbnail path outside the stream's cache is refused.
    thumb = "/etc/hosts";
    expect(await resolveMedia(`alcyo-media://thumb/${streamId}`, deps())).toBeNull();
  });

  it("serves the waveform and numbered thumbnails of a stream's source", async () => {
    const cache = store.paths.cacheDir(sourceId);
    await writeFile(join(cache, "peaks.bin"), "pk");
    expect(await resolveMedia(`alcyo-media://peaks/${streamId}/${sourceId}`, deps())).toBe(
      join(cache, "peaks.bin"),
    );
    expect(await resolveMedia(`alcyo-media://frames/${streamId}/${sourceId}/2`, deps())).toBe(
      thumb,
    );
    for (const bad of ["0", "x", "2/3", "../2"]) {
      expect(
        await resolveMedia(`alcyo-media://frames/${streamId}/${sourceId}/${bad}`, deps()),
      ).toBeNull();
    }
    expect(await resolveMedia(`alcyo-media://peaks/${streamId}/src_notmine123`, deps())).toBeNull();
  });

  it("uses the proxy when the recording doesn't play directly", async () => {
    await store.applyAnalysis(sourceId, {
      probe: { ...F.source.probe!, playsDirectly: false },
      fingerprint: F.source.fingerprint,
    });
    expect(await resolveMedia(sourceUrl(streamId, sourceId), deps())).toBeNull();
    const proxy = join(store.paths.cacheDir(sourceId), "proxy.mp4");
    await writeFile(proxy, "proxy");
    expect(await resolveMedia(sourceUrl(streamId, sourceId), deps())).toBe(proxy);
  });

  it("answers Range requests with 206", async () => {
    expect(parseRange("bytes=2-4", 10)).toEqual([2, 4]);
    expect(parseRange("bytes=7-", 10)).toEqual([7, 9]);
    expect(parseRange("bytes=-3", 10)).toEqual([7, 9]);
    expect(parseRange("bytes=20-", 10)).toBe("bad");
    expect(parseRange(null, 10)).toBeNull();
    const part = await fileResponse(media, "bytes=2-4");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await part.text()).toBe("234");
    const whole = await fileResponse(media, null);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(await whole.text()).toBe("0123456789");
    expect((await fileResponse(media, "bytes=50-")).status).toBe(416);
  });

  it("the handler serves GET and 404s the rest", async () => {
    const h = mediaHandler(deps());
    const ok = await h(
      new Request(sourceUrl(streamId, sourceId), { headers: { range: "bytes=0-0" } }),
    );
    expect(ok.status).toBe(206);
    expect(await ok.text()).toBe("0");
    expect((await h(new Request("alcyo-media://fonts/nope.ttf"))).status).toBe(404);
    expect((await h(new Request(sourceUrl(streamId, sourceId), { method: "POST" }))).status).toBe(
      404,
    );
  });
});

describe("dropped files", () => {
  it("keeps only real files, hands them out once, and expires", async () => {
    let now = 0;
    const box = new DropBox(() => now);
    expect(await box.put([join(root, "nothing.mp4")])).toBeNull();
    const got = (await box.put([media, join(root, "nothing.mp4")]))!;
    expect(got.names).toEqual(["it's live.mp4"]);
    expect(box.take(got.token)).toEqual([media]);
    expect(box.take(got.token)).toBeNull();
    const later = (await box.put([media]))!;
    now = 11 * 60_000;
    expect(box.take(later.token)).toBeNull();
    expect(EXPIRED).toMatch(/Drop the file again/);
  });

  it("a drop on home makes a stream; in a stream with a recording, clips", async () => {
    const out = await streams.useFiles([media]);
    expect("streamId" in out && out.streamId).not.toBe(streamId);
    const clip = join(root, "clip.mov");
    await writeFile(clip, "clip");
    expect(await streams.useFiles([clip], streamId)).toEqual({ streamId });
    expect((await store.clips()).map((c) => c.origin.path)).toEqual([clip]);
    const txt = join(root, "notes.txt");
    await writeFile(txt, "hi");
    expect(await streams.useFiles([txt], streamId)).toEqual({
      failed: true,
      message: COPY.notVideo,
    });
  });
});
