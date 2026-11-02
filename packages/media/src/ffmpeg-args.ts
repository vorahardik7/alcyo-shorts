// ffmpeg argument builders for the audio, loudness, silence, scene, proxy,
// thumbnail and encoder-test steps. All pure. "--" can't guard ffmpeg inputs,
// so paths always follow -i, where ffmpeg reads them as a file name.

export const AUDIO_RATE = 16_000;
const QUIET = ["-hide_banner", "-nostdin", "-y"];
const PROGRESS = ["-progress", "pipe:1", "-nostats"];

/** 16 kHz mono 16-bit WAV for whisper, silences, loudness and peaks. */
export function audioArgs(input: string, out: string): string[] {
  return [
    ...QUIET,
    ...PROGRESS,
    "-v",
    "error",
    "-i",
    input,
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(AUDIO_RATE),
    "-c:a",
    "pcm_s16le",
    "-f",
    "wav",
    out,
  ];
}

/** Cuts [startMs, endMs) out of the 16 kHz WAV. Sample-exact on PCM. */
export function chunkAudioArgs(wav: string, startMs: number, endMs: number, out: string): string[] {
  return [
    ...QUIET,
    "-v",
    "error",
    "-ss",
    secs(startMs),
    "-to",
    secs(endMs),
    "-i",
    wav,
    "-c:a",
    "pcm_s16le",
    "-f",
    "wav",
    out,
  ];
}

export const SILENCE_NOISE_DB = -35;
export const SILENCE_MIN_MS = 300;

export function silenceArgs(wav: string): string[] {
  return [
    ...QUIET,
    ...PROGRESS,
    "-i",
    wav,
    "-af",
    `silencedetect=n=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_MS / 1000}`,
    "-f",
    "null",
    "-",
  ];
}

export function loudnessArgs(wav: string): string[] {
  // framelog=verbose prints a line per 100 ms at -v verbose.
  return [
    ...QUIET,
    ...PROGRESS,
    "-v",
    "verbose",
    "-i",
    wav,
    "-af",
    "ebur128=framelog=verbose",
    "-f",
    "null",
    "-",
  ];
}

export const SCENE_THRESHOLD = 0.3;
export const SCENE_WIDTH = 320;

export function sceneArgs(input: string): string[] {
  return [
    ...QUIET,
    ...PROGRESS,
    "-i",
    input,
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    `scale=${SCENE_WIDTH}:-2,select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
    "-f",
    "null",
    "-",
  ];
}

export const THUMB_EVERY_MS = 5000;
export const THUMB_WIDTH = 320;

/** One JPEG every 5 s: <dir>/thumbs-001.jpg, -002, … */
export function thumbnailArgs(input: string, pattern: string): string[] {
  return [
    ...QUIET,
    ...PROGRESS,
    "-v",
    "error",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    `fps=1/${THUMB_EVERY_MS / 1000},scale=${THUMB_WIDTH}:-2`,
    "-q:v",
    "5",
    "-start_number",
    "1",
    pattern,
  ];
}

/** Proxy encoders in the order the test encode tries them (section 14). */
export const ENCODER_ORDER = [
  "h264_videotoolbox",
  "h264_nvenc",
  "h264_qsv",
  "h264_amf",
  "h264_mf",
  "libx264",
] as const;
export type Encoder = (typeof ENCODER_ORDER)[number];

function encoderOptions(encoder: string): string[] {
  return encoder === "libx264"
    ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]
    : ["-c:v", encoder, "-b:v", "5M"];
}

export function encoderTestArgs(encoder: string): string[] {
  return [
    ...QUIET,
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30",
    "-t",
    "1",
    "-pix_fmt",
    "yuv420p",
    ...encoderOptions(encoder),
    "-f",
    "null",
    "-",
  ];
}

export const PROXY_HEIGHT = 720;

/**
 * 720p H.264 proxy with a keyframe every second and AAC audio. With a range,
 * only that part (for per-short proxies, spec 9), seeking before the input.
 */
export function proxyArgs(opts: {
  input: string;
  out: string;
  encoder: string;
  fps: number;
  hasAudio: boolean;
  range?: { startMs: number; endMs: number };
}): string[] {
  const gop = String(Math.max(1, Math.round(opts.fps)));
  return [
    ...QUIET,
    ...PROGRESS,
    "-v",
    "error",
    ...(opts.range === undefined
      ? []
      : ["-ss", secs(opts.range.startMs), "-to", secs(opts.range.endMs)]),
    "-i",
    opts.input,
    "-map",
    "0:v:0",
    ...(opts.hasAudio ? ["-map", "0:a:0"] : []),
    "-vf",
    `scale=-2:${PROXY_HEIGHT}`,
    "-pix_fmt",
    "yuv420p",
    ...encoderOptions(opts.encoder),
    "-g",
    gop,
    "-keyint_min",
    gop,
    ...(opts.hasAudio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    opts.out,
  ];
}

/** ms to ffmpeg seconds, exact to the ms. */
export function secs(ms: number): string {
  return (ms / 1000).toFixed(3);
}
