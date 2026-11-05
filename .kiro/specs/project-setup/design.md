# Design: project-setup (spec 1)

Implements requirements.md. Plan references are to docs/build-plan.md v3.

## Overview

The result of this spec is a green monorepo and an Electron app that opens to
an empty chat shell. Nothing streams-related works yet. What it proves:

- the toolchain (pnpm 12, Turborepo 2, TypeScript ~6.0, ESLint 10, Prettier 3,
  Vitest 5, Playwright) runs on a fresh clone;
- the security model (sandboxed renderer, `window.alcyo` only, Zod at every
  boundary) is in place before any feature uses it;
- deep links, single instance and the worker are wired end to end;
- the bundled tools are pinned and checksum-verified;
- packaging works on macOS now and is configured for Windows;
- the Kiro hooks fire the way the plan assumes.

## Workspace layout

```
package.json            root scripts: lint, typecheck, test, build, test:e2e,
                        package:mac, package:win, fetch-binaries, check:media
pnpm-workspace.yaml     apps/*, packages/*, scripts
turbo.json              lint, typecheck, test, build, test:e2e
tsconfig.base.json      strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes,
                        verbatimModuleSyntax, Bundler resolution, ESM
eslint.config.js        one flat config for the repo (typescript-eslint
                        type-checked, react-hooks for the renderer)
.prettierrc.json, .prettierignore
packages/ipc            @alcyo/ipc: IPC contract + worker contract (zod only)
packages/schema         @alcyo/schema: AppLink schema and the one link parser
                        (zod only). Spec 2 fills in the rest of section 22.
apps/desktop            @alcyo/desktop: electron-vite app + electron-builder
scripts                 @alcyo/scripts: fetch-binaries, check-no-media, hook
                        scripts, their tests
```

`packages/media` and `packages/planner` stay empty folders until their specs.
They have no package.json, so pnpm and Turborepo ignore them.

Internal packages export TypeScript source (`"exports": {".": "./src/index.ts"}`)
and have no build step. electron-vite bundles them into main, preload, worker
and renderer. Vitest reads them directly.

`scripts` is a workspace package so `turbo run lint typecheck test` covers it
and the per-task hook needs no extra commands. Scripts run with Node's
built-in type stripping (`node scripts/fetch-binaries.ts`), so no tsx.

## Electron app

### Processes and files

```
apps/desktop/
  electron.vite.config.ts
  electron-builder.yml
  src/main/index.ts        lifecycle, window, single instance, links, protocol client
  src/main/window.ts       BrowserWindow options, navigation lockdown
  src/main/ipc.ts          handle(channel, fn) on top of a pure makeHandler
  src/main/links.ts        findLinkInArgv, pending-link queue (pure)
  src/main/worker-host.ts  utilityProcess fork + MessageChannelMain
  src/worker/index.ts      utilityProcess entry
  src/shared/port.ts       PortLike adapters, createWorkerClient, serveWorker (pure)
  src/preload/index.ts     window.alcyo { invoke, on }
  src/renderer/            React app
  e2e/app.spec.ts          Playwright Electron tests
```

### Window

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
`webSecurity: true`, `spellcheck: false`. `setWindowOpenHandler` denies
everything; `will-navigate` is prevented for anything but the app's own page.
`backgroundColor: #0B0B0B`, so there's no white flash.

CSP is a `<meta>` tag injected into index.html at build time:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
style-src 'self'; img-src 'self' data: blob: alcyo-media:; media-src 'self' blob: alcyo-media:;
font-src 'self' alcyo-media:; connect-src 'self' alcyo-media:; object-src 'none';
base-uri 'none'; form-action 'none'; frame-src 'none'
```

Dev mode skips the meta tag because the Vite dev server needs inline React
refresh code. The packaged app always has it.

### Preload

The renderer runs sandboxed, so the preload has to be CommonJS. electron-vite
builds it as `out/preload/index.cjs`. It exposes:

```ts
window.alcyo = {
  invoke(channel, input): Promise<output>,   // only channels in the contract
  on(event, cb): () => void,                 // only events in the contract
}
```

The preload imports only the list of channel and event names from
`@alcyo/ipc/names`, which has no zod import. That keeps it small. Main does all
the validation.

### IPC contract (spec 1 subset)

`packages/ipc/src/contract.ts` has the same shape as section 10. Spec 1 has
these channels:

| Channel | Input | Output |
|---|---|---|
| `app:info` | `{}` | `{ name, version, platform, arch, electron }` |
| `worker:ping` | `{ text: string ≤ 1000 }` | `{ text, ms }` |

Events (main to renderer), each with a Zod payload schema:

| Event | Payload |
|---|---|
| `link:open` | `{ link: AppLink }` |
| `link:invalid` | `{ message: string }` |

Later specs add the section 10 channels. Section 10 lists no event for a bad
link, so `link:invalid` is added here; the renderer shows the plain message
from section 5.

`handle(channel, fn)` checks that the sender is the app's own frame, parses the
input with the channel's schema, runs `fn`, and parses the output too. A
failure rejects the invoke with a short message and never runs `fn`. The parse
and run logic lives in the pure `makeHandler`, which unit tests call without
Electron.

### Deep links

- `app.requestSingleInstanceLock()`. A second instance quits right away; the
  first one gets `second-instance` with argv.
- Registration: in packaged builds `app.setAsDefaultProtocolClient("alcyo")`,
  plus electron-builder `protocols` (Info.plist on macOS, registry keys from
  the nsis installer on Windows). Dev runs don't register, so a dev Electron
  never becomes the system handler.
- Sources: macOS `open-url` (registered before `ready`), Windows and Linux
  `second-instance` argv and the first launch's `process.argv`.
- `findLinkInArgv(argv)` returns the first argument that starts with
  `alcyo://`, ignoring case.
