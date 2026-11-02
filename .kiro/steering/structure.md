---
inclusion: always
---
# Structure

apps/desktop/src/
  main/       lifecycle, single instance, alcyo:// links, IPC, stream
              service and job queue, alcyo-media://, worker host
  worker/     utilityProcess: import, media, profile, planner, render jobs
  preload/    window.alcyo (invoke, on). Nothing else.
  renderer/   sidebar, thread, cards, editor, render queue, setup,
              onboarding, settings
packages/
  schema/    Zod schemas, JSON Schema export, migrations, link format. Pure.
  ipc/       IPC and worker contracts. Pure.
  store/     stream folders, streams.json, settings.json, thread, sources,
             versions, drafts, atomic writes. Node fs; no electron.
  media/     ffprobe, ffmpeg, whisper wrappers, analysis steps, encoder probe.
  import/    yt-dlp, file import, clip matching.
  profile/   past-short measures, templates, style summary prompt.
  planner/   claude locate, providers, find shorts, chat actions,
             interview, id mapping, snapping.
  render/    crop.ts, ass.ts (pure, shared with renderer), args.ts, runner.ts.
  mcp/       MCP server for Kiro.

## Rules
- schema and ipc depend only on zod. No package under packages/ imports
  electron.
- The renderer never touches fs or child_process. It may import the pure
  parts of schema and render.
- One crop function, one .ass builder, one link parser.
- Nothing is written next to a source video. Past shorts are never copied.
- Never gitignore .kiro/.
