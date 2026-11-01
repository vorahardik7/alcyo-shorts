---
inclusion: fileMatch
fileMatchPattern: ["apps/desktop/src/renderer/**/*.tsx", "apps/desktop/src/renderer/**/*.css"]
---
# UI notes

- Chat-first, styled after Grok Bot: dark, soft, rounded, calm.
- Colors: bg #0B0B0B, sidebar #0F0F0F, Claude bubble #1C1C1C, user bubble
  #2A2A2A, hairline #FFFFFF14, text #F5F5F5, secondary #A3A3A3, unread
  #3B82F6. System font, 17 px body, 15 px secondary. Bubble radius 22 px.
- Sidebar: search and + at top, creator header, stream rows (round
  thumbnail, name, last-message preview, unread dot), user row and render
  queue button pinned at the bottom.
- Thread: floating header pill with the stream name. User bubbles right,
  Claude and app bubbles left. Composer: +, "Message <stream name>", send.
- Short cards: 9:16 inline player, title, hook, reason, length, clipped
  badge, version chip, Open editor, Render, Copy link.
- Every clickable thing that points at a stream, short, version or message
  is a real route link.
- Copy is plain and short. No exclamation marks. Errors say what to do.
- Keyboard first: every action has a shortcut or is reachable by Tab.