- `parseAppLink(url)` (packages/schema) turns the URL into an `AppLink` (section
  22) or `null`. It's the one link parser. `formatAppLink` and
  `appLinkToRoute` sit beside it.
- Links that arrive before the renderer has loaded are queued and flushed on
  `did-finish-load`. Each link focuses the window (restoring it if minimized)
  and sends `link:open`, or `link:invalid` with "That link doesn't point to
  anything in this app."

URL grammar, matching section 5 (a trailing slash is ignored, and segments are
URI-decoded):

```
alcyo://s/<id>                              stream
alcyo://s/<id>/m/<mid>                      message
alcyo://s/<id>/short/<sid>                  short (latest)
alcyo://s/<id>/short/<sid>/v/<n>            version
alcyo://s/<id>/short/<sid>/v/<n>/edit       editor
alcyo://s/<id>/source[?t=<ms>]              source moment
alcyo://renders | alcyo://settings | alcyo://settings/profile
```

### Worker

`apps/desktop/src/worker/index.ts` is built as a second main-process entry and
imported in main with electron-vite's `?modulePath`. Start-up:

1. Main forks it with `utilityProcess.fork(path, [], { serviceName: "Alcyo worker" })`.
2. Main makes a `MessageChannelMain`, keeps `port2`, and posts `port1` to the
   child in a `{ type: "init" }` message.
3. The worker takes the port, serves requests on it, and posts `{ type: "ready" }`.

Contract (`packages/ipc/src/worker.ts`):

```ts
MainToWorker = discriminatedUnion("type", [
  { type: "ping", id, text },
])
WorkerToMain = discriminatedUnion("type", [
  { type: "ready" },
  { type: "pong", id, text },
  { type: "error", id?, message },
])
```

Both sides parse every message they receive. A message that fails its schema
is dropped and logged, and if it had an id the worker answers with `error`.
`createWorkerClient(port)` matches replies to requests by id, with a 10 s
timeout, and rejects pending calls if the worker exits. Main forks a new
worker for the next request after an exit. The client and server only see a
`PortLike` interface (`send`, `onMessage`), so the round-trip test can run them
on a Node `MessageChannel`. The Playwright test runs the same round trip in the
real app through `worker:ping`.

### Renderer

React 19, Vite 8, Tailwind 4 (`@tailwindcss/vite`), and TanStack Router with
hash history and code-based routes:

| Route | Shows |
|---|---|
| `/` | empty thread: "Paste a stream link or drop in a recording to start." |
| `/s/$streamId` and everything below it | thread placeholder with the stream id in the header pill: "This stream isn't in the app yet." |
| `/renders` | "No renders yet." |
| `/settings` | app version, license, third-party notices |
| `/settings/profile` | "No creator profile yet." |
| not found | "That link doesn't point to anything in this app." |

The layout follows section 4 and ui.md. The sidebar is 340 px wide (`#0F0F0F`):
search and + at the top, the creator header, an empty list ("No streams yet"),
and at the bottom a profile row (links to `/settings/profile`) and a render
queue button (links to `/renders`). The thread has a floating header pill, a
centred empty state, and a composer with +, "Message Alcyo" and send. Send stays
disabled until spec 10. `link:open` calls `router.history.push(appLinkToRoute(link))`.
`link:invalid` shows a dismissible banner.

Third-party notices are in `THIRD_PARTY_NOTICES.md` at the repo root. The
renderer imports the file with `?raw`, and electron-builder copies it into the
package's resources.

## Binaries

`scripts/binaries.lock.json` pins each tool per target (`mac-arm64`, `win-x64`):

