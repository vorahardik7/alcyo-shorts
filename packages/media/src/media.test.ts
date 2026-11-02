import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { MAX_LINE_MS } from "@alcyo/schema";
import { describe, expect, it } from "vitest";
import { planChunks, CHUNK_MAX_MS, CHUNK_SLACK_MS, CHUNK_TARGET_MS } from "./chunks.ts";
import { MediaError } from "./errors.ts";
import {
  audioArgs,
  chunkAudioArgs,
  encoderTestArgs,
  proxyArgs,
  sceneArgs,
  secs,
  silenceArgs,
  thumbnailArgs,
} from "./ffmpeg-args.ts";
import { parseLoudness, parseScenes, parseSilences } from "./parse.ts";
import { peaksFromPcm, wavDataRange } from "./peaks.ts";
import { ffprobeArgs, layoutOf, parseFfprobe, playsDirectly } from "./probe.ts";
import { ffmpegProgress, whisperProgress } from "./progress.ts";
import {
  buildTranscript,
  fixWordTimes,
  groupLines,
  MAX_WORD_MS,
  tokensToWords,
  WhisperJson,
  whisperArgs,
} from "./whisper.ts";
import { checkTranscript } from "@alcyo/schema";
import { stepKey } from "./cache.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
const AWKWARD = `/Users/me/My "Stream" it's 名前 — final.mp4`;

describe("ffprobe", () => {
  it("puts -- before the input so a path can't be read as a flag", () => {
    const args = ffprobeArgs("-weird.mp4");
    expect(args.slice(-2)).toEqual(["--", "-weird.mp4"]);
  });

  it("reads an mp4 into integer ms and a layout", () => {
    const probe = parseFfprobe(fixture("ffprobe-mp4.json"));
    expect(probe).toMatchObject({
      durationMs: 9500,
      video: { codec: "h264", width: 1280, height: 720, fpsNum: 30, fpsDen: 1 },
      audio: { codec: "aac", sampleRate: 16000, channels: 1 },
      playsDirectly: true,
    });
    expect(layoutOf(probe)).toBe("v:h264:1280x720@30/1|a:aac:16000x1");
  });

  it("reads a WAV as audio only, which doesn't play as video", () => {
    const probe = parseFfprobe(fixture("ffprobe-wav.json"));
    expect(probe.video).toBeNull();
    expect(probe.audio?.codec).toBe("pcm_s16le");
    expect(probe.playsDirectly).toBe(false);
  });

  it("ignores cover art when looking for video", () => {
    const json = JSON.stringify({
      streams: [
        { codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 2 },
        {
          codec_type: "video",
          codec_name: "mjpeg",
          width: 500,
          height: 500,
          disposition: { attached_pic: 1 },
        },
      ],
      format: { format_name: "mp3", duration: "120.5" },
    });
    expect(parseFfprobe(json).video).toBeNull();
  });

  it("calls an empty or broken answer unreadable, in plain words", () => {
    for (const bad of [
      "{}",
      "not json",
      JSON.stringify({ streams: [], format: { duration: "3" } }),
    ]) {
      expect(() => parseFfprobe(bad)).toThrow(MediaError);
      expect(() => parseFfprobe(bad)).toThrow("This file couldn't be read.");
    }
  });

  it("plays H.264 MP4 and VP9 WebM directly, but not HEVC, H.264 MKV or PCM audio", () => {
    const base = { durationMs: 1000, container: "mov,mp4,m4a,3gp,3g2,mj2", audio: null };
    const v = (codec: string) => ({ codec, width: 1920, height: 1080, fpsNum: 30, fpsDen: 1 });
    expect(playsDirectly({ ...base, video: v("h264") })).toBe(true);
    expect(playsDirectly({ ...base, container: "matroska,webm", video: v("vp9") })).toBe(true);
    expect(playsDirectly({ ...base, video: v("hevc") })).toBe(false);
    expect(playsDirectly({ ...base, container: "matroska", video: v("h264") })).toBe(false);
    // ffprobe names MKV "matroska,webm" too; H.264 there needs a proxy.
    expect(playsDirectly({ ...base, container: "matroska,webm", video: v("h264") })).toBe(false);
    expect(
      playsDirectly({
        ...base,
        video: v("h264"),
        audio: { codec: "pcm_s16le", sampleRate: 48000, channels: 2 },
      }),
    ).toBe(false);
  });
});

