// The MCP server through a real MCP client: in memory for each tool, and
// over stdio against the bundled dist/index.js. Uses the bundled ffmpeg to
// make a recording inside the root; skipped when the binaries aren't fetched.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ffprobeArgs, parseFfprobe, runTool } from "@alcyo/media";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as F from "@alcyo/schema/testing";
import { type ProjectStore, createStream, hashFile, writeJsonAtomic } from "@alcyo/store";
import { beforeAll, describe, expect, it } from "vitest";
import { createServer } from "./server.ts";

const win = process.platform === "win32";
const target = `${win ? "win" : process.platform === "darwin" ? "mac" : process.platform}-${process.arch}`;
const repo = resolve(import.meta.dirname, "..", "..", "..");
const binDir =
  process.env["ALCYO_BIN_DIR"] ?? join(repo, "apps", "desktop", "resources", "bin", target);
const fontsDir = join(repo, "apps", "desktop", "resources", "fonts");
const ffmpeg = join(binDir, win ? "ffmpeg.exe" : "ffmpeg");
const have = existsSync(ffmpeg);

let root: string;
let folder: string;
let store: ProjectStore;
let shortId: string;
let client: Client;

type Result = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};
const call = async (name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })) as Result;
const data = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown>) => {
  const r = await call(name, args);
  if (r.isError === true) throw new Error(r.content[0]?.text);
  return r.structuredContent as T;
};

