// slides.js: fetches slide pictures one at a time, keeps recent ones in memory,
// and gets the next few ready ahead of time. Shared by the computer and the phone.
import { db, ref, get, P } from './firebase.js';
import { neighbors } from './core.js';

const KEEP = 40; // pictures kept in memory (about 3 MB)

export function createSlideCache(getOwner) {
  const cache = new Map(); // key → Promise<dataURL>
  const notes = new Map(); // deckId/rev → Promise<string[]>

  const keyFor = (deckId, deck, i) => `${deckId}/${deck.rev || 0}/${i}`;

  function slide(deckId, deck, i) {
    if (!deck || i < 0 || i >= deck.count) return Promise.resolve('');
    const key = keyFor(deckId, deck, i);
    let p = cache.get(key);
    if (p) {
      cache.delete(key); // move to the "recently used" end
    } else {
      p = get(ref(db, P.slide(getOwner(), deckId, i, deck.rev))).then((s) => s.val() || '').catch(() => {
        cache.delete(key);
        return '';
      });
    }
    cache.set(key, p);
    while (cache.size > KEEP) cache.delete(cache.keys().next().value);
    return p;
  }

  /** Current slide first, then the ones you're likely to need next. */
  function warm(deckId, deck, i) {
    if (!deck) return;
    for (const n of neighbors(i, deck.count)) slide(deckId, deck, n);
  }

  function deckNotes(deckId, deck) {
    if (!deck || !deck.hasNotes || !deck.rev) return Promise.resolve([]);
    const key = `${deckId}/${deck.rev}`;
    if (!notes.has(key)) {
      notes.set(key, get(ref(db, P.notes(getOwner(), deckId, deck.rev))).then((s) => s.val() || []).catch(() => []));
    }
    return notes.get(key);
  }

  return { slide, warm, deckNotes };
}
