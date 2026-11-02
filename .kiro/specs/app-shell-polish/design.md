# Design: app-shell-polish

## Overview

The renderer gets a navigation layer (history-aware Back, keyboard and mouse
shortcuts, window title), real Setup and Settings screens fed by a new
`setup:check` channel, guiding empty states, and a visual pass. Setup checks
spawn processes, so they run in the worker, as the plan's architecture says.
The `claude` resolver lives in `packages/planner/src/llm/claude-locate.ts`,
where spec 5 will extend it.

## Routes

| Route | Screen | Header / title | alcyo:// |
|---|---|---|---|
| `/` | Home thread, welcome empty state | "New stream" | none (home) |
| `/s/$streamId`, `/s/$streamId/$` | Stream thread placeholder | stream id | as in section 5 |
| `/setup` | Setup (full window, no sidebar) | "Setup" | `alcyo://setup` |
| `/settings` | Settings, Profile section selected | "Settings" | `alcyo://settings` |
| `/settings/profile` | Settings, Profile | "Settings · Profile" | `alcyo://settings/profile` |
| `/settings/$section` | Settings, claude, models, encoder, storage, about | "Settings · <Section>" | `alcyo://settings/<section>` |
| `/renders` | Render queue drawer over home | "Render queue" | `alcyo://renders` |
| anything else | Not found, with Back and Go home | "Not found" | none |

`AppLink` gains `{ to: "setup" }` and an optional `section` on
`{ to: "settings" }` (claude, models, encoder, storage, about). Profile keeps
its own `{ to: "profile" }`. This is a deviation from the section 22 sketch,
made so the hard rule "everything has a route and an alcyo:// link" holds for
the new screens.

The render queue is a route that draws a drawer over the home thread, so
`alcyo://renders`, Back and Esc all behave like any other screen. In this spec
the drawer always sits over home, because streams don't exist yet. When spec
10 adds real streams, the drawer can move to a search param kept across
routes, so the stream stays underneath.

## Navigation layer (`renderer/src/nav/`)

- `useBack()`: `router.history.canGoBack()` ? `history.back()` : navigate `/`.
- `useNavShortcuts()` on the root layout:
  - Cmd+[ / Cmd+] on macOS; Ctrl+[ / Ctrl+] and Alt+Left / Alt+Right on
    Windows; mouse buttons 3 and 4 (`mouseup`, `button === 3 | 4`).
  - Cmd/Ctrl+, opens Settings. Cmd/Ctrl+F opens sidebar search.
  - Esc: an overlay registry (a small zustand store, a stack of close
    functions) closes the top overlay. With none open, non-thread screens call
    `useBack()`. Esc inside a text field with text only blurs it.
- `usePageTitle(place)`: sets `document.title` to `<place> · Alcyo Shorts`;
  Electron mirrors it to the window title.
- `ScreenHeader`: Back button (arrow, "Back"), title, optional right actions.
  On macOS full-window screens (Setup) it pads 84 px for the traffic lights.

## Setup checks

### Contract (`packages/ipc`)

```ts
const CheckState = z.enum(["pass", "fail", "pending"]);
const Check = z.object({
  id: z.enum(["claude", "claude-auth", "ffmpeg", "ffprobe", "whisper-cli", "yt-dlp",
              "vad", "ffmpeg-features", "whisper-model"]),
  label: z.string(), state: CheckState, required: z.boolean(),
  detail: z.string().max(300),          // path, version: what was found
  fix: z.string().max(300).nullable(),  // one line, set when state is fail or pending
});
const SetupReport = z.object({
  checkedAt: z.iso.datetime(), complete: z.boolean(), checks: z.array(Check),
  claude: z.object({ path: z.string().nullable(), via: z.enum(["known-folder",
    "login-shell", "where", "none"]), version: z.string().nullable(),
    signedIn: z.boolean().nullable() }),
  tools: z.array(z.object({ name: z.string(), path: z.string(), version: z.string().nullable() })),
  encoders: z.array(z.string()),       // H.264 encoders the bundled ffmpeg lists
  whisperModel: z.object({ name: z.enum(["small.en", "base.en"]), path: z.string(),
    present: z.boolean() }),
});
"setup:check": { input: z.object({ fresh: z.boolean().optional() }), output: SetupReport }
"app:paths":   { input: z.object({}), output: { userData, models, bin } }
"shell:openDataFolder": { input: z.object({}), output: z.object({}) }
```

`app:info` adds `chrome` and `node` versions. `setup:check` with
`fresh: false` returns the cached report from main (or runs one); `fresh: true`
always reruns. Main starts one check at launch so the first screen rarely
waits.

`complete` is true when every `required` check passes. Required: claude,
claude-auth, ffmpeg, ffprobe, whisper-cli, yt-dlp, vad, ffmpeg-features.
whisper-model is `pending` with "Comes in spec 5", not required.

### Worker side

New worker messages `setup-check` / `setup-report` (Zod-checked like ping).
`apps/desktop/src/worker/setup.ts` runs, in parallel:

- `locateClaude(deps)` from `@alcyo/planner`:
  1. Saved path: none until spec 5 adds settings.json.
  2. Known folders. macOS: `~/.local/bin/claude`, `~/.claude/local/claude`,
     `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`. Windows:
     `%USERPROFILE%\.local\bin\claude.exe`, `%LOCALAPPDATA%\Microsoft\WinGet\Links\claude.exe`.
     Each is only `stat`ed and then run with `-v`; nothing under `~/.claude`
     is read.
  3. macOS: `execFile(SHELL ?? "/bin/zsh", ["-ilc", "command -v claude"],
     { timeout: 5000 })`, last absolute-path line of stdout.
  4. Windows: `execFile("where.exe", ["claude"])`; `.exe` only, a `.cmd`
     gives "Install the native Claude Code".
  Deps (`exists`, `run`) are injected so unit tests run on any OS.
