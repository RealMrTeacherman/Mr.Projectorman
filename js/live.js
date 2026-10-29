// live.js: the actions that change what's on the projector.
// Both the computer and the phone call these, so they always behave the same.
import { db, ref, set, update, P } from './firebase.js';
import { clampSlide } from './core.js';

export function startDeck(owner, deckId) {
  update(ref(db, P.deck(owner, deckId)), { lastUsed: Date.now() });
  return set(ref(db, P.live(owner)), { deckId, slide: 0, mode: 'slide', at: Date.now() });
}

export function endDeck(owner) {
  return set(ref(db, P.live(owner)), null);
}

/** Move by `delta` slides. Turning a page also brings back a hidden screen or leaves the whiteboard. */
export function step(owner, live, count, delta) {
  if (!live || !live.deckId) return null;
  const slide = clampSlide((live.slide || 0) + delta, count);
  return update(ref(db, P.live(owner)), { slide, mode: 'slide', at: Date.now() });
}

export function goTo(owner, live, count, slide) {
  if (!live || !live.deckId) return null;
  return update(ref(db, P.live(owner)), { slide: clampSlide(slide, count), mode: 'slide', at: Date.now() });
}

/** Switch between the slide and `mode` ('whiteboard' or 'hidden'). */
export function toggleMode(owner, live, mode) {
  if (!live || !live.deckId) return null;
  const next = live.mode === mode ? 'slide' : mode;
  return update(ref(db, P.live(owner)), { mode: next, at: Date.now() });
}
