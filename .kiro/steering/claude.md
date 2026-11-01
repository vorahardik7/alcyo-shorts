---
inclusion: fileMatch
fileMatchPattern: ["packages/planner/**/*.ts", "packages/profile/**/*.ts"]
---
# Claude notes

- Find claude: saved path, known folders, macOS login shell once, Locate
  claude. A Finder-launched app has no terminal PATH.
- Spawn: -p --output-format json --json-schema <schema> --safe-mode
  --tools "" --disallowedTools "mcp__*" --max-turns 3
  --no-session-persistence --model <setting>. Instruction as an arg,
  input on stdin, empty temp cwd.
- If --safe-mode is rejected with -p: --strict-mcp-config and
  --setting-sources project. Never --bare.
- Remove ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN from the child env.
- Read structured_output. Missing or is_error = failed attempt. One retry
  with the Zod errors, then a plain failure message.
- Cancel: SIGINT, then SIGTERM after 5 s.
- Schemas: ClaudeProposal (line ids), ChatAction (one of six actions),
  InterviewStep. Never times, never commands.
- Input is text only: profile, numbered lines with markers, last 20
  messages, the shorts list.
- Never offer a Claude login, read Claude's Keychain entry or ~/.claude,
  or store, log or pass Claude tokens.
