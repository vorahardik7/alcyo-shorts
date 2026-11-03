// Links, downloads and clip matching (plan sections 11 and 12, spec 6): what
// main asks the worker to run and what comes back. Main fills in every path.
import { ClipMatch, YtDlpInfo } from "@alcyo/schema";
import { z } from "zod";

export const LinkInfoRequest = z.object({
  ytDlp: z.string().min(1),
  ffmpegDir: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
});
export type LinkInfoRequest = z.infer<typeof LinkInfoRequest>;

export const LinkInfoResult = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("video"),
    info: YtDlpInfo,
    isClip: z.boolean(),
    /** Parts in the chosen format: "137+140" is 2. */
    parts: z.number().int().min(1).max(8),
  }),
  z.object({
    kind: z.literal("playlist"),
    title: z.string().max(200),
    count: z.number().int().nonnegative().nullable(),
  }),
  z.object({ kind: z.literal("unsupported") }),
]);
export type LinkInfoResult = z.infer<typeof LinkInfoResult>;

export const DownloadRequest = LinkInfoRequest.extend({
  /** sources/<id>/ or clips/<id>/. Removed on cancel or failure. */
  outDir: z.string().min(1),
  parts: z.number().int().min(1).max(8),
});
export type DownloadRequest = z.infer<typeof DownloadRequest>;

export const DownloadResult = z.object({ path: z.string().min(1), info: YtDlpInfo.nullable() });
export type DownloadResult = z.infer<typeof DownloadResult>;

export const ClipMatchRequest = z.object({
  /** cache/<clipId>/audio.wav, 16 kHz mono. */
  clipAudio: z.string().min(1),
  /** clips/<clipId>/analysis/transcript.json, or null when there is none. */
  clipTranscript: z.string().min(1).nullable(),
  /** cache/<sourceId>/audio.wav. */
  vodAudio: z.string().min(1),
  vodTranscript: z.string().min(1).nullable(),
  clipDurationMs: z.number().int().positive(),
  vodDurationMs: z.number().int().positive(),
});
export type ClipMatchRequest = z.infer<typeof ClipMatchRequest>;

/** null when nothing lined up at all. A low-confidence match is still returned. */
export const ClipMatchResult = z.object({ match: ClipMatch.nullable() });
export type ClipMatchResult = z.infer<typeof ClipMatchResult>;

/** Events from a download or match job. */
export const ImportEvent = z.object({
  kind: z.literal("import-progress"),
  stage: z.string().max(120),
  pct: z.number().min(0).max(100),
});
export type ImportEvent = z.infer<typeof ImportEvent>;
