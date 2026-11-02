// The setup report (plan section 3 step 1, spec 5's checks that run today).
// Built in the worker, cached in main, shown on the Setup and Settings screens.
import { z } from "zod";

export const CHECK_IDS = [
  "claude",
  "claude-auth",
  "ffmpeg",
  "ffprobe",
  "whisper-cli",
  "yt-dlp",
  "vad",
  "ffmpeg-features",
  "whisper-model",
] as const;
export const CheckId = z.enum(CHECK_IDS);
export type CheckId = z.infer<typeof CheckId>;

export const CheckState = z.enum(["pass", "fail", "pending"]);
export type CheckState = z.infer<typeof CheckState>;

export const SetupCheck = z.object({
  id: CheckId,
  label: z.string().max(80),
  state: CheckState,
  /** Required checks must pass for setup to be complete. */
  required: z.boolean(),
  /** What was found: a path, a version. */
  detail: z.string().max(400),
  /** One line saying how to fix it, for failed or pending checks. */
  fix: z.string().max(300).nullable(),
  /** A command the fix line mentions, for a Copy button. */
  command: z.string().max(200).nullable(),
});
export type SetupCheck = z.infer<typeof SetupCheck>;

export const WhisperModelName = z.enum(["small.en", "base.en"]);
export type WhisperModelName = z.infer<typeof WhisperModelName>;

export const SetupReport = z.object({
  checkedAt: z.iso.datetime(),
  complete: z.boolean(),
  checks: z.array(SetupCheck),
  claude: z.object({
    path: z.string().nullable(),
    via: z.enum(["saved", "known-folder", "login-shell", "where", "none"]),
    version: z.string().nullable(),
    /** null when claude wasn't found, so sign-in couldn't be checked. */
    signedIn: z.boolean().nullable(),
  }),
  tools: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      present: z.boolean(),
      version: z.string().nullable(),
    }),
  ),
  ffmpeg: z.object({ subtitles: z.boolean(), libx264: z.boolean() }),
  /** H.264 encoders the bundled ffmpeg lists. */
  encoders: z.array(z.string().max(60)).max(40),
  whisperModel: z.object({ name: WhisperModelName, path: z.string(), present: z.boolean() }),
});
export type SetupReport = z.infer<typeof SetupReport>;

/** What main sends the worker so it can check without Electron's app API. */
export const SetupRequest = z.object({
  binDir: z.string().min(1),
  modelsDir: z.string().min(1),
  platform: z.enum(["darwin", "win32", "linux"]),
  arch: z.string(),
});
export type SetupRequest = z.infer<typeof SetupRequest>;
