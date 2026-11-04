# Design: schema (spec 2)

## Overview

`packages/schema` holds every Zod schema, the checks Zod can't express, the
pure short-time math, file migrations and the JSON Schemas for Claude. It
depends only on zod and uses no Node or DOM API, so main, the worker, the
renderer and the MCP server all import the same code. Claude-facing id mapping
and pause snapping live in `packages/planner` (`id-mapping.ts`,
`snapping.ts`), as section 21 lays out, built on the schema package's time
math. `scripts/validate-plan.ts` is the `pnpm plan:validate` command.

## Modules

| File | Contents |
|---|---|
| `primitives.ts` | `Ms`, `Id`, `HttpUrl`, `LineId` (`L` + 4–6 digits), `WordId` (`w` + 5–7 digits), `IsoDateTime`, `HexColor`, `SchemaVersion` |
| `short.ts` | `Segment`, `CropKey`, `WordOverride`, `Short`, `ShortRef`, `ShortVersion`, `ShortFile` (short.json), `Draft`, `VersionSummary` |
| `clip.ts` | `ClipMatch`, `Clip`, `ClipFile` (clip.json) |
| `message.ts` | `Message` and its seven body kinds |
| `profile.ts` | `CreatorProfile`, `GoodMoment`, `Platform` |
| `claude.ts` | `ClaudeProposal`, `ChatAction`, `InterviewStep`, `claudeJsonSchemas` |
| `source.ts` | `Probe`, `Fingerprint`, `YtDlpInfo`, `Source` |
| `transcript.ts` | `Word`, `Line`, `Transcript`, `TranscriptWindow`, `Silences`, `Scenes`, `Loudness`, `AnalysisSteps` |
| `presets.ts` | `CaptionPreset`, `HookPreset`, `PresetFile`, `Template` |
| `project.ts` | `Project`, `StreamsIndex`, `RenderIndex`, `Settings`, `defaultSettings` |
| `checks.ts` | `checkShort`, `checkVersion`, `checkChatAction`, `checkTranscript`, `checkProfile`, `Issue`, `zodIssues` |
| `time.ts` | `shortDuration`, `shortToSource`, `sourceToShort`, `remapShortTime`, `normalizeShortTimes`, `rippleDelete`, `rippleDeleteWords`, `wordRangeToSource` |
| `edit.ts` | The editor's edits (spec 11): `trimSegment`, `splitAt`, `rippleDeleteShortRange`, `restoreWords`, `isWordKept`, `setWordOverride`, `nudgeWord`, `setWordsPerLine`, `setCaptionPreset`, `setCropKey`, `moveCropKey`, `deleteCropKey`, `setHook`, `snapTo`, `SAFE_AREAS`. Pure functions on `Short`; no new file formats. |
| `migrate.ts` | `CURRENT_VERSIONS`, `migrate(kind, raw, registry?)` |
| `files.ts` | `fileKindOf(path)`, `parseProjectFile(kind, text)` |
| `link.ts` | The one link parser (spec 1, extended in app-shell-polish) |
| `testing/arbitraries.ts` | fast-check arbitraries, exported as `@alcyo/schema/testing` for tests only |

Section 22's schemas are copied as written. Additions are noted below.

## Decisions

- **Segments are half-open** `[srcIn, srcOut)`, in source order, and may touch
  (`srcIn` equal to the previous `srcOut`) but not overlap. Cuts stay in
  source order (section 8).
- **Crop key times and hook times are short time.** Keys must be strictly
  increasing with `0 ≤ t < duration`. The hook needs
  `0 ≤ start < end ≤ duration`.
- **Zod schemas stay plain where Claude sees them.** Section 22 notes `.refine`
  doesn't carry into JSON Schema; ordering and references are in `checks.ts`.
  `Segment` and `ClipMatch` keep their `.refine` (`srcOut > srcIn`). No
  refine sits on `CreatorProfile`, because `InterviewStep` uses `.omit` on it,
  which Zod 4 refuses on refined objects; `checkProfile` checks
  `lengthMs.min ≤ max`.
- **`messages.jsonl` lines carry no `schemaVersion`.** The file's version is
  the project's. `plan:validate` checks each line as a `Message`, and drops a
  torn last line like the store will (spec 4).
- **Clip files** add `schemaVersion` to section 22's `Clip`.
- **The source fingerprint** is size, SHA-256 of the first and last 4 MB, the
  ffprobe duration and a stream-layout string (section 15).
- **yt-dlp info is stored after conversion** to integer ms. The raw yt-dlp
  JSON is parsed at the import boundary in spec 6.

## Time math

```
shortDuration(segs)           Σ (srcOut − srcIn)
shortToSource(segs, t)        t in [0, duration] → source ms; t = duration maps to the last srcOut
sourceToShort(segs, s)        s inside a kept segment → short ms; otherwise null
remapShortTime(old, new, t)   t → source via old; if kept in new, back to short time;
                              otherwise the short time of the next kept ms in new (or new duration)
normalizeShortTimes(short, oldSegs)
                              remaps crop keys and the hook after segments change,
                              keeps keys strictly increasing and inside the short,
                              drops a hook that collapses
rippleDelete(short, ranges)   subtracts the union of source ranges from the segments;
                              refuses if nothing would be left
rippleDeleteWords(short, transcript, wordRanges)
                              word ranges → source ranges [from.startMs, to.endMs), then rippleDelete
```

