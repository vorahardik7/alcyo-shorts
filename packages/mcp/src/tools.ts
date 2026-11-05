// The seven tools (plan sections 23 spec 12 and 27). Plain async functions
// with Zod inputs, so they're tested without a transport. Reads and writes
// stay under the root; the recording a short uses must be inside it too.
import { realpath } from "node:fs/promises";
import { mkdir, readFile, readdir, withFileAccess } from "@alcyo/store/access";
import { basename, join } from "node:path";
import { type Runner, ffprobeArgs, parseFfprobe } from "@alcyo/media";
import {
  DEFAULT_RENDER_PRESET,
  RENDER_PRESETS,
  renderFileName,
  resolveShortStyles,
} from "@alcyo/render";
import { renderShort } from "@alcyo/render/runner";
import {
  BUILTIN_CAPTION_PRESETS,
  BUILTIN_HOOK_PRESETS,
  Id,
  type Issue,
  Ms,
  ShortVersion,
  ShortStyles,
  checkVersion,
  shortDuration,
  zodIssues,
} from "@alcyo/schema";
import {
  ProjectStore,
  StoreError,
  exists,
  fingerprintKey,
  hashFile,
  newId,
  readJson,
} from "@alcyo/store";
import { z } from "zod";
import { type Root, ToolError } from "./root.ts";

export interface ToolContext {
  root: Root;
  ffmpeg: string;
  ffprobe: string;
  fontsDir: string;
  run: Runner;
}

const Folder = z
  .string()
  .min(1)
  .max(1000)
  .describe(
    'A stream folder (a ".alcyo" folder), relative to the root, e.g. "demo/Demo Stream.alcyo".',
  );
const Version = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("A version number. The latest when left out.");

export const inputs = {
  probe_video: z.object({
    path: z.string().min(1).max(1000).describe("A video file, relative to the root."),
  }),
  open_project: z.object({
    folder: Folder.optional().describe(
      "A stream folder. Leave it out to list the stream folders under the root.",
    ),
  }),
  list_shorts: z.object({ folder: Folder }),
  get_transcript_window: z
    .object({
      folder: Folder,
      sourceId: Id.optional().describe(
        "The source. The first one with a transcript when left out.",
      ),
      fromMs: Ms.describe("Start, in source milliseconds."),
      toMs: Ms.describe("End, in source milliseconds. At most 10 minutes after fromMs."),
    })
    .refine((v) => v.toMs > v.fromMs && v.toMs - v.fromMs <= 600_000, {
      message: "toMs must be after fromMs, and at most 10 minutes after it.",
    }),
  get_thread: z.object({
    folder: Folder,
    limit: z.number().int().min(1).max(200).default(50).describe("How many messages, newest last."),
    before: Id.optional().describe("Only messages before this message id."),
  }),
  validate_version: z.object({ folder: Folder, shortId: Id, version: Version }),
  render_short: z.object({
    folder: Folder,
    shortId: Id,
    version: Version,
    presetId: z.enum(RENDER_PRESETS.map((p) => p.id) as [string, ...string[]]).optional(),
  }),
} as const;

export type ToolName = keyof typeof inputs;
type In<N extends ToolName> = z.output<(typeof inputs)[N]>;

async function openStore(ctx: ToolContext, folder: string): Promise<ProjectStore> {
  const dir = await ctx.root.resolve(folder, "That stream folder");
  try {
    return await ProjectStore.open(dir);
  } catch (error) {
    if (error instanceof StoreError)
      throw new ToolError(`${folder} isn't a stream folder: ${error.message}`);
    throw error;
  }
}

/** Stream folders under dir, a few levels down. */
async function findStreams(dir: string, depth: number): Promise<string[]> {
  if (depth < 0) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (await exists(join(p, "project.json"))) out.push(p);
    else out.push(...(await findStreams(p, depth - 1)));
  }
  return out;
}

