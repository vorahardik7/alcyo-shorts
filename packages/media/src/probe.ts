// ffprobe: args, parsing into the schema's Probe, and whether Chromium plays
// the file directly.
import { Probe } from "@alcyo/schema";
import { z } from "zod";
import { MediaError, UNREADABLE_MESSAGE } from "./errors.ts";

export function ffprobeArgs(input: string): string[] {
  return ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "--", input];
}

const FfStream = z.looseObject({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional(),
  sample_rate: z.string().optional(),
  channels: z.number().optional(),
  disposition: z.looseObject({ attached_pic: z.number().optional() }).optional(),
});
const FfProbeJson = z.looseObject({
  streams: z.array(FfStream).default([]),
  format: z
    .looseObject({ format_name: z.string().optional(), duration: z.string().optional() })
    .optional(),
});

function rate(text: string | undefined): { num: number; den: number } | null {
  const m = /^(\d+)\/(\d+)$/.exec(text ?? "");
  if (m === null) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  return num > 0 && den > 0 ? { num, den } : null;
}

const DIRECT_CONTAINERS = ["mp4", "mov", "m4v", "webm"];
const DIRECT_VIDEO = ["h264", "vp8", "vp9", "av1"];
const DIRECT_AUDIO = ["aac", "mp3", "opus", "vorbis"];

/**
 * True when a <video> element in Chromium plays the file as is. HEVC is left
 * out because Chromium on Windows needs an extension for it.
 */
export function playsDirectly(p: Omit<Probe, "playsDirectly">): boolean {
  const names = p.container.split(",");
  if (!names.some((n) => DIRECT_CONTAINERS.includes(n))) return false;
  if (p.video === null || !DIRECT_VIDEO.includes(p.video.codec)) return false;
  return p.audio === null || DIRECT_AUDIO.includes(p.audio.codec);
}

/** Parses ffprobe's JSON. Throws MediaError("unreadable") when it isn't a media file. */
export function parseFfprobe(stdout: string): Probe {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new MediaError("unreadable", UNREADABLE_MESSAGE);
  }
  const parsed = FfProbeJson.safeParse(raw);
  if (!parsed.success) throw new MediaError("unreadable", UNREADABLE_MESSAGE);
  const { streams, format } = parsed.data;

  // Cover art in an audio file shows up as a video stream; it isn't one.
  const v = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const a = streams.find((s) => s.codec_type === "audio");
  const seconds = Number(format?.duration ?? NaN);
  if ((v === undefined && a === undefined) || !Number.isFinite(seconds) || seconds <= 0) {
    throw new MediaError("unreadable", UNREADABLE_MESSAGE);
  }

  const fps = rate(v?.avg_frame_rate) ?? rate(v?.r_frame_rate) ?? { num: 30, den: 1 };
  const base = {
    durationMs: Math.round(seconds * 1000),
    container: (format?.format_name ?? "unknown").slice(0, 100),
    video:
      v !== undefined && (v.width ?? 0) > 0 && (v.height ?? 0) > 0
        ? {
            codec: (v.codec_name ?? "unknown").slice(0, 50),
            width: v.width!,
            height: v.height!,
            fpsNum: fps.num,
            fpsDen: fps.den,
          }
        : null,
    audio:
      a !== undefined
        ? {
            codec: (a.codec_name ?? "unknown").slice(0, 50),
            sampleRate: Math.max(1, Math.round(Number(a.sample_rate ?? 0))) || 48000,
            channels: Math.max(1, a.channels ?? 1),
          }
        : null,
  };
  return Probe.parse({ ...base, playsDirectly: playsDirectly(base) });
}

/** The stream-layout part of the fingerprint, e.g. "v:h264:1280x720@30/1|a:aac:48000x2". */
export function layoutOf(p: Probe): string {
  const parts: string[] = [];
  if (p.video !== null)
    parts.push(
      `v:${p.video.codec}:${p.video.width}x${p.video.height}@${p.video.fpsNum}/${p.video.fpsDen}`,
    );
  if (p.audio !== null) parts.push(`a:${p.audio.codec}:${p.audio.sampleRate}x${p.audio.channels}`);
  return parts.join("|").slice(0, 200);
}