- `claude auth status` with the two env vars removed, 10 s timeout. Only the
  exit code is used.
- For each tool, `stat` plus a version run: `ffmpeg -version`,
  `ffprobe -version`, `whisper-cli --version`, `yt-dlp --version`, all
  `execFile` with args arrays and a 15 s timeout. VAD: the file
  `models/ggml-silero-v6.2.0.bin` exists.
- `ffmpeg -hide_banner -filters` has `subtitles`; `-encoders` has `libx264`;
  H.264 encoders are parsed from `-encoders`.
- Whisper model: `<userData>/models/ggml-<name>.bin` exists. `small.en` on
  macOS arm64, `base.en` on Windows.

Main passes `binDir`, `userData`, `platform` and `env` to the worker in the
request; the worker has no Electron app API.

Fix lines (plain, one each):

| Check | Fix |
|---|---|
| claude missing | Install Claude Code from claude.com/product/claude-code, then press Check again. |
| claude is a .cmd | Install the native Claude Code (claude.exe), then press Check again. |
| not signed in | Run `claude` in a terminal and sign in, then press Check again. |
| tool missing | Reinstall Alcyo Shorts. Building from source? Run `pnpm fetch-binaries`. |
| tool won't run | Same as missing. |
| ffmpeg features | This ffmpeg lacks libass or libx264. Run `pnpm fetch-binaries` to get the pinned build. |

### Headless test seam

`ALCYO_HEADLESS=1`: the window is created with `show: false` and never shown,
`backgroundThrottling` off, and on macOS `app.dock.hide()`. Only in headless
mode, `ALCYO_TEST_SETUP=pass|fail` makes main answer `setup:check` from a
fixture (`main/setup-fixture.ts`) instead of the worker. The real checks are
unit-tested with fakes and run in the screenshot pass.

### Startup gate

`renderer/src/setup/store.ts` (zustand) holds the report and a `skipped`
flag. The root layout shows a short splash (app mark, "Checking your
setup…") until the first report arrives. If the first location is `/` and
`complete` is false and not skipped, it replaces the location with `/setup`.
Continue and Skip for now go home. Skip lasts for this session only; the next
launch checks again. While incomplete, the sidebar shows a "Finish setup" row.

## Screens

- **Sidebar.** 84 px left inset on macOS for the traffic lights; search and +
  at top right. Header: app mark plus "Alcyo Shorts" and "No profile yet".
  Stream list or empty state ("No streams yet", how to start, New stream).
  Search box: input with clear and Esc, filters the stream list, shows
  "No streams match" when nothing does. Footer: setup row when incomplete;
  user row (app mark avatar, "Settings", "Profile, Claude, models"), grid
  button with active state.
- **Home.** Floating pill "New stream". Center: app mark, "Turn a stream into
  shorts", three numbered steps (paste or drop, analyzed here, Claude
  proposes), action buttons. Composer: + menu (Paste a link, Choose a file),
  placeholder "Paste a stream link or drop a recording".
- **Drop target.** Window-level dragenter/over/leave/drop; overlay with dashed
  border. Drop shows the spec 6 toast. `dragover` and `drop` always
  `preventDefault`, so the window never navigates.
- **Toasts.** zustand store, bottom center, `role="status"`, 4 s, Esc closes.
- **Setup.** Full window. Header with Back, title "Set up Alcyo Shorts". Groups
  "Claude", "Bundled tools", "Models", each row with state icon, label,
  detail, fix line, and a copy button for commands in the fix. Footer: Check
  again, Skip for now, Continue.
- **Settings.** Header with Back and "Settings". Left rail of six sections
  (links, `aria-current`), right pane with cards of label/value rows. A
  `ComesIn` chip renders "Comes in spec N".
- **Render queue drawer.** Right drawer 420 px with a scrim over the thread
  area only, so the sidebar and its grid button stay usable (the drawer isn't
  modal, so Tab isn't trapped). Focus moves to Close on open and back on
  close. Empty state: "No renders yet", how renders get there, and
  "Comes in spec 9".
- **Esc order.** Topmost overlay first, then leaving a focused text field,
  then the screen's Esc action (Back on non-thread screens).
- **Not found.** Plain bad-link message, Back and Go home.

## App icon

`apps/desktop/build/icon.svg` is the source: a rounded square with a dark
blue-violet gradient, a 9:16 frame and a four-point star (Alcyone, the
brightest Pleiad). `scripts/render-icon.ts` renders it to `build/icon.png`
(1024 px) with headless Electron; electron-builder makes the icns and ico.
The renderer uses the same mark as an inline SVG component.

## Testing

- Unit: `claude-locate` (order, login-shell parsing, Windows `.cmd`, no
  candidates), setup report assembly with fake runners (fix lines, required
  vs pending, `complete`), env scrubbing, `AppLink` setup/section cases,
  handlers for the new channels, fixture shape.
- E2E (headless, `ALCYO_TEST_SETUP=pass`): every route from the sidebar and
  back by Back, Esc and Cmd+[; mouse back button; window title; search filter
  UI; drawer open and Esc; drop shows the toast and doesn't navigate; pasted
  URL toast. A second launch with `fail` opens to Setup and Skip goes home.
- Screenshots: `e2e/screens.spec.ts` (tag `@screens`, excluded from
  `test:e2e`), run with `pnpm --filter @alcyo/desktop screens`, writing PNGs to
  `.agent-runs/screens/pass2/`.
