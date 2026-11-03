# Requirements: chat-shell (spec 10)

Source: docs/build-plan.md v3, sections 4, 5, 18 and 23 spec 10. Depends
on specs 8 and 9. The sidebar, home and Settings layout from spec 9's UI
pass (after T3 Code) stays.

## Requirements

### Requirement 1: Sidebar (P0)

1. Streams SHALL be listed by last activity with a thumbnail (initials
   until there is one), name, relative time, last-message preview and
   unread dot, plus search, New stream, Settings and the render queue.

### Requirement 2: Thread (P0)

1. EVERY message kind SHALL render; status messages update in place.
2. Older messages SHALL load on scroll, keeping the reader's place.

### Requirement 3: Short cards (P0)

1. Cards SHALL play inline with the render's crop function and `.ass`
   file, lazy-load when visible, and only one SHALL play at a time.
2. Playback across cuts SHALL use two video elements.
3. Cards SHALL have Edit, Render, Copy link and Reply; the version chip
   SHALL be a link to the version.

### Requirement 4: Composer (P0)

1. Text goes to the agent, pasted links to import, reply-to quotes target
   a short (spec 8).
2. Dropped files SHALL start a stream, become its recording, or become
   clips. The renderer SHALL never see or send a path.

### Requirement 5: Routes and links (P0)

1. EVERY route in section 5 SHALL work. A short or version route opens the
   thread at that card; the edit route opens the version's page; a message
   link scrolls to it.
2. `alcyo://` links SHALL open the same places; a malformed link shows the
   plain message (spec 1).
3. Copy link SHALL copy an `alcyo://` link.

### Requirement 6: Media and CSP (P0)

1. `alcyo-media://` SHALL serve only the open projects' sources and cache
   and the bundled fonts, by id, with Range (206).
2. THE CSP SHALL allow `'wasm-unsafe-eval'` and `blob:` workers and
   nothing remote.

### Requirement 7: Test (P0)

1. A Playwright test SHALL open a stream, send a follow-up, and see a new
   version card. (The demo stream itself is spec 13; the test seeds one.)
