# Tasks: media-engine (spec 3)

Each task ends with lint, typecheck and test, then one local commit. Build,
e2e and packaging run in task 7.

- [x] 1. Spec documents
  - requirements.md (EARS), design.md, tasks.md
  - Check `--dtw` with and without `-nfa` on the pinned whisper-cli
  - _Requirements: all, 2.6_

- [x] 2. Package, process runner and files
  - `@alcyo/media` package; `process.ts`, `errors.ts`, `files.ts`, `progress.ts`
  - Tests: args reach the child unchanged, cancel kills the child, atomic write
  - _Requirements: 1.5, 4.2, 5.3_

- [x] 3. Tool args and parsers
  - probe, fingerprint, audio, silences, chunks, whisper, loudness, scenes,
    encoder, proxy, peaks, thumbnails
  - Unit tests from real tool output; properties for chunks and lines
  - _Requirements: 2.1–2.3, 3.1–3.3, 6.1, 6.2_

- [x] 4. Pipeline
  - `cache.ts`, `analyze.ts`: order, keys, skip, cascade, resume, events,
    cancel, quick mode, no-audio
  - Fake-runner tests
  - _Requirements: 1.1–1.6, 2.4, 2.5, 4.1, 4.2, 6.3, 7.1_

- [ ] 5. Worker job
  - Contract messages, `serveWorker` and `createWorkerClient().analyze`
  - Worker wires the real runner; protocol test with a fake job and a cancel
  - _Requirements: 8.1, 8.2_

- [ ] 6. Real runs and drift
  - Integration test on a generated clip in an awkward path; nothing next to the source
  - `scripts/media-drift.ts`; record drift in design.md
  - _Requirements: 2.6, 5.1, 5.2_

- [ ] 7. Wrap-up
  - Full build, `pnpm test:e2e`, `pnpm package:mac`; plan section 36
  - _Requirements: all_
