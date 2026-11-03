# Requirements: creator-profile (spec 7)

Source: docs/build-plan.md v3, sections 13, 15, 22 and 23 spec 7. Depends on
specs 1 to 6.

## Introduction

The profile is what makes the first proposals sound like the creator. A short
interview with the signed-in agent, the creator's past shorts and their
caption templates become `profile.json` in userData. The profile goes into
every planner prompt as text.

## Glossary

- **Agent**: the signed-in coding agent chosen in spec 5, or the API key.
- **Sample**: one past short the creator added. Only its measurements and
  analysis files are kept, never the video.
- **Preset**: a caption or hook style. Built-in, from an Alcyo template, or
  from an `.ass` file.

## Requirements

### Requirement 1: Interview (P0)

1. WHEN setup passes and there is no profile, Continue SHALL open the
   onboarding thread. Home SHALL offer it until a profile exists.
2. THE agent SHALL ask one question at a time with `InterviewStep`, with up
   to 6 chips, and SHALL finish after at most 8 questions. Code SHALL
   enforce the limit.
3. EVERY question SHALL be skippable. A skipped answer SHALL use the
   default for that topic.
4. THE answer SHALL be checked with Zod and with range checks (length
   between 5 s and 3 min). One retry SHALL carry the errors back. A second
   failure SHALL show a plain message with Try again.
5. Caption look SHALL be a fixed last step: four built-in looks, or import a
   template. The agent SHALL NOT pick preset ids.

### Requirement 2: Past shorts (P0)

1. THE creator SHALL add up to 50 past shorts with a file dialog in main.
2. THE worker SHALL quick-analyze each one, one at a time with the other
   jobs. Analysis files go to `userData/samples/<id>/`. The video SHALL NOT
   be copied, and the cache SHALL be removed after measuring.
3. Code SHALL measure length, time to first word, the first sentence, words
   per second, a cut every N ms, pauses over 300 ms kept per 10 s, and
   integrated loudness.
4. A sample can be removed.

### Requirement 3: Style summary (P0)

1. THE agent SHALL write the summary from the samples' openings (text) and
   the median numbers. The numbers SHALL be saved as targets.
2. THE summary SHALL be editable.

### Requirement 4: Templates (P0)

1. Import SHALL take `*.alcyo-template.json` (checked with Zod) and `.ass`
   files (`[V4+ Styles]` to caption and hook presets).
2. A font that isn't in the bundled list SHALL fall back to Inter, with a
   note naming it.
3. Export SHALL write the current presets, length range, title rules and
   safe area as an Alcyo template.

### Requirement 5: Saved and sent as text (P0)

1. THE profile SHALL be saved in `userData/profile.json` with atomic writes,
   and SHALL be editable in Settings > Profile.
2. `profileText` SHALL give the text block from plan section 13. A test
   SHALL show it holds no media bytes and no file paths.
3. Preset ids in the profile SHALL exist; a missing one falls back to the
   first built-in.
