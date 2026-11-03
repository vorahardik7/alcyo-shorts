import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTool } from "@alcyo/media";
import { beforeAll, describe, expect, it } from "vitest";
import { FINE_HOP, bestLag, wavDurationMs, wavEnvelope } from "./envelope.ts";
import { PLACED_MIN, normalizeWord, transcriptCandidate } from "./match.ts";
import { matchClipFiles } from "./match-files.ts";

const target = process.platform === "win32" ? "win-x64" : `mac-${process.arch}`;
const binDir =
  process.env["ALCYO_BIN_DIR"] ??
  resolve(import.meta.dirname, "../../../apps/desktop/resources/bin", target);
const ffmpeg = join(binDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const haveFfmpeg = existsSync(ffmpeg);

describe("transcript candidate", () => {
  const vod =
    "so then I went back to the base and we found the crate with the golden key inside it and everyone screamed"
      .split(" ")
      .map((text, i) => ({ text, startMs: 600_000 + i * 400 }));

  it("finds the offset from shared word runs, ignoring case and punctuation", () => {
    const clip = vod.slice(8, 18).map((w, i) => ({
      text: i === 2 ? `${w.text.toUpperCase()},` : w.text,
      startMs: 1_000 + i * 400,
    }));
    const got = transcriptCandidate(clip, vod)!;
    expect(got.offsetMs).toBe(600_000 + 8 * 400 - 1_000);
    expect(got.score).toBeGreaterThan(0.9);
    expect(normalizeWord("Key!")).toBe("key");
  });

  it("returns null with too few clip words or nothing shared", () => {
    expect(transcriptCandidate(vod.slice(0, 3), vod)).toBeNull();
    const other = "a completely different set of words here".split(" ").map((text, i) => ({
      text,
      startMs: i * 300,
    }));
    expect(transcriptCandidate(other, vod)).toBeNull();
  });
});

describe("bestLag", () => {
  it("finds a shifted copy with sub-hop accuracy and ignores gain", () => {
    const vod = new Float32Array(4000);
    let seed = 42;
    for (let i = 0; i < vod.length; i++) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      vod[i] = seed / 2 ** 31;
    }
    const clip = vod.slice(1234, 1834).map((v) => v * 3 + 1);
    const got = bestLag(clip, vod)!;
    expect(Math.abs(got.lag - 1234)).toBeLessThan(0.5);
    expect(got.r).toBeGreaterThan(0.99);
  });

  it("refuses a flat clip", () => {
    expect(bestLag(new Float32Array(100).fill(1), new Float32Array(1000))).toBeNull();
  });
});

describe.skipIf(!haveFfmpeg)("matching real audio (bundled ffmpeg)", () => {
  const offsetMs = 73_250;
  const clipMs = 20_000;
  const vodMs = 150_000;
  let dir: string;
  let vodWav: string;
  let clipWav: string;

  const ff = async (args: string[]) => {
    const out = await runTool(ffmpeg, ["-hide_banner", "-v", "error", "-y", ...args], {});
    if (out.code !== 0) throw new Error(out.stderrTail.join("\n"));
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "alcyo-match 名前 "));
    const vodMp4 = join(dir, "vod.mp4");
    // Pink noise whose loudness moves, like speech and game sound do.
    await ff([
      "-f",
      "lavfi",
      "-i",
      `anoisesrc=d=${vodMs / 1000}:c=pink:seed=7:a=0.5`,
      "-af",
      "volume='0.15+0.85*abs(sin(t*1.7))*abs(sin(t*0.37+1))':eval=frame",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      vodMp4,
    ]);
    // A viewer clip: cut, made quieter, and re-encoded at a lower bitrate.
    const clipMp4 = join(dir, "clip.mp4");
    await ff([
      "-ss",
      String(offsetMs / 1000),
      "-i",
      vodMp4,
      "-t",
      String(clipMs / 1000),
      "-af",
      "volume=0.6",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      clipMp4,
    ]);
    vodWav = join(dir, "vod.wav");
    clipWav = join(dir, "clip.wav");
    for (const [input, out] of [
      [vodMp4, vodWav],
      [clipMp4, clipWav],
    ] as const) {
      await ff(["-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out]);
    }
  }, 60_000);

  it("reads the WAV length and envelope", async () => {
    expect(Math.abs((await wavDurationMs(vodWav)) - vodMs)).toBeLessThan(100);
    const env = await wavEnvelope(clipWav, FINE_HOP);
    expect(Math.abs(env.length - clipMs / 5)).toBeLessThan(40);
  });

  it("places a clip with no speech within 100 ms, searching the whole VOD", async () => {
    const { match } = await matchClipFiles({
      clipAudio: clipWav,
      clipTranscript: null,
      vodAudio: vodWav,
      vodTranscript: null,
      clipDurationMs: clipMs,
      vodDurationMs: vodMs,
    });
    expect(match).not.toBeNull();
    expect(match!.method).toBe("audio");
    expect(Math.abs(match!.srcIn - offsetMs)).toBeLessThan(100);
    expect(match!.srcOut - match!.srcIn).toBe(clipMs);
    expect(match!.confidence).toBeGreaterThanOrEqual(PLACED_MIN);
  }, 30_000);

  it("refines a transcript candidate that is 2 s off to within 100 ms", async () => {
    const words = "we found the crate with the golden key inside it".split(" ");
    const vodT = join(dir, "vod-transcript.json");
    const clipT = join(dir, "clip-transcript.json");
    const transcript = (sourceId: string, start: number) => ({
      schemaVersion: 1,
      sourceId,
      language: "en",
      model: "small.en",
      words: words.map((text, i) => ({
        id: `w${String(i + 1).padStart(5, "0")}`,
        text,
        startMs: start + i * 500,
        endMs: start + i * 500 + 400,
        p: 0.9,
      })),
      lines: [],
    });
    // Whisper's word times drift: the VOD's are 2 s late here.
    await writeFile(vodT, JSON.stringify(transcript("src_v", offsetMs + 3000 + 2000)));
    await writeFile(clipT, JSON.stringify(transcript("clip_c", 3000)));
    const { match } = await matchClipFiles({
      clipAudio: clipWav,
      clipTranscript: clipT,
      vodAudio: vodWav,
      vodTranscript: vodT,
      clipDurationMs: clipMs,
      vodDurationMs: vodMs,
    });
    expect(match!.method).toBe("transcript");
    expect(Math.abs(match!.srcIn - offsetMs)).toBeLessThan(100);
  }, 30_000);

  it("gives a clip from somewhere else a low confidence", async () => {
    const other = join(dir, "other.wav");
    await ff([
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=d=20:c=brown:seed=99:a=0.5",
      "-af",
      "volume='0.2+0.8*abs(sin(t*2.9))':eval=frame",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      other,
    ]);
    const { match } = await matchClipFiles({
      clipAudio: other,
      clipTranscript: null,
      vodAudio: vodWav,
      vodTranscript: null,
      clipDurationMs: clipMs,
      vodDurationMs: vodMs,
    });
    expect(match === null || match.confidence < PLACED_MIN).toBe(true);
  }, 30_000);
});
