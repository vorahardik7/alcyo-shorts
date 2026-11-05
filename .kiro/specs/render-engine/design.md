# Design: render-engine (spec 9)

## Modules

| File | Contents |
|---|---|
| `render/src/crop.ts` | `cropSize`, `cropFraction`, `cropWindow`, `cropXExpr`. Pure. |
| `render/src/ass.ts` | `captionWords`, `captionLines`, `buildAss`, `assColor`, `assTime`. Pure. |
| `render/src/args.ts` | `snapSegments`, `renderPlan`, `RENDER_PRESETS`, `renderFileName`. Pure. |
| `render/src/runner.ts` | `renderShort`, `checkOutput`. Node; imported as `@alcyo/render/runner`. |
| `ipc/src/render.ts` | `RenderRequest`, `RenderEvent`, `RenderResult`, `RenderView`. |
| `desktop/src/worker/render-gate.ts` | Background analysis waits while a render runs. |
| `desktop/src/main/renders.ts` | `RenderService`: the queue, records, notifications. |
| `desktop/src/renderer/src/streams/renders.tsx` | Render card, status, store. |
| `desktop/resources/fonts/` | Inter (Regular, SemiBold, Black), Anton, Montserrat ExtraBold, OFL. |

## Crop

The window is the largest even 9:16 box in the source, vertically
centered. A key's x is a 0..1 fraction of the room it can move in.
`cropXExpr` writes the same function as a sum of interval terms
(`gte(t,a)*lt(t,b)*(x0+slope*(t-a))`), grouped in sections of 32, wrapped in
`clip(2*floor(room*(...)/2),0,room)`. A test evaluates it every 33 ms for
200 keys and compares with `cropWindow`, with nesting under 10 levels.

## Captions

A word is kept when its midpoint is inside a segment. Overrides change
text and timing, clamped to the segment, or hide the word. Lines break at
`wordsPerLine`, a gap over 600 ms, or a sentence end. Each word is one
event showing its line, with that word in the highlight color via `\1c`;
the last word of a line stays up 300 ms. The hook is a layer-1 event; a
preset with a background uses BorderStyle 3. PlayRes is 1080 × 1920.

## Render

Each segment is its own input: `-ss <first frame> -to <end + 0.5 s> -i`.
The graph trims to the frame count, fades audio 10 ms in and out, concats,
then `fps`, `crop`, `scale=1080:1920:flags=lanczos`, `setsar=1`, and
`subtitles=filename=captions.ass:fontsdir=fonts`. The graph goes in
`filter.txt` (`-/filter_complex`), and ffmpeg runs in a work folder under
the stream's `cache/`, so no path is escaped inside the graph. libx264
medium CRF 20, AAC 192k, faststart. The output is written as `.part.mp4`,
probed, checked, then renamed.

## Queue

`RenderService` keeps this session's renders in memory and the finished
ones in `renders/index.json`. One chain runs renders in order. Enqueue
checks the recording exists first. Events: `render:changed` with the full
view. Channels: `render:enqueue`, `render:list`, `render:get`,
`render:cancel`, `render:retry`, `render:reveal` (takes an id, never a
path). In the worker, `RenderGate` holds analysis's background steps.

## UI pass

The layout, from a study of desktop chat apps' sidebars and settings:

- Window: macOS `hiddenInset` with traffic lights at `{ x: 16, y: 19 }`.
- Sidebar 264 px: 52 px drag bar with the glyph and "Alcyo Shorts", a
  32 px search field with ⌘F and a 28 px New stream button, rows with a
  32 px two-letter monogram, name, relative time, preview and unread dot,
  and a 48 px footer with Settings and the render queue (with a count).
- Home: the composer at the vertical center, max 46rem; the headline sits
  above it and the actions below, so the composer never moves.
- Settings: grouped nav (You, This computer, Alcyo), a 52 px header bar,
  4xl body. Agents is a list and detail grid (16rem list from 44rem wide).
  Each row shows a monogram, the name, `v` version and one status line;
  the in-use agent has a green dot. The detail has Use, Version, Locate,
  and "Show where it is" for the path. New channel `agent:use` saves the
  provider and rechecks.
- Icon: a dark tile with a wide stream frame and a tall blue 9:16 short
  breaking out of it, with Alcyone's star. `AppGlyph` is the tileless
  version for 16 px.

## Results (Nov 3, this Mac)

- Real render, two segments of a 1080p60 source, crop keys, captions and
  hook: 1080 × 1920 H.264 + AAC, length within 100 ms, about 3 s.
- In the app: Render on a revised card of a 5-minute 720p recording made
  `straight-to-it-v2-1080p30.mp4` (27 s) in about 6 s.
