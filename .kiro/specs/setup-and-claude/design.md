# Design: setup-and-claude (spec 5)

## Overview

Lookup and the four real providers live in `@alcyo/planner`, which does not
import Electron or IPC. The worker runs the lookup. Main owns the file
dialog, the model download, and the key file, because those need Electron.
The renderer only sees the setup report and button clicks.

Spec 8 is the first caller of `complete()`. This spec still ships
`spawnCommand`, so cancel behavior is real before that caller exists.

## Modules

| File | Contents |
|---|---|
| `planner/src/llm/locate-agents.ts` | `locateAgents`, `probeAgent`, `chooseAgent`, known paths |
| `planner/src/llm/claude-cli.ts` | Claude args, `--safe-mode` retry, scrubbed env |
| `planner/src/llm/grok-cli.ts` | Grok args, prompt file, `scrubGrokEnv` |
| `planner/src/llm/codex-cli.ts` | Codex args, last-message file, `scrubCodexEnv` |
| `planner/src/llm/anthropic-api.ts` | Messages API body and tool-use parse |
| `planner/src/llm/provider.ts` | `LlmProvider`, `PlannerError`, `parseStructuredOutput` |
| `planner/src/llm/spawn.ts` | `spawnCommand`: args array, SIGINT then SIGTERM |
| `planner/src/llm/fake.ts` | Canned value for tests |
| `ipc/src/setup.ts` | Report fields `agents`, `chosen`, `apiKey`, `applyApiKey` |
| `desktop/src/worker/setup.ts` | Builds the agent rows from the lookup |
| `desktop/src/main/whisper-download.ts` | Pinned download |
| `desktop/src/main/api-key.ts` | Encrypted key file |
| `desktop/src/main/index.ts` | Locate, download, set and clear key |

## Decisions

- **Which agents.** Claude Code, Grok and Codex. Each one has a headless
  structured-output invocation we could name from its own help. Gemini,
  cursor-agent, opencode and amp are on this machine and are not called.
  Their structured-output flags were not confirmed.
- **Order.** Saved `settings.provider` when that agent is signed in. Else
  Claude, then Grok, then Codex. `anthropic-api` is not an agent. A saved
  key covers the required summary row only when `chosen` is null.
- **Missing rows.** Grok or Codex missing is `pending` and not required.
  Claude missing is `fail` only when no agent is ready, so the existing
  install line still shows when nothing is signed in. It is `pending` when
  another agent is ready. Signed-in-but-not is `fail` and not required.
- **Settings file.** Schema version stays 1. `grokPath` and `codexPath`
  default to null, so an old settings file still parses. Provider values
  `claude-cli`, `grok-cli`, `codex-cli` and `anthropic-api` are all valid.
  The model field stays `"sonnet"` and is sent only to Claude.
- **Claude `--safe-mode`.** `claude --help` on 2.1.317 lists the flag. A
  live `claude -p` call would bill the account, so it was not run. The
  provider tries the flag, and retries once when `rejectedSafeMode` matches.
  Do not treat the help text as a passed probe.
- **Grok auth.** There is no `auth status` command. `grok models` exit 0 is
  the sign-in check. It uses the network, and it was not verified that a
  logged-out `grok` exits non-zero. `--tools ""` and the prompt-file shape
  were not run against a live login. The parser accepts both a Claude-like
  envelope and a raw object.
- **Grok, checked live (Nov 2).** grok 1.0.70, `grok-4.7-build-fast` at
  `--reasoning-effort medium`, the args above: exit 0 in about 10 s, about
  $0.03. stdout is `{ text, stopReason, sessionId, structuredOutput, … }`,
  so the parser reads `structuredOutput` too. An unknown model prints
  `{"type":"error",…}` and exits 1. `--tools ""` was accepted. The provider
  takes an optional model and effort; unset, Grok uses its own defaults.
  `ALCYO_LIVE_GROK=1` runs `planner/src/llm/live.test.ts` against it.