| Tool | macOS arm64 | Windows x64 |
|---|---|---|
| ffmpeg, ffprobe | static arm64 build with libass, libx264 and VideoToolbox; zip per tool, SHA-256 pinned | gyan.dev essentials build (GitHub mirror `GyanD/codexffmpeg`), SHA-256 pinned |
| whisper-cli | built with CMake from the pinned whisper.cpp tag's source tarball (SHA-256 pinned), Metal on, static libs | `whisper-bin-x64.zip` from the same tag, SHA-256 pinned |
| yt-dlp | `yt-dlp_macos` from the pinned release, SHA-256 pinned | `yt-dlp.exe`, SHA-256 pinned |
| Silero VAD | `ggml-silero-v5.1.2.bin` from `ggml-org/whisper-vad`, SHA-256 pinned | same |

`node scripts/fetch-binaries.ts [--target mac-arm64|win-x64] [--verify]`:

1. Downloads each artifact into `.cache/binaries/` (gitignored), reusing any
   cached copy whose checksum matches.
2. Verifies SHA-256. On a mismatch it stops with: file, expected, actual, and
   "Delete .cache/binaries/<file> and run again; if it still fails, the
   upstream file changed. Check it, then update scripts/binaries.lock.json."
3. Extracts or builds into `apps/desktop/resources/bin/<target>/` (gitignored)
   and writes `manifest.json` with each output's SHA-256 and the lock entry.
4. `--verify` checks that every expected file is present and matches
   `manifest.json`, without downloading anything. `package:mac` and
   `package:win` run it first, so a package can't ship without its tools.

Every child process (curl isn't used; `fetch` downloads, `tar`/`unzip`/`cmake`
are spawned with args arrays) follows tech.md. In dev, main resolves binaries
from `ALCYO_BIN_DIR`, falling back to `resources/bin/<target>`. When packaged,
it uses `process.resourcesPath/bin`. Only the path resolver is written now;
spec 3 uses it.

## Packaging

`apps/desktop/electron-builder.yml`:

- `appId: dev.alcyo.shorts`, `productName: Alcyo Shorts`.
- `files`: `out/**` and package.json only. Every runtime library is a
  devDependency bundled by electron-vite, so the package ships no
  node_modules. This avoids pnpm symlink problems in electron-builder.
- `extraResources`: `resources/bin/${os}-${arch}` to `bin`, plus
  `THIRD_PARTY_NOTICES.md` and LICENSE.
