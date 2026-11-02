# Requirements: media-engine (spec 3)

Source: docs/build-plan.md v3, section 14 (analysis pipeline), section 15
(storage layout), section 23 spec 3, and steering ffmpeg.md. Depends on spec 2.

## Introduction

`packages/media` turns a source video into the files the rest of the app
reads: probe, 16 kHz audio, silences, a transcript with word times, loudness,
scene cuts, a proxy, waveform peaks and thumbnails. It wraps the bundled
ffprobe, ffmpeg and whisper-cli, builds every argument list in a pure
function, and runs the steps in order with cache keys so finished work is
skipped. The utilityProcess worker runs it as a job with progress and cancel.

Clip matching (step 6) is spec 6, and per-short proxies (step 9) need shorts,
so they arrive with specs 6 and 9. Wiring a stream's source to
`analysis:start` needs the project store (spec 4). This spec ends at a worker
job that main can call with explicit paths.

## Glossary

- **Step**: one row of section 14's table, with inputs, one output and a cache key.
- **Cache key**: a SHA-256 of the step name, the source fingerprint, the
  step's settings, the tool version, and the keys of the steps it reads.
- **Analysis dir**: `sources/<sourceId>/analysis/`. **Cache dir**: `cache/<sourceId>/`.
- **Chunk**: a piece of the audio about 10 minutes long, cut at a silence.
- **Quick mode**: probe, audio, silences, transcript, scenes and loudness.
  Used for clips and past shorts.
- **Drift**: the difference between a word's start time from whisper and its
  true start time.

## Requirements

### Requirement 1: Steps, order and cache (P0)

1. THE engine SHALL run probe, audio, silences, transcript, loudness, scenes,
   proxy, peaks and thumbnails in that order, and write each output to the
   section 15 path.
2. THE engine SHALL record each finished step's cache key, tool version and
   time in `analysis/steps.json`.
3. WHEN a step's key matches the recorded key and its output exists, THE
   engine SHALL skip it.
4. WHEN an upstream step's key changes, every step that reads it SHALL rerun.
5. EVERY output SHALL be written to a temporary file and renamed into place,
   so a crash never leaves a half-written output under its real name.
6. EVERY file the engine reads back SHALL be parsed with its Zod schema.

### Requirement 2: Transcript (P0)

1. THE transcript step SHALL split the audio into chunks of about 10 minutes
   at silences, and run whisper-cli on each with `--vad`, the Silero model,
   `-ojf` and `--dtw <model>`.
2. THE step SHALL merge tokens into words (dropping special tokens) and group
   words into lines of at most 12 s, giving ids `w00001…` and `L0001…`.
3. Word times SHALL be integer ms in source time, and the result SHALL pass
   `checkTranscript`.
4. WHEN a chunk finishes, THE step SHALL save it, so an interrupted
   transcription resumes from the next chunk.
5. WHEN the transcript is written, THE engine SHALL emit a step-done event,
   so Find shorts can unlock before the background steps finish.
6. THE design SHALL record whether `--dtw` needs `-nfa` on the pinned
   whisper.cpp, and the word-time drift (median and worst) measured against
   known word times.

### Requirement 3: Proxy and encoder (P0)

1. THE engine SHALL pick the proxy encoder with a 1-second test encode, trying
   `h264_videotoolbox`, `h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_mf`, then
   libx264 `veryfast`, and return the pick so it can be saved per machine.
2. THE proxy SHALL be 720p H.264 with a keyframe every second and AAC audio.
3. WHEN the source plays directly in Chromium, THE engine SHALL skip the proxy.

### Requirement 4: Progress and cancel (P0)

1. WHILE a step runs, THE engine SHALL emit the step, a stage label and a
   percent from 0 to 100.
2. WHEN a job is cancelled, THE engine SHALL kill the running child process,
   remove partial files, and stop without recording the step.

### Requirement 5: Files and paths (P0)

1. THE engine SHALL handle source paths with spaces, quotes and non-ASCII
   characters on macOS and Windows.
2. THE engine SHALL write nothing next to the source. Every output goes under
   the analysis dir or the cache dir.
3. Every child process SHALL be spawned with an args array, never a shell.

### Requirement 6: Plain failures (P0)

1. IF ffprobe can't read the file, THE engine SHALL fail with one plain line
   saying the file couldn't be read.
2. IF the file has no audio, THE engine SHALL fail the audio and transcript
   steps with one plain line saying so, and still finish probe.
3. IF a tool exits with an error, THE message SHALL name the step and keep
   the last lines of the tool's output in the job log, not in the message.

### Requirement 7: Quick mode (P0)

1. THE engine SHALL offer a quick mode that runs only probe, audio,
   silences, transcript, scenes and loudness.

### Requirement 8: Worker job (P0)

1. THE worker contract SHALL carry an analysis request, progress and
   step-done events, a result, and a cancel message, all Zod-checked.
2. A test SHALL run a job through the worker protocol and cancel one.