`rippleDelete` and the planner functions return
`{ ok: true, value } | { ok: false, reason }` rather than throwing, because
callers (the editor, the planner's retry) show or send back the reason.

## Planner: id mapping and snapping

- `mapProposalShort(item, transcript)`: one segment from the first word of
  `startLine` to the last word of `endLine`. Fails on an unknown line or an
  end line before the start line.
- `mapKeep(keep, transcript)`: each range through `wordRangeToSource`, sorted,
  and merged where they overlap or touch. Fails on an unknown word or
  `toWord` before `fromWord`.
- `snapShort(short, silences, { sourceDurationMs, maxMoveMs = 1500 })`: each
  `srcIn` moves to the nearest silence end within 1500 ms, each `srcOut` to
  the nearest silence start within 1500 ms, only when the result stays valid
  (inside the source, after the previous segment, before the next one, not
  empty). Then crop keys and the hook are remapped.

## Checks

Each check returns `Issue[]` (`{ path: string; message: string }`), empty when
fine. Paths use `a.b[2].c` form. `zodIssues(error, prefix)` turns a Zod error
into the same shape.

| Check | Rejects |
|---|---|
| `checkShort(short, ctx)` | backwards segments; segments past `ctx.sourceDurationMs`; overlapping or out-of-order segments; crop keys out of order or outside the short; overrides naming words not in `ctx.wordIds`; duplicate overrides; a hook ending before it starts or after the short |
| `checkVersion(v, ctx)` | `checkShort`, plus `parent` not below `version` |
| `checkChatAction(a, ctx)` | `shortId` not in `ctx.shortIds`; `set_style` with scope `short` and no `shortId`; `set_style` with neither preset; `retime_short` with neither a start nor an end word |
| `checkTranscript(t)` | duplicate word or line ids; words out of time order; lines naming unknown words or words out of order; lines over 12 s; line times not matching their words |
| `checkProfile(p)` | `lengthMs.min > lengthMs.max` |

## Migrations

Every stored file kind has a current version, 1 for all of them today.
`migrate(kind, raw)` reads `schemaVersion`, rejects a missing or non-integer
one, rejects one above current ("made by a newer version of Alcyo Shorts"),
and runs registered steps `n → n+1` until current. A missing step is an error
naming it. The registry is passed in, so the tests run a fake two-step chain.
Real steps are added with the first breaking change, each with a test.

## JSON Schema for Claude

`claudeJsonSchemas` holds `z.toJSONSchema(...)` output for `ClaudeProposal`,
`ChatAction` and `InterviewStep` (draft 2020-12, `io: "output"`). Tests:

- Ajv (2020 dialect, dev dependency) compiles each, accepts the same valid
  samples the Zod schema accepts, and rejects the same broken ones.
- The id patterns (`^L\d{4,6}$`, `^w\d{5,7}$`) are present.
- No property in them is a time (`*Ms`, `srcIn`, `srcOut`, `start`, `end`,
  `t`) or a command (`command`, `args`, `ffmpeg`, `shell`).

## plan:validate

`node scripts/validate-plan.ts [paths…]`, run as `pnpm plan:validate`.

1. Roots: the arguments, or `examples/` when there are none.
2. When stdin isn't a TTY, read it for up to 300 ms; if it's hook JSON with a
   `file_path`, add that file.
3. Walk the roots (skipping `node_modules`, `.git`, `cache`), pick files by
   name with `fileKindOf`, and parse each with `parseProjectFile`, which runs
   JSON parsing, `migrate`, the schema and the file's own checks.
4. For a version or draft file inside a `.alcyo` folder, load
   `sources/<sourceId>/source.json` and `analysis/transcript.json` when they
   exist and run `checkShort` with the duration and word ids.
5. Print `file: path: reason` per issue, a summary line, and exit 1 when any
   file is bad.

Node runs the script directly with type stripping, so the schema package uses
explicit `.ts` import extensions (`allowImportingTsExtensions`; every
tsconfig is `noEmit`).

## Correctness properties

Each is a fast-check property with at least 200 runs.

1. **Ripple delete.** For any valid short `s` (with its transcript) and word
   ranges `R` that don't cover all kept time, `rippleDeleteWords(s, R)` is a
   short that passes `Short` and `checkShort`, and
   `duration(s) − duration(result) = |kept(s) ∩ ⋃R|`, computed independently.
2. **Time round trip.** For any valid segments and any source ms `x` inside a
   kept segment, `shortToSource(sourceToShort(x)) = x`; for any `t` in
   `[0, duration)`, `sourceToShort(shortToSource(t)) = t`.
3. **Snapping.** For any valid short and silence list,
   `snapShort` returns a short passing `Short` and `checkShort`, every
   segment edge moved at most 1500 ms, and the segment count is unchanged.
4. **JSON round trip.** For any valid `ShortVersion`, `Message` or
   `CreatorProfile` `v`, `Schema.parse(JSON.parse(JSON.stringify(v)))`
   deep-equals `v`.
5. **Line ids to segments.** For any valid transcript and proposal over its
   lines, every mapped segment starts at some word's `startMs` and ends at
   some word's `endMs`, and passes `Segment`.
6. **Keep ranges to segments.** For any valid transcript and `keep` ranges,
   `mapKeep` returns segments in order, non-overlapping, each passing
   `Segment`, starting on a word start and ending on a word end.
7. **Links.** For any valid `AppLink` in canonical form (`edit` only with a
   `version`, and only `true`), `parseAppLink(formatAppLink(l))` equals `l`.

## Later additions

- Spec 4: `Settings.streamsDir` (nullable, default null) and
  `StreamsIndex.streams[].preview` (default ""). Both have defaults, so files
  written before them still parse and `schemaVersion` stays 1.
- Spec 6: `Settings.urlNoteShown` (default false).
- Spec 8: `Project.autoFindAt` (nullable ISO time, default null): when Find
  shorts ran by itself. Defaulted, so older `project.json` files parse and
  `schemaVersion` stays 1.
- Spec 11: `edit.ts`, pure edit functions. No schema or file format change,
  so fixtures, Claude's JSON Schemas and migrations are unchanged.