describe("ffmpeg args", () => {
  it("keeps an awkward path as one argument, right after -i", () => {
    for (const args of [
      audioArgs(AWKWARD, "/c/audio.wav"),
      sceneArgs(AWKWARD),
      thumbnailArgs(AWKWARD, "/c/thumbs-%03d.jpg"),
      proxyArgs({ input: AWKWARD, out: "/c/p.mp4", encoder: "libx264", fps: 30, hasAudio: true }),
    ]) {
      expect(args[args.indexOf("-i") + 1]).toBe(AWKWARD);
    }
  });

  it("extracts 16 kHz mono 16-bit audio with progress on stdout", () => {
    const args = audioArgs("in.mp4", "out.wav");
    expect(args.join(" ")).toContain("-ac 1 -ar 16000 -c:a pcm_s16le -f wav out.wav");
    expect(args.join(" ")).toContain("-progress pipe:1");
  });

  it("cuts a chunk by exact seconds", () => {
    expect(secs(600_123)).toBe("600.123");
    const args = chunkAudioArgs("a.wav", 600_000, 1_200_500, "c.wav");
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual([
      "-ss",
      "600.000",
      "-to",
      "1200.500",
    ]);
  });

  it("uses the section 14 filters", () => {
    expect(silenceArgs("a.wav")).toContain("silencedetect=n=-35dB:d=0.3");
    expect(sceneArgs("v.mp4")).toContain("scale=320:-2,select='gt(scene,0.3)',showinfo");
    expect(thumbnailArgs("v.mp4", "t-%03d.jpg")).toContain("fps=1/5,scale=320:-2");
  });

  it("makes a 720p proxy with a keyframe every second and AAC", () => {
    const args = proxyArgs({
      input: "v.mp4",
      out: "p.mp4",
      encoder: "h264_videotoolbox",
      fps: 29.97,
      hasAudio: true,
    });
    const s = args.join(" ");
    expect(s).toContain("scale=-2:720");
    expect(s).toContain("-c:v h264_videotoolbox -b:v 5M");
    expect(s).toContain("-g 30 -keyint_min 30");
    expect(s).toContain("-c:a aac");
    const x264 = proxyArgs({
      input: "v.mp4",
      out: "p.mp4",
      encoder: "libx264",
      fps: 60,
      hasAudio: false,
    }).join(" ");
    expect(x264).toContain("-preset veryfast");
    expect(x264).toContain("-an");
    expect(x264).not.toContain("0:a:0");
  });

  it("test-encodes one second of a generated pattern", () => {
    const s = encoderTestArgs("h264_nvenc").join(" ");
    expect(s).toContain("testsrc2=size=1280x720:rate=30 -t 1");
    expect(s).toContain("-c:v h264_nvenc");
    expect(s.endsWith("-f null -")).toBe(true);
  });
});

describe("parsers", () => {
  it("reads silencedetect pairs and closes a trailing one at the end", () => {
    const lines = [
      "[Parsed_silencedetect_0 @ 0x1] silence_start: 1.5",
      "[Parsed_silencedetect_0 @ 0x1] silence_end: 2.25 | silence_duration: 0.75",
      "[Parsed_silencedetect_0 @ 0x1] silence_start: 7.23375",
    ];
    expect(parseSilences(lines, 9456)).toEqual([
      { startMs: 1500, endMs: 2250 },
      { startMs: 7234, endMs: 9456 },
    ]);
    expect(parseSilences(["silence_start: -0.01", "silence_end: 0.5"], 1000)).toEqual([
      { startMs: 0, endMs: 500 },
    ]);
  });

  it("reads ebur128 into the integrated value and one loudest value per second", () => {
    const out = parseLoudness(fixture("ebur128.txt").split("\n"));
    expect(out.integratedLufs).toBe(-16.8);
    expect(out.momentary.map((m) => m.tMs)).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]);
    expect(Math.min(...out.momentary.map((m) => m.lufs))).toBeGreaterThanOrEqual(-70);
  });

  it("reads showinfo scene times in ms", () => {
    const line =
      "[Parsed_showinfo_2 @ 0x6] n:   0 pts:  25600 pts_time:2       duration:    512 duration_time:0.04 fmt:yuv420p";
    expect(
      parseScenes(["[Parsed_showinfo_2 @ 0x6] config in time_base: 1/15360", line, line]),
    ).toEqual([2000]);
  });

  it("reads ffmpeg and whisper progress", () => {
    expect(ffmpegProgress("out_time_us=4728062", 9456)).toBe(50);
    expect(ffmpegProgress("out_time_us=99999999", 9456)).toBe(100);
    expect(ffmpegProgress("speed=3x", 9456)).toBeNull();
    expect(whisperProgress("whisper_print_progress_callback: progress =  45%")).toBe(45);
    expect(whisperProgress("output_json: saving")).toBeNull();
  });
});

