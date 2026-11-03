// Runs yt-dlp: info first, then the download into one folder. Cancel or a
// failure removes that folder; nothing in it is registered yet.
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { MediaError, type Runner } from "@alcyo/media";
import type { YtDlpInfo } from "@alcyo/schema";
import {
  CANT_DOWNLOAD,
  type LinkInfo,
  ProgressReader,
  downloadArgs,
  infoArgs,
  linkProblem,
  parseInfo,
  toYtDlpInfo,
} from "./ytdlp.ts";

export type ImportErrorCode = "cancelled" | "unsupported" | "failed";

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

const cancelled = () => new ImportError("cancelled", "The download was cancelled.");
export const NO_CONNECTION = "Couldn't reach that site. Check your connection, then try again.";

function networkProblem(stderr: readonly string[]): boolean {
  return /getaddrinfo|timed out|connection (refused|reset)|network is unreachable|name or service not known|nodename nor servname/i.test(
    stderr.join("\n"),
  );
}

function isCancel(error: unknown): boolean {
  return error instanceof MediaError && error.code === "cancelled";
}

export async function fetchLinkInfo(opts: {
  run: Runner;
  ytDlp: string;
  ffmpegDir: string;
  url: string;
  signal?: AbortSignal;
}): Promise<LinkInfo> {
  let out;
  try {
    out = await opts.run(opts.ytDlp, infoArgs(opts.url, opts.ffmpegDir), {
      collectStdout: true,
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    });
  } catch (error) {
    if (isCancel(error)) throw cancelled();
    throw new ImportError("failed", "The downloader didn't start. Try Check again in Setup.");
  }
  if (out.code !== 0) {
    if (linkProblem(out.stderrTail)) return { kind: "unsupported" };
    if (networkProblem(out.stderrTail)) throw new ImportError("failed", NO_CONNECTION);
    return { kind: "unsupported" };
  }
  return parseInfo(out.stdout, opts.url);
}

/** Removes a folder, retrying while Windows still holds a file in it. */
export function removeFolder(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

export interface Downloaded {
  /** The merged media file, media.mp4 in most cases. */
  path: string;
  /** From media.info.json; null when yt-dlp didn't write it. */
  info: YtDlpInfo | null;
}

export async function downloadMedia(opts: {
  run: Runner;
  ytDlp: string;
  ffmpegDir: string;
  url: string;
  outDir: string;
  /** Parts in the chosen format, from the info lookup ("137+140" is 2). */
  parts: number;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}): Promise<Downloaded> {
  const reader = new ProgressReader(Math.max(1, opts.parts));
  let out;
  try {
    out = await opts.run(
      opts.ytDlp,
      downloadArgs({ url: opts.url, ffmpegDir: opts.ffmpegDir, outDir: opts.outDir }),
      {
        cwd: opts.outDir,
        onStdoutLine: (line) => {
          const pct = reader.read(line);
          if (pct !== null) opts.onProgress?.(pct);
        },
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      },
    );
  } catch (error) {
    await removeFolder(opts.outDir);
    if (isCancel(error)) throw cancelled();
    throw new ImportError("failed", "The downloader didn't start. Try Check again in Setup.");
  }
  if (out.code !== 0) {
    await removeFolder(opts.outDir);
    if (linkProblem(out.stderrTail)) throw new ImportError("unsupported", CANT_DOWNLOAD);
    if (networkProblem(out.stderrTail)) throw new ImportError("failed", NO_CONNECTION);
    throw new ImportError(
      "failed",
      "The download stopped. Try again, or update the downloader in Settings.",
    );
  }

  const names = await readdir(opts.outDir);
  const media = names.find(
    (n) => n.startsWith("media.") && !/\.(json|part|ytdl|temp)$/i.test(n) && !/\.f\d+\./.test(n),
  );
  if (media === undefined) {
    await removeFolder(opts.outDir);
    throw new ImportError("failed", "The download finished without a video file.");
  }
  return { path: join(opts.outDir, media), info: await readInfo(opts.outDir, opts.url) };
}

async function readInfo(dir: string, url: string): Promise<YtDlpInfo | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(dir, "media.info.json"), "utf8"));
    return toYtDlpInfo(raw, url);
  } catch {
    return null;
  }
}
