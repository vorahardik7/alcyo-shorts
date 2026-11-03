// Fixed setup reports for headless test runs (ALCYO_TEST_SETUP=pass|fail), so
// e2e tests don't depend on what's installed on the machine. Never used
// outside headless mode.
import { join } from "node:path";
import type { AgentStatus, SetupCheck, SetupReport, SetupRequest } from "@alcyo/ipc";

export type FixtureKind = "pass" | "fail";

export function fixtureKind(env: NodeJS.ProcessEnv, headless: boolean): FixtureKind | null {
  if (!headless) return null;
  const value = env["ALCYO_TEST_SETUP"];
  return value === "pass" || value === "fail" ? value : null;
}

const missing = (id: AgentStatus["id"]): AgentStatus => ({
  id,
  path: null,
  via: "none",
  version: null,
  signedIn: null,
  problem: "missing",
});

export function fixtureReport(kind: FixtureKind, req: SetupRequest, at: Date): SetupReport {
  const exe = (name: string) => join(req.binDir, req.platform === "win32" ? `${name}.exe` : name);
  const ok = kind === "pass";
  const claudePath = ok ? "/Users/creator/.local/bin/claude" : null;
  const pass = (id: SetupCheck["id"], label: string, detail: string): SetupCheck => ({
    id,
    label,
    state: "pass",
    required: true,
    detail,
    fix: null,
    command: null,
  });
  const tools = ["ffmpeg", "ffprobe", "whisper-cli", "yt-dlp"] as const;
  const versions = {
    ffmpeg: "9.0.2",
    ffprobe: "9.0.2",
    "whisper-cli": "1.9.5",
    "yt-dlp": "2026.10.26",
  };

  const notInstalled = (id: "agent-grok" | "agent-codex", label: string): SetupCheck => ({
    id,
    label,
    state: "pending",
    required: false,
    detail: "Not installed.",
    fix: `Install ${label} (the ${label.toLowerCase()} command), then press Check again.`,
    command: null,
  });

  // Same rows and order as the worker's real report.
  const checks: SetupCheck[] = [
    ok
      ? pass("agent", "Coding agent", "Claude Code is signed in and will answer.")
      : {
          id: "agent",
          label: "Coding agent",
          state: "fail",
          required: true,
          detail: "None of Claude Code, Grok or Codex is signed in.",
          fix: "Install one of them and sign in, or save an API key in Settings.",
          command: null,
        },
    ok
      ? {
          ...pass(
            "claude",
            "Claude Code",
            `Version 2.1.30, signed in, in a standard folder: ${claudePath}`,
          ),
          required: false,
        }
      : {
          id: "claude",
          label: "Claude Code",
          state: "fail",
          required: false,
          detail: "Not installed.",
          fix: "Install Claude Code from claude.com/product/claude-code, then press Check again.",
          command: null,
        },
    notInstalled("agent-grok", "Grok"),
    notInstalled("agent-codex", "Codex"),
    ...tools.map((t) =>
      ok || t !== "yt-dlp"
        ? pass(t, t, `Version ${versions[t]}: ${exe(t)}`)
        : ({
            id: t,
            label: t,
            state: "fail",
            required: true,
            detail: `Missing: ${exe(t)}`,
            fix: "Reinstall Alcyo Shorts. Building from source? Run pnpm fetch-binaries.",
            command: "pnpm fetch-binaries",
          } satisfies SetupCheck),
    ),
    pass(
      "vad",
      "Silero VAD model",
      `Bundled: ${join(req.binDir, "models", "ggml-silero-v6.2.0.bin")}`,
    ),
    pass(
      "ffmpeg-features",
      "Captions and H.264 in ffmpeg",
      "Has the libass subtitles filter and libx264.",
    ),
    {
      id: "whisper-model",
      label: "Whisper model (small.en)",
      state: "pending",
      required: false,
      detail: "Not downloaded yet.",
      fix: "Press Download. The model stays on this computer.",
      command: null,
    },
  ];

  return {
    checkedAt: at.toISOString(),
    complete: ok,
    checks,
    agents: [
      ok && claudePath !== null
        ? {
            id: "claude",
            path: claudePath,
            via: "known-folder",
            version: "2.1.30",
            signedIn: true,
            problem: null,
          }
        : missing("claude"),
      missing("grok"),
      missing("codex"),
    ],
    chosen:
      ok && claudePath !== null ? { id: "claude", path: claudePath, version: "2.1.30" } : null,
    apiKey: { present: false },
    claude: {
      path: claudePath,
      via: ok ? "known-folder" : "none",
      version: ok ? "2.1.30" : null,
      signedIn: ok ? true : null,
    },
    tools: tools.map((t) => ({
      name: t,
      path: exe(t),
      present: ok || t !== "yt-dlp",
      version: ok || t !== "yt-dlp" ? versions[t] : null,
    })),
    ffmpeg: { subtitles: true, libx264: true },
    encoders: ["libx264", "libx264rgb", "h264_videotoolbox"],
    whisperModel: {
      name: "small.en",
      path: join(req.modelsDir, "ggml-small.en.bin"),
      present: false,
    },
  };
}
