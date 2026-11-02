# Requirements: schema (spec 2)

Source: docs/build-plan.md v3, section 22 (data schema), section 15 (storage
layout) and section 23 spec 2. Depends on spec 1.

## Introduction

Every boundary in Alcyo is parsed with Zod: IPC, worker messages, files on
disk, deep links and Claude's answers. This spec defines those schemas once in
`packages/schema`, adds the checks Zod can't express on its own (ordering,
overlap, references to other files), the pure time math the editor, planner
and renderer share, the JSON Schemas Claude is given, file migrations, and a
`pnpm plan:validate` command the `validate-project-files` hook runs. The
behaviour that matters most is stated as properties and tested with
fast-check.

## Glossary

- **Short**: one proposed or edited short: segments of source time, crop keys,
  captions, an optional hook.
- **Segment**: a kept range of source time, `[srcIn, srcOut)` in ms.
- **Short time**: ms from the start of the short, counting only kept time.
- **Source time**: ms from the start of the source video.
- **Word range**: a pair of word ids, `fromWord` to `toWord`, inclusive.
- **Silence**: a range of source time with no speech, from `silencedetect`.
- **Check**: a function that returns a list of issues, each with a path and a
  plain reason, for things a Zod schema alone can't see.
- **Project file**: any JSON or JSONL file in the section 15 layout, plus
  `profile.json`, `settings.json`, `streams.json`, presets and templates.

## Requirements

### Requirement 1: Schemas (P0)

**User story:** As a developer, I want one definition of every file and
message, so that every boundary parses the same way.

1. THE package SHALL define every schema in section 22: `Segment`, `CropKey`,
   `WordOverride`, `Short`, `ShortVersion`, `ClipMatch`, `Clip`, `Message`,
   `CreatorProfile`, `ClaudeProposal`, `ChatAction`, `InterviewStep` and
   `AppLink`.
2. THE package SHALL define `Project`, `ShortFile` (short.json), `Draft`,
   `Source` (with ffprobe summary, fingerprint and yt-dlp info), `Transcript`
   (words and lines), `Silences`, `Scenes`, `Loudness`, `AnalysisSteps`,
   `CaptionPreset`, `HookPreset`, `Template`, `Settings`, `StreamsIndex` and
   `RenderIndex`.
3. EVERY time SHALL be an integer number of milliseconds.
4. EVERY stored file schema SHALL have a `schemaVersion`.
5. THE package SHALL depend only on zod and SHALL NOT import Node or DOM APIs.

### Requirement 2: Checks (P0)

**User story:** As a developer, I want bad plans rejected before they're saved
or rendered, with a reason that says what's wrong.

1. THE checks SHALL reject a segment whose `srcOut` isn't after `srcIn`, that
   ends past the source's duration, or that overlaps or comes before the
   segment before it.
2. THE checks SHALL reject crop keys that aren't in strictly increasing time,
   or whose time is outside the short.
3. THE checks SHALL reject word overrides whose word id isn't in the
   transcript, and duplicate overrides for one word.
4. THE checks SHALL reject a hook whose end isn't after its start or that runs
   past the end of the short.
5. THE checks SHALL reject a chat action that names a short that doesn't
   exist, and a `set_style` with scope `short` and no short id.
6. THE checks SHALL reject a transcript whose words aren't in time order,
   whose lines name unknown words or words out of order, or whose lines run
   longer than 12 s.
7. EACH issue SHALL carry a path (like `segments[2].srcOut`) and a plain
   reason.

### Requirement 3: Time math (P0)

1. FOR ANY valid short and word ranges, ripple-deleting them SHALL give a
   valid short whose length drops by exactly the kept time removed (property).
2. FOR ANY time inside a kept segment, short to source and back SHALL return
   the same time (property).
3. FOR ANY valid short and silence list, snapping SHALL keep it valid and move
   no cut more than 1500 ms (property).
4. IF a ripple delete would remove every kept ms, THE function SHALL refuse
   with a plain reason and SHALL NOT return a short with no segments.

### Requirement 4: Id mapping (P0)

1. FOR ANY valid proposal and transcript, mapping line ids SHALL give segments
   on word boundaries (property).
2. FOR ANY valid `keep` ranges, mapping word ids SHALL give in-order,
   non-overlapping segments (property).
3. IF a line id or word id isn't in the transcript, or a range ends before it
   starts, THE mapping SHALL fail with the id and the reason.

### Requirement 5: Round trips (P0)

1. FOR ANY valid version, message or profile, a JSON round trip SHALL give an
   equal value (property).
2. FOR ANY valid `AppLink`, formatting it as an `alcyo://` URL and parsing it
   back SHALL give an equal link (property).

### Requirement 6: JSON Schema for Claude (P0)

1. THE package SHALL export JSON Schema for `ClaudeProposal`, `ChatAction` and
   `InterviewStep`, made with `z.toJSONSchema`.
2. THE JSON Schemas SHALL contain no times and no fields for commands.
3. A test SHALL show each JSON Schema accepts the same sample answers the Zod
   schema accepts, and keeps the id patterns.

### Requirement 7: Migrations (P0)

1. WHEN a file is read, THE package SHALL upgrade it from its `schemaVersion`
   to the current one through registered steps, each with a test.
2. IF a file has no `schemaVersion`, or one newer than the app knows, THE
   package SHALL reject it with a plain reason.

### Requirement 8: plan:validate (P0)

**User story:** As a developer, I want saved project files checked
automatically, so that a bad fixture or demo file is caught at once.

1. `pnpm plan:validate` SHALL check every project file under the paths it's
   given, or under `examples/` when given none.
2. WHEN run from the `validate-project-files` hook, IT SHALL also check the
   saved file named in the hook's stdin.
3. FOR each bad file, IT SHALL print the file, the path inside it and the
   reason, and SHALL exit 1; with no bad files IT SHALL exit 0.
4. IT SHALL check `messages.jsonl` line by line and report the line number,
   ignoring a torn last line as the store does.
5. WHERE a version file sits in a project with its source and transcript, IT
   SHALL also run the short checks against them.
