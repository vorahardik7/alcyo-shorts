---
inclusion: always
---
# Product: Alcyo Shorts (working name)

A desktop app for Mac and Windows that turns a long stream into captioned
9:16 shorts. Chat-first: each stream is a conversation. Claude proposes
shorts as cards in the thread; the creator asks for changes by chatting or
opens the editor. Everything is processed on the creator's computer.

## Who it's for
Streamers and small editing teams who post shorts from long streams.

## The flow
1. First run: setup checks, then a Claude interview plus past shorts and
   templates become a creator profile.
2. New stream: paste a URL (yt-dlp) or drop a file. Add viewer clips by URL.
3. Analyze locally: transcript with VAD and word times, clip matching.
   Find shorts unlocks; proxies and thumbnails build in the background.
4. Claude, through the user's own Claude Code, proposes shorts as line ids,
   with the profile and [clipped] markers as context. Text only.
5. Follow-up edits in the thread become one checked ChatAction each.
6. The editor: timeline, transcript editing, captions, reframe, hook.
7. Render queue: ffmpeg renders 1080x1920 MP4s.

## Hard rules
- Video and audio are never uploaded. Only transcript text and the profile
  go to the LLM. Downloads come in; nothing media goes out.
- The LLM never runs anything, never writes ffmpeg args, never returns
  times. It returns ids and one action from a fixed list. Code checks it.
- The same saved version renders the same every time. Preview and render
  share the crop function and the .ass file.
- Every Claude proposal, chat edit and editor save is a version.
- Everything has a route and an alcyo:// link. No local web server.
- Alcyo never offers a Claude login and never touches Claude credentials.
- Plain copy. Say what happened and what to do next.

## Priorities
P0 is the demo path. P1 waits for the vertical slice on both OSes.

## Out of scope
Accounts, cloud, platform logins, teams, auto-posting, face tracking,
a local LLM, a localhost server.

## What "done" looks like
Paste a real 1 to 3 hour stream URL; get three shorts a creator would post
after a couple of chat follow-ups, on both Mac and Windows.
