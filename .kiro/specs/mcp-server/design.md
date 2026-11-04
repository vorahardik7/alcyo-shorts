# Design: mcp-server (spec 12)

`@alcyo/mcp` uses `@modelcontextprotocol/sdk` 1.32 with stdio. `build.mjs`
bundles it with esbuild into one file, `dist/index.js`, that plain Node
runs (Electron is external and never loaded).

| File | Contents |
|---|---|
| `src/root.ts` | `Root`: resolves every path through `realpath` and refuses anything outside the root |
| `src/tools.ts` | The seven tools as plain functions with Zod inputs |
| `src/server.ts` | `createServer`: registers the tools, read-only hints, plain error text |
| `src/index.ts` | `--root`, `--bin` (ffmpeg folder), `--fonts`; defaults to the repo's fetched binaries and `resources/fonts` |

- Paths in answers are relative to the root. A source recorded outside the
  root is shown by file name only.
- `render_short` uses the render engine's `renderShort` with the built-in
  caption and hook looks (the creator's own presets live in the app's
  userData, outside the root), writes to `renders/`, never overwrites, and
  records the render. It checks the recording's fingerprint first.
- `validate_version` reads the version file itself rather than through the
  store, so a version the store would refuse still gets its issues listed:
  JSON, schema (with paths), `checkVersion` (order, range, keys, hook,
  caption word ids), the file's version number, the source fingerprint, and
  looks that aren't built in.
- Tool errors come back as `isError` with one plain sentence.

## Tests

`src/server.test.ts` runs a real MCP client: in memory against
`createServer` for every tool, the root limits (`..`, an absolute path, a
symlink, a recording outside the root) and schema refusals; and over stdio
against the built `dist/index.js`. A real render checks 1080 × 1920, H.264,
AAC and the length within 100 ms.

Checked live on Nov 3 through Kiro's own MCP client (the session's `alcyo`
server) and over stdio: a 10 s recording in a temporary stream under
`examples/` validated with no issues and rendered to a 2.4 s 1080 × 1920
MP4 in 614 ms; `../package.json` was refused.
