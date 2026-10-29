// firebase.js: one place that loads Firebase and names every database path.
import { firebaseConfig } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, reauthenticateWithPopup, signInAnonymously, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase, ref, set, update, push, remove, get, onValue, onDisconnect,
  query, orderByKey, limitToLast,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

const REQUIRED = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];
const cfg = firebaseConfig || {};
export const missingKeys = REQUIRED.filter((k) => !cfg[k] || cfg[k] === 'PASTE_ME');
export const configured = missingKeys.length === 0;

let app = null;
let auth = null;
let db = null;
let initError = null;
if (configured) {
  try {
    app = initializeApp(cfg);
    auth = getAuth(app);
    db = getDatabase(app);
  } catch (err) {
    initError = err && err.message ? err.message : String(err);
  }
}
export { app, auth, db, initError };

export {
  GoogleAuthProvider, signInWithPopup, reauthenticateWithPopup, signInAnonymously, onAuthStateChanged, signOut,
  ref, set, update, push, remove, get, onValue, onDisconnect, query, orderByKey, limitToLast,
};

// Every path the app reads or writes, in one list.
export const P = {
  decks: (u) => `users/${u}/decks`,
  deck: (u, d) => `users/${u}/decks/${d}`,
  slides: (u, d) => `users/${u}/slides/${d}`,
  // Drive decks store each version ("rev") separately, so updating never disturbs the one on screen.
  // PDF decks (no rev) keep the original layout.
  slideSet: (u, d, rev) => (rev ? `users/${u}/slides/${d}/r${rev}` : `users/${u}/slides/${d}`),
  slide: (u, d, i, rev) => (rev ? `users/${u}/slides/${d}/r${rev}/${i}` : `users/${u}/slides/${d}/${i}`),
  notesAll: (u, d) => `users/${u}/notes/${d}`,
  notes: (u, d, rev) => `users/${u}/notes/${d}/r${rev}`,
  inkDeck: (u, d) => `users/${u}/ink/${d}`,
  ink: (u, d, k) => `users/${u}/ink/${d}/${k}`,
  live: (u) => `users/${u}/live`,
  everPresented: (u) => `users/${u}/prefs/everPresented`,
  projectorOnline: (u) => `users/${u}/presence/projector`,
  phonesOnline: (u) => `users/${u}/presence/phones`,
  phoneOnline: (u, r) => `users/${u}/presence/phones/${r}`,
  remotes: (u) => `remotes/${u}`,
  remote: (u, r) => `remotes/${u}/${r}`,
  pairing: (c) => `pairing/${c}`,
};

/** Mark this device online at `path`, and have Firebase clear it if we drop off. */
export function stayPresent(path) {
  const connRef = ref(db, '.info/connected');
  return onValue(connRef, (snap) => {
    if (snap.val() !== true) return;
    const r = ref(db, path);
    onDisconnect(r).remove().then(() => set(r, true));
  });
}

/** Ask the device to keep its screen awake (silently skipped where unsupported). */
export async function keepAwake() {
  try {
    if (!('wakeLock' in navigator)) return null;
    const lock = await navigator.wakeLock.request('screen');
    return lock;
  } catch {
    return null;
  }
}
