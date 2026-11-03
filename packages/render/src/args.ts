// A saved version and a render preset -> ffmpeg's args and filter graph
// (plan sections 18 and 23 spec 9). Pure: the same input gives the same args
// and filter text. Each segment is its own input (-ss and -to before -i),
// trimmed to a whole number of source frames, with a 10 ms audio fade at
// each cut, then concat, 9:16 crop, scale and the captions.
import type { Segment, Short } from "@alcyo/schema";
import { cropSize, cropXExpr } from "./crop.ts";

export interface RenderPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
}

export const RENDER_PRESETS: readonly RenderPreset[] = [
  { id: "1080p30", label: "1080 × 1920, 30 fps", width: 1080, height: 1920, fps: 30 },
];
export const DEFAULT_RENDER_PRESET = RENDER_PRESETS[0]!;

/** The fade at each end of each segment, so cuts don't click. */
export const FADE_MS = 10;
/** Extra input read after a segment, so trim always has enough frames. */
const READ_PAD_MS = 500;

export interface SourceVideo {
  width: number;
  height: number;
  fpsNum: number;
  fpsDen: number;
  hasAudio: boolean;
}

export interface SnappedSegment {
  /** First source frame. */
  startFrame: number;
  frames: number;
  /** Exact seconds of the first frame and of the segment, as text for ffmpeg. */
  startSec: string;
  durSec: string;
  /** The same in ms, rounded, for the length check. */
  startMs: number;
  durMs: number;
}

const fixed = (v: number) => v.toFixed(6);

/** Segment edges on source frames: start and end round to the nearest frame. */
export function snapSegments(
  segments: readonly Segment[],
  fpsNum: number,
  fpsDen: number,
): SnappedSegment[] {
  const out: SnappedSegment[] = [];
  for (const s of segments) {
    const a = Math.round((s.srcIn * fpsNum) / (1000 * fpsDen));
    const b = Math.round((s.srcOut * fpsNum) / (1000 * fpsDen));
    const frames = Math.max(1, b - a);
    const start = (a * fpsDen) / fpsNum;
    const dur = (frames * fpsDen) / fpsNum;
    out.push({
      startFrame: a,
      frames,
      startSec: fixed(start),
      durSec: fixed(dur),
      startMs: Math.round(start * 1000),
      durMs: Math.round(dur * 1000),
    });
  }
  return out;
}

export interface RenderPlanInput {
  sourcePath: string;
  source: SourceVideo;
  short: Short;
  preset: RenderPreset;
  /** Where ffmpeg writes. The runner renames it into place when it's checked. */
  outPath: string;
  /** File names in ffmpeg's working folder. Relative, so no path is escaped in the graph. */
  files: { filter: string; ass: string; fonts: string };
}

export interface RenderPlan {
  args: string[];
  filter: string;
  /** The output's expected length: the snapped segments' total. */
  durationMs: number;
  segments: SnappedSegment[];
}

export function renderPlan(input: RenderPlanInput): RenderPlan {
  const { source, short, preset } = input;
  const segs = snapSegments(short.segments, source.fpsNum, source.fpsDen);
  const args = ["-hide_banner", "-nostdin", "-y", "-nostats", "-progress", "pipe:1"];
  const chains: string[] = [];
  const pairs: string[] = [];

  segs.forEach((seg, i) => {
    const endSec = fixed(Number(seg.startSec) + Number(seg.durSec) + READ_PAD_MS / 1000);
    args.push("-ss", seg.startSec, "-to", endSec, "-i", input.sourcePath);
    chains.push(`[${i}:v]trim=end_frame=${seg.frames},setpts=PTS-STARTPTS[v${i}]`);
    const fadeOut = fixed(Math.max(0, Number(seg.durSec) - FADE_MS / 1000));
    const fade = `afade=t=in:d=${fixed(FADE_MS / 1000)},afade=t=out:st=${fadeOut}:d=${fixed(FADE_MS / 1000)}`;
    chains.push(
      source.hasAudio
        ? `[${i}:a]atrim=end=${seg.durSec},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,${fade}[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=end=${seg.durSec}[a${i}]`,
    );
    pairs.push(`[v${i}][a${i}]`);
  });

  const { w, h } = cropSize(source.width, source.height);
  const y = 2 * Math.floor((source.height - h) / 4);
  chains.push(`${pairs.join("")}concat=n=${segs.length}:v=1:a=1[cv][ca]`);
  chains.push(
    [
      `[cv]fps=${preset.fps}`,
      `crop=w=${w}:h=${h}:x='${cropXExpr(short.crop.keys, source.width, source.height)}':y=${y}`,
      `scale=${preset.width}:${preset.height}:flags=lanczos`,
      "setsar=1",
      `subtitles=filename=${input.files.ass}:fontsdir=${input.files.fonts}[v]`,
    ].join(","),
  );
  chains.push("[ca]anull[a]");

  args.push(
    "-/filter_complex", input.files.filter,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "20",
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    "-r", String(preset.fps),
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-map_metadata", "-1",
    "-movflags", "+faststart",
    input.outPath,
  ); // prettier-ignore

  return {
    args,
    filter: `${chains.join(";\n")}\n`,
    durationMs: Math.round(segs.reduce((t, s) => t + Number(s.durSec), 0) * 1000),
    segments: segs,
  };
}

/** "Cat brings a DEAD mouse" -> "cat-brings-a-dead-mouse". */
export function fileSlug(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return s.length > 0 ? s : "short";
}

/** renders/<title>-v3-1080p30.mp4 (plan section 15). */
export function renderFileName(title: string, version: number, preset: RenderPreset): string {
  return `${fileSlug(title)}-v${version}-${preset.id}.mp4`;
}
