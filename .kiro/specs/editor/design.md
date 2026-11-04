# Design: editor (spec 11)

## Modules

| File | Contents |
|---|---|
| `schema/src/edit.ts` | Pure edits on a `Short`: trim, split, ripple-delete a short-time range, restore words, caption overrides, nudges, words per line, crop keys, hook, snapping, `SAFE_AREAS` |
| `desktop/src/main/editor.ts` | `EditorService.open` (one call with everything the editor shows) and `save` (a user version plus a version message) |
| `desktop/src/main/media-protocol.ts` | Adds `peaks/<stream>/<source>` and `frames/<stream>/<source>/<n>` |
| `desktop/src/renderer/src/editor/history.ts` | Undo history of snapshots (500 steps), the version note |
| `desktop/src/renderer/src/editor/store.ts` | Editor state: view, history, base version, playhead, selection, zoom, panel |
| `desktop/src/renderer/src/editor/Editor.tsx` | Page, header, versions, chat drawer, shortcuts, autosave |
| `desktop/src/renderer/src/editor/panels.tsx` | Transcript, Captions, Reframe, Hook panels; safe areas |
| `desktop/src/renderer/src/editor/Timeline.tsx` | Tracks, drags, snapping, selection |
| `desktop/src/renderer/src/streams/player.tsx` | Shared player with a `PlayerHandle` (seek, play at a rate, pause, the active video) |

## Data

`editor:open` returns the version, the head, the draft (only for the head),
the version list, the asking message's text, the source (media URL, size,
fps, length, waveform URL, thumbnail URLs), words, lines and silences for
the short ± 60 s, the caption and hook presets, and the profile's
platforms. The renderer builds the `.ass` with `buildAss` from the same
presets and words the render uses, so a caption edit shows at once.

`short:saveVersion` takes an optional `parent`. Main saves a user version
and posts a version message by the creator. Editing an older version and
saving records that version as the parent (a branch).

## Edits and history

Every edit is a pure function in `schema/edit.ts` applied through
`apply(label, fn)`, which pushes a snapshot. Undo and redo swap snapshots;
500 are kept. The agent's revision of the open short arrives as a version
message; the editor offers it, and loading it is one more step, so Undo
returns to the creator's edit. The version note is the labels of the steps
since the last save ("Cut 3 words, New hook, Split").

- Transcript: a word is kept when its midpoint is in a segment. Delete on
  kept words ripple-cuts from the first word's start to the last's end;
  on cut words it restores them, bridging to a kept neighbour when no other
  word is between, so the pause comes back too.
- Timeline: segment edges trim in source time, clamped to neighbours and
  at least 100 ms. Edges snap within 8 px to word edges, silence edges and
  the playhead; keyframes and hook edges snap to kept word starts, cuts and
  the playhead. Alt places freely. Shift-drag on the ruler selects; I and O
  set the selection from the playhead.
- Reframe: the panel paints the active video's full frame each animation
  frame, with the 9:16 window over it. Dragging sets a key at the playhead
  with the chosen ease.

## Autosave

When editing the head, changes go to `short:saveDraft` through
`DraftSaver` (300 ms after the last edit, at most 1 s). Opening the editor
restores a draft newer than the head.

## Bugs found while testing

- Chromium's `scrollIntoView()` returns a Promise; an effect written as
  `() => el.scrollIntoView()` returned it as its cleanup, and React threw
  on unmount, blanking the page. Effects use braces.
- Segment offsets were a new array each render, so the "reseek after an
  edit" effect ran on every render and stopped playback. They're memoized.

## Tests

- `schema/edit.test.ts`: every edit, with `checkShort` on the results.
- `editor/history.test.ts`: 250 undo and redo steps, the limit, the note.
- `render/runner.integration.test.ts`: a black source with a 2 px white
  line, rendered with hold and linear keys; the line's column in six output
  frames gives ffmpeg's crop x, within 1 px of `cropWindow`.
- `e2e/editor.spec.ts` (12 tests): word cut and restore, split, I/O and
  ripple delete, a trim that snaps to a word, captions, reframe drag and
  keys, hook and guides, 205 undo steps, Save (version file, parent, note,
  version message), the chat drawer and the agent's version, open and
  restore an older version, and a JASSUB frame against an ffmpeg frame of
  the same `.ass` on a 54 × 96 grid: 326 of 327 cells agree.

## Not done

- P1: filler finder, scene-cut keyframes, source view, extra presets.
- J plays backwards by stepping, since video can't play in reverse.
