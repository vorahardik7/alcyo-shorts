# Requirements: editor (spec 11)

Source: docs/build-plan.md v3, sections 6, 7, 18 and 23 spec 11. Depends on
specs 9 and 10.

## Requirements

### Requirement 1: Layout (P0)

1. THE editor SHALL open from a card at `/s/<id>/short/<id>/v/<n>/edit`,
   full window, with the preview, the transcript and side panels, the
   timeline, and a chat drawer.
2. THE header SHALL say which version is open and where it came from
   ("Agent v2, from your message 'make it punchier'").

### Requirement 2: Preview (P0)

1. THE preview SHALL play across segments with two video elements, draw
   the crop with `cropWindow` and captions with JASSUB from the same `.ass`
   the render burns, built from the current edit.

### Requirement 3: Timeline (P0)

1. Tracks for segments (with thumbnails and the waveform), caption words,
   the hook and crop keyframes.
2. Trim by dragging segment edges, split at the playhead, select a range
   and ripple-delete it, zoom, and snapping to words, pauses and the
   playhead.

### Requirement 4: Transcript (P0)

1. Deleting words SHALL ripple-cut on word boundaries; cut words SHALL stay
   visible, struck through, and restorable.
2. Clicking a word seeks there; the spoken word is highlighted.

### Requirement 5: Captions (P0)

1. Edit a word's text, hide it, nudge its timing by 10 ms and 100 ms, set
   words per line and the caption look. Stored as overrides; the transcript
   never changes.

### Requirement 6: Reframe (P0)

1. Drag the 9:16 window over the source; add hold or linear keyframes at
   the playhead; move and delete them.
2. A test SHALL compare ffmpeg frames with `cropWindow` within 1 px.

### Requirement 7: Hook (P0)

1. Hook text with start, end and look; safe-area guides from the profile's
   platforms, which can be turned off.

### Requirement 8: Versions and history (P0)

1. EVERY edit SHALL be undoable, at least 200 steps, including loading the
   agent's revision.
2. Saving SHALL make a user version and post a version message. Editing an
   older version and saving branches from it (its parent). Any version can
   be opened and restored.
3. Edits to the latest version autosave as a draft and come back after a
   restart.
4. Render saves unsaved edits as a version first.

### Requirement 9: Shortcuts and tests (P0)

1. THE shortcuts in section 6 SHALL work with Cmd on Mac and Ctrl on
   Windows.
2. A Playwright test SHALL compare a JASSUB frame with an ffmpeg frame of
   the same caption.

### Requirement 10: P1

1. Filler finder, scene-cut keyframes, source view, extra presets.
