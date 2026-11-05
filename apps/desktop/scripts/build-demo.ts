// Builds examples/demo.alcyo with the app's own services (spec 13). In a temp
// folder, the stand-in stream and two viewer clips are analyzed with the
// bundled tools, the clips are matched, a real agent proposes the shorts and
// answers one chat message, and one editor save is made. The project is then
// copied into examples/ with media paths relative to it, so it opens from any
// checkout and through the MCP server.
//
//   pnpm demo:build [--agent grok|claude|codex|script] [--new-clip | --generate-stand-in]
//
// macOS only: the stand-in footage is voiced with `say`. The whisper small.en
// model must be downloaded first (the app's Settings > Models does that).
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { matchClipFiles } from "@alcyo/import";
import type { AnalysisRequest } from "@alcyo/ipc";
import { analyze, runTool } from "@alcyo/media";
import {
  type LlmProvider,
  claudeProvider,
  codexProvider,
  grokProvider,
  realSpawnDeps,
} from "@alcyo/planner";
import { cropSize } from "@alcyo/render";
import {
  ClipFile,
  CreatorProfile,
  type Short,
  Source,
  Transcript,
  setCropKey,
  setHook,
} from "@alcyo/schema";
import {
  ProfileStore,
  ProjectStore,
  SettingsFile,
  StreamsIndex,
  createStream,
  readJson,
  writeJsonAtomic,
} from "@alcyo/store";
import { GROK_OPTIONS } from "../src/main/agent";
import { DEMO_FOLDER, DEMO_PROFILE, DEMO_STREAM_ID } from "../src/main/demo";
import { EditorService } from "../src/main/editor";
import { PlannerService } from "../src/main/planner";
import { StreamService } from "../src/main/streams";
import { scriptedAgent } from "../src/main/test-agent";
import { parseDemoOptions, prepareDemoInput } from "./demo-options";

const run = promisify(execFile);
// scripts/demo.mjs runs this as a bundle from out/, so it says where the repo is.
const repo = process.env["ALCYO_REPO"] ?? resolve(import.meta.dirname, "..", "..", "..");
const examples = join(repo, "examples");
const media = join(examples, "demo");
const bin = join(repo, "apps", "desktop", "resources", "bin", "mac-arm64");
const fonts = join(repo, "apps", "desktop", "resources", "fonts");
const scriptText = join(repo, "scripts", "demo", "script.txt");
const model = join(homedir(), "Library", "Application Support", "Alcyo Shorts", "models");

const VOICE = "Reed (English (US))";
const VOICE_RATE = "175";
const W = 1280;
const H = 720;
/** The boss box's center at source second s; the reframe in the editor save follows it. */
const bossX = (s: number) => 640 + 420 * Math.sin(s / 3);
const CLIP_MS = 10_000;

const options = parseDemoOptions(process.argv.slice(2));
const agentName = options.agent;

function say(line: string): void {
  console.log(`[demo] ${line}`);
}

