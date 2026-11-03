# Design: creator-profile (spec 7)

## Overview

`@alcyo/profile` is new and pure: the interview prompt and checks, defaults,
measures of past shorts, the style prompt, `profileText`, and templates.
`@alcyo/planner` sends the interview and style requests through
`askChecked`, which parses with Zod, runs code checks, and retries once with
the errors. Spec 8 uses the same helper.

Main owns `AgentService` (which agent answers) and `ProfileService` (the
interview state, past shorts, the style, templates). Agent calls run in main:
they only wait on a child process or a fetch, and the API key never leaves
main. Past shorts are quick-analyzed by the worker on the one job queue
(`StreamService.runExclusive`).

## Modules

| File | Contents |
|---|---|
| `profile/src/interview.ts` | `interviewRequest`, `checkDraft`, `isRepeat`, `profileFromDraft`, `DEFAULT_DRAFT`, `MAX_QUESTIONS` |
| `profile/src/measures.ts` | `measurePastShort`, `styleNumbers`, `extraNumbers` |
| `profile/src/style.ts` | `styleRequest`, `styleFrom` |
| `profile/src/text.ts` | `profileText` |
| `profile/src/templates.ts` | `parseAss`, `assColor`, `importTemplate`, `exportTemplate` |
| `planner/src/llm/ask.ts` | `askChecked`, `retryInstruction` |
| `planner/src/interview.ts` | `nextInterviewStep`, `writeStyleSummary` |
| `store/src/profile-store.ts` | `profile.json`, `preset.json`, `templates/`, `samples/` |
| `ipc/src/profile.ts` | `InterviewState`, `ProfileView`, `PendingSample` |
| `desktop/src/main/agent.ts` | `AgentService`: the chosen agent, or the key |
| `desktop/src/main/profile.ts` | `ProfileService` |
| `desktop/src/main/test-agent.ts` | Scripted agent for headless e2e |
| `renderer/src/profile/*` | Onboarding thread, Settings > Profile, caption look preview |

## Decisions

- **Preset ids.** `InterviewStep.done.profile` no longer has preset ids. The
  agent can't know them; the caption-look step sets them, and a missing id
  falls back to the first built-in.
- **Interview state.** `userData/interview.json`, so a restart keeps the
  questions. One agent call at a time. A failed call keeps the question and
  the answer stays on screen with Try again.
- **Limit.** After 8 answers, or Finish now, the instruction says finish and
  the check rejects another question, so the retry carries that back.
- **Checks.** `lengthMs` must be 5 s to 3 min, min before max: an agent that
  answers in seconds gets "25 s is 25000" back. Repeated questions are
  rejected.
- **Built-in looks.** Four caption presets (Bold pop, Clean, Punch, Steady)
  and two hooks, in `@alcyo/schema` so render and the renderer share them.
  `BUNDLED_FONTS` lists the families spec 9 will ship. The preview uses CSS
  with the system font until then; render uses the .ass builder.
- **Jump cuts.** The plan counts jump cuts as gaps in continuous speech.
  That can't be told apart from a pause in a single take, so `cutEveryMs`
  uses scene cuts only.
- **Samples.** `samples/<id>/sample.json` keeps the file name, the
  measurements and the first 8 s of words. The cache is deleted after
  measuring. The original path isn't stored, so a moved video doesn't matter.
- **Style.** The agent writes the words; the numbers are medians measured by
  code and saved with it. The prompt holds no file names.
- **.ass import.** Sizes scale from `PlayResY` (288 when missing) to 1920.
  Alignment and `MarginV` give `positionY`. Styles named Hook or Title
  become hook presets; BorderStyle 3 gives a background.
- **Grok.** The app runs Grok at `--reasoning-effort medium` with Grok's
  default model (`grok-4.7-build-fast`).
- **Test agent.** `ALCYO_TEST_AGENT=script` in headless mode answers three
  questions, then a draft. Never used otherwise.

## Checked live (Nov 2)

Grok Build through the real app: three questions ("What do you stream, and
who usually watches?", "Which moments…", "How long…"), Finish now, a draft
that passed the checks, saved as the profile. The style summary came back in
about 11 s. `ALCYO_LIVE_GROK=1` runs these from `planner/src/llm/live.test.ts`.
