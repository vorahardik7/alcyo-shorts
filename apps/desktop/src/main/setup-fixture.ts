// Fixed setup reports for headless test runs (ALCYO_TEST_SETUP=pass|fail), so
// e2e tests don't depend on what's installed on the machine. Never used
// outside headless mode.
import { join } from "node:path";
import type { SetupCheck, SetupReport, SetupRequest } from "@alcyo/ipc";

export type FixtureKind = "pass" | "fail";

export function fixtureKind(env: NodeJS.ProcessEnv, headless: boolean): FixtureKind | null {
  if (!headless) return null;
  const value = env["ALCYO_TEST_SETUP"];
  return value === "pass" || value === "fail" ? value : null;
}

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

  const checks: SetupCheck[] = [
    ok
      ? pass("claude", "Claude Code", `Version 2.1.30, in a standard folder: ${claudePath}`)
      : {
          id: "claude",
          label: "Claude Code",
          state: "fail",
          required: true,
          detail: "Not found in the usual folders or your login shell.",
          fix: "Install Claude Code from claude.com/product/claude-code, then press Check again.",
          command: null,
        },
    ok
      ? pass(
          "claude-auth",
          "Signed in to Claude",
          "Signed in. Alcyo uses your Claude plan through Claude Code.",
        )
      : {
          id: "claude-auth",
          label: "Signed in to Claude",
          state: "pending",
          required: true,
          detail: "Checked once Claude Code is found.",
          fix: null,
          command: null,
        },
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
      fix: "Downloads on first run. The download comes in spec 5.",
      command: null,
    },
  ];

  return {
    checkedAt: at.toISOString(),
    complete: ok,
    checks,
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
