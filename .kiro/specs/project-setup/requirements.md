# Requirements: project-setup (spec 1)

Source: docs/build-plan.md v3, section 23, spec 1. Depends on nothing.

## Introduction

Spec 1 sets up the repo so every later spec builds on a green base: a pnpm and
Turborepo monorepo, a locked-down Electron shell that opens to an empty chat
UI, a utilityProcess worker, deep links, pinned third-party binaries, the
footage guard, CI for macOS and Windows, and a self-test that shows which Kiro
hooks fire.

## Glossary

- **Repo**: the `alcyo-shorts` monorepo.
- **App**: the Electron desktop app in `apps/desktop`.
- **Main**: the Electron main process.
- **Worker**: the one Electron `utilityProcess` that will run jobs.
- **Renderer**: the React UI in the BrowserWindow.
- **App link**: an `alcyo://` URL as listed in section 5 of the plan.
- **Media file**: a file with a video or audio extension (for example mp4, mov,
  mkv, webm, wav, mp3, m4a, flac).

## Requirements

### Requirement 1: Checks pass through Turborepo (P0)

**User story:** As a developer, I want one set of commands that checks the whole
repo, so that every spec ends on a known-good state.

1. WHEN `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` run on a
   fresh clone after `pnpm install`, THE Repo SHALL pass all four through
   Turborepo.
2. THE Repo SHALL use TypeScript ~6.0 in strict mode with
   `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
   `verbatimModuleSyntax`, as ESM.
3. THE Repo SHALL lint with ESLint 10 flat config, typescript-eslint 8 and
   eslint-plugin-react-hooks 7, and check formatting with Prettier 3.

### Requirement 2: Packages for macOS and Windows (P0)

**User story:** As a creator, I want an installer for my OS, so that I can run
the app without building it.

1. WHEN `pnpm package:mac` runs on macOS, THE Repo SHALL produce an arm64 dmg.
2. WHEN `pnpm package:win` runs on Windows, THE Repo SHALL produce an x64 nsis
   installer.
3. WHEN either package is opened, THE App SHALL show the chat shell with an
   empty sidebar.
4. THE macOS package SHALL be ad-hoc signed.

### Requirement 3: Locked-down window (P0)

**User story:** As a creator, I want the UI to have no Node access, so that a
bug in the UI can't read or change my files.

1. THE App SHALL create its window with `contextIsolation: true`,
   `sandbox: true` and `nodeIntegration: false`.
2. THE Renderer SHALL have no `require` and no `process` global; a test SHALL
   show this.
3. THE Preload SHALL expose only `window.alcyo` with `invoke` and `on`.
4. WHEN Main receives an IPC call, IT SHALL parse the input with the channel's
   Zod schema before running the handler.
5. THE Renderer SHALL load with a CSP of `script-src 'self' 'wasm-unsafe-eval';
   worker-src 'self' blob:` and no remote content.

### Requirement 4: Single instance and alcyo:// links (P0)

**User story:** As a creator, I want an `alcyo://` link to open the running app
on the right place, so that links I paste anywhere work.

1. THE App SHALL be single-instance through `requestSingleInstanceLock`.
2. THE App SHALL register `alcyo://` with `app.setAsDefaultProtocolClient` and,
   in the packages, through the electron-builder `protocols` config.
3. WHEN macOS delivers an app link through `open-url`, THE App SHALL parse it
   with the Zod link schema and send `link:open` to the Renderer; a test SHALL
   show this.
4. WHEN Windows delivers an app link in `second-instance` argv (or the first
   launch's argv), THE App SHALL find the link in argv, parse it and send
   `link:open`; a test SHALL show the argv parsing.
5. IF an app link is malformed or unknown, THEN THE App SHALL show "That link
   doesn't point to anything in this app."
6. WHEN the Renderer receives `link:open`, IT SHALL navigate to the matching
   in-app route.

### Requirement 5: Worker with a checked MessagePort contract (P0)

**User story:** As a developer, I want jobs to run outside the main process
behind a typed contract, so that heavy work can't freeze the UI and bad
messages are caught.

1. WHEN the App starts, Main SHALL start one `utilityProcess` Worker and give it
   a MessagePort.
2. THE Main and the Worker SHALL parse every message on that port with a Zod
   schema from `packages/ipc`.
3. A test SHALL send one message from Main's side to the Worker and get the
   checked reply.
4. IF a message fails its schema, THEN THE receiver SHALL drop it and report an
   error instead of acting on it.

### Requirement 6: Pinned binaries (P0)

**User story:** As a developer, I want every bundled tool fetched from a pinned
source with a checksum, so that builds are repeatable and tampering is caught.

1. `scripts/fetch-binaries` SHALL fetch or build pinned ffmpeg, ffprobe,
   whisper-cli and yt-dlp for the target OS and CPU, and copy the Silero VAD
   model.
2. THE script SHALL read pins and checksums from `scripts/binaries.lock.json`
   and verify every download's SHA-256.
3. IF a checksum doesn't match, THEN THE script SHALL stop with a message that
   names the file, the expected and actual checksum, and what to do.
4. THE script SHALL place the files where the packages pick them up as
   `extraResources`.

### Requirement 7: License, notices and .gitignore (P0)

1. THE Repo SHALL have an MIT `LICENSE`.
2. THE App SHALL show third-party notices.
3. THE `.gitignore` SHALL ignore `node_modules/`, `out/`, `dist/`, `.turbo/`,
   `cache/`, `renders/`, fetched binaries, and every video and audio file
   outside `examples/demo/`, and SHALL NOT ignore `.kiro/`.

### Requirement 8: Footage guard (P0)

**User story:** As a creator, I want the tooling to stop video or audio from
leaving my computer by accident.

1. WHEN a shell command would upload a media file, THE `guard-footage` hook
   SHALL exit 2 with a reason.
2. WHEN a shell command would `git add` a media file outside `examples/demo/`,
   THE `guard-footage` hook SHALL exit 2 with a reason.
3. `scripts/check-no-media.mjs` SHALL fail when git tracks a media file outside
   `examples/demo/`.
4. CI SHALL run `check-no-media.mjs`.

### Requirement 9: CI (P0)

1. `.github/workflows/ci.yml` SHALL run the checks and packaging on `macos-14`
   and `windows-latest`.

### Requirement 10: Hook self-test (P0)

1. THE spec SHALL end with a hook self-test that saves a dummy `.ts` file and
   runs a dummy blocked command.
2. THE self-test SHALL record which hooks fired, whether `PostFileSave` fires on
   agent edits, the stdin field that carries the saved path, and whether
   `shell` is the right matcher name, in
   `.kiro/specs/project-setup/hook-self-test.md`.
