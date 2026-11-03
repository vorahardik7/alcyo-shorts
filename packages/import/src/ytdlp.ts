// yt-dlp args and parsers (plan section 11). Pure. Every call has
// --no-config and "--" right before the URL, so a link can't become a flag.
import { join } from "node:path";
import { type YtDlpInfo, YtDlpInfo as YtDlpInfoSchema } from "@alcyo/schema";
import { z } from "zod";

/**
 * 1080p at most. "<=?" also accepts a format whose height is unknown: a plain
 * file link reports none, and "<=" alone would reject every format there.
 */
export const FORMAT = "bv*[height<=?1080]+ba/b[height<=?1080]";
/** A video this long or longer is a stream, not a clip. */
export const SOURCE_MIN_MS = 10 * 60 * 1000;
export const CANT_DOWNLOAD =
  "That link can't be downloaded. If it's private, download it yourself and drop the file in.";
export const PROGRESS_PREFIX = "ALCYO";

function common(ffmpegDir: string): string[] {
  return ["--no-config", "--no-cache-dir", "--no-playlist", "--ffmpeg-location", ffmpegDir];
}

/** Asks what a link is. --flat-playlist keeps a big playlist from resolving every entry. */
export function infoArgs(url: string, ffmpegDir: string): string[] {
  return [...common(ffmpegDir), "--flat-playlist", "-f", FORMAT, "-J", "--", url];
}

export function downloadArgs(opts: { url: string; ffmpegDir: string; outDir: string }): string[] {
  return [
    ...common(opts.ffmpegDir),
    "-f",
    FORMAT,
    "--merge-output-format",
    "mp4",
    "--write-info-json",
    "--newline",
    "--progress-template",
    `${PROGRESS_PREFIX} %(info.format_id)s %(progress._percent_str)s`,
    "-o",
    joinTemplate(opts.outDir, "media.%(ext)s"),
    "--",
    opts.url,
  ];
}

// yt-dlp reads "-o" as a template, so the folder's own % signs must be doubled.
function joinTemplate(dir: string, name: string): string {
  return join(dir.replaceAll("%", "%%"), name);
}

const Num = z.number().finite().nonnegative();

/** The fields Alcyo reads from yt-dlp's JSON. Everything else is ignored. */
const RawInfo = z.looseObject({
  _type: z.string().optional(),
  id: z.string().max(200),
  title: z.string().max(500).optional(),
  uploader: z.string().max(200).nullish(),
  channel: z.string().max(200).nullish(),
  upload_date: z.string().nullish(),
  duration: Num.nullish(),
  webpage_url: z.string().optional(),
  original_url: z.string().optional(),
  extractor_key: z.string().max(100).optional(),
  extractor: z.string().max(100).optional(),
  format_id: z.string().max(200).nullish(),
  playlist_count: z.number().int().nonnegative().nullish(),
  entries: z.array(z.unknown()).nullish(),
});

export type LinkInfo =
  | { kind: "video"; info: YtDlpInfo; isClip: boolean; parts: number }
  | { kind: "playlist"; title: string; count: number | null }
  | { kind: "unsupported" };

export function toYtDlpInfo(raw: unknown, fallbackUrl: string): YtDlpInfo | null {
  const parsed = RawInfo.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  const date = r.upload_date != null && /^\d{8}$/.test(r.upload_date) ? r.upload_date : null;
  const candidate = {
    id: r.id,
    title: (r.title ?? r.id).slice(0, 500),
    uploader: (r.uploader ?? r.channel ?? null)?.slice(0, 200) ?? null,
    uploadDate: date,
    durationMs: r.duration == null ? null : Math.round(r.duration * 1000),
    webpageUrl: r.webpage_url ?? r.original_url ?? fallbackUrl,
    extractor: (r.extractor_key ?? r.extractor ?? "unknown").slice(0, 100),
  };
  const info = YtDlpInfoSchema.safeParse(candidate);
  if (info.success) return info.data;
  // A page URL yt-dlp reports that isn't http(s): keep the link the user sent.
  const retry = YtDlpInfoSchema.safeParse({ ...candidate, webpageUrl: fallbackUrl });
  return retry.success ? retry.data : null;
}

/** yt-dlp -J stdout to what the app needs to decide. */
export function parseInfo(stdout: string, url: string): LinkInfo {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { kind: "unsupported" };
  }
  const parsed = RawInfo.safeParse(raw);
  if (!parsed.success) return { kind: "unsupported" };
  const r = parsed.data;
  if (r._type === "playlist" || r.entries != null) {
    return {
      kind: "playlist",
      title: (r.title ?? "This page").slice(0, 200),
      count: r.playlist_count ?? r.entries?.length ?? null,
    };
  }
  const info = toYtDlpInfo(raw, url);
  if (info === null) return { kind: "unsupported" };
  const parts = Math.max(1, (r.format_id ?? "").split("+").filter((p) => p.length > 0).length);
  return {
    kind: "video",
    info,
    isClip: isClipUrl(url) || /clip/i.test(info.extractor),
    parts,
  };
}

/** Twitch and YouTube clip links. */
export function isClipUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  if (host === "clips.twitch.tv") return true;
  if (host === "twitch.tv" && /^\/[^/]+\/clip\/[^/]+/.test(u.pathname)) return true;
  if ((host === "youtube.com" || host === "youtu.be") && u.pathname.startsWith("/clip/"))
    return true;
  if (host === "kick.com" && /\/clips?\//.test(u.pathname)) return true;
  return false;
}

export type LinkRole = "source" | "clip" | "ask";

/**
 * Source: a long video that isn't a clip. Clip: a clip URL or a short video,
 * once the stream has a source. Ask: the length is unknown, or a clip would
 * be the stream's first media.
 */
export function classifyLink(
  link: { info: YtDlpInfo; isClip: boolean },
  hasSource: boolean,
): LinkRole {
  const ms = link.info.durationMs;
  if (!link.isClip && ms !== null && ms >= SOURCE_MIN_MS) return "source";
  return hasSource ? "clip" : "ask";
}

/**
 * One progress line to an overall percent. Each part of "137+140" downloads
 * from 0 to 100; parts are weighted evenly in the order they appear.
 */
export class ProgressReader {
  private seen: string[] = [];
  constructor(private readonly parts: number) {}

  read(line: string): number | null {
    const m = new RegExp(`^${PROGRESS_PREFIX}\\s+(\\S+)\\s+([\\d.]+)%`).exec(line.trim());
    if (m === null) return null;
    const format = m[1]!;
    const pct = Math.min(100, Math.max(0, Number(m[2])));
    if (!Number.isFinite(pct)) return null;
    if (!this.seen.includes(format)) this.seen.push(format);
    const index = Math.min(this.seen.indexOf(format), this.parts - 1);
    return Math.min(100, ((index + pct / 100) / this.parts) * 100);
  }
}

/** True when yt-dlp's error says the link itself is the problem. */
export function linkProblem(stderr: readonly string[]): boolean {
  const text = stderr.join("\n");
  return /unsupported url|is not a valid url|private|sign in|log ?in|members-only|not available|unavailable|404|403|no video formats|requested format is not available/i.test(
    text,
  );
}
