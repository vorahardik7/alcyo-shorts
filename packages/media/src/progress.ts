// Progress lines from ffmpeg (-progress pipe:1) and whisper-cli (-pp).

/** Percent from an ffmpeg `out_time_us=` line, or null for any other line. */
export function ffmpegProgress(line: string, durationMs: number): number | null {
  const m = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim());
  if (m === null || durationMs <= 0) return null;
  // ffmpeg's out_time_ms is in microseconds too, despite the name.
  const ms = Number(m[1]) / 1000;
  return clampPct((ms / durationMs) * 100);
}

/** Percent from whisper-cli's `progress = N%` line, or null. */
export function whisperProgress(line: string): number | null {
  const m = /progress\s*=\s*(\d+)%/.exec(line);
  return m === null ? null : clampPct(Number(m[1]));
}

export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
}
