# Requirements: demo-and-docs (spec 13)

Source: docs/build-plan.md v3, sections 23 spec 13, 28, 30 and 31. Depends
on specs 4, 6, 8, 9, 10, 11 and 12.

## Requirements

### Requirement 1: Demo project (P0)

1. `examples/demo.alcyo` SHALL include analysis, two matched clips, a thread
   with the agent's three proposals, one chat revision and one editor
   version, pointing at `examples/demo/clip.mp4`, plus
   `examples/demo-profile.json`.
2. Media paths in the committed project SHALL be relative to the stream
   folder, and the store SHALL resolve them against it, so the project opens
   from any checkout and through the MCP server.
3. The project SHALL be made by the app's own services (analysis, clip
   matching, planner with a real agent, editor save) from a script, not
   written by hand.
4. Rebuilding SHALL preserve existing recording bytes. `--new-clip` SHALL
   require an existing replacement recording and default to Grok without an
   explicit `--agent`. `--generate-stand-in` SHALL refuse an existing recording,
   including one created while generation is running. Invalid options SHALL
   fail before analysis or agent calls.

### Requirement 2: Open demo (P0)

1. Open the demo stream SHALL copy the project, with its recording and clips
   copied into it, to the streams folder and open it. A second open SHALL
   open the same stream unless its folder is gone.
2. Browsing, editing and rendering it SHALL need no agent, no key, no network
   and no whisper model.
3. IF no creator profile exists, THE app SHALL install the demo profile;
   otherwise it SHALL keep the creator's.
4. A follow-up message on the demo without a signed-in agent SHALL say no
   agent is signed in and how to set one up.
5. The packaged app SHALL ship the demo in its resources, without renders or
   audio.

### Requirement 3: Tests (P0)

1. A Playwright test SHALL open the demo with no agent, render short 1 and
   check it with ffprobe (1080 × 1920, H.264, AAC, within 100 ms of the kept
   segments), on Mac and Windows, in CI, against the built and the packaged
   app.

### Requirement 4: Docs (P0)

1. THE README SHALL cover download, the Gatekeeper and SmartScreen steps,
   building from source, setup, onboarding, the judge path, what stays on
   the computer, and "only download videos you own or have permission to
   use".
2. THE repo SHALL include `KIRO.md`, answering the rules' Kiro questions in
   order (surfaces, custom agents, hooks, specs, steering, MCP,
   property-based testing, powers), and describing `guard-footage` as one of
   three layers.
3. `.kiro/agents/reviewer.json` SHALL be a read-only reviewer (plan section
   28).

## Not in this spec

- The real demo footage and its 20 hand-marked word times (plan section 33):
  the committed footage is a synthetic-voice stand-in until Hardik records it.
- The GitHub repo, Releases and the Windows run of CI wait for Hardik's go.