async function probe_videoImpl(ctx: ToolContext, { path }: In<"probe_video">) {
  const file = await ctx.root.resolveFile(path, "That video");
  const out = await ctx.run(ctx.ffprobe, ffprobeArgs(file), { collectStdout: true });
  if (out.code !== 0)
    throw new ToolError("ffprobe couldn't read that file. It may not be a video.");
  return { path: await ctx.root.show(file), probe: parseFfprobe(out.stdout) };
}

async function open_projectImpl(ctx: ToolContext, { folder }: In<"open_project">) {
  if (folder === undefined) {
    const found = await findStreams(await ctx.root.resolve(".", "The root folder"), 3);
    const streams = [];
    for (const f of found) {
      const store = await ProjectStore.open(f).catch(() => null);
      if (store === null) continue;
      const p = await store.project();
      streams.push({
        folder: await ctx.root.show(f),
        streamId: p.streamId,
        name: p.name,
        shorts: p.shorts.length,
      });
    }
    return { streams };
  }
  const store = await openStore(ctx, folder);
  const p = await store.project();
  const sources = [];
  for (const { source, missing } of await store.sources()) {
    const inRoot = await ctx.root.contains(source.origin.path).catch(() => false);
    sources.push({
      sourceId: source.sourceId,
      kind: source.origin.kind,
      file: inRoot
        ? await ctx.root.show(await realpath(source.origin.path).catch(() => source.origin.path))
        : basename(source.origin.path),
      insideRoot: inRoot,
      missing,
      durationMs: source.probe?.durationMs ?? null,
      video:
        source.probe?.video == null
          ? null
          : {
              width: source.probe.video.width,
              height: source.probe.video.height,
              fps: source.probe.video.fpsNum / source.probe.video.fpsDen,
            },
      transcript: await exists(store.paths.analysis(source.sourceId, "transcript.json")),
      title: source.info?.title ?? null,
    });
  }
  const clips = await store.clips();
  return {
    folder: await ctx.root.show(store.folder),
    streamId: p.streamId,
    name: p.name,
    createdAt: p.createdAt,
    sources,
    clips: {
      total: clips.length,
      placed: clips.filter((c) => c.match !== null && c.match.confidence >= 0.6).length,
    },
    shorts: p.shorts,
    messages: (await store.messages()).length,
    renders: (await store.renders()).length,
  };
}

async function list_shortsImpl(ctx: ToolContext, { folder }: In<"list_shorts">) {
  const store = await openStore(ctx, folder);
  const shorts = [];
  for (const { shortId } of (await store.project()).shorts) {
    const file = await store.shortFile(shortId);
    const v = await store.version(shortId);
    shorts.push({
      shortId,
      status: file.status,
      head: file.head,
      title: v.short.title,
      hook: v.short.hook?.text ?? null,
      reason: v.short.reason,
      durationMs: shortDuration(v.short.segments),
      segments: v.short.segments,
      captionPresetId: v.short.captions.presetId,
      cropKeys: v.short.crop.keys.length,
      versions: await store.versions(shortId),
    });
  }
  return { shorts };
}

async function get_transcript_windowImpl(ctx: ToolContext, args: In<"get_transcript_window">) {
  const store = await openStore(ctx, args.folder);
  let sourceId = args.sourceId;
  if (sourceId === undefined) {
    for (const { source } of await store.sources()) {
      if (await exists(store.paths.analysis(source.sourceId, "transcript.json"))) {
        sourceId = source.sourceId;
        break;
      }
    }
  }
  if (sourceId === undefined) throw new ToolError("This stream has no transcript yet.");
  const w = await store.transcriptWindow(sourceId, args.fromMs, args.toMs).catch((e: unknown) => {
    throw new ToolError(e instanceof Error ? e.message : String(e));
  });
  const text = new Map(w.words.map((x) => [x.id, x.text]));
  return {
    sourceId,
    fromMs: args.fromMs,
    toMs: args.toMs,
    lines: w.lines.map((l) => ({
      id: l.id,
      startMs: l.startMs,
      endMs: l.endMs,
      text: l.wordIds
        .map((id) => text.get(id) ?? "")
        .join(" ")
        .trim(),
    })),
    words: w.words,
  };
}

