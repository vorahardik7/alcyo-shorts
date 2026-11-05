# Requirements: project-store (spec 4)

Source: docs/build-plan.md v3, sections 5, 10, 15 and 23 spec 4. Depends on
specs 2 and 3.

## Introduction

The store reads and writes stream folders (`My Stream.alcyo/`) and the
userData files, in the section 15 layout. It's a Node package with no
Electron import, so main and the MCP server (spec 12) share it. Main wraps it
in IPC channels, runs analysis jobs through the worker, and posts their
progress into the stream's thread.

This spec also adds the smallest UI that shows the store working: Choose a
file makes a stream, the sidebar lists streams, and a stream's thread shows
text and status messages. Dropped files and URLs stay in spec 6; the full
thread (cards, replies, chips) stays in spec 10.

## Glossary

- **Stream folder**: a folder ending in `.alcyo` holding one stream (section 15).
- **Streams index**: `userData/streams.json`, mapping stream ids to folders.
- **Source**: the stream's video. A file source is referenced in place unless copied.
- **Hash match**: the same size and the same SHA-256 of the first and last 4 MB.
- **Status message**: a thread message for a job, updated by appending a higher `rev`.

## Requirements

### Requirement 1: Folders and files (P0)

1. THE store SHALL create a stream folder in the section 15 layout, named
   after the stream, in the streams folder. IF the name is taken, it SHALL
   add " 2", " 3" and so on. Names SHALL be safe on macOS and Windows.
2. EVERY write SHALL be atomic: temp file in the same folder, fsync, rename,
   with the Windows `EPERM`/`EBUSY` retry for up to 2 s.
3. EVERY read SHALL be parsed with its Zod schema and migrations. IF a file
   is bad, THE store SHALL keep a copy as `<name>.bad` and fail with a
   message naming the file and the reason.
4. THE streams folder SHALL default to `Movies/Alcyo Shorts` on macOS and
   `Videos/Alcyo Shorts` on Windows, and be saved in settings.

### Requirement 2: Streams index (P0)

1. THE store SHALL keep `streams.json` in userData with each stream's id,
   folder, name, thumbnail, last activity and unread state.
2. THE list SHALL be sorted by last activity, newest first.
3. WHEN a stream's folder is missing, THE list SHALL still show it, marked
   missing, and opening it SHALL say the folder moved.

### Requirement 3: Thread (P0)

1. `messages.jsonl` SHALL be append-only, one full line per write.
2. READING SHALL keep the highest `rev` per message id, in the order each id
   first appeared, and SHALL drop a torn last line (test).
3. THE store SHALL page messages with `before` and `limit`.

### Requirement 4: Sources (P0)

1. WHEN a file is imported, THE store SHALL keep its path and fingerprint and
   SHALL NOT copy it unless asked.
2. IF the file is missing, Locate file SHALL accept only a file with a hash
   match, and SHALL say plainly when the chosen file is a different one.
3. THE store SHALL write nothing next to the source.

### Requirement 5: Shorts, versions and drafts (P0)

1. THE store SHALL never overwrite a version file. Each version SHALL record
   parent, author and `fromMessageId`.
2. Restoring a version SHALL make a new version that copies it.
3. THE store SHALL write a version-owned `draft-vNNNN.json` within 1 s of
   an edit, and restore it only for its actual parent version, including
   historical branches. Legacy `draft.json` files remain readable. Cancelling
   pending writes and retrying failures SHALL never replay older edits.

### Requirement 6: Transcript reads (P0)

1. `transcript:window` SHALL return only the words and lines that overlap
   the asked range.
2. `transcript:search` SHALL return matching lines, at most 50, with their
   times and text.

### Requirement 7: Analysis jobs (P0)

1. `analysis:start` SHALL run the analysis in the worker, one at a time, and
   post one status message that updates in place, at most every 2 s or 5 %.
2. WHEN analysis finishes, THE store SHALL save the probe and fingerprint
   into `source.json`, the poster as the stream's thumbnail, the encoder pick
   in settings, and mark the stream unread.
3. `job:cancel` SHALL cancel it, and the status SHALL say cancelled.
4. IF the whisper model isn't downloaded, the other steps SHALL still run,
   and the thread SHALL say how to get the model.

### Requirement 8: IPC and UI (P0)

1. EVERY new channel SHALL have a Zod-checked handler and a test.
2. File paths SHALL come from a native dialog in main, never from the renderer.
3. Choose a file SHALL create a stream named after the file, start analysis,
   and open its thread.
4. THE sidebar SHALL list streams with name, last-message preview and unread
   dot, and search SHALL filter them.
5. THE thread SHALL show text and status messages live, with Cancel on a
   running job.
6. A Playwright test SHALL choose a file, see the stream in the sidebar, and
   see its analysis finish.
