# Requirements: app-shell-polish

Source: Hardik's review of the spec 1 build ("going to profile and stuff
doesn't open anything and can't go back either"), docs/build-plan.md v3
sections 3, 4, 5, 10 and 16, and spec 5's setup checks that can run today.
Depends on spec 1. Runs before spec 2.

## Introduction

Spec 1 left a shell that looks like a scaffold: Profile opens a dead-end page,
nothing has a back control, the sidebar shows a gray "A" and a "?" avatar, and
every area is blank. This spec makes the shell feel finished without building
features that belong to later specs. Every screen is reachable, every screen
can be left, settings show real state from the main process, first run opens
to a working Setup screen, and the empty states say what to do next.

## Glossary

- **App**: the Electron desktop app in `apps/desktop`.
- **Main**: the Electron main process. **Worker**: the utilityProcess.
- **Renderer**: the React UI.
- **Thread screen**: `/` (home) or a stream route under `/s/<streamId>`.
- **Non-thread screen**: Setup, Settings (any section), and the not-found page.
- **Overlay**: the render queue drawer, the sidebar search box, a toast.
- **Setup report**: the result of the setup checks, sent from Main.
- **Required check**: a check that must pass for setup to be complete.
- **Headless mode**: the App started with `ALCYO_HEADLESS=1`; the window is
  never shown. Used by e2e tests and screenshot runs.

## Requirements

### Requirement 1: Navigation that always works (P0)

**User story:** As a creator, I want to reach every screen and always get back,
so that I never get stuck.

1. THE Sidebar SHALL give access to home, Settings (every section), the render
   queue and, WHILE setup is incomplete, Setup.
2. EVERY non-thread screen SHALL show a visible Back control in its header.
3. WHEN Back is pressed and there is an earlier in-app history entry, THE
   Renderer SHALL go back one entry; IF there is none, THE Renderer SHALL go
   home.
4. WHEN Esc is pressed, THE Renderer SHALL close the topmost overlay; IF no
   overlay is open and a non-thread screen is shown, THE Renderer SHALL act as
   Back.
5. WHEN Cmd+[ or Cmd+] (Ctrl+[ / Ctrl+], Alt+Left / Alt+Right on Windows) is
   pressed, or the mouse back or forward button is clicked, THE Renderer SHALL
   go back or forward in TanStack Router history.
6. WHILE a screen is shown, THE window title SHALL name it, as
   `<place> · Alcyo Shorts`, and the screen header SHALL name it too.
7. THE App SHALL give Setup and each Settings section a route and an
   `alcyo://` link (`/setup`, `/settings/<section>`).
8. An e2e test SHALL visit every route from the Sidebar and return to the
   previous screen with Back, Esc and Cmd+[.

### Requirement 2: Settings as a real screen (P0)

**User story:** As a creator, I want Settings to show what the app knows about
my computer, so that I can see what works and what doesn't.

1. THE Settings screen SHALL have sections Profile, Claude, Models, Encoder,
   Storage and About, with a section list and a content pane.
2. THE Claude section SHALL show whether `claude` was found, its path, how it
   was found, its version and whether it's signed in, from the Setup report.
3. THE Models section SHALL show the whisper model for this OS and whether it's
   downloaded, and whether the bundled VAD model is present.
4. THE Encoder section SHALL show the bundled ffmpeg's version, whether it has
   libass `subtitles` and libx264, and which H.264 encoders it lists.
5. THE Storage section SHALL show the data folder path and the models folder
   path, and SHALL open the data folder in Finder or Explorer on request.
6. THE About section SHALL show the app name and version, OS, CPU, Electron,
   Chromium and Node versions, the bundled tools with versions, the license
   and third-party notices.
7. WHERE a feature isn't built yet, THE section SHALL say "Comes in spec N" in
   one plain line next to that item, and SHALL NOT show an empty page.

### Requirement 3: First-run Setup (P0)

**User story:** As a new user, I want the app to check my computer first and
tell me how to fix anything missing.

1. THE Worker SHALL find `claude` in the plan's order: known folders for the
   OS, then on macOS `execFile($SHELL, ["-ilc", "command -v claude"])` with a
   5 s timeout, then on Windows `where.exe claude`. A candidate works when
   `claude -v` exits 0.
2. ON Windows, THE Worker SHALL only accept `claude.exe`; a `.cmd` shim SHALL
   fail with "Install the native Claude Code".
3. THE Worker SHALL run `claude auth status` with `ANTHROPIC_API_KEY` and
   `ANTHROPIC_AUTH_TOKEN` removed from its environment; exit 0 means signed in.
   THE App SHALL NOT read or show that command's output.
4. THE Worker SHALL check that ffmpeg, ffprobe, whisper-cli, yt-dlp and the
   Silero VAD model are in the bundled bin folder and that each tool runs, and
   that ffmpeg has the `subtitles` filter and libx264.
5. EVERY failed check SHALL show one line saying how to fix it.
6. THE Setup screen SHALL offer Check again, Continue (enabled when every
   required check passes) and Skip for now.
7. WHEN the App starts on `/` and a required check fails, THE Renderer SHALL
   open Setup instead of home, unless setup was skipped this session.
8. THE whisper model download SHALL show as "Comes in spec 5" and SHALL NOT
   block setup.
9. THE code SHALL NOT read `~/.claude` or Claude's Keychain entry, offer a
   Claude login, or pass Claude tokens; spawning uses args arrays with no
   shell, except the one login-shell lookup.

### Requirement 4: Empty states that guide (P0)

**User story:** As a creator opening the app for the first time, I want to
know what to do next.

1. WHILE there are no streams, THE Sidebar SHALL explain how to start and
   offer a New stream action.
2. THE home thread SHALL explain the flow and offer Paste a stream link,
   Choose a file and Open the demo stream.
3. WHEN a URL is pasted or sent in the composer, or a file is dropped on the
   window, THE Renderer SHALL show a toast saying import comes in spec 6.
4. WHEN a file is dragged over the window, THE Renderer SHALL show a drop
   target; dropping SHALL NOT navigate the window.

### Requirement 5: Visual quality (P0)

**User story:** As a creator, I want the app to look finished.

1. THE Renderer SHALL use the section 4 colors, font stack and sizes.
2. THE Sidebar SHALL show the Alcyo app mark where no profile avatar exists,
   and SHALL NOT show a "?" avatar or a gray letter circle.
3. THE packaged app SHALL have an Alcyo app icon.
4. EVERY interactive element SHALL have hover, active and keyboard focus-ring
   states.
5. ON macOS, THE Sidebar top bar and full-window headers SHALL leave room for
   the traffic lights.
6. THE Sidebar search box SHALL open from the search button or Cmd/Ctrl+F,
   filter the stream list, and close with Esc.
7. THE grid button SHALL open a render queue drawer with an empty state;
   `/renders` and `alcyo://renders` SHALL open the same drawer.

### Requirement 6: Tests run without windows (P0)

1. IN headless mode, THE App SHALL never show its window or its Dock icon.
2. E2E tests and screenshot runs SHALL run in headless mode.
3. IN headless mode, `ALCYO_TEST_SETUP` SHALL choose a fixed Setup report
   (`pass`, `fail`) so tests don't depend on the machine; `real` or unset runs
   the real checks.
4. A screenshot run SHALL save every screen to `.agent-runs/screens/pass2/`.
