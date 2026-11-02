# Tasks: schema (spec 2)

Each task ends with lint, typecheck and test, then one local commit. Build,
e2e and packaging run in task 7.

- [x] 1. Spec documents
  - requirements.md (EARS), design.md with correctness properties, tasks.md
  - _Requirements: all_

- [x] 2. Schemas
  - primitives, short, clip, message, profile, claude, source, transcript, presets, project/settings/indexes
  - `.ts` import extensions so Node can run the package directly
  - Unit tests for each schema's accept and reject cases
  - _Requirements: 1.1–1.5_

- [x] 3. Checks and time math
  - `checks.ts` with paths and reasons; `time.ts`
  - fast-check arbitraries in `testing/arbitraries.ts`
  - Unit tests and properties 1, 2, 4 and 7
  - _Requirements: 2.1–2.7, 3.1, 3.2, 3.4, 5.1, 5.2_

- [x] 4. Planner id mapping and snapping
  - `packages/planner/src/id-mapping.ts`, `snapping.ts`
  - Unit tests and properties 3, 5 and 6
  - _Requirements: 3.3, 4.1–4.3_

- [x] 5. JSON Schema for Claude and migrations
  - `claudeJsonSchemas`, Ajv tests, no-times and no-commands test
  - `migrate.ts` with a fake-chain test
  - _Requirements: 6.1–6.3, 7.1, 7.2_

- [x] 6. plan:validate
  - `files.ts` (`fileKindOf`, `parseProjectFile`), `scripts/validate-plan.ts`, root `plan:validate`
  - Tests with good and bad temp projects, hook stdin, torn JSONL line
  - _Requirements: 8.1–8.5_

- [ ] 7. Wrap-up
  - Full build, `pnpm test:e2e`, `pnpm package:mac`
  - _Requirements: all_
