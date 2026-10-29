# Changelog

## v1.0.2 (2026-10-29)
- Phones opening the main link are sent to the remote automatically; computers and iPads stay on the projector page. `?computer` keeps a phone on the computer page.
- The pairing window now gives the main link instead of remote.html.
- Tests: 7 new device checks (43 end-to-end checks total).

## v1.1.0-check2 (2026-10-29)
- Drive check now tests slide-by-slide pictures (no whole-deck size limit) instead of one PDF export, which Google caps at 10 MB. Shows timing, size, and a preview of the first slide as stored.

## v1.1.0-check (2026-10-29)
- New drive-test.html: step-by-step check that Google Drive import is allowed for the signed-in account (permission, file picker, speaker notes, PDF export, PowerPoint conversion).
- core.js: extractNotes() reads speaker notes from the Google Slides API, keyed by slide id (3 new unit tests; 16 total).

## v1.0.1 (2026-10-29)
- Startup problems now show on the page instead of a blank screen: a missing `export` in config.js, a missing `databaseURL` (listed by name), Firebase rejecting the settings, or a file that failed to load.
- New file: js/boot-check.js.
- README links updated for the Mr.Projectorman repo.

## v1.0.0 (2026-10-29)
- Computer page: Google sign-in, deck grid, PDF import (pages rendered with pdf.js and stored in Firebase), full-screen projector view with live ink, keyboard controls (arrows, B, W, F, Esc).
- Phone remote: one-time 6-digit pairing, then automatic reconnection; upright and sideways layouts; pens (black, blue, red, green), highlighter, whole-line eraser, undo, two-tap clear, whiteboard, hide screen, next-slide preview.
- Drawings persist per slide; whiteboard drawings are stored separately per deck.
- Screen kept awake on both devices while presenting, where supported.
- Database rules: only the signed-in owner and their paired phones can read or write; pairing codes expire after 10 minutes and are deleted once used.
- Tests: 13 unit tests (core.js); 36-check end-to-end run with both pages in Chromium.
