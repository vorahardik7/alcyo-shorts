---
inclusion: always
---
# Tech

- Electron 45, electron-vite 6, electron-builder 26: dmg (macOS arm64),
  nsis (Windows x64). Both build from spec 1 on, locally and in CI.
- Renderer: React 19, Vite 8, TanStack Router (hash history), Tailwind 4,
  zustand 5, JASSUB.
- Node 22+, pnpm workspaces, Turborepo. TypeScript ~6.0 (typescript-eslint
  doesn't support 7 yet), strict, noUncheckedIndexedAccess,
  exactOptionalPropertyTypes, verbatimModuleSyntax. ESM.
- Zod 4 at every boundary: IPC, worker messages, files, deep links, LLM
  output, ffprobe, whisper and yt-dlp output. z.toJSONSchema for Claude.
- All times are integer milliseconds.
- Storage: JSON files, atomic writes (temp, fsync, rename; retry on Windows
  EPERM/EBUSY). messages.jsonl is append-only. No database, no native modules.
- Jobs run in one utilityProcess. Main owns IPC, the store, protocols.
- Bundled: ffmpeg, ffprobe, whisper-cli, yt-dlp, Silero VAD, pinned in
  scripts/binaries.lock.json. Whisper models download on first run.
- Claude: see claude.md. Backup: @anthropic-ai/sdk, key in safeStorage.
- Tests: Vitest 5, fast-check 4, Playwright Electron. ESLint 10 flat
  config, typescript-eslint, Prettier.

## Child processes
- spawn/execFile with an args array. Never a shell string.
- yt-dlp: --no-config, and "--" before the URL.
- Build ffmpeg args in pure functions.
- Windows: spawn claude.exe, grok.exe, codex.exe; never shell: true.
- The one allowed shell use: on macOS, execFile($SHELL, ["-ilc",
  "command -v <bin>"]) to find an agent, where <bin> is the fixed name
  claude, grok or codex. Fixed args, 5 s timeout.

## Checks
pnpm lint && pnpm typecheck && pnpm test && pnpm build