describe("chunks", () => {
  it("keeps anything up to 12 minutes in one chunk", () => {
    expect(planChunks(CHUNK_MAX_MS, [])).toEqual([{ startMs: 0, endMs: CHUNK_MAX_MS }]);
    expect(planChunks(0, [])).toEqual([]);
  });

  it("cuts in the middle of the silence nearest 10 minutes", () => {
    const silences = [
      { startMs: 500_000, endMs: 501_000 },
      { startMs: 610_000, endMs: 612_000 },
    ];
    expect(planChunks(1_500_000, silences)[0]).toEqual({ startMs: 0, endMs: 611_000 });
  });

  it("covers the audio with no gaps, cutting within ±2 min of the target (property)", () => {
    const silence = fc
      .tuple(fc.integer({ min: 0, max: 4 * 3_600_000 }), fc.integer({ min: 300, max: 5000 }))
      .map(([s, d]) => ({ startMs: s, endMs: s + d }));
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 * 3_600_000 }),
        fc.array(silence, { maxLength: 200 }),
        (dur, sil) => {
          const chunks = planChunks(dur, sil);
          expect(chunks[0]!.startMs).toBe(0);
          expect(chunks.at(-1)!.endMs).toBe(dur);
          chunks.forEach((c, i) => {
            expect(c.endMs).toBeGreaterThan(c.startMs);
            if (i > 0) expect(c.startMs).toBe(chunks[i - 1]!.endMs);
            if (i < chunks.length - 1) {
              expect(Math.abs(c.endMs - c.startMs - CHUNK_TARGET_MS)).toBeLessThanOrEqual(
                CHUNK_SLACK_MS,
              );
            } else {
              expect(c.endMs - c.startMs).toBeLessThanOrEqual(CHUNK_MAX_MS);
            }
          });
        },
      ),
    );
  });
});

