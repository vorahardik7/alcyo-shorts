// project.json, and the userData files: settings.json, streams.json, plus
// renders/index.json (plan section 15).
import { z } from "zod";
import { Id, IsoDateTime, Ms, SchemaVersion } from "./primitives.ts";

export const Project = z.object({
  schemaVersion: SchemaVersion,
  streamId: Id,
  name: z.string().min(1).max(120),
  createdAt: IsoDateTime,
  sources: z.array(z.object({ sourceId: Id })),
  shorts: z.array(z.object({ shortId: Id, head: z.number().int().positive() })),
  clips: z.array(Id),
  settings: z.object({ copyIntoProject: z.boolean() }),
});
export type Project = z.infer<typeof Project>;

export const StreamsIndex = z.object({
  schemaVersion: SchemaVersion,
  streams: z.array(
    z.object({
      streamId: Id,
      folder: z.string().min(1),
      name: z.string().min(1).max(120),
      thumbnail: z.string().nullable(),
      lastActivityAt: IsoDateTime,
      unread: z.boolean(),
    }),
  ),
});
export type StreamsIndex = z.infer<typeof StreamsIndex>;

export const RenderIndex = z.object({
  schemaVersion: SchemaVersion,
  renders: z.array(
    z.object({
      renderId: Id,
      shortId: Id,
      version: z.number().int().positive(),
      presetId: Id,
      file: z.string().min(1),
      createdAt: IsoDateTime,
      probe: z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        durationMs: Ms,
        videoCodec: z.string(),
        audioCodec: z.string(),
      }),
    }),
  ),
});
export type RenderIndex = z.infer<typeof RenderIndex>;

export const Settings = z.object({
  schemaVersion: SchemaVersion,
  provider: z.enum(["claude-cli", "anthropic-api"]),
  /** Saved after a working lookup; tried first next time (section 16). */
  claudePath: z.string().nullable(),
  model: z.string().min(1).max(100),
  whisperModel: z.enum(["small.en", "base.en"]),
  /** The proxy encoder picked by the test encode (section 14). */
  encoder: z.string().nullable(),
  ytDlp: z.object({ version: z.string().nullable(), path: z.string().nullable() }),
  theme: z.enum(["dark", "light"]),
});
export type Settings = z.infer<typeof Settings>;

export function defaultSettings(platform: "darwin" | "win32" | "linux"): Settings {
  return {
    schemaVersion: 1,
    provider: "claude-cli",
    claudePath: null,
    model: "sonnet",
    whisperModel: platform === "win32" ? "base.en" : "small.en",
    encoder: null,
    ytDlp: { version: null, path: null },
    theme: "dark",
  };
}
