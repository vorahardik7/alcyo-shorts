# Third-party notices

Alcyo Shorts is MIT licensed. It ships with, or is built from, the software
below. Each keeps its own license.

## Bundled tools

These programs are bundled next to the app (in `Resources/bin`) and run as
separate processes. Alcyo doesn't link to them.

### FFmpeg and FFprobe 9.0.2

- License: GNU GPL version 2 or later. These builds include GPL parts such as
  x264 and x265.
- macOS build: Martin Riedl's FFmpeg build server, https://ffmpeg.martin-riedl.de
  (build script source: https://git.martin-riedl.de/ffmpeg/build-script)
- Windows build: gyan.dev essentials build, https://www.gyan.dev/ffmpeg/builds/
- FFmpeg source code: https://ffmpeg.org/download.html and
  https://git.ffmpeg.org/ffmpeg.git (tag n9.0.2)
- Libraries inside these builds include libass (ISC), FreeType (FTL), FriBidi
  (LGPL 2.1), HarfBuzz (MIT), x264 (GPL 2), x265 (GPL 2), libvpx (BSD), dav1d
  (BSD), opus (BSD), LAME (LGPL) and zlib (zlib).

### whisper.cpp v1.9.5 (whisper-cli)

- License: MIT. Copyright (c) 2023-2026 The ggml authors.
- Source: https://github.com/ggml-org/whisper.cpp

### yt-dlp 2026.10.26

- License: The Unlicense (public domain).
- Source: https://github.com/yt-dlp/yt-dlp
- The standalone builds include Python and other components under their own
  licenses. yt-dlp lists them in its THIRD_PARTY_LICENSES.txt.

### Silero VAD v6.2.0 (ggml conversion)

- License: MIT. Copyright (c) 2020-present Silero Team.
- Source: https://github.com/snakers4/silero-vad, converted by
  https://huggingface.co/ggml-org/whisper-vad

## Libraries in the app

- Electron (MIT), including Chromium (BSD-style and others, listed in the
  app's `LICENSES.chromium.html`) and Node.js (MIT)
- React and React DOM (MIT), Copyright (c) Meta Platforms, Inc. and affiliates
- TanStack Router (MIT), Copyright (c) Tanner Linsley
- Zod (MIT), Copyright (c) Colin McDonnell
- Tailwind CSS (MIT), Copyright (c) Tailwind Labs, Inc.

Fonts, JASSUB and libass (WASM) are added in later builds and listed here
when they are.
