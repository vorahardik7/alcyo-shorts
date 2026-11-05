# Design: demo-and-docs (spec 13)

## Demo footage

`examples/demo/clip.mp4` is a 112 s stand-in: macOS's "Reed (English (US))"
voice reading `scripts/demo/script.txt` (a boss fight, a parry, a story, a
rare drop) over an ffmpeg `gradients` background with the title, a LIVE
clock and a yellow "boss" box moving as `640 + 420·sin(t/3)` px, so reframing
has something to follow. 1280×720, H.264 CRF 30, AAC 96k, about 3.6 MB. Two
10 s viewer clips are cut from it around "parried" and "Ember", found from a
first transcription; their true offsets go into `examples/demo/README.md`.

The box is an `overlay` with `eval=frame`. A first version used `drawbox`,
where `t` is the line thickness, so the box never moved; frames from an MCP
render showed it.

## Builder

`apps/desktop/scripts/build-demo.ts`, run by `pnpm demo:build` through
`scripts/demo.mjs`, which bundles it with esbuild (the workspace packages
use extensionless imports) and runs it with Node. It uses main's
Electron-free services in a temp userData and streams folder:

1. `StreamService.addFile` analyzes the stream (full mode, small.en, Silero
   VAD), then `addClipFile` checks and places each clip (transcript, then
   audio matching).
2. The planner's one automatic Find shorts runs with the chosen agent
   (`--agent grok|claude|codex|script`, Grok by default, located the way the
   app does on macOS).
3. A reply to short 1, "make the first one punchier, cut the slow start",
   makes the chat revision. The builder fails when the revision keeps the
   same cut.
4. `EditorService.save` makes the user version on the parry short (or short
   2): a hook and crop keys every 1.5 s following the box.
5. The project is copied to `examples/demo.alcyo` without renders, `.wav`
   files or clip caches; source and clip paths are rewritten relative to it.

## Relative media paths

`ProjectStore.source()` and `clip()` resolve a relative `origin.path`
against the stream folder. Absolute paths are unchanged, so nothing else
changes for existing projects.

## Open demo

`apps/desktop/src/main/demo.ts`, `openDemo(deps)`, Electron-free:

- If `streams.json` has `s_demostream` and its folder exists, it's returned
  as is.
- Otherwise the project is copied into a new unique folder in the streams
  folder (renders left out), the recording and clips are copied into
  `sources/<id>/media.mp4` and `clips/<id>/media.mp4` (`copied: true`), the
  stream is upserted with its poster thumbnail, and the demo profile is
  saved if there's no profile.
- The demo root is `examples/` in a checkout and `resources/demo` when
  packaged (`extraResources` in `electron-builder.yml`, filtered to the
  project, the footage and the profile).

The `demo:open` IPC channel returns the stream summary; main posts one
message saying what the demo is and that Find shorts and chat need an agent,
then sends `streams:changed` and `profile:changed`. Home's **Open the demo
stream** calls it and navigates to the thread.

## Tests

- `src/main/demo.test.ts`: copy and media copies, renders left out, the
  examples folder untouched, the same stream on a second open, a new copy
  when the folder is gone, the profile only when none, and the missing-demo
  message.
- `src/main/ipc/handlers.test.ts`: `demo:open` returns the summary and
  passes the error on.
- `packages/store/src/store.test.ts`: relative source and clip paths.
- `e2e/demo.spec.ts`: setup failing (no agent), Skip, Open demo, three cards,
  the revision, a "You" version, two placed clips, render short 1 and
  ffprobe it, and the no-agent reply to a chat message.
