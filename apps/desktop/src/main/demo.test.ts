import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore, ProjectStore, StreamsIndex, createStream } from "@alcyo/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_COPY, DEMO_FOLDER, DEMO_PROFILE, DEMO_STREAM_ID, openDemo } from "./demo";

let root: string;
let examples: string;
let streamsDir: string;
let index: StreamsIndex;
let profiles: ProfileStore;

const profile = {
  schemaVersion: 1,
  name: "Demo",
  streams: "Boss fights",
  audience: "",
  goodMoments: ["skill"],
  lengthMs: { min: 15_000, max: 30_000 },
  titleRules: "Short.",
  exampleTitles: [],
  avoid: [],
  platforms: ["tiktok"],
  captionPresetId: "bold-pop",
  hookPresetId: "hook-bold",
  style: { summary: "", sampleCount: 0 },
};

/** A committed-style demo: media in examples/demo/, paths relative to the project. */
async function makeExamples(): Promise<void> {
  await mkdir(join(examples, "demo"), { recursive: true });
  await writeFile(join(examples, "demo", "clip.mp4"), Buffer.alloc(64 * 1024, 3));
  await writeFile(join(examples, "demo", "clip-a.mp4"), Buffer.alloc(16 * 1024, 4));
  const { folder } = await createStream({
    dir: join(root, "build"),
    name: "Demo Stream",
    streamId: DEMO_STREAM_ID,
  });
  const store = await ProjectStore.open(folder);
  const source = await store.addFileSource(join(examples, "demo", "clip.mp4"));
  await store.addClip({
    clipId: "clip_a",
    origin: { kind: "file", path: join(examples, "demo", "clip-a.mp4") },
    durationMs: 10_000,
  });
  await mkdir(join(folder, "cache", source.sourceId), { recursive: true });
  await writeFile(join(folder, "cache", source.sourceId, "thumbs-001.jpg"), Buffer.alloc(8192, 1));
  await mkdir(join(folder, "renders"), { recursive: true });
  await writeFile(join(folder, "renders", "old.mp4"), "x");
  const target = join(examples, DEMO_FOLDER);
  await cp(folder, target, { recursive: true });
  const rel = async (file: string, path: string) => {
    const json = JSON.parse(await readFile(file, "utf8")) as { origin: { path: string } };
    json.origin.path = path;
    await writeFile(file, JSON.stringify(json));
  };
  await rel(join(target, "sources", source.sourceId, "source.json"), "../demo/clip.mp4");
  await rel(join(target, "clips", "clip_a", "clip.json"), "../demo/clip-a.mp4");
  await writeFile(join(examples, DEMO_PROFILE), JSON.stringify(profile));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "alcyo-demo-"));
  examples = join(root, "examples");
  streamsDir = join(root, "Streams");
  index = new StreamsIndex(join(root, "userData"));
  profiles = new ProfileStore(join(root, "userData"));
  await makeExamples();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const open = () =>
  openDemo({ root: examples, streamsDir: () => Promise.resolve(streamsDir), index, profiles });

describe("openDemo", () => {
  it("copies the project and its media in, without renders, and lists it", async () => {
    await expect(open()).resolves.toEqual({ streamId: DEMO_STREAM_ID, created: true });
    const entry = await index.get(DEMO_STREAM_ID);
    expect(entry.folder).toBe(join(streamsDir, "Demo Stream.alcyo"));
    expect(entry.thumbnail).toMatch(/thumbs-001\.jpg$/);
    expect(await readdir(entry.folder)).not.toContain("renders");

    const store = await ProjectStore.open(entry.folder);
    const [view] = await store.sources();
    expect(view!.missing).toBe(false);
    expect(view!.source.origin).toEqual({
      kind: "file",
      path: join(store.paths.sourceDir(view!.source.sourceId), "media.mp4"),
      copied: true,
    });
    const clip = await store.clip("clip_a");
    expect(clip.origin.path).toBe(join(store.paths.clipDir("clip_a"), "media.mp4"));
    expect((await store.project()).settings.copyIntoProject).toBe(true);
    // The examples folder is left as it was.
    expect(await readdir(join(examples, "demo"))).toEqual(["clip-a.mp4", "clip.mp4"]);
  });

  it("opens the same stream the second time, and copies again only when it's gone", async () => {
    await open();
    await expect(open()).resolves.toEqual({ streamId: DEMO_STREAM_ID, created: false });
    await rm(join(streamsDir, "Demo Stream.alcyo"), { recursive: true });
    await expect(open()).resolves.toEqual({ streamId: DEMO_STREAM_ID, created: true });
    expect((await index.list()).filter((e) => e.streamId === DEMO_STREAM_ID)).toHaveLength(1);
  });

  it("installs the demo profile only when there is none", async () => {
    await open();
    expect((await profiles.profile())?.name).toBe("Demo");

    await rm(join(streamsDir, "Demo Stream.alcyo"), { recursive: true });
    await profiles.saveProfile({ ...(await profiles.profile())!, name: "Mine" });
    await open();
    expect((await profiles.profile())?.name).toBe("Mine");
  });

  it("says plainly when the demo isn't there", async () => {
    await rm(join(examples, DEMO_FOLDER), { recursive: true });
    await expect(open()).rejects.toThrow(DEMO_COPY.missing);
  });
});
