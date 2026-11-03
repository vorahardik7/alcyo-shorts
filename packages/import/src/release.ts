// Update downloader (plan section 11): pick this platform's yt-dlp from the
// latest GitHub release and its published SHA-256. Pure.
import { z } from "zod";

export const LATEST_RELEASE = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
export const SUMS_NAME = "SHA2-256SUMS";

const Asset = z.looseObject({
  name: z.string().max(200),
  browser_download_url: z.url({ protocol: /^https$/ }),
});
export const Release = z.looseObject({
  tag_name: z.string().regex(/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/),
  assets: z.array(Asset).max(200),
});
export type Release = z.infer<typeof Release>;

export function assetName(platform: NodeJS.Platform): string | null {
  if (platform === "darwin") return "yt-dlp_macos";
  if (platform === "win32") return "yt-dlp.exe";
  return null;
}

/** "<64 hex>  <name>" lines to a map. Other lines are ignored. */
export function parseSha256Sums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(\S.*)$/i.exec(line.trim());
    if (m !== null) out.set(m[2]!.trim(), m[1]!.toLowerCase());
  }
  return out;
}

/** The download and the hash for this platform, or why there isn't one. */
export function pickAsset(
  release: Release,
  platform: NodeJS.Platform,
): { binary: string; sums: string; name: string } | null {
  const name = assetName(platform);
  if (name === null) return null;
  const binary = release.assets.find((a) => a.name === name)?.browser_download_url;
  const sums = release.assets.find((a) => a.name === SUMS_NAME)?.browser_download_url;
  if (binary === undefined || sums === undefined) return null;
  return { binary, sums, name };
}

/** Compares yt-dlp versions like 2026.10.26 and 2026.10.26.1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}
