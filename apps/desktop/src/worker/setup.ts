// Setup checks (plan section 3 step 1; spec 5's checks that can run today).
// Runs in the worker because it spawns processes. Every spawn is execFile with
// an args array; the only shell use is claude-locate's login-shell lookup.
import { join } from "node:path";
import type { SetupCheck, SetupReport, SetupRequest, WhisperModelName } from "@alcyo/ipc";
import { claudeSignedIn, type LocateDeps, locateClaude } from "@alcyo/planner";

export interface SetupDeps extends LocateDeps {
  listDir: (path: string) => Promise<string[]>;
}

const TOOL_TIMEOUT_MS = 15_000;
const FETCH = "pnpm fetch-binaries";
const REINSTALL = "Reinstall Alcyo Shorts. Building from source? Run pnpm fetch-binaries.";

const TOOLS = [
  { id: "ffmpeg", label: "ffmpeg", args: ["-hide_banner", "-version"] },
  { id: "ffprobe", label: "ffprobe", args: ["-hide_banner", "-version"] },
  { id: "whisper-cli", label: "whisper-cli", args: ["--version"] },
  { id: "yt-dlp", label: "yt-dlp", args: ["--version"] },
] as const;
type ToolId = (typeof TOOLS)[number]["id"];

export function whisperModelFor(platform: NodeJS.Platform): WhisperModelName {
  return platform === "win32" ? "base.en" : "small.en";
}

/** "ffmpeg version 9.0.2-https://…", "whisper.cpp version: 1.9.5-dev", "2026.10.26". */
export function parseToolVersion(id: ToolId, stdout: string): string | null {
  const text = stdout.trim();
  if (id === "yt-dlp") return /^(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)/.exec(text)?.[1] ?? null;
  if (id === "whisper-cli") return /version:?\s*v?(\d+\.\d+\.\d+[\w.-]*)/i.exec(text)?.[1] ?? null;
  return /version\s+n?(\d+(?:\.\d+)+)/i.exec(text)?.[1] ?? null;
}

/** H.264 encoder names from `ffmpeg -encoders`. */
export function parseH264Encoders(stdout: string): string[] {
  const names: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*V[.\w]{5}\s+(\S+)\s.*\(codec h264\)/.exec(line);
    if (match?.[1] !== undefined && names.length < 40) names.push(match[1]);
  }
  return names;
}

export function hasSubtitlesFilter(stdout: string): boolean {
  return /^\s*\S+\s+subtitles\s/m.test(stdout);
}

interface ToolResult {
  id: ToolId;
  path: string;
  present: boolean;
  runs: boolean;
  version: string | null;
}

async function checkTool(
  tool: (typeof TOOLS)[number],
  req: SetupRequest,
  deps: SetupDeps,
): Promise<ToolResult> {
  const exe = req.platform === "win32" ? `${tool.id}.exe` : tool.id;
  const path = join(req.binDir, exe);
  if (!(await deps.isFile(path))) {
    return { id: tool.id, path, present: false, runs: false, version: null };
  }
  const run = await deps.run(path, tool.args, { timeoutMs: TOOL_TIMEOUT_MS, env: deps.env });
  let runs = run.code === 0;
  let version = runs ? parseToolVersion(tool.id, run.stdout) : null;
  if (!runs && tool.id === "whisper-cli") {
    // Older whisper-cli builds have no --version; -h exiting 0 still shows it runs.
    const help = await deps.run(path, ["-h"], { timeoutMs: TOOL_TIMEOUT_MS, env: deps.env });
    runs = help.code === 0;
    version = null;
  }
  return { id: tool.id, path, present: true, runs, version };
}

const VIA_LABEL = {
  saved: "at the saved path",
  "known-folder": "in a standard folder",
  "login-shell": "through your login shell",
  where: "on PATH",
  none: "",
} as const;

