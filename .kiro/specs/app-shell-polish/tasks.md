# Tasks: app-shell-polish

Each task ends with lint, typecheck and test, then one local commit. Build,
e2e, screenshots and packaging run in task 8.

- [x] 1. Spec documents
  - requirements.md (EARS), design.md, tasks.md
  - _Requirements: all_

- [x] 2. Headless mode for tests
  - `ALCYO_HEADLESS=1`: never show the window, hide the Dock icon, no background throttling
  - e2e launches headless; `test:e2e` excludes `@screens`
  - _Requirements: 6.1, 6.2_

- [x] 3. Links and routes for the new screens
  - `AppLink`: `setup`, settings `section`; parser, formatter, route, tests
  - Routes: `/setup`, `/settings/$section`, `/renders` drawer, not found with Back
  - _Requirements: 1.7_

- [x] 4. Navigation layer
  - `useBack`, `ScreenHeader`, overlay stack and Esc, Cmd+[ / Cmd+], Alt+arrows, mouse buttons, Cmd+, and Cmd+F
  - Page titles on every screen
  - _Requirements: 1.1–1.6_

- [x] 5. Setup checks
  - `@alcyo/planner` with `llm/claude-locate.ts` and tests
  - Worker `setup-check` message and `worker/setup.ts` with tests
  - IPC `setup:check`, `app:paths`, `shell:openDataFolder`, `app:info` versions; handlers and tests; headless fixture
  - _Requirements: 3.1–3.5, 3.8, 3.9, 6.3_

- [x] 6. Setup and Settings screens
  - Setup screen with Check again, Continue, Skip for now; startup gate and splash
  - Settings with six sections and real state, "Comes in spec N" chips
  - _Requirements: 2.1–2.7, 3.5–3.7_

- [ ] 7. Sidebar, empty states and visuals
  - App mark component and `build/icon.svg` / `icon.png`
  - Sidebar: traffic-light inset, header, empty state, search box, setup row, footer
  - Home welcome, composer + menu, paste/send URL toast, drop target and toast
  - Render queue drawer, toasts, hover/active/focus states
  - _Requirements: 4.1–4.4, 5.1–5.7_

- [ ] 8. E2E, screenshots and review
  - e2e: every route and back (Back, Esc, Cmd+[), mouse back, titles, search, drawer, drop, paste, Setup gate with `fail`
  - `e2e/screens.spec.ts` to `.agent-runs/screens/pass2/`; review and fix
  - Full build, `pnpm test:e2e`, `pnpm package:mac`, e2e on the packaged app
  - _Requirements: 1.8, 6.4_
