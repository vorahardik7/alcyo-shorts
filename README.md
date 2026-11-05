# Alcyo Shorts

A desktop app for macOS and Windows that turns a long stream into captioned
9:16 shorts. Each stream is a chat. The coding agent you're already signed in
to (Claude Code, Grok or Codex) proposes shorts as cards in the thread; you
ask for changes by replying, or open the editor and change them by hand.
Everything is processed on your computer.

Working name. MIT licensed.

## What it does

- **Import.** Paste a stream link (yt-dlp) or choose a recording. Add viewer
  clips by link or file; Alcyo finds where each one sits in the stream, from
  the words and then the audio.
- **Analyze locally.** whisper.cpp with voice detection makes a transcript
  with word times. ffmpeg finds pauses, scene cuts and loudness, and builds a
  preview copy, a waveform and thumbnails in the background.
- **Find shorts.** The agent reads numbered transcript lines, your creator
  profile and `[clipped]` markers, and answers with line ids. Code maps them
  to word edges, snaps cuts to pauses and checks length, overlap and count.
- **Chat edits.** Each message becomes one checked action from a fixed list
  (revise a short, retime it, change its style, find new shorts, answer, or
  ask which short you mean). Every proposal, chat edit
  and editor save is a version with its own `alcyo://` link.
- **Editor.** Timeline with trims and splits, transcript editing (delete a
  word and the video follows), captions, reframe keys, hook text, undo,
  versions and autosave.
- **Render.** 1080 × 1920 H.264/AAC MP4s, one at a time, checked with
  ffprobe. The preview and the render share one crop function and one `.ass`
  caption file, so what you see is what you get.
- **Creator profile.** A short interview through your agent, past shorts
  measured in place (never copied), and caption looks or templates.

## Download

Installers are on the [Releases page](https://github.com/vorahardik7/alcyo-shorts/releases):
`Alcyo-Shorts-<version>-mac-arm64.dmg` (Apple silicon) and
`Alcyo-Shorts-<version>-win-x64.exe`, with `SHA256SUMS.txt`. CI
(`.github/workflows/ci.yml`) builds and tests both from a `v*` tag and
publishes them only when every check passes on both systems.

Neither build is signed with a paid certificate yet, so the first open needs
one extra step.

**macOS.** Open the dmg and drag Alcyo Shorts to Applications. Open it once;
macOS says it can't check the app. Open System Settings > Privacy & Security,
scroll to the message about Alcyo Shorts, and click **Open Anyway**. Confirm
with your password. Later opens work normally.

**Windows.** Run the installer. If SmartScreen says "Windows protected your
PC", click **More info**, then **Run anyway**.

## Build from source

You need Node 22.18 or later, pnpm 12 (`corepack enable`), and git. macOS
builds need an Apple silicon Mac; Windows builds need Windows x64.

```sh
pnpm install
pnpm fetch-binaries            # pinned ffmpeg, ffprobe, whisper-cli, yt-dlp, Silero VAD; checksums checked
pnpm dev                       # run the app from source
pnpm package:mac               # or: pnpm package:win  -> apps/desktop/release/
```

Checks: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then
`pnpm test:e2e` for the Playwright tests against the built app. Run
`pnpm hooks:install` once to add the pre-commit check that keeps video and
audio out of git.

## First run

1. **Setup** checks the bundled tools and looks for Claude Code, Grok or
   Codex on your computer, and whether you're signed in. Alcyo never offers a
   login and never reads an agent's credentials; it runs the agent you
   already use. If none is signed in, you can save an Anthropic API key in
   Settings instead (stored with the OS keychain through Electron's
   safeStorage). Setup also downloads the whisper model (small.en, about
   490 MB) once; nothing else is downloaded unless you ask.
2. **Onboarding** builds your creator profile: a few questions from your
   agent (skip any and defaults are used), past shorts if you have them, and
   a caption look. You can skip it and come back from Settings.
3. **New stream.** Paste a link or choose a file. Analysis starts; Find
   shorts runs by itself once the transcript is in.

## Try it without an agent (judge path)

1. Get the app (download or build, above) and open it once (Gatekeeper or
   SmartScreen step above).
2. On Setup, click **Skip for now**. On Home, click **Open the demo stream**.
   It's a ready project with a profile, two placed viewer clips, three
   proposed shorts, one chat revision and one editor version. It needs no
   agent, key, network or whisper model; its footage is copied into a new
   project in your streams folder.
3. Click around: play a card, **Copy link** and open it, **Edit** to open
   the editor, delete a word, drag the crop, and **Render**. The MP4 lands in
   the project's `renders/` folder (Settings > Storage shows where that is).
4. Optional, the full path: sign in to Claude Code, Grok or Codex (or save an
   API key), then paste a link to a stream you own and chat with it.

A chat message on the demo without a signed-in agent says so, and how to set
one up.

The demo footage is a stand-in made with a synthetic voice; see
[`examples/demo/README.md`](examples/demo/README.md).

## What stays on your computer

- Video and audio are never uploaded. Analysis, previews and renders run
  locally with the bundled ffmpeg and whisper.cpp.
- Only transcript text and your creator profile go to your agent (or the
  Anthropic API, if you saved a key). The agent answers with ids and one
  action from a fixed list; it never runs anything, writes ffmpeg arguments
  or returns times.
- Network use is limited to: downloads you ask for (yt-dlp), the yt-dlp
  update, the one-time whisper model download, and your agent or the API.
- No accounts, no cloud, no telemetry, no local web server.
- Nothing is written next to your recordings. Past shorts are measured where
  they are and never copied.

**Only download videos you own or have permission to use.**

## Repository

```
apps/desktop/    Electron app: main, utilityProcess worker, preload, React renderer
packages/        schema, ipc, store, media, import, profile, planner, render, mcp
examples/        the demo stream and profile; the MCP server's root
.kiro/           specs, steering, hooks, settings and the reviewer agent
docs/build-plan.md
```

How Kiro was used to build it is in [KIRO.md](KIRO.md).
Third-party licenses are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
