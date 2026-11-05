// sources/<sourceId>/source.json (plan section 15). The ffprobe summary and the
// yt-dlp info are stored after conversion to integer ms.
import { z } from "zod";
import { HttpUrl, Id, IsoDateTime, Ms, SchemaVersion } from "./primitives.ts";

export const Probe = z.object({
  durationMs: Ms,
  container: z.string().max(100),
  video: z
    .object({
      codec: z.string().max(50),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fpsNum: z.number().int().positive(),
      fpsDen: z.number().int().positive(),
    })
    .nullable(),
  audio: z
    .object({
      codec: z.string().max(50),
      sampleRate: z.number().int().positive(),
      channels: z.number().int().positive(),
    })
    .nullable(),
  /** True when Chromium plays the file directly, so no proxy is needed. */
  playsDirectly: z.boolean(),
});
export type Probe = z.infer<typeof Probe>;

/** Size, first and last 4 MB, ffprobe duration and stream layout (section 15). */
export const Fingerprint = z.object({
  sizeBytes: z.number().int().nonnegative(),
  headSha256: z.string().regex(/^[0-9a-f]{64}$/),
  tailSha256: z.string().regex(/^[0-9a-f]{64}$/),
  durationMs: Ms,
  layout: z.string().max(200),
});
export type Fingerprint = z.infer<typeof Fingerprint>;

/** The parts of yt-dlp's info JSON Alcyo keeps. */
export const YtDlpInfo = z.object({
  id: z.string().max(200),
  title: z.string().max(500),
  uploader: z.string().max(200).nullable(),
  /** YYYYMMDD, as yt-dlp writes it. */
  uploadDate: z
    .string()
    .regex(/^\d{8}$/)
    .nullable(),
  durationMs: Ms.nullable(),
  webpageUrl: HttpUrl,
  extractor: z.string().max(100),
});
export type YtDlpInfo = z.infer<typeof YtDlpInfo>;

export const SourceOrigin = z.discriminatedUnion("kind", [
  /** A local file, referenced in place unless copied into the project. */
  z.object({ kind: z.literal("file"), path: z.string().min(1), copied: z.boolean() }),
  /** A URL import, always downloaded into the project. */
  z.object({ kind: z.literal("url"), url: HttpUrl, path: z.string().min(1) }),
]);

export const Source = z.object({
  schemaVersion: SchemaVersion,
  sourceId: Id,
  addedAt: IsoDateTime,
  origin: SourceOrigin,
  /** Changes only when a source is relinked/moved; busts Chromium media caches. */
  mediaRevision: z.number().int().nonnegative().optional(),
  fingerprint: Fingerprint,
  probe: Probe.nullable(),
  info: YtDlpInfo.nullable(),
});
export type Source = z.infer<typeof Source>;
