# Tasks: creator-profile (spec 7)

- [x] 1. Spec documents
  - _Requirements: all_

- [x] 2. Schema and `@alcyo/profile`
  - InterviewStep without preset ids, StyleSummary, PastShortMeasures, SampleFile
  - Built-in looks and bundled font names
  - Interview prompt, checks, defaults; measures; style prompt; profileText; templates
  - _Requirements: 1.2–1.5, 2.3, 3.1, 4.1–4.3, 5.2, 5.3_

- [x] 3. Planner
  - `askChecked` with one retry; `nextInterviewStep`, `writeStyleSummary`
  - Live Grok tests (opt-in)
  - _Requirements: 1.2, 1.4, 3.1_

- [x] 4. Store, IPC, main
  - ProfileStore; InterviewState and ProfileView; AgentService; ProfileService
  - Past shorts on the job queue; cache removed after measuring
  - _Requirements: 1, 2, 3, 4, 5.1_

- [x] 5. Screens and e2e
  - Onboarding thread, caption looks, Settings > Profile, Home and Setup entry
  - e2e with the scripted agent; a live run with Grok in the app
  - _Requirements: 1.1, 3.2, 5.1_
