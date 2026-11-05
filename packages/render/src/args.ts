// Render from one sequential ffconcat input. Saved integer milliseconds are
// the shared preview/ASS/crop clock; frame sampling happens only at output.
// See ffmpeg.org/ffmpeg-filters.html#select_002c-aselect (concatdec_select).
import { shortDuration, type Segment, type Short } from "@alcyo/schema";
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
  files: { filter: string; ass: string; fonts: string; concat?: string };
}

export interface RenderPlan {
  args: string[];
  filter: string;
  concat: string;
  /** The saved edit clock; output frame rounding is applied only once. */
  durationMs: number;
  segments: SnappedSegment[];
}

export function renderPlan(input: RenderPlanInput): RenderPlan {
  const { source, short, preset } = input;
  const segs = snapSegments(short.segments, source.fpsNum, source.fpsDen);
  const durationMs = shortDuration(short.segments);
  const duration = fixed(durationMs / 1000);
  // ffconcat opens the same recording sequentially, seeking for each cut.
  // duration directives retain the saved millisecond clock. Sampling to the
  // output frame rate happens once, after concatenation, so rounding never
  // accumulates across cuts. No intermediate video or quality loss.
  if (/[\r\n\0]/.test(input.sourcePath))
    throw new Error("Rename this recording without line breaks before rendering.");
  const filePath = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(input.sourcePath)
    ? input.sourcePath.replace(/\\/g, "/")
    : input.sourcePath;
  const quoted = filePath.replace(/'/g, "'\\''");
  // Decode nearby cuts together, rather than repeatedly decoding the same
  // GOP after a seek. Distant moments still seek; no full-VOD decode.
  const groups: { srcIn: number; srcOut: number; offset: number }[] = [];
  const spans: { from: number; to: number; shortFrom: number }[] = [];
  let readMs = 0;
  let shortMs = 0;
  for (const seg of short.segments) {
    let group = groups.at(-1);
    if (
      group === undefined ||
      seg.srcIn - group.srcOut > 2000 ||
      seg.srcOut - group.srcIn > 120000
    ) {
      if (group !== undefined) readMs += group.srcOut - group.srcIn;
      group = { srcIn: seg.srcIn, srcOut: seg.srcOut, offset: readMs };
      groups.push(group);
    } else group.srcOut = seg.srcOut;
    spans.push({
      from: (group.offset + seg.srcIn - group.srcIn) / 1000,
      to: (group.offset + seg.srcOut - group.srcIn) / 1000,
      shortFrom: shortMs / 1000,
    });
    shortMs += seg.srcOut - seg.srcIn;
  }
  const concat = [
    "ffconcat version 1.0",
    ...groups.flatMap((group) => [
      `file '${quoted}'`,
      `inpoint ${fixed(group.srcIn / 1000)}`,
      `outpoint ${fixed(group.srcOut / 1000)}`,
      `duration ${fixed((group.srcOut - group.srcIn) / 1000)}`,
    ]),
    "",
  ].join("\n");
  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-nostats",
    "-progress",
    "pipe:1",
    "-copyts",
    "-f",
    "concat",
    "-safe",
    "0",
    "-protocol_whitelist",
    "file",
    "-segment_time_metadata",
    "1",
    "-threads",
    "2",
    "-i",
    input.files.concat ?? "input.ffconcat",
  ];
  const chains: string[] = [];
  const ranges: { from: number; to: number }[] = [];
  let acc = 0;
  for (const seg of short.segments) {
    const from = acc;
    acc += seg.srcOut - seg.srcIn;
    ranges.push({ from: from / 1000, to: acc / 1000 });
  }
  const piecewise = (
    lo: number,
    hi: number,
    variable: string,
    leaf: (span: (typeof spans)[number]) => string,
  ): string => {
    if (hi - lo === 1) return leaf(spans[lo]!);
    const mid = Math.floor((lo + hi) / 2);
    return `if(lt(${variable},${fixed(spans[mid]!.from)}),${piecewise(lo, mid, variable, leaf)},${piecewise(mid, hi, variable, leaf)})`;
  };
  const keep = piecewise(
    0,
    spans.length,
    "t",
    (span) => `gte(t,${fixed(span.from)})*lt(t,${fixed(span.to)})`,
  );
  const clock = piecewise(0, spans.length, "T", (span) => `T-${fixed(span.from - span.shortFrom)}`);
  // A balanced decision tree selects one local fade per sample in O(log cuts).
  const gain = (lo: number, hi: number): string => {
    if (hi - lo === 1) {
      const r = ranges[lo]!;
      return `clip(min(t-${fixed(r.from)},${fixed(r.to)}-t)/${fixed(FADE_MS / 1000)},0,1)`;
    }
    const mid = Math.floor((lo + hi) / 2);
    return `if(lt(t,${fixed(ranges[mid]!.from)}),${gain(lo, mid)},${gain(mid, hi)})`;
  };
  chains.push(
    source.hasAudio
      ? `[0:a]aselect='concatdec_select*(${keep})',asetpts='(${clock})/TB',aresample=48000:async=1:min_hard_comp=0.001:first_pts=0,aformat=channel_layouts=stereo,apad=whole_dur=${duration},atrim=duration=${duration},asetpts=N/SR/TB,aeval=exprs='val(ch)*${gain(0, ranges.length)}':c=same[a]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[a]`,
  );

  const { w, h } = cropSize(source.width, source.height);
  const y = 2 * Math.floor((source.height - h) / 4);
  chains.push(
    [
      `[0:v]select='concatdec_select*(${keep})',setpts='(${clock})/TB',fps=${preset.fps}:start_time=0,tpad=stop_mode=clone:stop_duration=1,trim=duration=${duration}`,
      `crop=w=${w}:h=${h}:x='${cropXExpr(short.crop.keys, source.width, source.height)}':y=${y}`,
      `scale=${preset.width}:${preset.height}:flags=lanczos`,
      "setsar=1",
      `subtitles=filename=${input.files.ass}:fontsdir=${input.files.fonts}[v]`,
    ].join(","),
  );

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
    "-t", duration,
    input.outPath,
  ); // prettier-ignore

  return {
    args,
    filter: `${chains.join(";\n")}\n`,
    durationMs,
    concat,
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
