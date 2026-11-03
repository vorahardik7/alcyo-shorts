# Design: import-and-clips (spec 6)

## Overview

`@alcyo/import` is new. It holds the yt-dlp args and parsers, the download
runner, the release checksum parser, and the clip matcher. It uses the
`Runner` from `@alcyo/media` and imports no Electron.

The worker runs the info lookup, the downloads and the matching. Main owns
the flow in `StreamService`: it posts messages, queues jobs on the one
chain, and writes through `ProjectStore`. Main also runs Update downloader,
like the whisper model download, because it writes into userData.

## Modules

| File | Contents |
|---|---|
| `import/src/ytdlp.ts` | `infoArgs`, `downloadArgs`, `parseInfo`, `classifyLink`, `isClipUrl`, `parseProgress`, `CANT_DOWNLOAD` |
| `import/src/download.ts` | `fetchLinkInfo`, `downloadMedia` (cancel removes the folder) |
| `import/src/envelope.ts` | WAV reads, `envelope`, `ncc`, `bestLag` |
| `import/src/match.ts` | `transcriptCandidate`, `matchClip`, `PLACED_MIN` |
| `import/src/match-files.ts` | `matchClipFiles`: reads the WAVs and transcripts, runs `matchClip` |
| `import/src/release.ts` | `parseSha256Sums`, `releaseAsset`, `newerVersion` |
| `ipc/src/import.ts` | Worker requests and results for info, download, match |
| `store` | `clipDir`, `clip`, `addDownloadedSource`, `addClip`, `clips`, `setClipMatch` |
| `desktop/src/main/streams.ts` | `addLink`, `answer`, `chooseClipFile`, `placeClip`, clip jobs |
| `desktop/src/main/downloader.ts` | Update downloader and the path in use |

## Decisions

- **Classification.** `classifyLink(info, hasSource)`. A clip URL is a clip.
  A known length of 10 minutes or more is a source. Under 10 minutes is a
  clip. An unknown length (the generic extractor on a plain file URL) asks.
  A clip with no source asks too. The pending answer is kept in main's
  memory under the question's message id. After a restart the buttons say
  the question expired and to paste the link again.
- **One source.** A stream holds one VOD in P0. A second long link gets a
  line pointing at Home.
- **Format.** The plan's `bv*[height<=1080]+ba/b[height<=1080]` rejects
  every format of a plain file link, because yt-dlp doesn't know its height
  ("Requested format is not available"). The format uses `<=?`, which keeps
  unknown heights and still caps known ones at 1080.
- **Paste.** A link pasted into an empty composer goes in right away. A
  link typed next to other text waits for Send.
- **Progress template.** The plan's `%(progress._percent_str)s` restarts at
  0 for each part of `bv*+ba`. The template is
  `ALCYO %(info.format_id)s %(progress._percent_str)s`. The parser counts
  parts from the requested `format_id` (`137+140` is two) and weights them
  evenly. Lines without the prefix are ignored.
- **Cancel.** `runTool` sends SIGTERM, then SIGKILL after 2 s. The whole
  download folder is removed with retries, since nothing in it is
  registered yet. yt-dlp's own ffmpeg child can outlive it for a moment on
  Windows. The retry covers the file lock.
- **Info JSON.** yt-dlp writes `media.info.json`. It is parsed with the raw
  schema in `ytdlp.ts` and mapped to `YtDlpInfo` (seconds become integer
  ms). Unknown fields are ignored. The file stays in the folder.
- **Clip origin.** `ClipOrigin` `url` gets an optional `path`: the
  downloaded copy inside the project. Old clip files still parse.
- **Matching.** Words are lowercased and stripped to letters and digits.
  Every VOD trigram is indexed. Each clip trigram that hits votes for
  `vodWord.startMs - clipWord.startMs`, in 500 ms buckets. The best bucket
  and its neighbours give the candidate (median vote) and a transcript
  score (votes over clip trigrams). Fewer than 4 clip words means no
  usable speech.
- **Envelope.** Mean absolute sample per 5 ms hop (80 samples at 16 kHz),
  then `log1p`. Normalized cross-correlation over lags within ±5 s, then a
  parabola through the peak for sub-hop timing. The coarse search uses
  50 ms hops over the whole VOD, then the 5 ms refine within ±5 s of the
  coarse peak. Pearson correlation ignores gain, so a louder or quieter
  clip still matches.
- **Confidence and method.** Transcript candidate refined by audio:
  method `transcript`, confidence = the refined correlation. Transcript
  with no audio (no VOD `audio.wav`): method `transcript`, confidence =
  the transcript score. No speech: method `audio`, confidence = the
  correlation. Below 0.6 the match is saved and shown as unplaced, so
  Place by hand can start from the best guess. `metadata` is not used.
  Whether yt-dlp's clip info carries a VOD offset is still open (plan 35).
- **No clips.json.** Section 14 step 6 names `clips.json`. Each clip's
  match lives in its `clip.json`, which the store already reads, so there
  is no second copy.
- **Update downloader.** `GET api.github.com/repos/yt-dlp/yt-dlp/releases/latest`.
  The asset is `yt-dlp_macos` or `yt-dlp.exe`. `SHA2-256SUMS` from the same
  release gives the hash. The file goes to `userData/bin/yt-dlp-<tag>`,
  chmod 755, `--version` must exit 0, then settings save
  `ytDlp: { version, path }`. The SUMS file is not signature-checked. The
  `.sig` needs yt-dlp's GPG key, which isn't pinned yet. Same tag as the
  one in use returns "already the newest".
- **One-time note.** `settings.urlNoteShown`, default false.
- **Dropped files.** Not in this spec. A dropped file's path needs
  `webUtils.getPathForFile` in the preload, and the preload exposes only
  `invoke` and `on`.

## Calls

Info:

```
yt-dlp --no-config --no-cache-dir --no-playlist --ffmpeg-location <bin>
  -f "bv*[height<=?1080]+ba/b[height<=?1080]" -J -- <url>
```

Download (cwd is the target folder):

```
yt-dlp --no-config --no-cache-dir --no-playlist --ffmpeg-location <bin>
  -f "bv*[height<=?1080]+ba/b[height<=?1080]" --merge-output-format mp4
  --write-info-json --newline
  --progress-template "ALCYO %(info.format_id)s %(progress._percent_str)s"
  -o <dir>/media.%(ext)s -- <url>
```