- **Codex.** `codex login status` is the sign-in check. Its stdout is
  discarded. The safety boundary is `--sandbox read-only` plus
  `--ignore-user-config` and `--ignore-rules`. The last-message file is
  parsed, not the JSONL stream. That file's shape with `--output-schema`
  was not run against a live login.
- **Model pins.** `small.en` SHA-256
  `c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d`
  matches the file already in userData and the Hugging Face etag. `base.en`
  SHA-256 `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`
  is the Hugging Face etag only. It was not hashed from a local file.
  Download is a button. The first run does not fetch it.
- **Key.** `ApiKeyFile` takes a `SecretCodec`. Production uses
  `safeStorage.encryptString`. Tests use a stand-in. `setApiKey` refuses
  when encryption is unavailable. `applyApiKey` rewrites the summary row
  and adds the optional `api-key` check. The fixture path does not call it,
  so headless e2e counts stay stable.
- **Section id.** The settings route stays `/settings/claude`. The visible
  label is Agent. Test ids `claude-card`, `claude-path` and `section-claude`
  stay, because the fail fixture still explains a missing Claude Code.
- **PATH for script installs.** npm installs of Codex are
  `#!/usr/bin/env node` scripts. A Finder-launched app's PATH is
  `/usr/bin:/bin`, so `codex --version` exited 127 and Codex showed as
  missing. Every agent child now gets its own folder first on PATH
  (`withAgentDir`). Checked on this Mac: Claude 2.1.317, Grok 1.0.70 and
  Codex 0.166.0 are all found and signed in with PATH `/usr/bin:/bin`.
- **One row per agent.** The old `claude-auth` row repeated the Claude Code
  row's sign-in state. It is gone; sign-in is part of each agent row. The
  headless fixture now has the same rows as the worker.
- **API backup request.** Claude Sonnet 5.5 and Opus 5.5 return 400 for a
  forced `tool_choice`
  ([what's new in Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5)).
  The body sends the schema in `output_config.format` and reads the JSON
  from the text block. `refusal` and `max_tokens` stop reasons fail. The
  settings alias `sonnet` maps to `claude-sonnet-5-5`; full ids pass
  through. Not run against a live key.
- **For spec 8.** Structured outputs drop `minLength`, `maximum` and similar
  constraints and cap optional fields at 24; OpenAI strict schemas want every
  property required. The planner's schemas should stay flat, and Zod still
  checks every answer.
- **Spawn.** Providers take `SpawnDeps`. Tests pass a fake. `spawnCommand`
  is the real one: no shell, stdin is the input string, stdout and stderr
  are capped at 4 MB, abort sends SIGINT and SIGTERM 5 s later.

## Calls

Claude, safe mode on:

```
claude -p --output-format json --json-schema <schema> --safe-mode
  --tools "" --disallowedTools mcp__* --max-turns 3
  --no-session-persistence --model <model> <instruction>
```

Stdin is the input. The fallback drops `--safe-mode` and adds
`--strict-mcp-config --setting-sources project`.

Grok writes `prompt.txt` in the temp directory and runs:

```
grok --no-auto-update --prompt-file <file> --output-format json
  --json-schema <schema> --tools "" --max-turns 3 --no-subagents
  --disable-web-search --verbatim
```

Codex writes `schema.json` and reads `last.txt`:

```
codex exec --ephemeral --skip-git-repo-check --ignore-user-config
  --ignore-rules --sandbox read-only --color never --json
  --output-schema <schema> --output-last-message <last> -C <cwd> -
```

The Anthropic backup is `POST https://api.anthropic.com/v1/messages` with
`anthropic-version: 2023-06-01` and
`output_config: { format: { type: "json_schema", schema } }`. No tools.
Redirects are errors. A non-OK status becomes "Claude's API refused the
request (status)." and nothing else.
