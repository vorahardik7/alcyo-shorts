# Requirements: planner (spec 8)

Source: docs/build-plan.md v3, sections 3, 14, 16, 17, 22 and 23 spec 8.
Depends on specs 4, 5 and 7.

## Introduction

The planner turns a stream's transcript into proposed shorts, and each chat
message into one checked action. The signed-in agent only reads text (the
profile, numbered transcript lines, the thread) and answers with line ids,
word ids and one action from a fixed list. Code maps the ids to times, snaps
them to pauses, checks the result, and saves versions.

## Glossary

- **Agent**: the signed-in coding agent chosen in spec 5, or the API key.
- **Line**: one transcript line, at most 12 s, shown to the agent as
  `L0001 00:00:04 <words>`.
- **Window**: the words around one short, with their word ids, sent so the
  agent can revise or retime it.
- **Head**: a short's latest version.

## Requirements

### Requirement 1: Find shorts input (P0)

1. WHEN Find shorts runs, THE planner SHALL send the profile text, one stream
   header line, the asked-for count and length range, and one row per line:
   its id, its start time, markers, and its words.
2. A line inside a placed viewer clip SHALL be marked `[clipped]`, or
   `[clipped xN]` when N clips overlap it. A line after a gap in speech of a
   second or more SHALL be marked `[pause]`.
3. A test SHALL check the input has no media bytes, no file paths, no word
   ids and no word-level times.

### Requirement 2: Find shorts result (P0)

1. THE answer SHALL be a `ClaudeProposal`, mapped from line ids to the first
   word's start and the last word's end.
2. EACH edge SHALL snap to the nearest pause within 1.5 s.
3. THE checks SHALL be: every line id exists and end is not before start; the
   snapped length is within the profile's range (2 s of slack each side); no
   two shorts overlap, and none overlaps an existing short; the count is the
   one asked for, unless the stream is too short for it.
4. IF the answer fails the schema or the checks, THE planner SHALL send the
   errors back once. IF it fails again, THE planner SHALL post a plain
   failure message and write nothing.
5. ON success, EACH short SHALL be saved as version 1 by Claude, with one
   segment, a centered crop, the profile's caption and hook looks, and the
   hook text over the first 3 s. ONE shorts message SHALL list them.
6. Find shorts SHALL run by itself once per stream, as soon as the
   transcript is in and any waiting clips are placed. After that it runs on
   request. Proxies and thumbnails keep building meanwhile.

### Requirement 3: Long streams (P0)

1. THE input size SHALL be estimated at characters / 4.
2. WHEN it is over 150k tokens, THE planner SHALL split the lines into
   overlapping windows of about 100k tokens. Each window SHALL return up to
   5 candidates from its own lines. Clipped lines from the whole stream SHALL
   be in every window's context.
3. ONE more call SHALL pick the final shorts from the candidates, with the
   same checks.

### Requirement 4: Chat actions (P0)

1. WHEN a message is sent, THE planner SHALL ask for one `ChatAction`, with
   the profile, the last 20 messages as text, the shorts list (head title,
   range and line ids) and the word windows.
2. A reply to a card SHALL target that short, and only its window SHALL be
   sent. Without a reply, a named short id SHALL be checked to exist, and
   windows SHALL be sent for up to 6 shorts.
3. `revise_short` SHALL map keep ranges to segments, snap them, and save a
   new Claude version with the new title and hook. `retime_short` SHALL move
   the start or end to a word's edge. `set_style` SHALL apply a known preset
   to one short or all of them. `new_shorts` SHALL run Find shorts with the
   request, excluding existing shorts. `answer` and `clarify` SHALL post text.
4. EVERY word id SHALL be inside a window that was sent. EVERY changed short
   SHALL be between 5 s and 3 min.
5. EVERY new version from a chat action SHALL record the message id, and a
   version message SHALL be posted for it.
6. THE same retry and failure rules as Requirement 2.4 SHALL apply.

### Requirement 5: In the app (P0)

1. THE thread SHALL show shorts and version messages as simple cards: title,
   hook, reason, start time and length, the version chip, a "Clipped by
   viewers" badge, and Reply. Inline playback is spec 10.
2. THE composer SHALL send text to the planner. Reply SHALL put a quote of
   the card above the composer, and the next message SHALL go to that short.
3. WHILE the agent works, THE thread SHALL show who is working with Cancel.
   Messages sent meanwhile SHALL wait their turn.
4. A Find shorts button SHALL show once the transcript is in.

### Requirement 6: Hints (P1)

1. Lines SHALL carry `[loud]` and `[scene]` hints when that analysis exists.
