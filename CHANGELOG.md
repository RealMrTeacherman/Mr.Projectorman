# Changelog

## v1.0.0 (2026-10-29)
- Computer page: Google sign-in, deck grid, PDF import (pages rendered with pdf.js and stored in Firebase), full-screen projector view with live ink, keyboard controls (arrows, B, W, F, Esc).
- Phone remote: one-time 6-digit pairing, then automatic reconnection; upright and sideways layouts; pens (black, blue, red, green), highlighter, whole-line eraser, undo, two-tap clear, whiteboard, hide screen, next-slide preview.
- Drawings persist per slide; whiteboard drawings are stored separately per deck.
- Screen kept awake on both devices while presenting, where supported.
- Database rules: only the signed-in owner and their paired phones can read or write; pairing codes expire after 10 minutes and are deleted once used.
- Tests: 13 unit tests (core.js); 36-check end-to-end run with both pages in Chromium.
