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
      /** The last message's text, cut short, for the sidebar. Added in spec 4. */
      preview: z.string().max(200).default(""),
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

/** A local coding agent the app can call for structured JSON. */
export const LocalAgentId = z.enum(["claude", "grok", "codex"]);
export type LocalAgentId = z.infer<typeof LocalAgentId>;

/** Who answers a planner request. `*-cli` is that agent on this computer. */
export const ProviderId = z.enum(["claude-cli", "grok-cli", "codex-cli", "anthropic-api"]);
export type ProviderId = z.infer<typeof ProviderId>;

export const Settings = z.object({
  schemaVersion: SchemaVersion,
  provider: ProviderId,
  /** Saved after a working lookup; tried first next time (section 16). */
  claudePath: z.string().nullable(),
  /** Saved Grok and Codex paths. Missing on files written before spec 5. */
  grokPath: z.string().nullable().default(null),
  codexPath: z.string().nullable().default(null),
  model: z.string().min(1).max(100),
  whisperModel: z.enum(["small.en", "base.en"]),
  /** The proxy encoder picked by the test encode (section 14). */
  encoder: z.string().nullable(),
  ytDlp: z.object({ version: z.string().nullable(), path: z.string().nullable() }),
  theme: z.enum(["dark", "light"]),
  /** Where new stream folders go. Null means Movies (macOS) or Videos (Windows)/Alcyo Shorts. Added in spec 4. */
  streamsDir: z.string().min(1).nullable().default(null),
});
export type Settings = z.infer<typeof Settings>;

export function defaultSettings(platform: "darwin" | "win32" | "linux"): Settings {
  return {
    schemaVersion: 1,
    provider: "claude-cli",
    claudePath: null,
    grokPath: null,
    codexPath: null,
    model: "sonnet",
    whisperModel: platform === "win32" ? "base.en" : "small.en",
    encoder: null,
    ytDlp: { version: null, path: null },
    theme: "dark",
    streamsDir: null,
  };
}
