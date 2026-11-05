// Open demo (spec 13): copies examples/demo.alcyo into the streams folder,
// with its recording and clips copied into the project, so the demo needs no
// agent, key, network or model. Electron-free.
import { copyFile, cp, mkdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { pickPoster } from "@alcyo/media";
import { ClipFile, CreatorProfile, Source } from "@alcyo/schema";
import {
  type ProfileStore,
  ProjectStore,
  StoreError,
  type StreamsIndex,
  exists,
  readJson,
  uniqueStreamFolder,
  writeJsonAtomic,
} from "@alcyo/store";

export const DEMO_STREAM_ID = "s_demostream";
export const DEMO_FOLDER = "demo.alcyo";
export const DEMO_PROFILE = "demo-profile.json";

export const DEMO_COPY = {
  missing: "The demo isn't in this build of Alcyo. Start a stream from a link or a file instead.",
  opened:
    "This is the demo stream. Its recording and viewer clips were copied into this project; nothing was uploaded. Find shorts and chat need a signed-in agent; playing, editing and rendering don't.",
} as const;

export interface DemoDeps {
  /** examples/ in a checkout, resources/demo when packaged. */
  root: string;
  streamsDir: () => Promise<string>;
  index: StreamsIndex;
  profiles: Pick<ProfileStore, "profile" | "saveProfile">;
  now?: () => Date;
}

/** Folders the app makes that the copy leaves out. */
const SKIP = new Set(["renders"]);

/**
 * The demo stream, copied the first time. Later calls return the same stream
 * unless its folder is gone. created says whether this call copied it.
 */
export async function openDemo(deps: DemoDeps): Promise<{ streamId: string; created: boolean }> {
  const now = deps.now ?? (() => new Date());
  const existing = (await deps.index.list()).find((e) => e.streamId === DEMO_STREAM_ID);
  if (existing !== undefined && (await exists(existing.folder))) {
    return { streamId: DEMO_STREAM_ID, created: false };
  }
  const from = join(deps.root, DEMO_FOLDER);
  if (!(await exists(join(from, "project.json"))))
    throw new StoreError("not-found", DEMO_COPY.missing);

  const dir = await deps.streamsDir();
  await mkdir(dir, { recursive: true });
  const folder = await uniqueStreamFolder(dir, "Demo Stream");
  await cp(from, folder, {
    recursive: true,
    filter: (path) => {
      const rel = relative(from, path);
      return !SKIP.has(rel.split(sep)[0] ?? "");
    },
  });

  // The committed files point at ../demo/ relative to the project; the store
  // resolves them against the original folder, then they're copied in.
  const original = await ProjectStore.open(from, now);
  const store = await ProjectStore.open(folder, now);
  const project = await store.project();
  if (project.streamId !== DEMO_STREAM_ID) throw new StoreError("bad-file", DEMO_COPY.missing);
  let thumbnail: string | null = null;
  for (const { sourceId } of project.sources) {
    const source = await original.source(sourceId);
    const target = join(store.paths.sourceDir(sourceId), "media.mp4");
    await copyFile(source.origin.path, target);
    await writeJsonAtomic(
      store.paths.source(sourceId),
      Source.parse({ ...source, origin: { kind: "file", path: target, copied: true } }),
    );
    if (thumbnail === null) {
      const cache = store.paths.cacheDir(sourceId);
      const poster = (await exists(cache)) ? await pickPoster(cache) : null;
      if (poster !== null) thumbnail = join(cache, poster);
    }
  }
  for (const clipId of project.clips) {
    const clip = await original.clip(clipId);
    if (clip.origin.path === undefined) continue;
    const target = join(store.paths.clipDir(clipId), "media.mp4");
    await mkdir(store.paths.clipDir(clipId), { recursive: true });
    await copyFile(clip.origin.path, target);
    await writeJsonAtomic(
      store.paths.clip(clipId),
      ClipFile.parse({ ...clip, origin: { kind: "file", path: target } }),
    );
  }
  await store.setCopyIntoProject(true);

  await deps.index.upsert({
    streamId: DEMO_STREAM_ID,
    folder,
    name: project.name,
    thumbnail,
    lastActivityAt: now().toISOString(),
    unread: false,
    preview: DEMO_COPY.opened.slice(0, 120),
  });

  if ((await deps.profiles.profile()) === null) {
    const profile = await readJson(join(deps.root, DEMO_PROFILE), CreatorProfile);
    if (profile !== null) await deps.profiles.saveProfile(profile);
  }
  return { streamId: DEMO_STREAM_ID, created: true };
}