async function get_threadImpl(ctx: ToolContext, { folder, limit, before }: In<"get_thread">) {
  const store = await openStore(ctx, folder);
  const all = await store.messages();
  return { total: all.length, messages: await store.pageMessages(limit, before) };
}

/** Reads a version file as it is on disk, without the store's own checks. */
async function readVersionFile(store: ProjectStore, shortId: string, version: number | undefined) {
  const n = version ?? (await store.shortFile(shortId).catch(() => null))?.head;
  if (n === undefined) throw new ToolError(`There's no short ${shortId} in this stream.`);
  const names = await readdir(store.paths.versions(shortId)).catch(() => [] as string[]);
  const name = names.find((f) =>
    new RegExp(`^${String(n).padStart(4, "0")}\\.(claude|user)\\.json$`).test(f),
  );
  if (name === undefined) throw new ToolError(`Version ${n} of ${shortId} doesn't exist.`);
  return { n, file: join(store.paths.versions(shortId), name) };
}

async function validate_versionImpl(ctx: ToolContext, args: In<"validate_version">) {
  const store = await openStore(ctx, args.folder);
  const { n, file } = await readVersionFile(store, args.shortId, args.version);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return {
      valid: false,
      shortId: args.shortId,
      version: n,
      issues: [{ path: "(file)", message: "The file isn't valid JSON." }],
    };
  }
  const parsed = ShortVersion.safeParse(raw);
  if (!parsed.success) {
    return { valid: false, shortId: args.shortId, version: n, issues: zodIssues(parsed.error) };
  }
  const v = parsed.data;
  const styles =
    v.short.styles ?? (await readJson(store.paths.styles(args.shortId, n), ShortStyles));
  const source = await store.source(v.sourceId).catch(() => null);
  if (source === null) {
    return {
      valid: false,
      shortId: v.shortId,
      version: n,
      issues: [{ path: "sourceId", message: `Source ${v.sourceId} isn't in this stream.` }],
    };
  }
  const words = await store.transcript(v.sourceId).catch(() => null);
  const issues: Issue[] = checkVersion(v, {
    ...(source.probe === null ? {} : { sourceDurationMs: source.probe.durationMs }),
    ...(words === null ? {} : { wordIds: new Set(words.words.map((w) => w.id)) }),
  });
  if (v.version !== n)
    issues.push({ path: "version", message: `The file is version ${n} but says ${v.version}.` });
  if (v.sourceFingerprint !== fingerprintKey(source.fingerprint)) {
    issues.push({
      path: "sourceFingerprint",
      message: "This version was made from a different recording.",
    });
  }
  const known = (list: readonly { id: string }[], id: string | undefined) =>
    id === undefined || list.some((p) => p.id === id);
  if (
    !known(styles == null ? BUILTIN_CAPTION_PRESETS : [styles.caption], v.short.captions.presetId)
  ) {
    issues.push({
      path: "short.captions.presetId",
      message: `${v.short.captions.presetId} isn't available in this project. Import the template in the app first.`,
    });
  }
  if (!known(styles == null ? BUILTIN_HOOK_PRESETS : [styles.hook], v.short.hook?.presetId)) {
    issues.push({
      path: "short.hook.presetId",
      message: `${v.short.hook?.presetId} isn't available in this project. Import the template in the app first.`,
    });
  }
  return {
    valid: issues.length === 0,
    shortId: v.shortId,
    version: n,
    createdBy: v.createdBy,
    durationMs: shortDuration(v.short.segments),
    issues,
  };
}

