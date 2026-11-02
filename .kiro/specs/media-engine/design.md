# Design: media-engine (spec 3)

## Overview

`packages/media` (`@alcyo/media`) depends on `@alcyo/schema` and zod, uses
Node's `child_process`, `fs` and `crypto`, and never imports Electron. Every
tool's arguments come from a pure `*Args` function with a unit test; every
tool's output is parsed by a pure function with a unit test. `analyze.ts`
runs the steps. The worker calls `analyze` for an `analysis-run` message and
streams events back to main.

## Modules

| File | Contents |
|---|---|
| `process.ts` | `runTool(file, args, opts)`: spawn with an args array, line callbacks for stdout and stderr, an `AbortSignal` that sends SIGTERM then SIGKILL after 2 s, a stderr tail for logs. `Runner` type for tests. |
| `errors.ts` | `MediaError` with `code` (`unreadable`, `no-audio`, `tool-failed`, `cancelled`) and a plain `message`. |
| `files.ts` | `writeFileAtomic` (temp in the same folder, fsync, rename, Windows EPERM/EBUSY retry for 2 s), `writeJsonAtomic`, `readJson(path, schema)`, `removeQuietly`. |
| `probe.ts` | `ffprobeArgs`, `parseFfprobe` (Zod) → `Probe`, `playsDirectly`, `layoutOf`. |
| `fingerprint.ts` | `fingerprint(path, probe)`: size, SHA-256 of first and last 4 MB, duration, layout. |
| `progress.ts` | `ffmpegProgress(line, durationMs)` for `-progress pipe:1` (`out_time_us`), `whisperProgress(line)` for `progress = N%`. |
| `audio.ts` | `audioArgs`: 16 kHz mono s16 WAV. `chunkAudioArgs`. |
| `silences.ts` | `silenceArgs` (`silencedetect=n=-35dB:d=0.3`), `parseSilences(stderr, durationMs)`. |
| `chunks.ts` | `planChunks(durationMs, silences)`: pure. |
| `whisper.ts` | `whisperArgs`, `WhisperJson` (Zod), `tokensToWords`, `wordsToLines`, `buildTranscript`. |
| `loudness.ts` | `loudnessArgs` (`ebur128`), `parseLoudness`. |
| `scenes.ts` | `sceneArgs` (`select='gt(scene,0.3)',showinfo` on a 320 px decode), `parseScenes`. |
| `encoder.ts` | `ENCODER_ORDER`, `encoderTestArgs`, `pickEncoder(run)`. |
| `proxy.ts` | `proxyArgs(source, out, encoder, range?)`. |
| `peaks.ts` | `peaksFromPcm(samples)`, `writePeaks(wavPath, outPath)`: min/max Int8 pairs at 100 per second. |
| `thumbnails.ts` | `thumbnailArgs` (one frame every 5 s, 320 px wide JPEG), `pickPoster(files)`. |
| `cache.ts` | `stepKey(...)`, `StepState` read and write of `steps.json`. |
| `analyze.ts` | `analyze(request, deps, onEvent, signal)` → `AnalysisResult`. |

## Paths

```
sources/<sourceId>/analysis/  source.json is the store's (spec 4); the engine writes:
  probe.json  silences.json  transcript.json  loudness.json  scenes.json  steps.json
cache/<sourceId>/
  audio.wav  proxy.mp4  peaks.bin  thumbs-001.jpg …
  transcript/chunk-000.json …   per-chunk whisper results, for resume
  tmp/                          chunk WAVs and whisper's own output, removed after
```

