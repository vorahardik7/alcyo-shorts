# Design: project-store (spec 4)

## Overview

`packages/store` (`@alcyo/store`) holds every read and write of the section
15 layout. It uses Node's `fs` and `crypto`, depends on `@alcyo/schema`, and
never imports Electron, so the MCP server (spec 12) can use it. The atomic
file helpers move here from `@alcyo/media`, which now imports them, so there
is one implementation.

`structure.md` listed the store under `main/`. It moves to a package for the
MCP server's sake; main keeps the service that ties the store, the worker
and IPC together (`main/streams.ts`).

## Modules

| File | Contents |
|---|---|
| `files.ts` | `writeFileAtomic`, `writeJsonAtomic`, `writeNewFileAtomic` (fails if the target exists), `readJson`, `readProjectFile` (schema, migrations, `.bad` copy), `StoreError` |
| `hash.ts` | `hashFile`: size and SHA-256 of the first and last 4 MB. `sameFile` |
| `ids.ts` | `newId(prefix)`: prefix + 10 random base-36 characters, like `s_k3j9x0q2ma` |
| `names.ts` | `safeFolderName`, `uniqueFolder` |
| `layout.ts` | Every path in the stream folder, from one place |
| `messages.ts` | `appendMessage`, `readMessages`, `pageMessages` |
| `streams-index.ts` | `StreamsIndex`: list, get, upsert, update; writes are serialized |
| `settings.ts` | `SettingsFile`: read with defaults, patch |
| `project.ts` | `createStream`, `ProjectStore` (project, sources, thread, shorts, transcript reads) |
| `draft-saver.ts` | `DraftSaver`: debounce 300 ms, never more than 1 s after the first unsaved edit |

## Layout

As section 15. Additions:

- `sources/<id>/analysis/probe.json`: written by the engine (spec 3).
  `source.json` gets `probe` copied from it when analysis finishes.
- `.bad` copies sit next to the bad file.

## Decisions

- **Ids.** Stream, source, message and short ids are `newId` values with a
  prefix (`s_`, `src_`, `m_`, `sh_`). They're safe in paths and links.
- **Folder names.** Characters `<>:"/\|?*` and control characters become
  `-`, trailing dots and spaces go, Windows reserved names (`CON`, `NUL`,
  `COM1`…) get a `-` suffix, and the name is cut to 80 characters. A taken
  name gets " 2", " 3"….
- **No-overwrite version files.** Write a temp file, fsync, then
  `link(temp, target)`, which fails with `EEXIST` if the version exists, then
  remove the temp. On a file system without hard links, fall back to an
  exists check and rename.
- **Bad files.** The original stays in place; a copy goes to `<name>.bad`
  (once per content). The error says "<relative path> couldn't be read:
  <first reason>. A copy was kept as <name>.bad."
- **messages.jsonl.** `appendFile` with one complete line. Reading splits on
  `\n`; a last line without a newline that doesn't parse is dropped. A line in
  the middle that doesn't parse is skipped and reported to the log, so one bad
  line can't hide the thread. Order is by each id's first line; the value is
  the highest `rev`.
- **Status updates.** Main appends a status message at most every 2 s or 5 %,
  plus the final state. A 3-hour stream's analysis then adds about 60 lines.
- **Relink.** Locate file compares size and the two hashes, which needs no
  ffprobe. A mismatch says "That's a different file. Choose the original
  recording." The index keeps the new path; analysis results stay valid
  because the content matches.
- **Missing sources.** `stream:open` reports `missing: true` for a file
  source whose path doesn't exist.
- **Drafts.** `readDraft` returns the draft only when its `baseVersion` is the
  head and its `savedAt` is after the head's `createdAt`. Saving a version
  deletes the draft.
- **Restore.** A new version with the old version's short, `parent` set to the
  restored version, `createdBy: "user"`, note "Restored v<n>".
- **Streams folder.** `Settings.streamsDir` (nullable, default null, so older
  settings files still parse without a migration). Null means
  `app.getPath("videos")/Alcyo Shorts` (`~/Movies` on macOS, `Videos` on
  Windows). Tests set `ALCYO_STREAMS_DIR`.
- **Paths come from main.** `source:chooseFile` and `source:relink` open a
  native dialog in main. The renderer never sends a file path.
- **No whisper model.** `AnalysisRequest.model` becomes nullable. With no
  model, the transcript step is `not-needed` with the problem "The
  transcription model isn't downloaded yet. Open Setup to get it.", and the
  other steps run.

## Main: `StreamService`

```
chooseFile(streamId?) → dialog → createStream(name of file) → addFileSource
                      → startAnalysis → { stream }
startAnalysis(streamId, sourceId) → queue (one at a time)
   worker.analyze(request, onEvent)
   onEvent → job:progress event; status message (throttled); thread:message event
   done → source.json probe, streams.json thumbnail + unread + last activity,
          settings encoder, final status message, streams:changed
cancel(jobId) → worker cancel → status "cancelled"
```

The request uses the bundled tool paths, the tool versions from the cached
setup report, the platform's whisper model if present, and the saved encoder.

## IPC additions

| Channel | Input | Output |
|---|---|---|
| `streams:list` | `{}` | `StreamSummary[]` |
| `stream:open` | `{ streamId }` | `StreamDetail` |
| `stream:markRead` | `{ streamId }` | `{}` |
| `source:chooseFile` | `{ streamId? }` | `{ stream: StreamSummary } \| { cancelled: true }` |
| `source:relink` | `{ streamId, sourceId }` | `{ source } \| { cancelled: true } \| { mismatch: true }` |
| `analysis:start` | `{ streamId, sourceId }` | `{ jobId }` |
| `job:cancel` | `{ jobId }` | `{}` |
| `thread:messages` | `{ streamId, before?, limit }` | `Message[]` |
| `transcript:window` | `{ streamId, sourceId, fromMs, toMs }` | `TranscriptWindow` |
| `transcript:search` | `{ streamId, sourceId, query }` | `LineHit[]` |
| `short:get` / `short:versions` / `short:saveDraft` / `short:saveVersion` / `short:restore` | with `streamId` added to section 10's inputs | as section 10 |

Events: `streams:changed {}`, `thread:message { streamId, message }`,
`job:progress { jobId, streamId, step, stage, pct }`.

Section 10 names `source:importFile` with a path; this spec uses a dialog in
main instead, so no path crosses from the renderer. `streamId` is added to
inputs that name a source or short, because ids alone don't say which folder
to open.

## UI

- Sidebar rows: a round avatar with the stream's first letter (thumbnails
  need `alcyo-media://`, spec 10), name, last-message preview, unread dot.
- Home: Choose a file calls `source:chooseFile` and opens the new thread.
- Stream thread: header pill, then text and status messages as left bubbles.
  A status message shows its label, a thin progress bar while running, and
  Cancel. Missing sources show a Locate file row.
- Dropping files keeps its "comes in spec 6" note, because a dropped file's
  path needs the preload (spec 6 decides how).

## Testing

- Unit: names, ids, atomic writes, `.bad` copies, messages (torn line, revs,
  order, paging), index ordering, version no-overwrite under a race, restore,
  drafts and the saver's 1 s bound (fake timers), relink match and mismatch,
  transcript window and search.
- Main: `StreamService` with a fake worker: status throttling, done and
  cancel bookkeeping, no-model problem.
- e2e: dialog stubbed to a generated clip; the stream appears, its analysis
  finishes, the thread shows it. With `ALCYO_E2E_SOURCE` and
  `ALCYO_MODELS_DIR` set, the same test runs on a real recording with the
  real model.
