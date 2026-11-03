# Requirements: render-engine (spec 9)

Source: docs/build-plan.md v3, sections 15, 18 and 23 spec 9. Depends on
specs 3, 4 and 8. This spec also carries a UI pass the owner asked for on
Nov 3: a new logo, a T3 Code-style sidebar, home and Settings, and agent
settings without paths everywhere.

## Requirements

### Requirement 1: Shared crop and captions (P0)

1. `cropWindow` and `buildAss` SHALL be pure, Node-free and importable by
   the renderer, from `@alcyo/render`.
2. THE ffmpeg crop expression SHALL give the same x as `cropWindow` at
   every frame, for up to 200 keys, without deep nesting.
3. Captions SHALL use only kept words with overrides, shifted to short
   time, with the spoken word highlighted, using bundled fonts. A font that
   isn't bundled SHALL fall back to Inter.

### Requirement 2: Args (P0)

1. THE version-and-preset-to-args function SHALL be pure, with snapshot
   tests for multiple segments, 200 crop keys, captions and hook.
2. Segment edges SHALL snap to source frames, with a 10 ms audio fade at
   each cut. A source with no audio SHALL get silence.
3. THE same version rendered twice SHALL give identical args and caption
   files. No path SHALL appear inside the filter graph.

### Requirement 3: Output (P0)

1. ffprobe on an output SHALL show the preset's size, H.264, AAC, and a
   length within 100 ms of the kept segments. Otherwise the render fails
   and no file is left.
2. A cancel or failure SHALL leave no file behind. Nothing is written next
   to the recording.
3. Files SHALL be `renders/<title>-v<n>-1080p30.mp4`, never overwritten.

### Requirement 4: Queue (P0)

1. ONE render SHALL run at a time, across streams, with progress, cancel
   and retry.
2. Background analysis steps (loudness, scenes, proxy, peaks, thumbnails)
   SHALL wait while a render runs.
3. EACH render SHALL post a render message in its thread, write a
   `renders/index.json` record, mark the short rendered, and show a
   notification when done.
4. THE render card and the queue drawer SHALL show progress, Cancel, Try
   again, Show in Finder or Explorer, and Copy path.

### Requirement 5: UI pass (owner request)

1. A new app icon and mark, drawn for 16 px to 1024 px.
2. THE sidebar SHALL follow T3 Code's layout: a 52 px top bar with the
   name, a search row with New stream, stream rows with a monogram, time
   and preview, and a footer with Settings and the render queue.
3. Home SHALL center the composer with the headline above and quiet
   actions below.
4. Settings SHALL have a grouped nav, a header bar, and an Agents page
   with a list (name, version, one status line) and a detail panel. Paths
   SHALL show only on request. The creator SHALL be able to choose which
   signed-in agent answers.
5. Setup check lines SHALL not show file paths.