async function render_shortImpl(ctx: ToolContext, args: In<"render_short">) {
  const store = await openStore(ctx, args.folder);
  const v = await store.version(args.shortId, args.version).catch((e: unknown) => {
    throw new ToolError(e instanceof Error ? e.message : String(e));
  });
  const source = await store.source(v.sourceId);
  const media = await ctx.root
    .resolveFile(source.origin.path, "The recording")
    .catch((e: unknown) => {
      throw new ToolError(
        e instanceof ToolError && e.message.includes("outside")
          ? "The recording is outside the root folder, so this server won't read it."
          : "The recording isn't where the stream says. Locate it in the app first.",
      );
    });
  if (
    fingerprintKey(await hashFile(media).then((h) => ({ ...h }))) !==
    fingerprintKey(source.fingerprint)
  ) {
    throw new ToolError("That's a different file from the one the stream was made from.");
  }
  const video = source.probe?.video ?? null;
  if (video === null) throw new ToolError("This recording has no video, so it can't be rendered.");
  const preset = RENDER_PRESETS.find((p) => p.id === args.presetId) ?? DEFAULT_RENDER_PRESET;
  const styles =
    v.short.styles ?? (await store.freezeStyles(v.shortId, v.version, resolveShortStyles(v.short)));
  const { caption, hook } = styles;
  const from = v.short.segments[0]!.srcIn;
  const to = v.short.segments.at(-1)!.srcOut;
  const words = await store
    .transcript(v.sourceId)
    .then((t) => t.words.filter((w) => w.endMs > from && w.startMs < to))
    .catch(() => []);

  await mkdir(store.paths.renders, { recursive: true });
  const name = renderFileName(v.short.title, v.version, preset);
  let outPath = join(store.paths.renders, name);
  for (let n = 2; await exists(outPath); n++)
    outPath = join(store.paths.renders, name.replace(/\.mp4$/, `-${n}.mp4`));
  const renderId = newId("r");
  const started = Date.now();
  const out = await renderShort(
    {
      ffmpeg: ctx.ffmpeg,
      ffprobe: ctx.ffprobe,
      fontsDir: ctx.fontsDir,
      workDir: join(store.paths.cache, `render-${renderId}`),
      sourcePath: media,
      source: {
        width: video.width,
        height: video.height,
        fpsNum: video.fpsNum,
        fpsDen: video.fpsDen,
        hasAudio: source.probe?.audio != null,
      },
      short: v.short,
      words,
      caption,
      hook,
      preset,
      outPath,
    },
    { run: ctx.run },
    () => undefined,
    new AbortController().signal,
  ).catch((e: unknown) => {
    throw new ToolError(e instanceof Error ? e.message : String(e));
  });
  await store.addRender({
    renderId,
    shortId: v.shortId,
    version: v.version,
    presetId: preset.id,
    file: basename(outPath),
    createdAt: new Date().toISOString(),
    probe: out,
  });
  return {
    renderId,
    shortId: v.shortId,
    version: v.version,
    file: await ctx.root.show(outPath),
    path: outPath,
    expectedMs: shortDuration(v.short.segments),
    ffprobe: out,
    tookMs: Date.now() - started,
  };
}

function confined<A, R>(run: (ctx: ToolContext, args: A) => Promise<R>) {
  return (ctx: ToolContext, args: A): Promise<R> =>
    withFileAccess(
      (path) => ctx.root.resolveAny(path),
      () => run(ctx, args),
    );
}

export const probe_video = confined(probe_videoImpl);
export const open_project = confined(open_projectImpl);
export const list_shorts = confined(list_shortsImpl);
export const get_transcript_window = confined(get_transcript_windowImpl);
export const get_thread = confined(get_threadImpl);
export const validate_version = confined(validate_versionImpl);
export const render_short = confined(render_shortImpl);

export const tools = {
  probe_video,
  open_project,
  list_shorts,
  get_transcript_window,
  get_thread,
  validate_version,
  render_short,
} as const;
