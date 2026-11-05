# How Kiro was used

Alcyo Shorts was built with Kiro, one spec at a time, from the plan in
[`docs/build-plan.md`](docs/build-plan.md). Everything Kiro reads is in
[`.kiro/`](.kiro/) and committed. This page answers the rules' questions in
their order.

## 1. Surfaces

- **Kiro agent sessions** (the Kiro agent over ACP, with the same hook engine
  as CLI V3) built specs 1 to 13: planning each spec, writing code and tests,
  running the checks, and committing.
- **kiro-cli 2.34.0** was used to prove the hooks on both engines (the V2
  default and `--agent-engine v3`), see
  [`hook-self-test.md`](.kiro/specs/project-setup/hook-self-test.md), and
  to validate the custom agent (`kiro-cli agent validate`).
- **Kiro's MCP client** called the project's own MCP server to check the
  demo project and renders (section 6).
- Sub-agents ran research in parallel with the build, for example how T3
  Code lays out its provider settings and sidebar before spec 9's UI pass.

_To confirm by Hardik:_ which specs, if any, were run in the Kiro IDE (the
plan wanted the IDE for `schema`, for its spec Correctness feature).

## 2. Custom agents

[`.kiro/agents/reviewer.json`](.kiro/agents/reviewer.json) is a read-only
reviewer. It gets the `read` and `shell` tools; its permission rules deny
every file write and allow only `git status`, `git diff`, `git log`,
`git show`, `ls` and `wc` in the shell. Its prompt checks a finished spec
against its requirements and the plan's agent rules (section 34): nothing
media leaves the computer, the LLM returns only ids and one listed action,
Zod at every boundary, args arrays and no shell strings, integer ms, one crop
function, one `.ass` builder, one link parser.

Run it with `kiro-cli chat --agent reviewer "Review spec render-engine"`, or
pick `reviewer` in the IDE's agent menu.

## 3. Hooks

Five files in [`.kiro/hooks/`](.kiro/hooks/):

| Hook                      | Trigger                             | What it does                                                                                                                 |
| ------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `checks-after-task`       | PostTaskExec                        | `turbo run lint typecheck test` after each spec task, cached per package.                                                    |
| `checks-before-done`      | Stop                                | Reminds the agent to run the checks (and build and package at the end of a spec) and say which ran.                          |
| `lint-on-save`            | PostFileSave `.ts`/`.tsx`           | ESLint `--fix` and Prettier on the one saved file (`scripts/hooks/lint-file.mjs`).                                           |
| `validate-project-files`  | PostFileSave on project JSON        | `pnpm plan:validate`: every project, version, clip, profile and thread file against the Zod schemas.                         |
| `schema-change-followups` | PostFileSave `packages/schema/src/` | Prompts the agent to update fixtures, the demo project, migrations and the JSON Schemas sent to the agent.                   |
| `ipc-contract-followups`  | PostFileSave `packages/ipc/src/`    | Prompts for a Zod-checked handler and a handler test for every new channel. It fired while `demo:open` was added in spec 13. |
| `guard-footage`           | PreToolUse `shell`                  | Blocks commands that look like they upload or commit video or audio.                                                         |

**guard-footage is one of three layers.** Video and audio must never leave
the computer or reach git (except the demo footage in `examples/demo/`).

1. **Kiro PreToolUse hook**
   ([`scripts/hooks/guard-footage.mjs`](scripts/hooks/guard-footage.mjs)).
   It splits each shell command into simple commands, honouring quotes, and
   exits 2 with a reason for uploads of media (`curl -T` or `-F`,
   `wget --post-file`, `scp`, `rsync`, `rclone`, `gsutil`, `aws`, and others),
   ffmpeg writing to a network output, and
   `git add` of media outside `examples/demo/`. The self-test showed it
   blocking `curl -T hook-selftest-cli.mp4 https://example.invalid/upload`
   on V3, with the agent reporting the reason and not retrying.
2. **git pre-commit hook**, installed by `pnpm hooks:install`
   ([`scripts/install-git-hooks.mjs`](scripts/install-git-hooks.mjs)),
   which runs `scripts/check-no-media.mjs --staged`.
3. **CI**, `pnpm check:media` on every push and pull request.

The hook matches command patterns, so a program that uploads from inside its
own code gets past layer 1; layers 2 and 3 still keep media out of the repo.
The extension list lives in one place, `scripts/media-extensions.mjs`, and
`.gitignore` follows it.

## 4. Specs

Fourteen specs in [`.kiro/specs/`](.kiro/specs/), each with
`requirements.md` (EARS criteria with P0/P1 tags), `design.md` and
`tasks.md`, built in the order in plan section 23:

`project-setup`, `app-shell-polish`, `schema`, `media-engine`,
`project-store`, `setup-and-claude`, `import-and-clips`, `creator-profile`,
`planner`, `render-engine`, `chat-shell`, `editor`, `mcp-server`,
`demo-and-docs`.

Each spec ended with lint, typecheck, unit tests, build, the Playwright
tests and a packaged macOS build, then one commit. When the build changed a
decision, the spec and the plan were updated with it (for example the
render engine's move from one input per segment to one sequential decoder,
recorded in `render-engine/requirements.md` and the plan's audit notes).

## 5. Steering

Seven files in [`.kiro/steering/`](.kiro/steering/):

- Always on: `product.md` (the hard rules, such as no media uploaded and the
  LLM returns only ids), `tech.md` (versions, Zod at every boundary, integer
  ms, child-process rules), `structure.md` (what lives in each package, which
  packages may import what).
- By file match: `electron.md` for main, preload and worker; `ffmpeg.md`
  for media, render, import and profile; `claude.md` for planner and
  profile; `ui.md` for the renderer.

## 6. MCP

[`packages/mcp`](packages/mcp) is Alcyo's own MCP server, configured in
[`.kiro/settings/mcp.json`](.kiro/settings/mcp.json) with `--root examples`.
Seven tools with Zod inputs: `probe_video`, `open_project`, `list_shorts`,
`get_transcript_window`, `get_thread`, `validate_version` and
`render_short`. The six read-only tools are auto-approved. Every path is
resolved through symlinks and must stay inside the root.

Kiro used it to check work instead of trusting it. In spec 13,
`render_short` on the demo's editor version returned
`1080 × 1920, h264/aac` with the expected length, and frames from that file
showed the crop following the moving box. That check also caught a bug in
the demo footage: the "boss" box hadn't been moving at all (ffmpeg's
`drawbox` reads `t` as thickness, not time), so the footage was rebuilt
with `overlay`.

## 7. Property-based testing

fast-check properties run with the unit tests:

- `packages/schema/src/properties.test.ts`: ripple delete keeps a valid short
  and removes exactly the kept time; source time to short time and back is
  the identity inside kept segments, and source time outside them has none;
  versions, messages and profiles round-trip through JSON and their schemas;
  `alcyo://` links format and parse back to the same link.
- `packages/planner/src/mapping.test.ts`: snapping keeps a short valid and
  moves no cut more than 1500 ms; line ids and keep ranges map to in-order,
  non-overlapping segments on word boundaries.
- `packages/media/src/media.test.ts`: transcript chunks cover the audio with
  no gaps, cutting within 2 minutes of the target length; every word gets a positive length of at most 3 s, in order; every word lands
  in exactly one line of at most 12 s.

## 8. Powers

Not used. The plan listed packaging the MCP server and the ffmpeg notes as a
power as a stretch goal; it wasn't done.
