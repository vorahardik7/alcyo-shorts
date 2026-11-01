---
inclusion: fileMatch
fileMatchPattern: ["packages/media/**/*.ts", "packages/render/**/*.ts", "packages/import/**/*.ts", "packages/profile/**/*.ts"]
---
# ffmpeg, whisper and yt-dlp notes

- Each segment is its own input with -ss and -to before -i, then
  trim/atrim and concat. Snap edges to frames. 10 ms afade at each cut.
- 9:16: crop=w=ih*9/16:h=ih with an x expression from crop.ts, clip(),
  then scale=1080:1920. Over 32 keys, chain sections.
- Captions and hook: one .ass from ass.ts, subtitles=...:fontsdir=<fonts>.
- Progress: -progress pipe:1, out_time_us.
- silencedetect; select='gt(scene,0.3)',showinfo; ebur128.
- Proxy: 720p H.264, keyframe every second, AAC, encoder from the saved
  probe, libx264 veryfast fallback. Skip when the source plays directly.
- whisper-cli: 16 kHz mono WAV, --vad -vm <silero>, -ojf, --dtw <model>,
  chunks split at silences. Check whether --dtw needs -nfa.
- yt-dlp: --no-config --no-cache-dir --no-playlist --ffmpeg-location
  <bundled> -f "bv*[height<=1080]+ba/b[height<=1080]" --merge-output-format
  mp4 --write-info-json, then "--" and the URL. Info JSON through Zod.
- Clip matching: transcript fuzzy match, then audio envelope
  cross-correlation within ±5 s.
- Integer ms in saved files. Convert at the tool boundary.
- Tests read real values with ffprobe.