`probe.json` holds the `Probe` plus the `Fingerprint`, so the store can copy
both into `source.json` when it lands (spec 4). The request carries the
source path, the two dirs, the tool paths and the model; the engine never
derives a path from the source's folder, so nothing is written next to it
(a test lists the source's folder before and after).

## Cache keys

`stepKey(step, { fingerprint, settings, toolVersion, inputs })` is the
SHA-256 of a canonical JSON with sorted keys. `inputs` are the keys of the
steps it reads, so a change upstream cascades. A step is skipped when the key
in `steps.json` matches and every output file exists. `steps.json` is
rewritten after each step, so a crash loses at most the running step.

| Step | Reads | Settings in the key |
|---|---|---|
| probe | source | — |
| audio | probe | rate 16000, mono |
| silences | audio | noise −35 dB, 300 ms |
| transcript | audio, silences | model name, VAD model, language, `-nfa` |
| loudness | audio | — |
| scenes | probe | threshold 0.3, 320 px |
| proxy | probe | encoder, 720p, GOP 1 s |
| peaks | audio | 100 per second |
| thumbnails | probe | every 5 s, 320 px |

## Transcript

- **Chunks.** Target 10 min. From the current start, the cut goes at the
  middle of the silence whose middle is nearest start + 10 min within ±2 min.
  With no silence there, the cut goes at start + 10 min. The last chunk takes
  whatever is left when it's under 12 min. Chunks are cut from `audio.wav`
  with `-ss`/`-to` (sample-exact on PCM) into `cache/tmp/`.
- **whisper-cli args.** `-m <model> -f <chunk.wav> -l en --vad -vm <silero>
  -ojf --dtw <model name> -nfa -of <tmp/chunk-N> -np -pp -t <threads>`.
  `-np` keeps stdout to progress lines; `-pp` gives `progress = N%`.
- **`--dtw` needs `-nfa` on whisper.cpp 1.9.5.** Measured Nov 1 on this Mac:
  with flash attention on (the default), every token's `t_dtw` is −1; with
  `-nfa` the tokens carry DTW times. So `-nfa` is always passed with `--dtw`.
- **Tokens to words.** `t_dtw` is in centiseconds; `offsets` are ms. Tokens
  whose text matches `^\[_.*\]$` are dropped. A token starting with a space
  begins a new word; others (punctuation, `'s`) join the word before. A word's
  start is its first token's DTW time when present (see drift below), else
  `offsets.from`. Its end is its last token's `offsets.to`, clamped to be after
  the start and no later than the next word's start. Word `p` is the mean of
  its tokens' `p`. Empty words are dropped.
- **Words to lines.** A line closes after a word ending in `.`, `?` or `!` once
  it's at least 2 s long, before a gap over 1.2 s, or before a word that would
  take it past 12 s.
- Each finished chunk is saved to `cache/transcript/chunk-NNN.json` with the
  step key and the chunk range. On a rerun with the same key, saved chunks are
  reused and whisper runs only on the rest.

## Word-time drift

Measured with `scripts/media-drift.ts` on a synthetic clip: words spoken by
macOS `say` one at a time and joined with gaps of 60 to 260 ms, so every
word's true start is known from where its audio was placed plus its own
onset. The real demo clip (plan section 33, hand-marked) gets the same script
once it exists.

Results are filled in by task 6 below.

Rule from section 14: if the median drift is over 80 ms, cut points use the
nearest silence edge within 150 ms. That rule lives in the render and planner
snapping (specs 8 and 9); this spec only records the number.

## Proxy and encoder

- `pickEncoder` runs, in order, `ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30
  -t 1 -c:v <enc> -f null -` and returns the first that exits 0, else
  `libx264`. libx264 gets `-preset veryfast -crf 23`; hardware encoders get
  `-b:v 5M`.
- Proxy: `scale=-2:720`, `-g <fps>` with `-keyint_min <fps>` (one keyframe a
  second), `-c:a aac -b:a 128k`, `-movflags +faststart`.
- `playsDirectly`: container mp4, mov, m4v or webm; video h264, vp8, vp9 or
  av1; audio aac, mp3, opus, vorbis or none. HEVC is out because Chromium on
  Windows doesn't play it without an extension.

## Peaks and thumbnails

- Peaks: read `audio.wav` in 1 MB blocks, 160 samples per bucket at 16 kHz,
  write min then max per bucket as Int8 (sample >> 8).
- Thumbnails: `fps=1/5,scale=320:-2`, `-q:v 5`. The poster is the first
  thumbnail over 6 KB, since near-black frames compress below that; else the
  first. The result names it.

## Progress and cancel

Events: `{ kind: "progress", step, stage, pct }` and `{ kind: "step-done",
step, skipped }`. Overall percent weights the steps (transcript 60, audio 8,
proxy 12, the rest share 20) so the bar moves evenly. Cancel aborts the
`AbortSignal`: the running tool gets SIGTERM, then SIGKILL after 2 s; the
step's temp files are removed; `analyze` throws `MediaError("cancelled")` and
doesn't touch `steps.json` for that step.

## Failures

| Case | Message |
|---|---|
| ffprobe exits non-zero or finds no streams | "This file couldn't be read. It may be damaged or not a video." |
| No audio stream | "This file has no audio, so it can't be transcribed." Probe and the video-only steps still run. |
| A tool fails | "The <step> step stopped. The job log has the details." |

## Worker contract

`MainToWorker` gains `analysis-run { id, jobId, request }` and
`job-cancel { jobId }`. `WorkerToMain` gains `job-event { jobId, event }` and
`analysis-result { id, result }`. `createWorkerClient().analyze(request,
onEvent)` returns `{ jobId, done, cancel }`. Analysis has no reply timeout.

## Testing

- Unit tests for every args builder and parser, with output captured from
  the real tools.
- `chunks`, `tokensToWords`, `wordsToLines`: unit tests plus properties:
  chunks cover the audio with no gaps; lines are at most 12 s; every word is
  in exactly one line, in order.
- `analyze` with a fake runner: order, skip on a matching key, cascade on a
  changed key, resume from saved chunks, cancel mid-step, no-audio source.
- Integration (`analyze.integration.test.ts`): real binaries on a generated
  clip in a folder named with spaces, quotes and non-ASCII. Skipped, with a
  note, when the binaries or the whisper model aren't present.
