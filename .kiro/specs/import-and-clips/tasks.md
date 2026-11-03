# Tasks: import-and-clips (spec 6)

- [x] 1. Spec documents
  - requirements.md, design.md, tasks.md
  - _Requirements: all_

- [x] 2. Schema and store
  - `ClipOrigin.url.path`, `Settings.urlNoteShown`, `CLIP_PLACED_MIN`, `isPlaced`
  - `clipDir`, `clip`, `clipAnalysisDir`, `addDownloadedSource`, `addClip`, `clips`, `updateClip`
  - _Requirements: 2.3, 4.1, 5.4_

- [x] 3. `@alcyo/import`
  - yt-dlp args, info parsing, classification, progress, release checksums
  - Download runner that removes its folder on cancel or failure
  - Transcript candidate, WAV envelopes, cross-correlation, `matchClipFiles`
  - Tests: `--` before the URL, a `-` URL against the real yt-dlp, 100 ms on real audio
  - _Requirements: 1.1–1.5, 2.1–2.4, 5.1–5.5_

- [x] 4. Worker and IPC
  - `link-info`, `download-run`, `clip-match-run`, `JobEvent`
  - Channels `link:add`, `link:answer`, `clip:chooseFile`, `clip:place`, `downloader:*`
  - _Requirements: 1, 2, 3, 4, 5.6_

- [x] 5. Main
  - One job queue for analysis, downloads and clip checks
  - Links, the question, clip files, Place by hand, Update downloader
  - _Requirements: 1.6, 1.7, 2.5, 2.6, 3.1–3.3, 4.2, 4.3, 5.6_

- [x] 6. Screens and e2e
  - Composer links, question buttons, clips message, Place by hand, Downloader card
  - e2e: a local link asks, downloads and analyzes; a clip link is placed within 100 ms;
    a foreign clip file is placed by hand
  - _Requirements: 6.1–6.3_

- [x] 7. Demo clips stand-in
  - There are no recorded demo clips. `demo.integration.test.ts` builds a
    2-minute stream from `say` lines at known times over noise, cuts two
    clips at 31.25 s and 77.8 s, and runs real whisper and matching.
    Both land at 0 ms error. macOS only (needs `say` and the model).
  - It found a whisper.cpp 1.9.5 bug: with `--vad`, token times stay on
    the speech-only clock. Fixed in `@alcyo/media` (`remapTokens`).
  - _Requirements: 5.5_
