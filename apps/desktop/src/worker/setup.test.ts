import { join } from "node:path";
import { SetupReport, type SetupRequest } from "@alcyo/ipc";
import { describe, expect, it } from "vitest";
import {
  hasSubtitlesFilter,
  parseH264Encoders,
  parseToolVersion,
  runSetupCheck,
  type SetupDeps,
} from "./setup";

const ENCODERS = `Encoders:
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D libx264rgb           libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 RGB (codec h264)
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)
 V....D libx265              libx265 H.265 / HEVC (codec hevc)
 A....D aac                  AAC (Advanced Audio Coding)`;
const FILTERS = ` .. ass               V->V       Render ASS subtitles onto input video using the libass library.
 .. subtitles         V->V       Render text subtitles onto input video using the libass library.`;

const req: SetupRequest = {
  binDir: "/app/bin",
  modelsDir: "/data/models",
  platform: "darwin",
  arch: "arm64",
};

interface World {
  files: string[];
  claudeWorks?: boolean;
  signedIn?: boolean;
  vad?: boolean;
  filters?: string;
  encoders?: string;
  broken?: string[];
}

function deps(world: World): SetupDeps & { calls: Array<{ file: string; args: string[] }> } {
  const files = new Set(world.files);
  const calls: Array<{ file: string; args: string[] }> = [];
  return {
    calls,
    platform: "darwin",
    env: { SHELL: "/bin/zsh", ANTHROPIC_API_KEY: "k" },
    homedir: "/Users/me",
    isFile: (p) => Promise.resolve(files.has(p)),
    listDir: (p) =>
      p === join("/app/bin", "models") && world.vad !== false
        ? Promise.resolve(["ggml-silero-v6.2.0.bin"])
        : Promise.reject(new Error("ENOENT")),
    run: (file, args) => {
      calls.push({ file, args: [...args] });
      const ok = (stdout: string) => Promise.resolve({ code: 0, stdout });
      const fail = () => Promise.resolve({ code: 1, stdout: "" });
      if (world.broken?.includes(file)) return fail();
      if (args[0] === "-ilc") return ok("");
      if (file.endsWith("claude")) {
        if (world.claudeWorks === false) return fail();
        if (args[0] === "-v") return ok("2.1.30 (Claude Code)");
        return world.signedIn === false ? fail() : ok("");
      }
      if (args.includes("-filters")) return ok(world.filters ?? FILTERS);
      if (args.includes("-encoders")) return ok(world.encoders ?? ENCODERS);
      if (file.endsWith("ffmpeg")) return ok("ffmpeg version 9.0.2-https://example Copyright");
      if (file.endsWith("ffprobe")) return ok("ffprobe version 9.0.2-https://example");
      if (file.endsWith("whisper-cli")) return ok("whisper.cpp version: 1.9.5-dev");
      if (file.endsWith("yt-dlp")) return ok("2026.10.26\n");
      return fail();
    },
  };
}

const allTools = ["ffmpeg", "ffprobe", "whisper-cli", "yt-dlp"].map((t) => join("/app/bin", t));
const now = () => new Date("2026-11-01T12:00:00.000Z");

describe("parsers", () => {
  it("reads tool versions", () => {
    expect(parseToolVersion("ffmpeg", "ffmpeg version 9.0.2-https://x Copyright")).toBe("9.0.2");
    expect(parseToolVersion("ffmpeg", "ffmpeg version n7.1 Copyright")).toBe("7.1");
    expect(parseToolVersion("whisper-cli", "whisper.cpp version: 1.9.5-dev")).toBe("1.9.5-dev");
    expect(parseToolVersion("yt-dlp", "2026.10.26\n")).toBe("2026.10.26");
    expect(parseToolVersion("yt-dlp", "garbage")).toBeNull();
  });

  it("lists H.264 encoders and finds the subtitles filter", () => {
    expect(parseH264Encoders(ENCODERS)).toEqual(["libx264", "libx264rgb", "h264_videotoolbox"]);
    expect(hasSubtitlesFilter(FILTERS)).toBe(true);
    expect(hasSubtitlesFilter(" .. ass   V->V  Render ASS")).toBe(false);
  });
});

