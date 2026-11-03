# Requirements: setup-and-claude (spec 5)

Source: docs/build-plan.md v3, sections 16 and 23 spec 5, updated Nov 2 so
setup uses whichever local coding agent is signed in. Depends on specs 1 to 4.

## Introduction

Setup finds a coding agent already installed on this computer and checks the
bundled tools. The supported agents are Claude Code, Grok and Codex. The
saved choice wins when that agent is signed in. Otherwise Alcyo uses the
first signed-in agent in that order. An Anthropic API key is the backup when
none of them is signed in.

The planner calls these providers in spec 8. This spec builds the providers,
the lookup, the whisper model download, Locate, and the API key file.

## Glossary

- **Agent**: Claude Code (`claude`), Grok (`grok`) or Codex (`codex`).
- **Signed in**: that agent's own auth command exits 0. Alcyo keeps the exit
  code and throws away the output.
- **Ready**: the binary runs and the agent is signed in.
- **Shim**: a Windows `.cmd`, `.bat` or `.ps1` wrapper. It is not spawned.

## Requirements

### Requirement 1: Find the agents (P0)

1. THE resolver SHALL look up each agent in this order: the saved path, the
   known folders, then on macOS one login-shell `command -v`, and on Windows
   `where.exe`.
2. Known macOS folders SHALL be `~/.local/bin/<bin>`, `/opt/homebrew/bin/<bin>`
   and `/usr/local/bin/<bin>`. Claude Code SHALL also be looked up in
   `~/.claude/local/claude`.
3. Known Windows folders SHALL be `%USERPROFILE%\.local\bin\<bin>.exe` and
   the WinGet Links folder. THE lookup SHALL work when `PATH` is only
   `/usr/bin:/bin` (test).
4. "Runs" SHALL mean the version command exits 0. Auth output SHALL NOT be
   kept. THE child env SHALL drop that agent's billing key:
   `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` for Claude,
   `XAI_API_KEY` for Grok, `OPENAI_API_KEY` for Codex.
5. A Windows shim SHALL be reported as `cmd-shim` and SHALL NOT be spawned.
6. THE lookup SHALL NOT read `~/.claude`, `~/.grok`, `~/.codex`, the Keychain,
   or any token file.

### Requirement 2: Choose one (P0)

1. WHEN the saved provider's agent is ready, THE setup check SHALL choose it.
2. OTHERWISE THE setup check SHALL choose the first ready agent in the order
   Claude, Grok, Codex.
3. Setup SHALL be complete when that summary check passes, or when a saved
   API key is present and no agent is ready, and the existing required tool
   checks pass. A missing Grok or Codex SHALL NOT by itself block setup.
   A missing Claude Code SHALL fail only when nothing else is ready.

### Requirement 3: Providers (P0)

1. THE providers SHALL be `claude-cli`, `grok-cli`, `codex-cli`,
   `anthropic-api` and `fake`.
2. EACH CLI provider SHALL spawn an args array in an empty temp directory.
   No shell. `spawnCommand` SHALL cancel with SIGINT, then SIGTERM after 5 s.
3. THE Claude provider SHALL use the section 16 args, with the instruction as
   an argument and the input on stdin, and SHALL drop both Anthropic env vars.
4. THE Grok provider SHALL pass a prompt file and SHALL drop `XAI_API_KEY`.
   The settings model name SHALL NOT be passed to Grok or Codex.
5. THE Codex provider SHALL run `codex exec` in a read-only sandbox and SHALL
   read the last-message file. It SHALL drop `OPENAI_API_KEY`.
6. THE parser SHALL accept `structured_output`, a fenced JSON value, or a raw
   JSON object. `is_error: true`, or text that is not JSON, SHALL fail.

### Requirement 4: `--safe-mode` (P0)

1. THE Claude provider SHALL try `--safe-mode` first.
2. WHEN the process exits non-zero, stdout is not JSON, and stderr says the
   flag is unknown, THE provider SHALL retry once with `--strict-mcp-config`
   and `--setting-sources project`.
3. THE design SHALL say that Claude Code 2.1.317 lists the flag, and that no
   billed `claude -p` probe was run.

### Requirement 5: Whisper model (P0)

1. THE download SHALL fetch the pinned Hugging Face file for `small.en` or
   `base.en`, hash it, and rename it into place only when the SHA-256 matches.
2. A bad hash SHALL leave any existing good file in place and SHALL delete
   the partial file.
3. THE model check SHALL stay optional, so Continue is not blocked on the
   download. Progress SHALL be reported on `model:progress`.

### Requirement 6: Locate and the API key (P0)

1. Locate SHALL open the file dialog in main. The renderer SHALL NOT send a
   path. THE chosen file SHALL be kept only when its version command exits 0,
   and settings SHALL store that path and the matching provider.
2. THE API key SHALL be encrypted with `safeStorage` in
   `userData/anthropic-key.bin`. It SHALL NOT be written to settings, logged,
   or returned to the renderer.
3. THE Messages API call SHALL send the JSON schema as structured output
   (`output_config.format`), not a forced tool, and SHALL send a model id,
   not a Claude Code alias. Error text SHALL NOT include the key or the
   response body.
4. THE worker SHALL NOT see the key. Main SHALL apply key presence after the
   worker returns.

### Requirement 7: Screens (P0)

1. Setup SHALL show one row per agent plus the summary and the optional key,
   with one fix line and a command chip where a command exists.
2. Settings SHALL keep the section id `claude`, label it Agent, and offer
   Locate for each agent, the key field, and Download on the model row.
3. Alcyo SHALL NOT offer an agent login.
