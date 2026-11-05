import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MediaError, type Runner, runTool } from "@alcyo/media";
import { describe, expect, it } from "vitest";
import { ImportError, downloadMedia, fetchLinkInfo } from "./download.ts";
import {
  FORMAT,
  ProgressReader,
  classifyLink,
  downloadArgs,
  infoArgs,
  isClipUrl,
  parseInfo,
} from "./ytdlp.ts";

const target = process.platform === "win32" ? "win-x64" : `mac-${process.arch}`;
const binDir =
  process.env["ALCYO_BIN_DIR"] ??
  resolve(import.meta.dirname, "../../../apps/desktop/resources/bin", target);
const ytDlp = join(binDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const haveYtDlp = existsSync(ytDlp);

const info = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    _type: "video",
    id: "abc",
    title: "Rook42 stream",
    uploader: "Rook42",
    upload_date: "20261030",
    duration: 10712.4,
    webpage_url: "https://www.youtube.com/watch?v=abc",
    extractor_key: "Youtube",
    format_id: "137+140",
    formats: [{ huge: true }],
    ...over,
  });

describe("args", () => {
  it("puts -- right before the URL, with no config and the 1080p format", () => {
    for (const args of [
      infoArgs("https://x.test/v", "/bin"),
      downloadArgs({ url: "https://x.test/v", ffmpegDir: "/bin", outDir: "/p/sources/src_1" }),
    ]) {
      expect(args.slice(-2)).toEqual(["--", "https://x.test/v"]);
      expect(args.indexOf("--")).toBe(args.length - 2);
      expect(args).toContain("--no-config");
      expect(args).toContain("--no-cache-dir");
      expect(args).toContain("--no-playlist");
      expect(args[args.indexOf("--ffmpeg-location") + 1]).toBe("/bin");
      expect(args[args.indexOf("-f") + 1]).toBe(FORMAT);
    }
    const dl = downloadArgs({ url: "https://x.test/v", ffmpegDir: "/bin", outDir: "/p/100% fun" });
    expect(dl).toEqual(
      expect.arrayContaining(["--merge-output-format", "mp4", "--write-info-json", "--newline"]),
    );
    expect(dl[dl.indexOf("-o") + 1]).toBe(join("/p/100%% fun", "media.%(ext)s"));
  });

  it.skipIf(!haveYtDlp)(
    "keeps a URL that starts with - from being read as an option (real yt-dlp)",
    async () => {
      const lines: string[] = [];
      const out = await runTool(ytDlp, infoArgs("--version", binDir), {
        collectStdout: true,
        onStderrLine: (l) => lines.push(l),
      });
      // Read as an option, --version would print the version and exit 0.
      expect(out.code).not.toBe(0);
      expect(out.stdout).not.toMatch(/^\d{4}\.\d{2}\.\d{2}/);
      expect(lines.join("\n")).toMatch(/not a valid URL/i);
    },
    30_000,
  );
});

describe("parseInfo and classifyLink", () => {
  it("reads a video into YtDlpInfo with integer ms and the part count", () => {
    const link = parseInfo(info(), "https://www.youtube.com/watch?v=abc");
    expect(link).toEqual({
      kind: "video",
      isClip: false,
      parts: 2,
      info: {
        id: "abc",
        title: "Rook42 stream",
        uploader: "Rook42",
        uploadDate: "20261030",
        durationMs: 10_712_400,
        webpageUrl: "https://www.youtube.com/watch?v=abc",
        extractor: "Youtube",
      },
    });
  });

  it("spots playlists, garbage, and clip links", () => {
    expect(
      parseInfo(info({ _type: "playlist", entries: [{}, {}], title: "Clips" }), "https://x.test"),
    ).toEqual({
      kind: "playlist",
      title: "Clips",
      count: 2,
    });
    expect(parseInfo("not json", "https://x.test")).toEqual({ kind: "unsupported" });
    expect(parseInfo("{}", "https://x.test")).toEqual({ kind: "unsupported" });
    expect(isClipUrl("https://clips.twitch.tv/FunnyClip-abc")).toBe(true);
    expect(isClipUrl("https://www.twitch.tv/rook42/clip/FunnyClip-abc")).toBe(true);
    expect(isClipUrl("https://www.youtube.com/clip/Ugkx123")).toBe(true);
    expect(isClipUrl("https://www.twitch.tv/videos/123")).toBe(false);
    expect(isClipUrl("https://www.youtube.com/watch?v=abc")).toBe(false);
  });

  it("makes long videos sources, and short or clip links clips once there is a source", () => {
    const link = (durationMs: number | null, isClip = false) => ({
      isClip,
      info: {
        id: "a",
        title: "t",
        uploader: null,
        uploadDate: null,
        durationMs,
        webpageUrl: "https://x.test/",
        extractor: "x",
      },
    });
    expect(classifyLink(link(3 * 3_600_000), false)).toBe("source");
    expect(classifyLink(link(10 * 60_000), true)).toBe("source");
    expect(classifyLink(link(10 * 60_000 - 1), true)).toBe("clip");
    expect(classifyLink(link(30_000), false)).toBe("ask");
    expect(classifyLink(link(3 * 3_600_000, true), true)).toBe("clip");
    expect(classifyLink(link(null), false)).toBe("ask");
    expect(classifyLink(link(null), true)).toBe("clip");
  });
});

