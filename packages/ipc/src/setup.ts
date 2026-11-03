// The setup report (plan section 3 step 1, spec 5's checks that run today).
// Built in the worker, cached in main, shown on the Setup and Settings screens.
import { LocalAgentId } from "@alcyo/schema";
import { z } from "zod";

export { LocalAgentId };

export const CHECK_IDS = [
  "agent",
  "claude",
  "agent-grok",
  "agent-codex",
  "api-key",
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

const AgentVia = z.enum(["saved", "known-folder", "login-shell", "where", "none"]);

export const AgentStatus = z.object({
  id: LocalAgentId,
  path: z.string().nullable(),
  via: AgentVia,
  version: z.string().nullable(),
  /** null when the binary wasn't found, so sign-in couldn't be checked. */
  signedIn: z.boolean().nullable(),
  problem: z.enum(["missing", "cmd-shim"]).nullable(),
});
export type AgentStatus = z.infer<typeof AgentStatus>;

export const SetupReport = z.object({
  checkedAt: z.iso.datetime(),
  complete: z.boolean(),
  checks: z.array(SetupCheck),
  /** Every agent that was looked up, in catalog order. */
  agents: z.array(AgentStatus).max(6),
  /** The signed-in agent Alcyo will call. Null when none is ready. */
  chosen: z
    .object({ id: LocalAgentId, path: z.string(), version: z.string().nullable() })
    .nullable(),
  /** Whether an API key is saved. The key itself never leaves the main process. */
  apiKey: z.object({ present: z.boolean() }),
  claude: z.object({
    path: z.string().nullable(),
    via: AgentVia,
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
  /** Saved paths and the provider to prefer. Omitted by older callers. */
  saved: z
    .object({
      provider: z.enum(["claude-cli", "grok-cli", "codex-cli", "anthropic-api"]),
      claudePath: z.string().nullable(),
      grokPath: z.string().nullable(),
      codexPath: z.string().nullable(),
    })
    .optional(),
});
export type SetupRequest = z.infer<typeof SetupRequest>;

/** Fills in the API-key row. Main does this; the worker never sees the key. */
export function applyApiKey(report: SetupReport, present: boolean): SetupReport {
  const without = report.checks.filter((c) => c.id !== "api-key");
  const apiKey: SetupCheck = present
    ? {
        id: "api-key",
        label: "API key backup",
        state: "pass",
        required: false,
        detail: "Saved on this computer. Used only when no coding agent is signed in.",
        fix: null,
        command: null,
      }
    : {
        id: "api-key",
        label: "API key backup",
        state: "pending",
        required: false,
        detail: "No key saved.",
        fix: "Optional. Add one in Settings if you don't have a coding agent signed in.",
        command: null,
      };
  const checks = without.map((c) => {
    if (c.id !== "agent" || !present || report.chosen !== null || c.state === "pass") return c;
    return {
      ...c,
      state: "pass" as const,
      detail: "No coding agent is signed in. Alcyo will use the saved API key.",
      fix: null,
      command: null,
    };
  });
  checks.push(apiKey);
  return {
    ...report,
    checks,
    apiKey: { present },
    complete: checks.every((c) => !c.required || c.state === "pass"),
  };
}