describe("whisper", () => {
  const json = WhisperJson.parse(JSON.parse(fixture("whisper-ojf.json")));
  const tokens = json.transcription.flatMap((s) => s.tokens);

  it("always passes -nfa with --dtw, and -- isn't needed because -f takes the path", () => {
    const args = whisperArgs({
      model: "/m/ggml-small.en.bin",
      modelName: "small.en",
      vadModel: "/m/silero.bin",
      wav: AWKWARD,
      outBase: "/c/tmp/whisper-000",
      threads: 8,
    });
    expect(args).toContain("--vad");
    expect(args).toContain("-ojf");
    expect(args[args.indexOf("--dtw") + 1]).toBe("small.en");
    expect(args).toContain("-nfa");
    expect(args[args.indexOf("-f") + 1]).toBe(AWKWARD);
    expect(args[args.indexOf("-vm") + 1]).toBe("/m/silero.bin");
  });

  it("merges tokens into words, drops special tokens, and joins punctuation", () => {
    const words = tokensToWords(tokens, 0);
    expect(words.map((w) => w.text).slice(0, 6)).toEqual([
      "All",
      "right",
      "chat,",
      "we",
      "are",
      "live.",
    ]);
    expect(words.find((w) => w.text === "That's")).toBeDefined();
    expect(words.some((w) => w.text.includes("[_"))).toBe(false);
  });

  it("uses DTW times for starts, shifted by the chunk offset", () => {
    const words = tokensToWords(tokens, 600_000);
    // " right" has t_dtw 40 (centiseconds).
    expect(words[1]).toMatchObject({ text: "right", startMs: 600_400 });
    const byOffsets = tokensToWords(tokens, 0, "offsets");
    expect(byOffsets[1]!.startMs).toBe(250);
  });

  it("drops bracketed non-speech", () => {
    const t = (text: string, from: number) => ({
      text,
      offsets: { from, to: from + 100 },
      p: 1,
      t_dtw: -1,
    });
    const words = tokensToWords(
      [t(" [", 0), t("BL", 0), t("ANK", 0), t("_AUDIO", 0), t("]", 0), t(" hi", 200)],
      0,
    );
    expect(words.map((w) => w.text)).toEqual(["hi"]);
  });

  it("builds a transcript that passes the schema checks", () => {
    const transcript = buildTranscript({
      sourceId: "s1",
      language: "en",
      model: "small.en",
      words: tokensToWords(tokens, 0),
    });
    expect(checkTranscript(transcript)).toEqual([]);
    expect(transcript.words[0]!.id).toBe("w00001");
    expect(transcript.lines[0]!.id).toBe("L0001");
    expect(transcript.lines.length).toBeGreaterThanOrEqual(2);
  });

  const rawWords = fc
    .array(
      fc.record({
        gap: fc.integer({ min: 0, max: 4000 }),
        len: fc.integer({ min: 1, max: 6000 }),
        text: fc.constantFrom("hi", "there.", "what?", "no", "way!", "ok,"),
        p: fc.double({ min: 0, max: 1, noNaN: true }),
      }),
      { minLength: 1, maxLength: 300 },
    )
    .map((items) => {
      let t = 0;
      return items.map(({ gap, len, text, p }) => {
        t += gap;
        // Overlapping and over-long words on purpose: fixWordTimes cleans them.
        return { text, startMs: t, endMs: t + len, p };
      });
    });

  it("gives every word a positive length of at most 3 s, in order (property)", () => {
    fc.assert(
      fc.property(rawWords, (raw) => {
        const words = fixWordTimes(raw);
        words.forEach((w, i) => {
          expect(w.endMs).toBeGreaterThan(w.startMs);
          expect(w.endMs - w.startMs).toBeLessThanOrEqual(MAX_WORD_MS);
          if (i > 0) expect(w.startMs).toBeGreaterThanOrEqual(words[i - 1]!.startMs);
        });
      }),
    );
  });

  it("puts every word in exactly one line, in order, with lines of at most 12 s (property)", () => {
    fc.assert(
      fc.property(rawWords, (raw) => {
        const words = fixWordTimes(raw);
        const lines = groupLines(words);
        expect(lines.flat()).toEqual(words.map((_, i) => i));
        for (const idx of lines) {
          const span = words[idx.at(-1)!]!.endMs - words[idx[0]!]!.startMs;
          expect(span).toBeLessThanOrEqual(MAX_LINE_MS);
        }
        const t = buildTranscript({ sourceId: "s", language: "en", model: "m", words });
        expect(checkTranscript(t)).toEqual([]);
      }),
    );
  });
});

describe("peaks", () => {
  it("gives a min and max per 160 samples, as Int8", () => {
    const samples = new Int16Array(320);
    samples[5] = 32767;
    samples[6] = -32768;
    samples[200] = 256;
    expect([...peaksFromPcm(samples)]).toEqual([-128, 127, 0, 1]);
  });

  it("finds the data chunk after other chunks", () => {
    const h = Buffer.alloc(64);
    h.write("RIFF", 0, "ascii");
    h.write("WAVE", 8, "ascii");
    h.write("LIST", 12, "ascii");
    h.writeUInt32LE(4, 16);
    h.write("data", 24, "ascii");
    h.writeUInt32LE(1000, 28);
    expect(wavDataRange(h)).toEqual([32, 1000]);
    expect(wavDataRange(Buffer.from("nope nope nope"))).toBeNull();
  });
});

describe("cache keys", () => {
  const fingerprint = {
    sizeBytes: 10,
    headSha256: "a".repeat(64),
    tailSha256: "b".repeat(64),
    durationMs: 1000,
    layout: "v",
  };
  const base = { fingerprint, settings: { a: 1, b: 2 }, toolVersion: "9", inputs: ["x"] };

  it("ignores key order and changes with any part", () => {
    expect(stepKey("audio", base)).toBe(stepKey("audio", { ...base, settings: { b: 2, a: 1 } }));
    const k = stepKey("audio", base);
    expect(stepKey("silences", base)).not.toBe(k);
    expect(stepKey("audio", { ...base, inputs: ["y"] })).not.toBe(k);
    expect(stepKey("audio", { ...base, toolVersion: "10" })).not.toBe(k);
    expect(stepKey("audio", { ...base, fingerprint: { ...fingerprint, sizeBytes: 11 } })).not.toBe(
      k,
    );
  });
});