describe("runSetupCheck", () => {
  it("is complete when claude, sign-in, tools, VAD and ffmpeg features pass", async () => {
    const d = deps({ files: ["/Users/me/.local/bin/claude", ...allTools] });
    const report = await runSetupCheck(req, d, now);
    expect(SetupReport.parse(report)).toEqual(report);
    expect(report.complete).toBe(true);
    expect(report.checks.filter((c) => c.state !== "pass").map((c) => c.id)).toEqual([
      "whisper-model",
    ]);
    expect(report.claude).toEqual({
      path: "/Users/me/.local/bin/claude",
      via: "known-folder",
      version: "2.1.30",
      signedIn: true,
    });
    expect(report.encoders).toContain("h264_videotoolbox");
    expect(report.whisperModel).toEqual({
      name: "small.en",
      path: join("/data/models", "ggml-small.en.bin"),
      present: false,
    });
    // The model download isn't built yet, and it doesn't block setup.
    const model = report.checks.find((c) => c.id === "whisper-model")!;
    expect(model).toMatchObject({ required: false, state: "pending" });
    expect(model.fix).toContain("spec 5");
  });

  it("says how to install Claude Code when it's missing, and leaves sign-in pending", async () => {
    const report = await runSetupCheck(req, deps({ files: allTools }), now);
    expect(report.complete).toBe(false);
    const claude = report.checks.find((c) => c.id === "claude")!;
    expect(claude.state).toBe("fail");
    expect(claude.fix).toContain("Install Claude Code");
    expect(report.checks.find((c) => c.id === "claude-auth")?.state).toBe("pending");
    expect(report.claude.signedIn).toBeNull();
  });

  it("says how to sign in when claude auth status fails", async () => {
    const report = await runSetupCheck(
      req,
      deps({ files: ["/opt/homebrew/bin/claude", ...allTools], signedIn: false }),
      now,
    );
    const auth = report.checks.find((c) => c.id === "claude-auth")!;
    expect(auth).toMatchObject({ state: "fail", command: "claude" });
    expect(auth.fix).toContain("sign in");
    expect(report.complete).toBe(false);
  });

  it("flags missing and broken tools with the fetch-binaries fix", async () => {
    const report = await runSetupCheck(
      req,
      deps({
        files: [
          "/Users/me/.local/bin/claude",
          join("/app/bin", "ffmpeg"),
          join("/app/bin", "yt-dlp"),
        ],
        broken: [join("/app/bin", "yt-dlp")],
        vad: false,
      }),
      now,
    );
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["ffmpeg"]?.state).toBe("pass");
    expect(byId["ffprobe"]).toMatchObject({ state: "fail", command: "pnpm fetch-binaries" });
    expect(byId["ffprobe"]?.detail).toContain("Missing");
    expect(byId["yt-dlp"]?.detail).toContain("didn't run");
    expect(byId["vad"]?.state).toBe("fail");
    for (const check of report.checks) {
      if (check.state === "fail") expect(check.fix).not.toBeNull();
    }
  });

  it("fails the feature check when ffmpeg has no libass or libx264", async () => {
    const report = await runSetupCheck(
      req,
      deps({
        files: ["/Users/me/.local/bin/claude", ...allTools],
        filters: "",
        encoders: " V....D h264_videotoolbox VideoToolbox (codec h264)",
      }),
      now,
    );
    const features = report.checks.find((c) => c.id === "ffmpeg-features")!;
    expect(features.state).toBe("fail");
    expect(features.detail).toBe("This ffmpeg has no libass subtitles or libx264.");
    expect(report.ffmpeg).toEqual({ subtitles: false, libx264: false });
  });

  it("uses .exe tools and base.en on Windows", async () => {
    const win: SetupRequest = { ...req, platform: "win32", arch: "x64" };
    const report = await runSetupCheck(win, deps({ files: [] }), now);
    expect(report.tools.map((t) => t.path)).toEqual(
      ["ffmpeg", "ffprobe", "whisper-cli", "yt-dlp"].map((t) => join("/app/bin", `${t}.exe`)),
    );
    expect(report.whisperModel.name).toBe("base.en");
  });

  it("runs every process with an args array and never a shell string", async () => {
    const d = deps({ files: ["/Users/me/.local/bin/claude", ...allTools] });
    await runSetupCheck(req, d, now);
    for (const call of d.calls) {
      expect(Array.isArray(call.args)).toBe(true);
      expect(call.file).not.toMatch(/\s-/);
    }
  });
});