export async function runSetupCheck(
  req: SetupRequest,
  deps: SetupDeps,
  now: () => Date = () => new Date(),
): Promise<SetupReport> {
  const ffmpegPath = join(req.binDir, req.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const modelName = whisperModelFor(req.platform);
  const modelPath = join(req.modelsDir, `ggml-${modelName}.bin`);
  const vadDir = join(req.binDir, "models");

  const claudeTask = (async () => {
    const location = await locateClaude(deps);
    const signedIn = location.path === null ? null : await claudeSignedIn(location.path, deps);
    return { location, signedIn };
  })();
  const toolsTask = Promise.all(TOOLS.map((t) => checkTool(t, req, deps)));
  const vadTask = deps
    .listDir(vadDir)
    .then((names) => names.find((n) => /^ggml-silero-.*\.bin$/.test(n)) ?? null)
    .catch(() => null);
  const modelTask = deps.isFile(modelPath);

  const [{ location, signedIn }, tools, vadFile, modelPresent] = await Promise.all([
    claudeTask,
    toolsTask,
    vadTask,
    modelTask,
  ]);

  const ffmpeg = tools.find((t) => t.id === "ffmpeg");
  let subtitles = false;
  let libx264 = false;
  let encoders: string[] = [];
  if (ffmpeg?.runs === true) {
    const opts = { timeoutMs: TOOL_TIMEOUT_MS, env: deps.env };
    const [filters, enc] = await Promise.all([
      deps.run(ffmpegPath, ["-hide_banner", "-filters"], opts),
      deps.run(ffmpegPath, ["-hide_banner", "-encoders"], opts),
    ]);
    subtitles = filters.code === 0 && hasSubtitlesFilter(filters.stdout);
    encoders = enc.code === 0 ? parseH264Encoders(enc.stdout) : [];
    libx264 = encoders.includes("libx264");
  }

  const checks: SetupCheck[] = [];

  if (location.path !== null) {
    checks.push({
      id: "claude",
      label: "Claude Code",
      state: "pass",
      required: true,
      detail: `${location.version === null ? "Found" : `Version ${location.version}`}, ${VIA_LABEL[location.via]}: ${location.path}`,
      fix: null,
      command: null,
    });
  } else {
    const shim = location.problem === "cmd-shim";
    checks.push({
      id: "claude",
      label: "Claude Code",
      state: "fail",
      required: true,
      detail: shim
        ? "Only the npm version (claude.cmd) is installed."
        : "Not found in the usual folders or your login shell.",
      fix: shim
        ? "Install the native Claude Code (claude.exe), then press Check again."
        : "Install Claude Code from claude.com/product/claude-code, then press Check again.",
      command: null,
    });
  }

  checks.push(
    signedIn === null
      ? {
          id: "claude-auth",
          label: "Signed in to Claude",
          state: "pending",
          required: true,
          detail: "Checked once Claude Code is found.",
          fix: null,
          command: null,
        }
      : signedIn
        ? {
            id: "claude-auth",
            label: "Signed in to Claude",
            state: "pass",
            required: true,
            detail: "Signed in. Alcyo uses your Claude plan through Claude Code.",
            fix: null,
            command: null,
          }
        : {
            id: "claude-auth",
            label: "Signed in to Claude",
            state: "fail",
            required: true,
            detail: "Claude Code isn't signed in.",
            fix: "Run claude in a terminal and sign in, then press Check again.",
            command: "claude",
          },
  );

  for (const tool of tools) {
    const label = TOOLS.find((t) => t.id === tool.id)!.label;
    checks.push(
      tool.runs
        ? {
            id: tool.id,
            label,
            state: "pass",
            required: true,
            detail: `${tool.version === null ? "Bundled" : `Version ${tool.version}`}: ${tool.path}`,
            fix: null,
            command: null,
          }
        : {
            id: tool.id,
            label,
            state: "fail",
            required: true,
            detail: tool.present
              ? `Found but it didn't run: ${tool.path}`
              : `Missing: ${tool.path}`,
            fix: REINSTALL,
            command: FETCH,
          },
    );
  }

  checks.push(
    vadFile !== null
      ? {
          id: "vad",
          label: "Silero VAD model",
          state: "pass",
          required: true,
          detail: `Bundled: ${join(vadDir, vadFile)}`,
          fix: null,
          command: null,
        }
      : {
          id: "vad",
          label: "Silero VAD model",
          state: "fail",
          required: true,
          detail: `Missing from ${vadDir}`,
          fix: REINSTALL,
          command: FETCH,
        },
  );

  const featureNames = [subtitles ? null : "libass subtitles", libx264 ? null : "libx264"].filter(
    (n) => n !== null,
  );
  checks.push(
    ffmpeg?.runs !== true
      ? {
          id: "ffmpeg-features",
          label: "Captions and H.264 in ffmpeg",
          state: "pending",
          required: true,
          detail: "Checked once ffmpeg runs.",
          fix: null,
          command: null,
        }
      : featureNames.length === 0
        ? {
            id: "ffmpeg-features",
            label: "Captions and H.264 in ffmpeg",
            state: "pass",
            required: true,
            detail: "Has the libass subtitles filter and libx264.",
            fix: null,
            command: null,
          }
        : {
            id: "ffmpeg-features",
            label: "Captions and H.264 in ffmpeg",
            state: "fail",
            required: true,
            detail: `This ffmpeg has no ${featureNames.join(" or ")}.`,
            fix: "Run pnpm fetch-binaries to get the pinned ffmpeg build.",
            command: FETCH,
          },
  );

  checks.push({
    id: "whisper-model",
    label: `Whisper model (${modelName})`,
    state: modelPresent ? "pass" : "pending",
    required: false,
    detail: modelPresent ? `Downloaded: ${modelPath}` : "Not downloaded yet.",
    fix: modelPresent ? null : "Downloads on first run. The download comes in spec 5.",
    command: null,
  });

  return {
    checkedAt: now().toISOString(),
    complete: checks.every((c) => !c.required || c.state === "pass"),
    checks,
    claude: {
      path: location.path,
      via: location.via,
      version: location.version,
      signedIn,
    },
    tools: tools.map((t) => ({
      name: t.id,
      path: t.path,
      present: t.present,
      version: t.version,
    })),
    ffmpeg: { subtitles, libx264 },
    encoders,
    whisperModel: { name: modelName, path: modelPath, present: modelPresent },
  };
}
