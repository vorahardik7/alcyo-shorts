# Tasks: planner (spec 8)

- [x] 1. Spec documents
  - _Requirements: all_

- [x] 2. Lines and Find shorts in `@alcyo/planner`
  - Rows with `[pause]` and `[clipped xN]`; stream header; length range
  - `buildProposal`: map, snap, length, overlap, count; version 1 looks and hook
  - Windows with clipped context, then a final pick
  - Tests: no word ids, word times, paths or control bytes in the input; retry once; failure; windows
  - _Requirements: 1, 2.1–2.5, 3_

- [x] 3. Chat actions in `@alcyo/planner`
  - Context: shorts list, last 20 messages, word windows, reply target
  - All six actions; checks; length kept in the profile's range unless asked
  - _Requirements: 4_

- [x] 4. Main and IPC
  - `PlannerService`: per-stream queue, working indicator, cancel, failure messages
  - `shorts:find`, `chat:send`, `thread:working`, `stream:open` planner state
  - The one automatic run (`project.autoFindAt`), after the transcript and clip checks
  - Thread messages keep `replyTo`
  - _Requirements: 2.4–2.6, 4.5, 5.3_

- [x] 5. Screens and e2e
  - Short and version cards, reply quote, working bubble, Find shorts button
  - Scripted agent answers Find shorts and chat; e2e on a seeded stream
  - Live with Grok: planner tests on a real VOD, and a run in the app
  - _Requirements: 5_

- [ ] 6. `[loud]` and `[scene]` hints (P1)
  - _Requirements: 6_