beforeAll(async () => {
  if (!have) return;
  root = await mkdtemp(join(tmpdir(), "alcyo-mcp-"));
  const made = await createStream({ dir: join(root, "demo"), name: "Demo Stream" });
  folder = "demo/Demo Stream.alcyo";
  const { ProjectStore } = await import("@alcyo/store");
  store = await ProjectStore.open(made.folder);
  const media = join(root, "demo", "recording 名前.mp4");
  execFileSync(ffmpeg, [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:d=10",
    "-f", "lavfi", "-i", "sine=frequency=330:duration=10",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    media,
  ]); // prettier-ignore
  const source = await store.addFileSource(media);
  const ffprobe = join(binDir, win ? "ffprobe.exe" : "ffprobe");
  const probe = parseFfprobe(
    (await runTool(ffprobe, ffprobeArgs(media), { collectStdout: true })).stdout,
  );
  const fp = await hashFile(media);
  await store.applyAnalysis(source.sourceId, {
    probe,
    fingerprint: { ...fp, durationMs: probe.durationMs, layout: "v+a" },
  });
  await writeJsonAtomic(store.paths.analysis(source.sourceId, "transcript.json"), {
    ...F.transcript,
    sourceId: source.sourceId,
  });
  shortId = (
    await store.createShort({
      sourceId: source.sourceId,
      short: F.short,
      createdBy: "claude",
      note: "",
      fromMessageId: null,
    })
  ).shortId;
  await store.appendMessage({ ...F.messages[0]!, id: "m_first01" });

  const server = createServer({ root, binDir, fontsDir });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

describe.skipIf(!have)("alcyo MCP server", () => {
  it("lists the seven tools with input schemas and read-only hints", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_thread",
      "get_transcript_window",
      "list_shorts",
      "open_project",
      "probe_video",
      "render_short",
      "validate_version",
    ]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.annotations?.readOnlyHint).toBe(t.name !== "render_short");
    }
    const probe = tools.find((t) => t.name === "probe_video")!;
    expect(probe.inputSchema.required).toEqual(["path"]);
  });

  it("probe_video reads a video inside the root", async () => {
    const out = await data<{
      path: string;
      probe: { durationMs: number; video: { width: number } };
    }>("probe_video", { path: "demo/recording 名前.mp4" });
    expect(out.path).toBe("demo/recording 名前.mp4");
    expect(out.probe.video.width).toBe(1280);
    expect(Math.abs(out.probe.durationMs - 10_000)).toBeLessThan(100);
  });

  it("open_project lists streams, then opens one", async () => {
    expect(await data("open_project", {})).toEqual({
      streams: [expect.objectContaining({ folder, name: "Demo Stream", shorts: 1 })],
    });
    const p = await data<{
      sources: { insideRoot: boolean; transcript: boolean; file: string }[];
      shorts: unknown[];
      messages: number;
    }>("open_project", { folder });
    expect(p.sources[0]).toMatchObject({
      insideRoot: true,
      transcript: true,
      file: "demo/recording 名前.mp4",
    });
    expect(p.shorts).toHaveLength(1);
    expect(p.messages).toBe(1);
  });

  it("list_shorts, get_transcript_window and get_thread", async () => {
    const { shorts } = await data<{
      shorts: { shortId: string; title: string; versions: unknown[] }[];
    }>("list_shorts", { folder });
    expect(shorts[0]).toMatchObject({ shortId, title: F.short.title });
    expect(shorts[0]!.versions).toHaveLength(1);
    const w = await data<{ lines: { id: string; text: string }[]; words: unknown[] }>(
      "get_transcript_window",
      {
        folder,
        fromMs: 4000,
        toMs: 7000,
      },
    );
    expect(w.lines).toEqual([{ id: "L0002", startMs: 5000, endMs: 6300, text: "no way did you" }]);
    expect(w.words).toHaveLength(4);
    const t = await data<{ total: number; messages: { id: string }[] }>("get_thread", { folder });
    expect(t).toMatchObject({ total: 1, messages: [{ id: "m_first01" }] });
  });

  it("validate_version passes a good version and lists every problem in a bad one", async () => {
    expect(await data("validate_version", { folder, shortId })).toMatchObject({
      valid: true,
      issues: [],
    });
    // Written straight to disk: the store itself refuses to save a version like this.
    const v1 = await store.version(shortId, 1);
    await writeFile(
      join(store.paths.versions(shortId), "0002.user.json"),
      JSON.stringify({
        ...v1,
        version: 2,
        parent: 1,
        createdBy: "user",
        short: {
          ...F.short,
          captions: { ...F.short.captions, overrides: [{ wordId: "w99999", hidden: true }] },
          crop: {
            keys: [
              { t: 0, x: 0.5, ease: "hold" },
              { t: 999_999, x: 0.5, ease: "hold" },
            ],
          },
        },
      }),
    );
    await writeJsonAtomic(store.paths.short(shortId), {
      ...(await store.shortFile(shortId)),
      head: 2,
    });
    const bad = await data<{ valid: boolean; version: number; issues: { path: string }[] }>(
      "validate_version",
      { folder, shortId },
    );
    expect(bad.valid).toBe(false);
    expect(bad.version).toBe(2);
    expect(bad.issues.map((i) => i.path).sort()).toEqual([
      "short.captions.overrides[0].wordId",
      "short.crop.keys[1].t",
    ]);
    // A file that doesn't parse at all.
    await writeFile(join(store.paths.versions(shortId), "0003.user.json"), "{ not json");
    await writeJsonAtomic(store.paths.short(shortId), {
      ...(await store.shortFile(shortId)),
      head: 3,
    });
    expect(await data("validate_version", { folder, shortId })).toMatchObject({ valid: false });
  });

  it("refuses paths outside the root, through .. and through symlinks", async () => {
    const outside = await mkdtemp(join(tmpdir(), "alcyo-outside-"));
    await writeFile(join(outside, "x.mp4"), "x");
    await symlink(outside, join(root, "link"));
    for (const path of ["../x.mp4", join(outside, "x.mp4"), "link/x.mp4", "/etc/hosts"]) {
      const r = await call("probe_video", { path });
      expect(r.isError, path).toBe(true);
      expect(r.content[0]!.text).toMatch(/outside the root|doesn't exist/);
    }
    const r = await call("open_project", { folder: "../.." });
    expect(r.isError).toBe(true);
  });

  it("checks inputs with the Zod schemas", async () => {
    const r = await call("get_transcript_window", { folder, fromMs: 5000, toMs: 1000 });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toMatch(/toMs must be after fromMs/);
    expect((await call("get_thread", { folder, limit: 999 })).isError).toBe(true);
  });

  it(
    "render_short writes a checked MP4 in the stream's renders folder",
    { timeout: 120_000 },
    async () => {
      const out = await data<{
        file: string;
        version: number;
        expectedMs: number;
        ffprobe: {
          width: number;
          height: number;
          durationMs: number;
          videoCodec: string;
          audioCodec: string;
        };
      }>("render_short", { folder, shortId, version: 1 });
      expect(out.file).toMatch(/^demo\/Demo Stream\.alcyo\/renders\/.+-v1-1080p30\.mp4$/);
      expect(out.ffprobe).toMatchObject({
        width: 1080,
        height: 1920,
        videoCodec: "h264",
        audioCodec: "aac",
      });
      expect(Math.abs(out.ffprobe.durationMs - out.expectedMs)).toBeLessThanOrEqual(100);
      expect(existsSync(join(root, out.file))).toBe(true);
      const index = JSON.parse(readFileSync(join(store.paths.renders, "index.json"), "utf8")) as {
        renders: unknown[];
      };
      expect(index.renders).toHaveLength(1);
    },
  );

  it("render_short won't read a recording outside the root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "alcyo-outside-"));
    const media = join(outside, "far.mp4");
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=30:d=2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      media,
    ]);
    const made = await createStream({ dir: join(root, "other"), name: "Far" });
    const { ProjectStore } = await import("@alcyo/store");
    const s = await ProjectStore.open(made.folder);
    const src = await s.addFileSource(media);
    const id = (
      await s
        .createShort({
          sourceId: src.sourceId,
          short: {
            ...F.short,
            segments: [{ srcIn: 0, srcOut: 1000 }],
            crop: { keys: [{ t: 0, x: 0.5, ease: "hold" }] },
          },
          createdBy: "user",
          note: "",
          fromMessageId: null,
        })
        .catch(() => null)
    )?.shortId;
    if (id === undefined) return;
    const r = await call("render_short", { folder: "other/Far.alcyo", shortId: id });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/outside the root/);
  });
});

