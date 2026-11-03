// Rendering (plan sections 18 and 23 spec 9): what main asks the worker to
// render, and the render jobs the window shows. Main fills in every path.
import { CaptionPreset, HookPreset, Id, IsoDateTime, Ms, Short, Word } from "@alcyo/schema";
import { z } from "zod";

export const RenderRequest = z.object({
  ffmpeg: z.string().min(1),
  ffprobe: z.string().min(1),
  fontsDir: z.string().min(1),
  workDir: z.string().min(1),
  sourcePath: z.string().min(1),
  source: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fpsNum: z.number().int().positive(),
    fpsDen: z.number().int().positive(),
    hasAudio: z.boolean(),
  }),
  short: Short,
  /** Only the words inside the short's segments. */
  words: z.array(Word),
  caption: CaptionPreset,
  hook: HookPreset,
  presetId: Id,
  outPath: z.string().min(1),
});
export type RenderRequest = z.infer<typeof RenderRequest>;

export const RenderEvent = z.object({
  kind: z.literal("render-progress"),
  pct: z.number().min(0).max(100),
});
export type RenderEvent = z.infer<typeof RenderEvent>;

export const RenderResult = z.object({
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  durationMs: Ms,
  videoCodec: z.string().max(50),
  audioCodec: z.string().max(50),
});
export type RenderResult = z.infer<typeof RenderResult>;

/** One render as the window shows it: the queue drawer and the render card. */
export const RenderView = z.object({
  renderId: Id,
  streamId: Id,
  shortId: Id,
  version: z.number().int().positive(),
  presetId: Id,
  title: z.string().max(80),
  state: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  pct: z.number().min(0).max(100),
  /** The finished file. Set when done. */
  file: z.string().nullable(),
  durationMs: Ms.nullable(),
  /** What went wrong, in one line. Set when failed. */
  message: z.string().max(300).nullable(),
  createdAt: IsoDateTime,
});
export type RenderView = z.infer<typeof RenderView>;