- `protocols: [{ name: Alcyo link, schemes: [alcyo] }]`.
- mac: `target: dmg`, `arch: arm64`, `identity: "-"` (ad-hoc), hardened runtime
  off (an ad-hoc build can't be notarized), category video.
- win: `target: nsis`, `arch: x64`; nsis `oneClick: false`, per-user install.
- `npmRebuild: false`. There are no native modules.

## Footage guard (three layers)

1. **Kiro `guard-footage` hook**, PreToolUse on `shell`. `scripts/hooks/guard-footage.mjs`
   reads the hook JSON from stdin and takes `tool_input.command` (falling back
   to other string fields). It exits 2 with a reason when:
   - an upload tool (`curl` with `-T`/`--upload-file`/`-F`/`--form`/`-d @`/
     `--data-binary @`, `wget --post-file`, `scp`, `rsync`, `sftp`, `rclone`,
     `aws s3`, `gsutil`, `az storage`, `gh release upload`, `gh gist`,
     `ftp`/`lftp`, `nc`) names a media file or a media glob;
   - ffmpeg writes to a network output (`rtmp://`, `rtmps://`, `srt://`,
     `udp://`, `tcp://`, `http(s)://` as output, `-f flv rtmp`);
   - `git add` names a media file outside `examples/demo/`, or `git add -f`/
     `--force` is used with a media path; for `git add .`/`-A`/`--all`/a folder,
     it asks git which untracked or modified media files outside
     `examples/demo/` that path would add (`git add --dry-run`) and blocks if
     there are any.
   Everything else exits 0. A pure `checkCommand(command, deps)` is exported
   for tests.
2. **Pre-commit**: `node scripts/check-no-media.mjs --staged` checks the
   index. `pnpm hooks:install` writes `.git/hooks/pre-commit`. It doesn't
   change git config.
3. **CI**: `node scripts/check-no-media.mjs` checks `git ls-files` and fails,
   listing the paths, if any media file is tracked outside `examples/demo/`.

The media extensions live in one list in `scripts/media-extensions.mjs`:
video `mp4 mov mkv webm avi m4v flv wmv mpg mpeg m2ts 3gp`, audio `wav mp3 m4a
aac flac ogg oga opus wma aif aiff caf`. `.ts` and `.mts` are left out on
purpose because they are TypeScript here.

## Lint on save

`scripts/hooks/lint-file.mjs` reads the hook stdin JSON and finds the saved
path in the first field that exists: `file_path`, `filePath`, `path`,
`tool_input.path`, `tool_input.file_path`, `paths[0]`. It resolves the path
inside the repo and skips anything outside it, anything that isn't
`.ts`/`.tsx`, and anything that no longer exists. Then it runs
`eslint --fix <file>` and `prettier --write <file>` on that one file. It never
lints the repo. Remaining lint errors go to stderr with a non-zero exit
(non-blocking). Every run appends the raw payload's keys and the chosen path
to `.hook-log/events.jsonl` (gitignored), which is how the self-test finds the
real field name.

## CI

`.github/workflows/ci.yml`, on push and pull_request, with a matrix of
`macos-15` and `windows-latest`. Steps: checkout, pnpm (from `packageManager`),
Node 24 with the pnpm cache, `pnpm install --frozen-lockfile`, `pnpm
check:media`, `pnpm fetch-binaries`, `pnpm lint`, `pnpm typecheck`, `pnpm
test`, `pnpm build`, `pnpm test:e2e`, `pnpm package:mac` or `package:win`, and
an upload of the dmg or exe as an artifact. Releases on tag (release.yml) come
with spec 13.

## Testing strategy

| What | How |
|---|---|
| Link parsing, formatting, routes | Vitest, packages/schema (spec 2 adds the fast-check round-trip property) |
| IPC handler validation | Vitest on `makeHandler`: bad input rejected and fn not called; bad output rejected |
| Worker round trip | Vitest: `serveWorker` and `createWorkerClient` over a Node `MessageChannel`, one ping and pong; bad messages dropped; timeout |
| argv parsing | Vitest on `findLinkInArgv` with Windows-style argv |
| Renderer has no `require`/`process`; `window.alcyo` has only `invoke` and `on` | Playwright Electron |
| Worker round trip in the real app | Playwright: `worker:ping` |
| `open-url` routing (macOS) and `second-instance` argv routing (Windows path) | Playwright: emit the events in main, check the renderer's hash route and the invalid-link banner |
| Packaged app opens to the empty shell | Playwright against the packaged executable (`ALCYO_E2E_EXECUTABLE`) |
| guard-footage, check-no-media, lint-file path extraction | Vitest in @alcyo/scripts |
| Hook behaviour in Kiro | the self-test, recorded in hook-self-test.md |

The Playwright tests run in `pnpm test:e2e`, not in `pnpm test`. They need a
build, and the per-task hook mustn't build. They run at the end of the spec
and in CI.

## Decisions and deviations

- **MCP config**: section 27 says `.kiro/settings/mcp.json` is added after spec
  12. This run was asked to write it now, but a workspace permission rule
  blocks writes to that file. It's left for the user (see the report).
- **Hook timeouts** are at hook level (`hooks[].timeout`), as in the plan and
  the Kiro hook field reference. The hook-creation tool put them inside
  `action`, and that was corrected.
- **Stop hook prompt**: changed so the per-turn reminder asks for lint,
  typecheck and test, and build plus packaging only when a spec is finished.
  This matches the "full build at the end of a spec" fix.
- **`link:invalid` event**: added beside `link:open` for the malformed-link
  message.
- **AppLink and the link parser** are written in packages/schema now, because
  spec 1 routes links. Spec 2 owns the rest of that package and adds the
  property test.
- **Silero model** is downloaded with a pinned checksum instead of being
  committed. It stays out of git and goes into the same bin folder. The pin is
  v6.2.0, the newer of the two models whisper.cpp v1.9.5's download script
  offers.
- **Pins** (Nov 1, 2026): ffmpeg/ffprobe 9.0.2 (martin-riedl.de arm64 build;
  gyan.dev essentials for Windows), whisper.cpp v1.9.5 (Windows zip from
  release b5454, the same commit), yt-dlp 2026.10.26.
- **macOS minimum is 13.3**, not 12. whisper.cpp's Accelerate path uses
  `cblas_sgemm`, which needs 13.3. That's set in the CMake flags and in
  electron-builder's `minimumSystemVersion`.
- **Windows packaging is checked in CI only.** A cross-build on this Mac got
  as far as `win-unpacked` with every tool in `resources/bin`, then failed
  because electron-builder's macOS `makensis` is an x86_64 binary and Rosetta
  isn't installed (spawn error -86). This is a host limitation, not a config
  error.
- **Kiro CLI engine**: kiro-cli 2.34 defaults to the V2 engine, which ignores
  `.kiro/hooks/*.json`. Run spec work with `kiro-cli chat --v3`, as recorded
  in hook-self-test.md.
- **Prettier in packages** gets the root `.gitignore` and `.prettierignore`
  through `--ignore-path`, because Prettier 3 only reads ignore files from the
  working directory.
