// firebase.js: one place that loads Firebase and names every database path.
import { firebaseConfig } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase, ref, set, update, push, remove, get, onValue, onDisconnect,
  query, orderByKey, limitToLast,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

export const configured = Object.values(firebaseConfig).every((v) => v && v !== 'PASTE_ME');

export const app = configured ? initializeApp(firebaseConfig) : null;
export const auth = configured ? getAuth(app) : null;
export const db = configured ? getDatabase(app) : null;

export {
  GoogleAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, signOut,
  ref, set, update, push, remove, get, onValue, onDisconnect, query, orderByKey, limitToLast,
};

// Every path the app reads or writes, in one list.
export const P = {
  decks: (u) => `users/${u}/decks`,
  deck: (u, d) => `users/${u}/decks/${d}`,
  slides: (u, d) => `users/${u}/slides/${d}`,
  slide: (u, d, i) => `users/${u}/slides/${d}/${i}`,
  inkDeck: (u, d) => `users/${u}/ink/${d}`,
  ink: (u, d, k) => `users/${u}/ink/${d}/${k}`,
  live: (u) => `users/${u}/live`,
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
