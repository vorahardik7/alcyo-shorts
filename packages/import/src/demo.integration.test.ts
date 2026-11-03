// The stand-in for the demo clips (plan section 33): a 2-minute "stream" of
// spoken lines placed at known times over game-like noise, and two viewer
// clips cut from it at known offsets and re-encoded. Real ffmpeg, whisper and
// matching, so the 100 ms rule is checked on speech, not only on noise.
// Needs macOS `say`, the bundled tools and a whisper model; skipped otherwise.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AnalysisRequest } from "@alcyo/ipc";
import { analyze, runTool } from "@alcyo/media";
import { describe, expect, it } from "vitest";
import { matchClipFiles } from "./match-files.ts";

const target = process.platform === "win32" ? "win-x64" : `mac-${process.arch}`;
const binDir =
  process.env["ALCYO_BIN_DIR"] ??
  resolve(import.meta.dirname, "../../../apps/desktop/resources/bin", target);
const tool = (name: string) => join(binDir, process.platform === "win32" ? `${name}.exe` : name);
const modelsDir =
  process.env["ALCYO_MODELS_DIR"] ??
  join(homedir(), "Library", "Application Support", "Alcyo Shorts", "models");
const model = (["small.en", "base.en"] as const)
  .map((name) => ({ name, path: join(modelsDir, `ggml-${name}.bin`) }))
  .find((m) => existsSync(m.path));
const vadDir = join(binDir, "models");
const vad = existsSync(vadDir)
  ? readdirSync(vadDir).find((f) => f.startsWith("ggml-silero"))
  : undefined;
const ready =
  process.platform === "darwin" &&
  existsSync("/usr/bin/say") &&
  existsSync(tool("ffmpeg")) &&
  existsSync(tool("whisper-cli")) &&
  model !== undefined &&
  vad !== undefined;

const VOD_MS = 120_000;
/** [start ms, words]. Gaps between lines, like a streamer talking over a game. */
const LINES: Array<[number, string]> = [
  [2_000, "Alright chat, we are live. Today we finally try the hard mode run."],
  [11_000, "Okay, loading in. The first area is all spiders, I hate spiders."],
  [22_500, "Wait, wait, there is something behind the door. Do you hear that?"],
  [33_000, "No way. That is the golden key. Nobody has found that before."],
  [44_000, "Chat, clip that. Somebody clip that right now, that was insane."],
  [56_000, "Let me check the map. I think the boss room is to the north."],
  [67_500, "Thanks for the five gifted subs, that is really kind of you."],
  [78_000, "Here we go, boss fight. Phase one, just dodge the slam attacks."],
  [89_000, "He is at half health. Oh no, he is doing the spin move again."],
  [100_500, "We did it. We beat the boss on hard mode. I can't believe it."],
  [111_000, "Okay, getting some water. Back in two minutes, do not leave."],
];
const CLIPS = [
  { name: "clip-key.mp4", atMs: 31_250, lengthMs: 20_000 },
  { name: "clip-boss.mp4", atMs: 77_800, lengthMs: 26_000 },
];

function ff(args: string[]) {
  execFileSync(tool("ffmpeg"), ["-hide_banner", "-v", "error", "-y", ...args]);
}

function makeStream(dir: string): string {
  const inputs: string[] = [];
  const delays: string[] = [];
  LINES.forEach(([at, text], i) => {
    const file = join(dir, `line-${i}.aiff`);
    execFileSync("/usr/bin/say", ["-v", "Samantha", "-r", "185", "-o", file, text]);
    inputs.push("-i", file);
    delays.push(`[${i + 1}:a]adelay=${at}|${at},aresample=48000[s${i}]`);
  });
  const mix = LINES.map((_, i) => `[s${i}]`).join("");
  const out = join(dir, "stream.mp4");
  ff([
    "-f", "lavfi", "-i", `anoisesrc=d=${VOD_MS / 1000}:c=pink:seed=3:a=0.04`,
    ...inputs,
    "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30:d=${VOD_MS / 1000}`,
    "-filter_complex",
    `${delays.join(";")};[0:a]aresample=48000[bg];[bg]${mix}amix=inputs=${LINES.length + 1}:duration=first:normalize=0[a]`,
    "-map", `${LINES.length + 1}:v`, "-map", "[a]",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-t", String(VOD_MS / 1000), out,
  ]); // prettier-ignore
  for (const clip of CLIPS) {
    // A viewer clip: cut, quieter, lower bitrate, its own encode.
    ff([
      "-ss", String(clip.atMs / 1000), "-i", out, "-t", String(clip.lengthMs / 1000),
      "-af", "volume=0.8", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-b:a", "96k",
      join(dir, clip.name),
    ]); // prettier-ignore
  }
  return out;
}

function request(id: string, path: string, root: string, mode: "full" | "quick"): AnalysisRequest {
  return {
    sourceId: id,
    sourcePath: path,
    analysisDir: join(root, id, "analysis"),
    cacheDir: join(root, "cache", id),
    tools: { ffmpeg: tool("ffmpeg"), ffprobe: tool("ffprobe"), whisper: tool("whisper-cli") },
    toolVersions: { ffmpeg: "9.0.2", whisper: "1.9.5" },
    model: model!,
    vadModel: join(vadDir, vad!),
    mode,
    encoder: null,
    threads: 4,
  };
}

describe.skipIf(!ready)("demo stand-in: spoken stream and two viewer clips", () => {
  it("places both clips within 100 ms from their words, then the sound", async () => {
    const root = await mkdtemp(join(tmpdir(), "alcyo-demo 名前 "));
    const stream = makeStream(root);
    const vodReq = { ...request("src_vod", stream, root, "full"), mode: "quick" as const };
    const vod = await analyze(vodReq, { run: runTool });
    expect(vod.steps.transcript).toBe("done");

    for (const clip of CLIPS) {
      const id = clip.name.replace(".mp4", "");
      const req = request(id, join(root, clip.name), root, "quick");
      const result = await analyze(req, { run: runTool });
      expect(result.steps.transcript).toBe("done");
      const { match } = await matchClipFiles({
        clipAudio: join(req.cacheDir, "audio.wav"),
        clipTranscript: join(req.analysisDir, "transcript.json"),
        vodAudio: join(vodReq.cacheDir, "audio.wav"),
        vodTranscript: join(vodReq.analysisDir, "transcript.json"),
        clipDurationMs: result.probe.durationMs,
        vodDurationMs: vod.probe.durationMs,
      });
      console.log(
        `[demo] ${clip.name}: true ${clip.atMs} ms, found ${match?.srcIn} ms (${match?.method}, ${match?.confidence})`,
      );
      expect(match).not.toBeNull();
      expect(match!.method).toBe("transcript");
      expect(match!.confidence).toBeGreaterThanOrEqual(0.6);
      expect(Math.abs(match!.srcIn - clip.atMs)).toBeLessThan(100);
    }
  }, 600_000);
});