describe.skipIf(!have)("portable saved looks", () => {
  it("validates and renders a custom style snapshot without the desktop profile", async () => {
    const caption = {
      ...F.presets.captionPresets[0]!,
      id: "custom-portable",
      name: "Portable",
      sizePx: 99,
      origin: "template" as const,
    };
    const hook = F.presets.hookPresets[0]!;
    const created = await store.createShort({
      sourceId: (await store.project()).sources[0]!.sourceId,
      short: {
        ...F.short,
        captions: { ...F.short.captions, presetId: caption.id },
        styles: { caption, hook },
      },
      createdBy: "user",
      note: "Portable look",
      fromMessageId: null,
    });
    expect(await data("validate_version", { folder, shortId: created.shortId })).toMatchObject({
      valid: true,
    });
    const out = await data<{ path: string; ffprobe: { width: number } }>("render_short", {
      folder,
      shortId: created.shortId,
    });
    expect(existsSync(out.path)).toBe(true);
    expect(out.ffprobe.width).toBe(1080);
  });
});

describe.skipIf(!have)("over stdio, from dist/index.js", () => {
  it("starts, lists tools and answers a call", { timeout: 60_000 }, async () => {
    const pkg = resolve(import.meta.dirname, "..");
    execFileSync(process.execPath, ["build.mjs"], { cwd: pkg });
    const dir = await mkdtemp(join(tmpdir(), "alcyo-mcp-stdio-"));
    await mkdir(join(dir, "empty"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(pkg, "dist", "index.js"), "--root", dir, "--bin", binDir],
      stderr: "pipe",
    });
    const c = new Client({ name: "stdio-test", version: "1" });
    await c.connect(transport);
    expect((await c.listTools()).tools).toHaveLength(7);
    const r = (await c.callTool({ name: "open_project", arguments: {} })) as Result;
    expect(r.structuredContent).toEqual({ streams: [] });
    await c.close();
    // The bundle doesn't load Electron.
    expect(readFileSync(join(pkg, "dist", "index.js"), "utf8")).not.toMatch(
      /require\(["']electron["']\)|from ["']electron["']/,
    );
  });
});
