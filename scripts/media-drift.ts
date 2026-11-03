// pnpm media:drift [--clip <video> --marks <marks.json>] [--model <ggml-*.bin>]
//
// Measures whisper's word-start drift against known word times (plan section
// 14, spec 3). With no --clip, it builds a synthetic clip with macOS `say`:
// each word spoken on its own and placed with a 60–260 ms gap, so every word's
// true start is known. With --clip, marks.json is [{ "word": "boss",
// "startMs": 12340 }, …] hand-marked on that clip.
//
// Prints the median and worst drift for DTW starts and for token-offset
// starts. Writes nothing outside a temp folder.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { audioArgs } from "../packages/media/src/ffmpeg-args.ts";
import {
  WhisperJson,
  parseVadMap,
  remapTokens,
  tokensToWords,
  whisperArgs,
} from "../packages/media/src/whisper.ts";

const PARAGRAPH =
  "alright chat we are live today we finally try the boss again no way did you see that " +
  "that is the third time this run I am not even mad honestly that was clean okay okay " +
  "let me grab the sword first then we go left through the cave and hope nothing spawns " +
  "behind us chat is saying turn around and there it is again of course it is";

const { values } = parseArgs({
  options: {
    clip: { type: "string" },
    marks: { type: "string" },
    model: { type: "string" },
    bin: { type: "string" },
    "no-vad": { type: "boolean" },
  },
});

const root = resolve(import.meta.dirname, "..");
const win = process.platform === "win32";
const target = `${win ? "win" : "mac"}-${process.arch}`;
const bin =
  values.bin ??
  process.env["ALCYO_BIN_DIR"] ??
  join(root, "apps", "desktop", "resources", "bin", target);
const exe = (n: string) => join(bin, win ? `${n}.exe` : n);
const vadDir = join(bin, "models");
const vad = join(vadDir, readdirSync(vadDir).find((f) => f.startsWith("ggml-silero")) ?? "missing");
const modelsDir = win
  ? join(process.env["APPDATA"] ?? "", "Alcyo Shorts", "models")
  : join(homedir(), "Library", "Application Support", "Alcyo Shorts", "models");
const model =
  values.model ??
  ["small.en", "base.en"].map((n) => join(modelsDir, `ggml-${n}.bin`)).find((p) => existsSync(p));
if (model === undefined || !existsSync(model)) {
  console.error("No whisper model found. Pass --model <path to ggml-small.en.bin>.");
  process.exit(1);
}
const modelName = /ggml-(.+)\.bin$/.exec(model)?.[1] ?? "small.en";

const RATE = 16_000;
const dir = await mkdtemp(join(tmpdir(), "alcyo-drift-"));

function pcmOf(wavPath: string): Int16Array {
  const buf = readFileSync(wavPath);
  const at = buf.indexOf("data") + 8;
  return new Int16Array(buf.buffer.slice(buf.byteOffset + at, buf.byteOffset + buf.length));
}

function wavOf(samples: Int16Array): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + samples.length * 2, 4);
  h.write("WAVEfmt ", 8, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(samples.length * 2, 40);
  return Buffer.concat([h, Buffer.from(samples.buffer)]);
}

function toWav(input: string, out: string) {
  execFileSync(exe("ffmpeg"), audioArgs(input, out), { stdio: "ignore" });
}

/** First and last sample above -40 dBFS. */
function trim(samples: Int16Array): Int16Array {
  const th = 328;
  let a = 0;
  let b = samples.length - 1;
  while (a < b && Math.abs(samples[a]!) < th) a++;
  while (b > a && Math.abs(samples[b]!) < th) b--;
  return samples.slice(a, b + 1);
}

interface Mark {
  word: string;
  startMs: number;
}

let wav: string;
let marks: Mark[];
if (values.clip !== undefined) {
  if (values.marks === undefined) throw new Error("--clip needs --marks.");
  wav = join(dir, "clip.wav");
  toWav(values.clip, wav);
  marks = JSON.parse(readFileSync(values.marks, "utf8")) as Mark[];
} else {
  if (process.platform !== "darwin")
    throw new Error("The synthetic clip needs macOS `say`. Pass --clip.");
  const words = PARAGRAPH.split(" ");
  const parts: Int16Array[] = [];
  marks = [];
  let cursor = Math.round(0.5 * RATE);
  parts.push(new Int16Array(cursor));
  // A fixed sequence of gaps, so runs compare.
  const gaps = [60, 120, 90, 200, 70, 150, 260, 80, 110, 180];
  words.forEach((word, i) => {
    const aiff = join(dir, `w${i}.aiff`);
    const w = join(dir, `w${i}.wav`);
    execFileSync("/usr/bin/say", ["-v", "Samantha", "-r", "190", "-o", aiff, word]);
    toWav(aiff, w);
    const s = trim(pcmOf(w));
    marks.push({ word, startMs: Math.round((cursor / RATE) * 1000) });
    parts.push(s);
    const gap = Math.round((gaps[i % gaps.length]! / 1000) * RATE);
    parts.push(new Int16Array(gap));
    cursor += s.length + gap;
  });
  parts.push(new Int16Array(RATE));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Int16Array(total);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  wav = join(dir, "synthetic.wav");
  writeFileSync(wav, wavOf(all));
}

const outBase = join(dir, "whisper");
const whisperRun = spawnSync(
  exe("whisper-cli"),
  whisperArgs({
    model,
    modelName,
    vadModel: vad,
    wav,
    outBase,
    threads: 8,
    vad: values["no-vad"] !== true,
  }),
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (whisperRun.status !== 0)
  throw new Error(`whisper-cli failed: ${whisperRun.stderr.slice(-500)}`);
// Same as analysis: token times back on the file's clock when VAD cut silences.
const json = remapTokens(
  WhisperJson.parse(JSON.parse(readFileSync(`${outBase}.json`, "utf8"))),
  parseVadMap(whisperRun.stderr.split(/\r?\n/)),
);
const tokens = json.transcription.flatMap((s) => s.tokens);

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9']/g, "");

function drift(timing: "dtw" | "offsets") {
  const got = tokensToWords(tokens, 0, timing);
  // Walk both lists, matching words by text, allowing whisper to merge or
  // split a few ("all right" for "alright").
  const diffs: number[] = [];
  let j = 0;
  for (const mark of marks) {
    for (let k = j; k < Math.min(got.length, j + 4); k++) {
      if (norm(got[k]!.text) === norm(mark.word)) {
        diffs.push(got[k]!.startMs - mark.startMs);
        j = k + 1;
        break;
      }
    }
  }
  const abs = diffs.map(Math.abs).sort((a, b) => a - b);
  const mean = diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length);
  return {
    timing,
    matched: `${diffs.length} of ${marks.length}`,
    medianMs: abs[Math.floor(abs.length / 2)] ?? null,
    p90Ms: abs[Math.floor(abs.length * 0.9)] ?? null,
    worstMs: abs.at(-1) ?? null,
    meanSignedMs: Math.round(mean),
    /** Median distance from the mean: how much is scatter, not a fixed offset. */
    spreadMs:
      diffs.map((d) => Math.abs(d - mean)).sort((a, b) => a - b)[Math.floor(diffs.length / 2)] ??
      null,
  };
}

console.log(
  JSON.stringify(
    {
      clip: values.clip ?? "synthetic (macOS say, words placed with 60–260 ms gaps)",
      model: modelName,
      vad: values["no-vad"] !== true,
      results: [drift("dtw"), drift("offsets")],
    },
    null,
    2,
  ),
);
