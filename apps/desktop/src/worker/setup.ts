// Setup checks (plan section 3 step 1, spec 5). Runs in the worker because it
// spawns processes. Every spawn is execFile with an args array; the only shell
// use is each agent's `command -v` lookup.
import { join } from "node:path";
import type { CheckId, SetupCheck, SetupReport, SetupRequest, WhisperModelName } from "@alcyo/ipc";
import { type AgentHit, type LocateDeps, chooseAgent, locateAgents } from "@alcyo/planner";

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

const AGENT_LABEL = { claude: "Claude Code", grok: "Grok", codex: "Codex" } as const;
const AGENT_CHECK: Record<AgentHit["id"], CheckId> = {
  claude: "claude",
  grok: "agent-grok",
  codex: "agent-codex",
};
const INSTALL = {
  claude: "Install Claude Code from claude.com/product/claude-code, then press Check again.",
  grok: "Install Grok (the grok command), then press Check again.",
  codex: "Install Codex (the codex command), then press Check again.",
} as const;
const SIGN_IN = {
  claude: {
    fix: "Run claude in a terminal and sign in, then press Check again.",
    command: "claude",
  },
  grok: {
    fix: "Run grok login in a terminal and sign in, then press Check again.",
    command: "grok login",
  },
  codex: {
    fix: "Run codex login in a terminal and sign in, then press Check again.",
    command: "codex login",
  },
} as const;

function agentRow(hit: AgentHit, claudeMissingMatters: boolean): SetupCheck {
  const label = AGENT_LABEL[hit.id];
  const id = AGENT_CHECK[hit.id];
  if (hit.path !== null && hit.signedIn === true) {
    const version = hit.version === null ? "Found" : `Version ${hit.version}`;
    return {
      id,
      label,
      state: "pass",
      required: false,
      detail: `${version}, signed in.`,
      fix: null,
      command: null,
    };
  }
  if (hit.path !== null) {
    const sign = SIGN_IN[hit.id];
    return {
      id,
      label,
      state: "fail",
      required: false,
      detail:
        hit.version === null ? "Found, not signed in." : `Version ${hit.version}, not signed in.`,
      fix: sign.fix,
      command: sign.command,
    };
  }
  const shim = hit.problem === "cmd-shim";
  const failed = hit.id === "claude" && claudeMissingMatters;
  return {
    id,
    label,
    state: failed ? "fail" : "pending",
    required: false,
    detail: shim ? "Only a command shim is installed." : "Not installed.",
    fix: shim ? "Install the native program, then press Check again." : INSTALL[hit.id],
    command: null,
  };
}

export async function runSetupCheck(
  req: SetupRequest,
  deps: SetupDeps,
  now: () => Date = () => new Date(),
): Promise<SetupReport> {
  const ffmpegPath = join(req.binDir, req.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const modelName = whisperModelFor(req.platform);
  const modelPath = join(req.modelsDir, `ggml-${modelName}.bin`);
  const vadDir = join(req.binDir, "models");

  const saved = req.saved;
  const agentTask = locateAgents(deps, {
    claudePath: saved?.claudePath ?? null,
    grokPath: saved?.grokPath ?? null,
    codexPath: saved?.codexPath ?? null,
  });
  const toolsTask = Promise.all(TOOLS.map((t) => checkTool(t, req, deps)));
  const vadTask = deps
    .listDir(vadDir)
    .then((names) => names.find((n) => /^ggml-silero-.*\.bin$/.test(n)) ?? null)
    .catch(() => null);
  const modelTask = deps.isFile(modelPath);

  const [hits, tools, vadFile, modelPresent] = await Promise.all([
    agentTask,
    toolsTask,
    vadTask,
    modelTask,
  ]);
  const chosen = chooseAgent(hits, saved?.provider ?? null);
  const claudeHit = hits.find((hit) => hit.id === "claude");

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
  const ready = chosen !== null;
  checks.push(
    ready
      ? {
          id: "agent",
          label: "Coding agent",
          state: "pass",
          required: true,
          detail: `${AGENT_LABEL[chosen.id]} is signed in and will answer.`,
          fix: null,
          command: null,
        }
      : {
          id: "agent",
          label: "Coding agent",
          state: "fail",
          required: true,
          detail: "None of Claude Code, Grok or Codex is signed in.",
          fix: "Install one of them and sign in, or save an API key in Settings.",
          command: null,
        },
  );
  for (const hit of hits) checks.push(agentRow(hit, !ready));
  const claude = claudeHit ?? {
    id: "claude" as const,
    path: null,
    via: "none" as const,
    version: null,
    signedIn: null,
    problem: "missing" as const,
  };

  for (const tool of tools) {
    const label = TOOLS.find((t) => t.id === tool.id)!.label;
    checks.push(
      tool.runs
        ? {
            id: tool.id,
            label,
            state: "pass",
            required: true,
            detail:
              tool.version === null
                ? "Bundled with the app."
                : `Version ${tool.version}, bundled with the app.`,
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
          detail: "Bundled with the app.",
          fix: null,
          command: null,
        }
      : {
          id: "vad",
          label: "Silero VAD model",
          state: "fail",
          required: true,
          detail: "Missing from the app's tools.",
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
    detail: modelPresent ? "Downloaded to this computer." : "Not downloaded yet.",
    fix: modelPresent ? null : "Press Download. The model stays on this computer.",
    command: null,
  });

  return {
    checkedAt: now().toISOString(),
    complete: checks.every((c) => !c.required || c.state === "pass"),
    checks,
    agents: hits,
    chosen: chosen === null ? null : { id: chosen.id, path: chosen.path, version: chosen.version },
    apiKey: { present: false },
    claude: {
      path: claude.path,
      via: claude.via,
      version: claude.version,
      signedIn: claude.signedIn,
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
