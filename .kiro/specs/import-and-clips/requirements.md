# Requirements: import-and-clips (spec 6)

Source: docs/build-plan.md v3, sections 11, 12, 14 step 6 and 23 spec 6.
Depends on specs 1 to 5.

## Introduction

A creator pastes a stream link or a clip link. Alcyo asks yt-dlp what the
link is, downloads it into the stream's folder, and analyzes it. Viewer
clips, from a link or a file, are matched to the VOD so later specs can mark
the lines viewers clipped. Nothing leaves the computer except the download
request itself.

## Glossary

- **Info**: yt-dlp's `-J` JSON for a link, read with Zod.
- **VOD**: the stream's source recording.
- **Clip**: a short piece of the stream, from a link or a file.
- **Placed**: a clip with a match whose confidence is at least 0.6.

## Requirements

### Requirement 1: Read a link first (P0)

1. WHEN an `http(s)` URL is sent or pasted in the composer, THE app SHALL run
   yt-dlp for its info before downloading anything.
2. A single video of 10 minutes or more that isn't a clip URL SHALL become
   the stream's source.
3. A video under 10 minutes, or a clip URL (Twitch or YouTube clip), SHALL
   become a clip. WHEN the stream has no source yet, or the length is
   unknown, THE app SHALL ask "Use this as the stream, or add it as a clip?"
   with two choices.
4. A playlist or clips page SHALL get one line saying single links work and
   picking from a page comes later (P1).
5. A link yt-dlp can't read SHALL get: "That link can't be downloaded. If
   it's private, download it yourself and drop the file in."
6. From Home, a link that can be read SHALL make a new stream named after
   the video title. A link that can't be read SHALL make no stream.
7. A stream that already has a source SHALL NOT take a second one. Alcyo
   SHALL say so and suggest a new stream.

### Requirement 2: Download (P0)

1. yt-dlp SHALL be spawned with an args array, `--no-config`,
   `--no-cache-dir`, `--no-playlist`, the bundled `--ffmpeg-location`, the
   1080p format, `--merge-output-format mp4`, `--write-info-json`, and `--`
   right before the URL.
2. A test SHALL show a URL that starts with `-` is not read as an option.
3. A source download SHALL land in `sources/<id>/`, a clip in `clips/<id>/`.
   The source's origin SHALL be `url` with the downloaded path and the
   info JSON's fields.
4. Progress SHALL go to the thread as one status message, throttled like
   analysis. Cancel SHALL stop yt-dlp and remove the download folder.
5. THE first URL import SHALL post once: "Only download videos you own or
   have permission to use."
6. After a source download, full analysis SHALL start.

### Requirement 3: Update downloader (P1 in the plan, built here)

1. Settings SHALL show the yt-dlp version in use and offer Update
   downloader.
2. Update SHALL read the latest GitHub release, take this platform's file
   and `SHA2-256SUMS`, and keep the file only when its SHA-256 matches and
   `--version` exits 0. It SHALL be written with temp, fsync and rename.
3. THE pinned build SHALL stay in place. A missing updated file SHALL fall
   back to it. Settings SHALL offer Use the bundled version.

### Requirement 4: Clips (P0)

1. Choose a file in a stream that has a source SHALL add the file as a clip,
   referenced in place. Nothing SHALL be written next to it.
2. EACH clip SHALL get quick analysis into `clips/<id>/analysis/` and
   `cache/<id>/`.
3. Matching SHALL wait for the VOD's analysis. Clip jobs SHALL run one at a
   time with the other jobs.

### Requirement 5: Matching (P0)

1. WHEN both transcripts have words, THE matcher SHALL find a candidate
   offset from shared word runs in the VOD transcript.
2. THE matcher SHALL refine with a cross-correlation of 16 kHz audio
   envelopes within ±5 s of the candidate.
3. WHEN the clip has no usable speech, THE matcher SHALL search the whole
   VOD with a coarse envelope, then refine.
4. THE match SHALL save `srcIn`, `srcOut`, `confidence` and `method` in
   `clips/<id>/clip.json`.
5. On a clip cut from a test VOD and re-encoded, matching SHALL land within
   100 ms of the true offset (test). The demo clips test waits on the demo
   clips (plan section 33).
6. A match below 0.6 SHALL show as "Couldn't place this clip" with Place by
   hand. Place by hand SHALL take a VOD start time and save method `manual`.

### Requirement 6: Thread (P0)

1. Clips SHALL show as one clips message: title, length, and where it sits
   in the VOD, or the unplaced line.
2. THE question SHALL show its two choices as buttons, reachable by Tab.
3. Copy SHALL be plain: what happened and what to do next.
