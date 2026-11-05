# Examples

- `demo.alcyo/`: the demo stream that Home's **Open the demo stream** opens
  (the app copies it, with its footage, into your streams folder first). It
  has analysis, two placed viewer clips, three proposed shorts, one chat
  revision and one editor version. Media paths in it are relative
  (`../demo/clip.mp4`), so it opens from any checkout.
- `demo/`: the stand-in footage; see [`demo/README.md`](demo/README.md).
- `demo-profile.json`: the creator profile the demo installs when you have
  none yet.

Rebuild all of it with `pnpm demo:build` (macOS, needs the small.en model and
a signed-in agent; `--agent script` uses the test agent instead).

This folder is also the root of the Alcyo MCP server
(`.kiro/settings/mcp.json`). Stream folders under it can be opened, checked
and rendered by the server. Renders and audio caches stay out of git;
the demo keeps its thumbnails and waveform so it opens with them.
