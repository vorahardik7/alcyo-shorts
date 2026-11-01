# Hook self-test (spec 1, task 10)

Run on Nov 1, 2026 on macOS 27.2 (arm64) with kiro-cli 2.34.0 (KAS 0.66.62).

## Method

Each command hook appends a line to `.hook-log/events.jsonl` (gitignored). The
line holds the hook name, the event, the stdin key names, and the saved path or
shell command. File contents aren't logged. The self-test did two things:

1. Write a dummy `.ts` file with bad formatting (`export   const   cli   =   {x:1}   ;`).
2. Run a dummy upload command: `curl -T hook-selftest-cli.mp4 https://example.invalid/upload`.

It ran three times:

| Run | Engine | How |
|---|---|---|
| A | the ACP session that built spec 1 (same hook behaviour as V3) | the building agent's own tools |
| B | kiro-cli default, the V2 engine | `kiro-cli chat --no-interactive --trust-all-tools --trust-workspace "<steps>"` |
| C | V3 | the same command as B, plus `--agent-engine v3` |

The dummy files were deleted afterwards.

## Which hooks fired

| Hook (file) | Trigger | Run A (building session) | Run B (V2 default) | Run C (V3) |
|---|---|---|---|---|
| lint-on-save (`lint-on-save.json`) | PostFileSave `\.(ts\|tsx)$` | Fired. File reformatted to `export const dummy = { a: 1, b: "two" };` | **Did not fire** | Fired. File reformatted to `export const cli = { x: 1 };` |
| guard-footage (`guard-footage.json`) | PreToolUse `shell` | Fired. **Blocked** (exit 2, reason shown to the agent) | **Did not fire**; curl ran and failed only because the file didn't exist | Fired. **Blocked**; the agent reported the reason and didn't retry |
| guard-footage on ordinary commands | PreToolUse `shell` | Fired on every `execute_bash` call, `blocked: false` | Did not fire | Fired on `pnpm lint`, `pnpm typecheck`, `pnpm test`, `blocked: false` |
| checks-before-done (`checks.json`) | Stop (agent prompt) | Not observable: this run is one long turn | No sign of it | Fired. The agent ran lint, typecheck and test, and skipped build and package "per the hook's conditional" because no spec was finished |
| schema-change-followups (`project-files.json`) | PostFileSave `packages/schema/src/.*\.ts$` | Fired on every save under `packages/schema/src/` | n/a | n/a |
| ipc-contract-followups (`ipc-contract.json`) | PostFileSave `packages/ipc/src/.*\.ts$` | Fired on every save under `packages/ipc/src/` | n/a | n/a |
| validate-project-files (`project-files.json`) | PostFileSave (project JSON) | Not exercised: no matching files exist until spec 2/4, and `plan:validate` arrives in spec 2 | n/a | n/a |
| checks-after-task (`checks.json`) | PostTaskExec | Not exercised: these tasks weren't run through a spec runner that sets task status | n/a | n/a |

Raw evidence from Run C, in `.hook-log/events.jsonl`:

```json
{"hook":"lint-on-save","event":"PostFileSave","keys":["session_id","hook_event_name","cwd","file_path"],"path":".../scripts/hook-selftest-cli.ts"}
{"hook":"guard-footage","event":"PreToolUse","tool":"execute_bash","keys":["session_id","hook_event_name","cwd","tool_name","tool_input"],"inputKeys":["command","description","cwd","run_in_background","timeout"],"command":"curl -T hook-selftest-cli.mp4 https://example.invalid/upload","blocked":true}
```

## Answers to the open question (plan section 35)

**Does PostFileSave fire on agent edits?** Yes, on the V3 engine. It fired for
files the agent created (`fs_write`) and edited (`str_replace`), once per write.
The Kiro docs say file triggers respond only to agent changes, not manual editor
saves.

**Which stdin field carries the saved path?** `file_path`, an absolute path. The
whole PostFileSave payload is `{ session_id, hook_event_name, cwd, file_path }`.
`scripts/hooks/lint-file.mjs` reads `file_path` first and keeps other names as
fallbacks.

**Is `shell` the right matcher name?** Yes. `shell` is a category selector that
matches the shell tool. The tool itself arrives as `tool_name: "execute_bash"` on
macOS (`execute_pwsh` on Windows, per the docs; not tested). The command is in
`tool_input.command`. The PreToolUse payload is `{ session_id, hook_event_name,
cwd, tool_name, tool_input }`.

**Caveat: the engine matters.** kiro-cli 2.34 defaults to the V2 engine, which
ignores `.kiro/hooks/*.json`, so nothing fired and nothing was blocked. Run the
CLI with `--v3` (or `--agent-engine v3`) for these hooks, and for every spec run
that counts on the footage guard.

## Other findings

- The hook tool wrote `timeout` inside `action`; the plan and docs put it at
  hook level. The files use hook level. Whether the runtime honours the 600 s
  `checks-after-task` timeout wasn't tested, because PostTaskExec didn't fire.
- Hooks created during a session fired in that same session for the building
  agent (Run A), even though the hook tool said they'd be active from the next
  session.
- lint-on-save's `eslint --fix` can rewrite code right after an edit (it removed
  `as never` casts flagged as unnecessary). That's expected, but it means the
  agent's next edit has to match the fixed text.
