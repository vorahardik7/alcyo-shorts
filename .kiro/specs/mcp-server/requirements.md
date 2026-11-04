# Requirements: mcp-server (spec 12)

Source: docs/build-plan.md v3, sections 23 spec 12 and 27. Depends on specs
3, 4 and 9.

## Requirements

### Requirement 1: Tools (P0)

1. THE server SHALL expose `probe_video`, `open_project`, `list_shorts`,
   `get_transcript_window`, `get_thread`, `validate_version` and
   `render_short`, each with a Zod input schema. Bad input SHALL be refused
   with the schema's message.
2. `render_short` SHALL return output paths plus an ffprobe summary, and
   record the render in the stream's `renders/index.json`.
3. `validate_version` SHALL list every issue, including a file that doesn't
   parse.

### Requirement 2: Limits (P0)

1. THE server SHALL only read and write under its root folder, after
   symlinks; `..`, absolute paths outside it and links out of it SHALL be
   refused. A recording outside the root SHALL NOT be read.
2. THE server SHALL NOT import Electron.

### Requirement 3: Kiro (P0)

1. `.kiro/settings/mcp.json` SHALL run `packages/mcp/dist/index.js --root
   examples`, auto-approving the six read-only tools; `render_short` asks.
