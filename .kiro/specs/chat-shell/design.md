# Design: chat-shell (spec 10)

## Modules

| File | Contents |
|---|---|
| `desktop/src/main/media-protocol.ts` | `alcyo-media://` resolver and Range responses |
| `desktop/src/main/drops.ts` | `DropBox`: dropped paths held in main under a token |
| `desktop/src/preload/index.ts` | Reads dropped files' paths with `webUtils`, sends them on a preload-only channel |
| `desktop/src/renderer/src/streams/player.tsx` | `ShortPlayer`: two videos, crop transform, JASSUB canvas, one at a time |
| `desktop/src/renderer/src/streams/shorts.tsx` | Cards, lazy preview, Copy link, chips as links |
| `desktop/src/renderer/src/streams/ShortPage.tsx` | The edit route: the version, large |
| `desktop/src/renderer/src/streams/StreamThread.tsx` | Focus by route, message scroll, older pages |

## alcyo-media://

Privileged before ready (standard, secure, stream, fetch, CORS). URLs carry
ids, never paths:

- `source/<streamId>/<sourceId>`: the recording when Chromium plays it,
  else `cache/<id>/proxy.mp4`, else 404.
- `thumb/<streamId>`: the index's thumbnail, only if it's inside that
  stream's `cache/`.
- `fonts/<file>`: a file in `resources/fonts`, by exact name.

Ids must look like Alcyo ids. GET and HEAD only. One `Range` gives 206 with
`Content-Range`; a bad one gives 416. `Access-Control-Allow-Origin: *`, so
JASSUB's module worker (origin `file://`) can fetch fonts.

## Preview

`short:preview` returns the version, the media URL, the source size, and
`buildAss(...)` with the same presets and words the render uses
(`RenderService.looks`). The player:

- Draws with `cropWindow` as a CSS transform on both videos, so the crop is
  the render's crop at every frame.
- Draws captions with JASSUB in canvas mode: `manualRender` at the short's
  own time. The bundled fonts are passed as `fonts`, so they load before
  `ready`; local and remote font lookup is off.
- Calls JASSUB only after `ready`. An earlier `manualRender` throws inside
  JASSUB and leaves its `busy` flag set, which stops all later drawing (found
  in testing; the e2e checks `busy` returns to false). `resize()` runs when
  the box changes size.
- Swaps two videos at each cut: A plays segment n while B waits at n+1.
- One player plays at a time (`usePlaying`). Cards mount the player only
  while on screen and fetch the preview the first time they are.

## Drops

The preload listens for `drop`, reads paths with `webUtils.getPathForFile`,
and calls `preload:drop`. That channel isn't in `CHANNELS`, so
`window.alcyo.invoke` refuses it; main checks the sender and the input as
for every channel. Main keeps real files under a token (10 minutes, 20 at
most) and sends `drop:files` with names. The window answers `drop:use` with
the token and the open stream. No stream: a new stream from the first file.
A stream with no recording: the first file becomes it. Otherwise: clips.
Non-video files get a plain message.

## Routes

- `/s/:id/short/:short` and `/v/:n`: the thread, scrolled to the latest
  card of that short or version, with a ring. A version that isn't there
  says so.
- `/s/:id/short/:short/v/:n/edit`: the version's page (large player,
  Render, Copy link). The editing tools are spec 11.
- `/s/:id#m-:message`: scrolls to the message.
- Older messages: 200 at a time, loaded when within 200 px of the top; the
  scroll offset from the bottom is kept.

## Not done

- A pixel diff of JASSUB against an ffmpeg frame (plan section 18). The e2e
  reads JASSUB's frame back and checks the hook draws, but doesn't compare
  it with ffmpeg's frame.
- Per-short proxies: a source that doesn't play directly previews only once
  the full proxy is built.
- The creator's name and avatar in the sidebar; the footer has the Settings
  gear instead.
