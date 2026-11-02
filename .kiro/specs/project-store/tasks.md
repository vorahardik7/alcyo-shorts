# Tasks: project-store (spec 4)

Each task ends with lint, typecheck and test, then one local commit.

- [x] 1. Spec documents
  - requirements.md, design.md, tasks.md
  - _Requirements: all_

- [x] 2. Store package
  - `@alcyo/store`: files (moved from media), hash, ids, names, layout,
    messages, streams index, settings, project store, draft saver
  - Schema: `Settings.streamsDir`; `AnalysisRequest.model` nullable
  - Unit tests
  - _Requirements: 1.1–1.4, 2.1–2.3, 3.1–3.3, 4.1–4.3, 5.1–5.3, 6.1, 6.2, 7.4_

- [x] 3. Main service and IPC
  - Contract channels and events; handlers; `StreamService` with the job
    queue, throttled status messages and finish bookkeeping
  - Tests with a fake worker
  - _Requirements: 7.1–7.4, 8.1, 8.2_

- [x] 4. UI
  - Sidebar list, Choose a file, stream thread with status messages and
    Cancel, Locate file, Storage settings
  - _Requirements: 8.3–8.5_

- [x] 5. e2e, real run and wrap-up
  - Playwright import test; the real-recording run; screenshots
  - Full build, `pnpm test:e2e`, `pnpm package:mac`; plan section 36
  - _Requirements: 8.6, all_
