# Tasks: setup-and-claude (spec 5)


- [x] 1. Spec documents
  - requirements.md, design.md, tasks.md
  - _Requirements: all_

- [x] 2. Lookup and choice
  - `locateAgents`, `probeAgent`, `chooseAgent`
  - Settings fields `grokPath` and `codexPath`, provider ids
  - Worker rows and the required summary check
  - _Requirements: 1.1–1.6, 2.1–2.3_

- [x] 3. Providers
  - Claude, Grok, Codex, Anthropic API, fake
  - `parseStructuredOutput`, `--safe-mode` retry, `spawnCommand`
  - _Requirements: 3.1–3.6, 4.1–4.3_

- [x] 4. Download, Locate, API key
  - Pinned whisper download and `model:progress`
  - Locate dialog in main, encrypted key file, `applyApiKey`
  - _Requirements: 5.1–5.3, 6.1–6.4_

- [x] 5. Screens
  - Setup copy and groups, Settings Agent section, Download button
  - _Requirements: 7.1–7.3_

- [x] 6. Audit fixes (Nov 2)
  - Agent folder first on PATH, so npm-installed Codex is found from Finder
  - API backup: structured output instead of forced tool use; alias to model id
  - `spawnCommand` ignores EPIPE on stdin instead of crashing the worker
  - Key file and model download use temp, fsync, rename with the Windows retry
  - `model:progress` at most every 200 ms
  - One row per agent; `claude-auth` removed; fixture matches the worker
  - Settings Agent card shows every agent with its path and Locate
  - _Requirements: 1.4, 2.1–2.3, 5.1, 6.2, 6.3, 7.1, 7.2_
