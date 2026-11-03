# Design: planner (spec 8)

## Overview

`@alcyo/planner` gains three pure modules: the lines the agent reads, Find
shorts, and chat actions. Each sends one request through `askChecked`
(spec 7), which parses with Zod, runs code checks, and sends the problems
back once. The check closures build the result as they check it, so what is
saved is exactly what passed.

Main owns `PlannerService`. It loads a stream's transcript, silences,
placed clips, the profile and presets, calls the planner, and saves versions
and messages through the stream store. Agent calls run in main, off the
worker's job queue: they only wait on a child process or a fetch, so
proxies and thumbnails keep building meanwhile.

## Modules

| File | Contents |
|---|---|
| `planner/src/lines.ts` | `promptLines`, `formatLine` (`L0001 00:00:04 [pause] [clipped x2] words`), `streamHeader`, `lengthRange`, `estimateTokens`, `clock`, `seconds` |
| `planner/src/find-shorts.ts` | `findRequest`, `buildProposal` (map, snap, check), `newShort`, `splitWindows`, `findShorts` |
| `planner/src/chat-actions.ts` | `chatRequest`, `applyChatAction`, `chatAction`, `editRange`, `windowShorts` |
| `planner/src/plan.live.test.ts` | Opt-in live run with Grok on a real VOD's words |
| `desktop/src/main/planner.ts` | `PlannerService`: inputs, per-stream agent queue, working indicator, cancel, the one automatic run |
| `desktop/src/renderer/src/streams/shorts.tsx` | Short cards, shorts and version bubbles, reply quote, working bubble |

## Find shorts

1. Rows: one per line with its start time and markers. `[pause]` is a gap in
   speech of 1 s or more before the line. `[clipped xN]` counts placed clips
   (confidence ≥ 0.6) that overlap it. No word ids, word times or paths.
2. Instruction: what the markers mean, the count and length range, the
   profile's rules, the creator's request (`new_shorts`), and the line ranges
   of existing shorts not to overlap. Input: profile text, stream header,
   `# Pick 3 shorts, each 25 to 40 s.`, then the rows.
3. `buildProposal` maps line ids to the first word's start and last word's
   end (`mapProposalShort`), builds version 1 (centered crop, the profile's
   caption and hook looks, hook text over the first 3 s), snaps with
   `snapShort`, and checks: title and hook not blank, length within the
   profile's range ± 2 s, `checkShort`, no overlap with each other or with
   existing shorts, and the count. Every problem goes into the retry.
4. Count: 3 by default, fewer only when the stream has no room for 3 at the
   shortest length.
5. Long input (characters / 4 over 150k tokens): `splitWindows` makes
   windows of about 100k tokens that overlap by about 5k. Each window asks
   for up to 5 candidates from its own rows, with clipped rows from the rest
   of the stream below it as context. A window that fails twice is skipped.
   One final call sees each candidate's rows (2 before, 2 after) and picks
   the count, with the same checks, limited to those rows.

## Chat actions

- Input: profile text, stream header, the shorts list (`sh_x v2 "Title".
  00:21:01 to 00:21:34 (33 s), lines L0412 to L0420. Hook: "...".
  Captions: bold-pop.`), the caption and hook looks, the last 20 messages
  as text (status and render messages left out), the word windows, and the
  message.
- Windows: the reply target only, or the newest 6 shorts. Each covers the
  short ± 20 s, as `L0412 w04512:NO (w04513:um)`, where parentheses mark
  words cut from the current version.
- Checks: `checkChatAction` (known short ids, a retime needs a word, a
  style needs a preset); a reply targets its short; word ids are in a sent
  window; presets exist; the result passes `checkShort`.
- Length: a changed short stays in the profile's range (± 2 s) unless the
  message names a length ("cut it to 20 seconds", "3 s earlier"), when 5 s
  to 3 min is allowed. The live run showed why: "make it punchier" first
  turned a 42 s short into 6 s.
- `revise_short`: keep ranges → `mapKeep` → `normalizeShortTimes` → snap.
  New title; the hook gets the new text over the first 3 s.
- `retime_short`: the new first word's start or last word's end replaces
  the edge; segments outside are dropped; snapped. A hook at 0 stays at 0.
  `whatChanged` is written by code ("Starts 4 s earlier.").
- `set_style`: one short or all. Saved with `createdBy: "user"`, following
  the plan's "user-style versions": the creator chose it, code applied it.
- `new_shorts`: Find shorts with the request and existing shorts excluded,
  in the same job.
- `answer`, `clarify`: a text message from the agent.

## Main

- `PlannerService.queue` runs one agent job per stream at a time. A message
  sent meanwhile is posted at once and waits its turn. The job sets
  `thread:working` (`Grok is finding shorts`, `Grok is reading your
  message`) and clears it at the end.
- Cancel: `job:cancel` tries the planner first, then the analysis queue. A
  running job's AbortSignal stops the agent (SIGINT, then SIGTERM). A
  cancelled job posts "Stopped. Nothing changed." and writes nothing.
- Failure: the plain error is posted as an app message, and the sidebar
  gets an unread dot. Nothing is written before every check passes.
- Inputs mid-analysis: the probe comes from `analysis/probe.json` until
  `source.json` has it.
- The one automatic run: `StreamService` calls `onReady("transcript")` at
  the transcript's `step-done`, and `onReady("clips")` after the clip checks
  queued behind analysis. The planner runs once when the transcript is in
  and no clip waits to be placed. `project.autoFindAt` records it, so a
  restart or a reanalysis doesn't run it again.
- `stream:open` adds `planner: { ready, working }`. New channels:
  `shorts:find`, `chat:send` (with `replyTo`). New event: `thread:working`.

## Renderer

Shorts messages show a grid of cards: title, hook, reason, start and
length, "Clipped by viewers", the version chip (`v1 · Agent`), and Reply.
Version messages show `whatChanged` and the new version's card. Reply puts
"Replying to “Title” v1" above the composer; Escape or × clears it. The
next message is sent with `replyTo`, and the user bubble shows the quote.
A Find shorts button sits above the composer once the transcript is in.

## Live results (Nov 3, Grok `grok-4.7-build-fast`, medium effort)

On a 4.7-hour VOD's YouTube word times (28,510 words, 225k characters,
about 56k tokens):

- Find shorts, one call: 91 to 110 s. Once of three runs it needed the
  retry. Picks: the cat bringing a dead mouse mid-match, yelling at a
  teammate who turns out to be a bot, the account costing more than the car.
- Reply "make this one punchier, cut the slow start": `revise_short`, 33 s
  to 28 s, 37 to 50 s.
- Windowed (forced with 30k/20k token limits): 3 windows and a final pick,
  4 calls, about 9 minutes.
- In the app with real Grok: Find shorts 82 s, a reply edit 33 s.

## Not done here

- `[loud]` and `[scene]` hints (P1).
- Inline playback, Open editor, Render and Copy link on cards (specs 9 to
  11).
