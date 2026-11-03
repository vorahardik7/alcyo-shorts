---
inclusion: fileMatch
fileMatchPattern: ["packages/planner/**/*.ts", "packages/profile/**/*.ts"]
---
# Coding agents

- Supported: Claude Code, Grok, Codex. Saved provider if that agent is
  signed in, else the first signed-in one in that order.
- Find each: saved path, known folders, macOS login shell once, Locate.
  A Finder-launched app has no terminal PATH. A Windows .cmd/.bat/.ps1
  shim is not spawned.
- Claude: -p --output-format json --json-schema <schema> --safe-mode
  --tools "" --disallowedTools "mcp__*" --max-turns 3
  --no-session-persistence --model <setting>. Instruction as an arg,
  input on stdin, empty temp cwd. If --safe-mode is rejected with -p:
  --strict-mcp-config and --setting-sources project. Never --bare.
  Drop ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN. Auth: `claude auth status`.
- Grok: --prompt-file, --output-format json, --json-schema, --tools "",
  --max-turns 3, --no-subagents, --disable-web-search, --verbatim.
  Drop XAI_API_KEY. Do not pass the Claude model name. Auth: `grok models`.
- Codex: exec --ephemeral --sandbox read-only --ignore-user-config
  --ignore-rules --output-schema <file> --output-last-message <file>.
  Drop OPENAI_API_KEY. Do not pass the Claude model name.
  Auth: `codex login status`.
- Read structured_output, or the raw JSON. is_error or non-JSON fails.
  One retry with the Zod errors, then a plain failure message.
- Cancel: SIGINT, then SIGTERM after 5 s. No shell.
- Schemas: ClaudeProposal (line ids), ChatAction (one of six actions),
  InterviewStep. Never times, never commands.
- Input is text only: profile, numbered lines with markers, last 20
  messages, the shorts list.
- Never offer an agent login, read an agent's config directory or Keychain
  entry, or store, log or pass agent tokens. The API key is the backup and
  stays in the OS key store.
