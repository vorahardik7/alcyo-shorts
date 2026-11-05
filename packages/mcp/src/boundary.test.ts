import { mkdir, mkdtemp, rm, symlink, writeFile, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectStore, createStream, writeJsonAtomic } from "@alcyo/store";
import * as F from "@alcyo/schema/testing";
import { Root } from "./root.ts";
import {
  get_thread,
  get_transcript_window,
  open_project,
  render_short,
  validate_version,
  type ToolContext,
} from "./tools.ts";

let dir: string;
let allowed: string;
let outside: string;
let folder: string;
let store: ProjectStore;
let ctx: ToolContext;
let sourceId: string;
let shortId: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "alcyo-boundary-"));
  allowed = join(dir, "allowed");
  outside = join(dir, "outside");
  await mkdir(allowed);
  await mkdir(outside);
  folder = (await createStream({ dir: allowed, name: "Audit" })).folder;
  store = await ProjectStore.open(folder);
  const recording = join(allowed, "recording.mp4");
  await writeFile(recording, "synthetic video");
  const source = await store.addFileSource(recording);
  sourceId = source.sourceId;
  await store.applyAnalysis(sourceId, {
    probe: {
      durationMs: 10000,
      container: "mp4",
      video: { codec: "h264", width: 1280, height: 720, fpsNum: 30, fpsDen: 1 },
      audio: null,
      playsDirectly: true,
    },
    fingerprint: { ...source.fingerprint, durationMs: 10000, layout: "v" },
  });
  await writeJsonAtomic(store.paths.analysis(sourceId, "transcript.json"), {
    ...F.transcript,
    sourceId,
  });
  shortId = (
    await store.createShort({
      sourceId,
      short: F.short,
      createdBy: "user",
      note: "",
      fromMessageId: null,
    })
  ).shortId;
  ctx = {
    root: new Root(allowed),
    ffmpeg: "ffmpeg",
    ffprobe: "ffprobe",
    fontsDir: "fonts",
    run: vi.fn(() => Promise.reject(new Error("runner must not start"))),
  };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const args = () => ({ folder: basename(folder) });
async function replaceWithLink(path: string, target: string, content: string) {
  await writeFile(target, content);
  await rm(path, { recursive: true, force: true });
  await symlink(target, path);
}

describe("MCP project file confinement without media binaries", () => {
  it("refuses a symlinked thread file and preserves ordinary/in-root linked threads", async () => {
    await store.appendMessage(F.messages[0]!);
    expect((await get_thread(ctx, { ...args(), limit: 50 })).messages).toHaveLength(1);
    const target = join(outside, "messages.jsonl");
    await replaceWithLink(store.paths.messages, target, JSON.stringify(F.messages[0]) + "\n");
    await expect(get_thread(ctx, { ...args(), limit: 50 })).rejects.toThrow("outside the root");
    await rm(store.paths.messages);
    const inside = join(allowed, "inside.jsonl");
    await writeFile(inside, JSON.stringify(F.messages[0]) + "\n");
    await symlink(inside, store.paths.messages);
    expect((await get_thread(ctx, { ...args(), limit: 50 })).messages).toHaveLength(1);
  });

  it.each(["project", "transcript", "version", "source", "renders"])(
    "refuses outside %s files before reads or .bad copies",
    async (kind) => {
      const path =
        kind === "project"
          ? store.paths.project
          : kind === "transcript"
            ? store.paths.analysis(sourceId, "transcript.json")
            : kind === "source"
              ? store.paths.source(sourceId)
              : kind === "version"
                ? store.paths.version(shortId, 1, "user")
                : store.paths.renderIndex;
      await mkdir(join(folder, "renders"), { recursive: true });
      const target = join(outside, "private.json");
      await replaceWithLink(path, target, "{ invalid outside JSON");
      const call =
        kind === "transcript"
          ? get_transcript_window(ctx, { ...args(), sourceId, fromMs: 0, toMs: 10000 })
          : kind === "version"
            ? validate_version(ctx, { ...args(), shortId })
            : open_project(ctx, args());
      await expect(call).rejects.toThrow("outside the root");
      await expect(readFile(target + ".bad")).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("does not render after a denied transcript is caught by a missing-caption fallback", async () => {
    await replaceWithLink(
      store.paths.analysis(sourceId, "transcript.json"),
      join(outside, "transcript.json"),
      JSON.stringify({ ...F.transcript, sourceId }),
    );
    await expect(render_short(ctx, { ...args(), shortId })).rejects.toThrow("outside the root");
    expect(ctx.run).not.toHaveBeenCalled();
    await expect(readFile(store.paths.renderIndex)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses supplied traversal ids and stored traversal ids", async () => {
    await expect(
      get_transcript_window(ctx, {
        ...args(),
        sourceId: "../../../../outside",
        fromMs: 0,
        toMs: 1000,
      }),
    ).rejects.toThrow();
    await expect(
      validate_version(ctx, { ...args(), shortId: "../../../../outside" }),
    ).rejects.toThrow();
    const p = await store.project();
    await writeJsonAtomic(store.paths.project, {
      ...p,
      sources: [{ sourceId: "../../../../outside" }],
    });
    await expect(open_project(ctx, args())).rejects.toThrow("outside the root");
  });

  it.each(["renders", "cache"])(
    "refuses external %s directories before invoking ffmpeg",
    async (name) => {
      await symlink(outside, join(folder, name));
      await expect(render_short(ctx, { ...args(), shortId })).rejects.toThrow("outside the root");
      expect(ctx.run).not.toHaveBeenCalled();
      expect(await import("node:fs/promises").then((fs) => fs.readdir(outside))).toEqual([]);
    },
  );

  it("resolves missing descendants through ancestors and rejects dangling links", async () => {
    await symlink(outside, join(allowed, "external"));
    await expect(ctx.root.resolveAny(join(allowed, "external", "new", "out.mp4"))).rejects.toThrow(
      "outside the root",
    );
    await symlink(join(outside, "missing"), join(allowed, "dangling"));
    await expect(ctx.root.resolveAny(join(allowed, "dangling", "new.mp4"))).rejects.toThrow(
      "unresolved link",
    );
    expect(await ctx.root.resolveAny(join(allowed, "new", "out.mp4"))).toBe(
      join(await realpath(allowed), "new", "out.mp4"),
    );
  });

  it("does not leak the active boundary across concurrent roots or later calls", async () => {
    const other = { ...ctx, root: new Root(dir) };
    await replaceWithLink(
      store.paths.messages,
      join(outside, "thread.jsonl"),
      JSON.stringify(F.messages[0]) + "\n",
    );
    const results = await Promise.allSettled([
      get_thread(ctx, { ...args(), limit: 50 }),
      get_thread(other, { folder: join("allowed", basename(folder)), limit: 50 }),
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
    expect(await store.messages()).toHaveLength(1);
  });
});
