# Tasks: project-setup (spec 1)

Each task ends with one local git commit. The checks hook runs lint, typecheck
and test after each task. Build, e2e and packaging run in task 10.

- [x] 1. Kiro setup
  - Steering files from plan section 25 in `.kiro/steering/`, with their inclusion modes
  - Hooks from section 26 in `.kiro/hooks/`: lint-on-save lints only the saved file, and the per-task check runs lint, typecheck and test
  - Spec documents: requirements.md, design.md, tasks.md
  - _Requirements: 10_

- [ ] 2. Monorepo tooling
  - pnpm workspace (apps/*, packages/*, scripts), turbo.json, tsconfig.base.json
  - ESLint 10 flat config, Prettier 3, Vitest 5
  - MIT LICENSE, .gitignore as in section 21, THIRD_PARTY_NOTICES.md
  - _Requirements: 1.1, 1.2, 1.3, 7.1, 7.3_

- [ ] 3. Shared contracts
  - `@alcyo/ipc`: IPC contract (`app:info`, `worker:ping`, `link:open`, `link:invalid`), worker message schemas, channel names
  - `@alcyo/schema`: `AppLink`, `parseAppLink`, `formatAppLink`, `appLinkToRoute`, with unit tests
  - _Requirements: 3.4, 4.3, 4.4, 5.2_

- [ ] 4. Electron main, preload and worker
  - Locked-down window, CSP, navigation lockdown
  - `handle(channel, fn)` with Zod in and out, plus unit tests
  - Single instance, alcyo:// registration, open-url and argv routing, pending-link queue, plus argv tests
  - utilityProcess worker over a MessagePort, `createWorkerClient` and `serveWorker`, plus a round-trip test
  - Preload exposes only `window.alcyo.invoke` and `on`
  - _Requirements: 3.1, 3.3, 3.4, 3.5, 4.1–4.5, 5.1–5.4_

- [ ] 5. Renderer chat shell
  - React 19, Vite 8, Tailwind 4, TanStack Router (hash history)
  - Sidebar and empty thread in the section 4 visual system
  - Routes from the design, link:open navigation, and the invalid-link banner
  - Settings page with version, license and third-party notices
  - _Requirements: 2.3, 4.5, 4.6, 7.2_

- [ ] 6. Pinned binaries
  - `scripts/binaries.lock.json` with pins and SHA-256 for mac-arm64 and win-x64
  - `scripts/fetch-binaries.ts`: download, verify, extract or build (whisper.cpp with CMake on macOS), manifest, `--verify`
  - Run it on this Mac
  - _Requirements: 6.1–6.4_

- [ ] 7. Footage guard and lint-on-save scripts
  - `scripts/hooks/guard-footage.mjs`, `scripts/check-no-media.mjs` (`--staged` too), `scripts/hooks/lint-file.mjs`
  - `pnpm hooks:install` for the pre-commit layer
  - Unit tests
  - _Requirements: 8.1–8.3_

- [ ] 8. Packaging and end-to-end tests
  - electron-builder.yml: mac dmg arm64 with ad-hoc signing, win nsis x64, protocols, extraResources
  - Playwright Electron tests: no require or process, `window.alcyo` shape, worker round trip, open-url and argv routing, invalid link
  - Run the e2e tests against the packaged app too
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.2, 4.3, 4.4, 5.3_

- [ ] 9. CI
  - `.github/workflows/ci.yml`: matrix of macos-14 and windows-latest, with media check, binaries, checks, e2e, package, artifacts
  - _Requirements: 8.4, 9.1_

- [ ] 10. Final checks and hook self-test
  - Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e` and `pnpm package:mac`
  - In a fresh Kiro CLI session, save a dummy `.ts` file and run a dummy blocked command, then record which hooks fired in hook-self-test.md
  - Answer: does PostFileSave fire on agent edits, what field carries the path, and is `shell` the right matcher
  - _Requirements: 1.1, 2.1, 10.1, 10.2_