const tool = (name: string) => join(bin, name);

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function ffmpeg(argv: string[]): Promise<void> {
  await run(tool("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", ...argv], {
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function durationMs(file: string): Promise<number> {
  const { stdout } = await run(tool("ffprobe"), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Math.round(Number(stdout.trim()) * 1000);
}

const ENCODE = [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "30",
  "-pix_fmt",
  "yuv420p",
  "-g",
  "60",
  "-c:a",
  "aac",
  "-b:a",
  "96k",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-movflags",
  "+faststart",
];

/** The stand-in stream: a voiced script over a moving gradient, a title and a moving "boss". */
async function makeStream(out: string, work: string): Promise<void> {
  const voice = join(work, "voice.aiff");
  await run("say", ["-v", VOICE, "-r", VOICE_RATE, "-o", voice, "-f", scriptText]);
  const seconds = Math.ceil((await durationMs(voice)) / 1000) + 2;
  const font = (name: string) => `fontfile='${join(fonts, name)}'`;
  const background = [
    `gradients=s=${W}x${H}:r=30:d=${seconds}:c0=0x1b1446:c1=0x0e3a5c:c2=0x3a1240:n=3:speed=0.015[bg]`,
    `color=c=0xf5c518:s=120x180:r=30:d=${seconds}[boss]`,
  ].join(";");
  const filter = [
    // Keep in step with bossX. overlay reads t per frame; drawbox's t is its thickness.
    `[bg][boss]overlay=x='640+420*sin(t/3)-60':y=430:eval=frame`,
    `drawtext=${font("Inter-Black.ttf")}:text='THE WARDEN':fontsize=22:fontcolor=0xf5c518:x='640+420*sin(t/3)-tw/2':y=395`,
    `drawtext=${font("Inter-Black.ttf")}:text='HOLLOW PEAK':fontsize=64:fontcolor=white:x=(w-tw)/2:y=90`,
    `drawtext=${font("Inter-SemiBold.ttf")}:text='The Warden · attempt 12':fontsize=30:fontcolor=white@0.8:x=(w-tw)/2:y=172`,
    `drawtext=${font("Inter-SemiBold.ttf")}:text='LIVE %{pts\\:hms}':fontsize=24:fontcolor=white:x=40:y=40:box=1:boxcolor=0xd0021b@0.9:boxborderw=10[v]`,
  ].join(",");
  await ffmpeg([
    "-i",
    voice,
    "-filter_complex",
    `${background};${filter};[0:a]adelay=500|500,apad[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    String(seconds),
    ...ENCODE,
    out,
  ]);
}

async function cut(from: string, startMs: number, out: string): Promise<void> {
  await ffmpeg([
    "-ss",
    (startMs / 1000).toFixed(3),
    "-i",
    from,
    "-t",
    (CLIP_MS / 1000).toFixed(3),
    ...ENCODE,
    out,
  ]);
}

function version(name: string, manifest: { tools: Record<string, { version: string }> }): string {
  return manifest.tools[name]?.version ?? "unknown";
}

/** The agent on this computer, found the way the app does on macOS. */
async function locate(name: "claude" | "grok" | "codex"): Promise<string> {
  const shell = process.env["SHELL"] ?? "/bin/zsh";
  const { stdout } = await run(shell, ["-ilc", `command -v ${name}`], { timeout: 5000 });
  const path = stdout.trim().split("\n").at(-1) ?? "";
  if (path.length === 0) throw new Error(`${name} isn't on this computer's PATH.`);
  return path;
}

async function provider(): Promise<{ provider: LlmProvider; label: string }> {
  const spawn = realSpawnDeps();
  switch (agentName) {
    case "grok":
      return { provider: grokProvider(await locate("grok"), spawn, GROK_OPTIONS), label: "Grok" };
    case "claude":
      return { provider: claudeProvider(await locate("claude"), spawn), label: "Claude Code" };
    case "codex":
      return { provider: codexProvider(await locate("codex"), spawn), label: "Codex" };
    case "script":
      return { provider: scriptedAgent(), label: "Test agent" };
  }
}

/** Source time at short time t, through the kept segments. */
function srcAt(short: Short, t: number): number {
  let left = t;
  for (const s of short.segments) {
    const len = s.srcOut - s.srcIn;
    if (left < len) return s.srcIn + left;
    left -= len;
  }
  return short.segments.at(-1)!.srcOut;
}

const shortLength = (short: Short) => short.segments.reduce((n, s) => n + (s.srcOut - s.srcIn), 0);

const PARRY_HOOK = "One hit left. Then this.";

/** The editor save: a hook, and the crop following the boss box. */
function editorEdit(short: Short, hook: string): Short {
  const hooked = setHook(short, {
    text: hook,
    start: 0,
    end: Math.min(2500, shortLength(short)),
    presetId: short.hook?.presetId ?? "hook-bold",
  });
  // Real replacement footage has no generated boss box to follow.
  if (options.newClip) return hooked.ok ? hooked.value : short;
  // The proposal's single centered key is replaced by keys that follow the boss.
  let next: Short = { ...(hooked.ok ? hooked.value : short), crop: { keys: [] } };
  const { w } = cropSize(W, H);
  const room = W - w;
  const len = shortLength(next);
  for (let t = 0; t < len; t += 1500) {
    const x = (bossX(srcAt(next, t) / 1000) - w / 2) / room;
    next = setCropKey(next, { t, x: Math.max(0, Math.min(1, x)), ease: "linear" });
  }
  return { ...next, crop: { keys: next.crop.keys.filter((k) => k.t < len) } };
}

/** First word whose text matches, after an optional start. */
function wordAt(transcript: Transcript, re: RegExp): { startMs: number; endMs: number } {
  const w = transcript.words.find((x) => re.test(x.text));
  if (w === undefined) throw new Error(`The transcript has no word matching ${re}.`);
  return w;
}

const posix = (p: string) => p.split(sep).join("/");

async function main(): Promise<void> {
  if (process.platform !== "darwin") throw new Error("The demo is built on macOS (it uses say).");
  const modelPath = join(model, "ggml-small.en.bin");
  if (!(await exists(modelPath)))
    throw new Error("Download the small.en model first: open the app, Settings > Models.");
  const manifest = JSON.parse(await readFile(join(bin, "manifest.json"), "utf8")) as {
    tools: Record<string, { version: string }>;
  };
  const work = await mkdtemp(join(tmpdir(), "alcyo-demo-"));
  say(`Working in ${work}`);
  const agent = await provider();

  // 1. The stand-in stream.
  await mkdir(media, { recursive: true });
  const vod = join(media, "clip.mp4");
  await prepareDemoInput(vod, options, async (output) => {
    say("Making the stand-in stream");
    await makeStream(output, work);
  });
  const vodMs = await durationMs(vod);
  say(`Stream is ${(vodMs / 1000).toFixed(1)} s`);

  const base: Omit<AnalysisRequest, "sourceId" | "sourcePath" | "analysisDir" | "cacheDir"> = {
    tools: { ffmpeg: tool("ffmpeg"), ffprobe: tool("ffprobe"), whisper: tool("whisper-cli") },
    toolVersions: {
      ffmpeg: version("ffmpeg", manifest),
      whisper: version("whisper-cli", manifest),
    },
    model: { path: modelPath, name: "small.en" },
    vadModel: join(bin, "models", "ggml-silero-v6.2.0.bin"),
    mode: "full",
    encoder: "libx264",
    threads: 6,
  };

  // 2. Where the viewer clips go: transcribe once to find the two moments.
  say("Transcribing to place the viewer clips");
  const probeDir = join(work, "probe");
  await analyze(
    {
      ...base,
      mode: "quick",
      sourceId: "src_probe",
      sourcePath: vod,
      analysisDir: join(probeDir, "analysis"),
      cacheDir: join(probeDir, "cache"),
    },
    { run: runTool },
  );
  const probeWords = (await readJson(join(probeDir, "analysis", "transcript.json"), Transcript))!;
  const round = (ms: number) => Math.max(0, Math.round(ms / 100) * 100);
  const parry = round(wordAt(probeWords, /^parried/i).startMs - 5000);
  const ember = round(wordAt(probeWords, /^ember/i).startMs - 2500);
  const clips = [
    { file: "clip-parry.mp4", startMs: parry, title: "PARRIED THE TAIL" },
    { file: "clip-ember.mp4", startMs: ember, title: "1 in 200 drop" },
  ];
  for (const c of clips) await cut(vod, c.startMs, join(media, c.file));

  // 3. The app's services, on a temp userData and streams folder.
  const userData = join(work, "userData");
  const streamsDir = join(work, "Streams");
  await mkdir(userData, { recursive: true });
  const profiles = new ProfileStore(userData);
  const profile = CreatorProfile.parse(
    JSON.parse(await readFile(join(examples, DEMO_PROFILE), "utf8")),
  );
  await profiles.saveProfile(profile);
  const index = new StreamsIndex(userData);
  const settings = new SettingsFile(userData, "darwin");
  const late: { planner?: PlannerService } = {};
  const streams = new StreamService({
    index,
    settings,
    defaultStreamsDir: streamsDir,
    worker: () => ({
      analyze: (request, onEvent) => {
        const c = new AbortController();
        return {
          done: analyze(request, { run: runTool }, onEvent, c.signal),
          cancel: () => c.abort(),
        };
      },
      matchClip: (request) => {
        const c = new AbortController();
        return { done: matchClipFiles(request, c.signal), cancel: () => c.abort() };
      },
      linkInfo: () => Promise.reject(new Error("No links in the demo build.")),
      download: () => ({
        done: Promise.reject(new Error("No links in the demo build.")),
        cancel: () => undefined,
      }),
    }),
    analysisBase: () => Promise.resolve(base),
    importBase: () => Promise.reject(new Error("No links in the demo build.")),
    chooseVideo: () => Promise.resolve(null),
    emit: () => undefined,
    onReady: (streamId, phase) => void late.planner?.ready(streamId, phase),
    log: (line) => say(line),
  });
  const planner = new PlannerService({
    streams,
    agent: {
      provider: () => Promise.resolve(agent.provider),
      model: async () => (await settings.read()).model,
      label: () => Promise.resolve(agent.label),
    },
    profiles,
    emit: () => undefined,
    log: (line) => say(`planner: ${line}`),
  });
  late.planner = planner;
  const editor = new EditorService({ streams, profiles });

  const { folder } = await createStream({
    dir: streamsDir,
    name: "Demo Stream",
    streamId: DEMO_STREAM_ID,
  });
  await index.upsert({
    streamId: DEMO_STREAM_ID,
    folder,
    name: "Demo Stream",
    thumbnail: null,
    lastActivityAt: new Date().toISOString(),
    unread: false,
    preview: "",
  });

  // 4. The stream, then the clips (their checks wait for its analysis), then
  // the one automatic Find shorts after the checks.
  say("Analyzing the stream");
  await streams.addFile(vod, DEMO_STREAM_ID, false);
  const store = await streams.forStream(DEMO_STREAM_ID);
  for (const c of clips) {
    const { clipId } = await streams.addClipFile(DEMO_STREAM_ID, join(media, c.file));
    const file = await store.clip(clipId);
    await writeJsonAtomic(store.paths.clip(clipId), ClipFile.parse({ ...file, title: c.title }));
  }
  await streams.idle();
  say(`${agent.label} is finding shorts`);
  const deadline = Date.now() + 10 * 60_000;
  let quiet = 0;
  while ((await store.project()).shorts.length === 0) {
    await new Promise((r) => setTimeout(r, 1000));
    await planner.idle(DEMO_STREAM_ID);
    const ran = (await store.project()).autoFindAt !== null;
    const working = (await planner.state(DEMO_STREAM_ID)).working !== null;
    quiet = ran && !working ? quiet + 1 : 0;
    if (quiet >= 3 && (await store.project()).shorts.length === 0) {
      const last = (await store.messages()).at(-1);
      const text = last?.body.kind === "text" ? last.body.text : "no answer";
      throw new Error(`Find shorts didn't work: ${text}`);
    }
    if (Date.now() > deadline) throw new Error("Find shorts took over 10 minutes.");
  }
  const shorts = (await store.project()).shorts;
  if (shorts.length < 3) throw new Error(`The agent proposed ${shorts.length} shorts, not 3.`);

  // 5. One chat revision, replying to the first card.
  const first = shorts[0]!.shortId;
  say(`${agent.label} is revising short 1`);
  await planner.send(DEMO_STREAM_ID, "make the first one punchier, cut the slow start", {
    shortId: first,
    version: (await store.version(first)).version,
  });
  await planner.idle(DEMO_STREAM_ID);
  const revised = await store.version(first);
  if (revised.version < 2) {
    const last = (await store.messages()).at(-1);
    throw new Error(
      `The chat message didn't make a version: ${last?.body.kind === "text" ? last.body.text : last?.body.kind}`,
    );
  }
  const before = await store.version(first, 1);
  if (JSON.stringify(before.short.segments) === JSON.stringify(revised.short.segments))
    throw new Error(`The revision kept the same cut (${revised.note}). Run it again.`);

  // 6. One editor save, on another short than the chat revision: the parry
  // short when it's one of them, else short 2.
  const parryAt = wordAt(probeWords, /^parried/i).startMs;
  const heads = await Promise.all(shorts.slice(1).map((s) => store.version(s.shortId)));
  const parryShort = heads.find((v) =>
    v.short.segments.some((s) => s.srcIn <= parryAt && parryAt < s.srcOut),
  );
  const head = parryShort ?? heads[0]!;
  await editor.save(DEMO_STREAM_ID, head.shortId, {
    short: editorEdit(head.short, parryShort === undefined ? head.short.title : PARRY_HOOK),
    note: options.newClip ? "Added a hook" : "Added a hook and reframed to follow the boss",
    parent: head.version,
  });

  // 7. Into examples/: no renders, no audio or clip caches, relative media paths.
  const target = join(examples, DEMO_FOLDER);
  const clipIds = (await store.project()).clips;
  const clipsCache = (rel: string) =>
    clipIds.some((id) => rel === `cache/${id}` || rel.startsWith(`cache/${id}/`));
  await rm(target, { recursive: true, force: true });
  await cp(folder, target, {
    recursive: true,
    filter: (p) => {
      const rel = posix(relative(folder, p));
      if (rel === "renders" || rel.startsWith("renders/")) return false;
      if (rel.endsWith(".wav") || rel.endsWith("/tmp")) return false;
      return !clipsCache(rel);
    },
  });
  const demo = await ProjectStore.open(target);
  const project = await demo.project();
  for (const { sourceId } of project.sources) {
    const file = demo.paths.source(sourceId);
    const s = Source.parse(JSON.parse(await readFile(file, "utf8")));
    const path = posix(relative(target, s.origin.path));
    await writeJsonAtomic(file, { ...s, origin: { ...s.origin, path } });
  }
  for (const clipId of project.clips) {
    const file = demo.paths.clip(clipId);
    const c = ClipFile.parse(JSON.parse(await readFile(file, "utf8")));
    if (c.origin.path === undefined) continue;
    const path = posix(relative(target, c.origin.path));
    await writeJsonAtomic(file, { ...c, origin: { ...c.origin, path } });
  }
  // 8. The facts for examples/demo/README.md.
  const placed = await Promise.all(project.clips.map((id) => demo.clip(id)));
  const rows = clips.map((c, i) => {
    const m = placed[i]?.match ?? null;
    const found =
      m === null ? "not placed" : `${m.srcIn} ms (${m.method}, ${m.confidence.toFixed(2)})`;
    return `| \`${c.file}\` | ${c.startMs} ms | ${found} |`;
  });
  const titles = await Promise.all(
    project.shorts.map(async (s) => (await demo.version(s.shortId)).short.title),
  );
  const notes = join(media, "README.md");
  const video = (await demo.source(project.sources[0]!.sourceId)).probe?.video;
  const format = video == null ? "" : `, ${video.width}x${video.height}, ${video.codec}`;
  await writeFile(notes, readme({ vodMs, rows, titles, agent: agent.label, format }));
  // The repo's Prettier, so lint stays clean after a rebuild.
  await run(process.execPath, [
    join(repo, "node_modules", "prettier", "bin", "prettier.cjs"),
    "--write",
    notes,
  ]);
  await rm(work, { recursive: true, force: true });
  say(`Done: ${posix(relative(repo, target))} with ${titles.length} shorts.`);
}

function readme(o: {
  vodMs: number;
  rows: string[];
  titles: string[];
  agent: string;
  format: string;
}): string {
  const input = options.newClip
    ? "Replacement footage for the demo stream in `../demo.alcyo`, supplied by its owner. The rebuild keeps the recording unchanged and retains the proposed crop."
    : `Stand-in footage for the demo stream in \`../demo.alcyo\`, made by
\`pnpm demo:build\` (\`apps/desktop/scripts/build-demo.ts\`). It is not a real
stream: the voice is macOS's "${VOICE}" reading \`scripts/demo/script.txt\`
over a generated background, and the yellow box is the "boss" the reframe follows.`;
  return `# Demo footage

${input}

To use your own recording, replace \`clip.mp4\` and run
\`pnpm demo:build --new-clip\`. This keeps the recording and rebuilds the
analysis, viewer clips and shorts. Include the scripted "parried" and
"Ember" narration cues: the builder uses them to place the two viewer clips.
Replacement footage keeps the proposed crop instead of following the synthetic
box. To generate a new stand-in, move the existing \`clip.mp4\` first, then
run \`pnpm demo:build --generate-stand-in\`. These are the only media files git tracks.

- \`clip.mp4\`: the stream, ${(o.vodMs / 1000).toFixed(1)} s${o.format}.
- Two viewer clips, 10 s each, cut from it:

| File | True start in the stream | Where clip matching put it |
| --- | --- | --- |
${o.rows.join("\n")}

The shorts were proposed by ${o.agent}: ${o.titles.map((t) => `"${t}"`).join(", ")}.
`;
}

await main();
