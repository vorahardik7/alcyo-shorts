# Demo footage

Stand-in footage for the demo stream in `../demo.alcyo`, made by
`pnpm demo:build` (`apps/desktop/scripts/build-demo.ts`). It is not a real
stream: the voice is macOS's "Reed (English (US))" reading `scripts/demo/script.txt`
over a generated background, and the yellow box is the "boss" the reframe
follows. To use your own recording, replace `clip.mp4` and run
`pnpm demo:build --new-clip`. This keeps the recording and rebuilds the
analysis, viewer clips and shorts. Include the scripted "parried" and
"Ember" narration cues: the builder uses them to place the two viewer clips.
Replacement footage keeps the proposed crop instead of following the synthetic
box. To generate a new stand-in, move the existing `clip.mp4` first, then
run `pnpm demo:build --generate-stand-in`. These are the only media files git tracks.

- `clip.mp4`: the stream, 112.0 s, 1280x720, H.264 and AAC.
- Two viewer clips, 10 s each, cut from it:

| File             | True start in the stream | Where clip matching put it  |
| ---------------- | ------------------------ | --------------------------- |
| `clip-parry.mp4` | 47700 ms                 | 47700 ms (transcript, 1.00) |
| `clip-ember.mp4` | 84500 ms                 | 84500 ms (transcript, 1.00) |

The shorts were proposed by Grok: "The game is reading chat", "Parried the tail on one hit", "Ember Blade dropped, 1 in 200".