describe("progress", () => {
  it("weights each part of a merged format evenly and ignores other lines", () => {
    const r = new ProgressReader(2);
    expect(r.read("[download] Destination: media.f137.mp4")).toBeNull();
    expect(r.read("ALCYO 137   50.0%")).toBe(25);
    expect(r.read("ALCYO 137  100.0%")).toBe(50);
    expect(r.read("ALCYO 140   50.0%")).toBe(75);
    expect(r.read("ALCYO 140  100.0%")).toBe(100);
    expect(new ProgressReader(1).read("ALCYO mp4  12.5%")).toBe(12.5);
  });
});

describe("download", () => {
  const fakeRun =
    (fn: (args: readonly string[], cwd: string) => Promise<number>): Runner =>
    async (_file, args, opts) => {
      const code = await fn(args, opts.cwd ?? "");
      if (opts.signal?.aborted === true) throw new MediaError("cancelled", "Cancelled.");
      return { code, stdout: "", stderrTail: code === 0 ? [] : ["ERROR: Unsupported URL: x"] };
    };

  it("returns the merged file and its info", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "alcyo-dl-"));
    const run = fakeRun(async (_args, cwd) => {
      await writeFile(join(cwd, "media.mp4"), "v");
      await writeFile(join(cwd, "media.info.json"), info());
      return 0;
    });
    const got = await downloadMedia({
      run,
      ytDlp: "yt-dlp",
      ffmpegDir: "/bin",
      url: "https://www.youtube.com/watch?v=abc",
      outDir,
      parts: 2,
    });
    expect(got.path).toBe(join(outDir, "media.mp4"));
    expect(got.info?.durationMs).toBe(10_712_400);
  });

  it("removes the folder on cancel and on failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "alcyo-dl-"));
    const controller = new AbortController();
    const cancelDir = join(root, "src_cancel");
    await mkdir(cancelDir);
    const cancelled = await downloadMedia({
      run: fakeRun(async (_a, cwd) => {
        await writeFile(join(cwd, "media.f137.mp4.part"), "partial");
        controller.abort();
        return 1;
      }),
      ytDlp: "yt-dlp",
      ffmpegDir: "/bin",
      url: "https://x.test/v",
      outDir: cancelDir,
      parts: 1,
      signal: controller.signal,
    }).catch((e: unknown) => e);
    expect(cancelled).toMatchObject({ code: "cancelled" });

    const failDir = join(root, "src_fail");
    await mkdir(failDir);
    const failed = await downloadMedia({
      run: fakeRun(async (_a, cwd) => {
        await writeFile(join(cwd, "media.f137.mp4.part"), "partial");
        return 1;
      }),
      ytDlp: "yt-dlp",
      ffmpegDir: "/bin",
      url: "https://x.test/v",
      outDir: failDir,
      parts: 1,
    }).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ImportError);
    expect(failed).toMatchObject({ code: "unsupported" });
    expect(await readdir(root)).toEqual([]);
  });

  it("calls an unreadable link unsupported", async () => {
    const got = await fetchLinkInfo({
      run: () =>
        Promise.resolve({ code: 1, stdout: "", stderrTail: ["ERROR: [generic] Unsupported URL"] }),
      ytDlp: "yt-dlp",
      ffmpegDir: "/bin",
      url: "https://x.test/v",
    });
    expect(got).toEqual({ kind: "unsupported" });
  });
});
