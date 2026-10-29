// Test double for js/firebase.js backed by a SharedWorker "server".
const worker = new SharedWorker('/fake-server.js');
let tree = {};
const listeners = new Set();
const waiting = new Map();
let nextId = 1;
let ready;
const readyP = new Promise((r) => { ready = r; });
const parts = (p) => p.split('/').filter(Boolean);
function getAt(t, p) { let n = t; for (const k of parts(p)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : n; }
function snap(path, v) { return { key: parts(path).at(-1), val: () => (v == null ? null : JSON.parse(JSON.stringify(v))), exists: () => v != null, forEach(cb) { if (v && typeof v === 'object') for (const k of Object.keys(v).sort()) cb(snap(path + '/' + k, v[k])); } }; }
function notify() { for (const l of listeners) { const v = getAt(tree, l.path); const s = JSON.stringify(v); if (s !== l.last) { l.last = s; l.cb(snap(l.path, v)); } } }
worker.port.onmessage = (m) => {
  tree = m.data.tree; window.__fakeTree = tree; ready(); notify();
  if (m.data.from && waiting.has(m.data.id)) { waiting.get(m.data.id)(); waiting.delete(m.data.id); }
};
worker.port.start();
function send(ops, type = 'ops') { const id = nextId++; return new Promise((res) => { waiting.set(id, res); worker.port.postMessage({ type, ops, id }); }); }
window.__fakeReset = () => send([], 'reset');

export const configured = true;
export const missingKeys = [];
export const initError = null;
export const auth = { listeners: [] };
export const db = {};
let current = null;
const isPhone = location.pathname.endsWith('remote.html');
export function onAuthStateChanged(a, cb) { readyP.then(() => cb(isPhone ? current : { uid: 'owner1', displayName: 'Josh', isAnonymous: false, emailVerified: true, email: localStorage.getItem('fakeEmail') || 'jbiederman@creswell.k12.or.us' })); a.listeners.push(cb); }
export async function signInAnonymously(a) { current = { uid: 'phone1', isAnonymous: true }; a.listeners.forEach((cb) => cb(current)); }
export class GoogleAuthProvider {
  addScope() {}
  setCustomParameters() {}
  static credentialFromResult() { return { accessToken: 'fake-drive-token' }; }
}
export async function reauthenticateWithPopup(user) { window.__reauths = (window.__reauths || 0) + 1; return { user }; }
export async function signInWithPopup() {}
export async function signOut() {}
export const ref = (_db, path) => ({ path });
const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
export function set(r, v) { return send([[r.path, clone(v)]]); }
export function update(r, v) { return send(Object.entries(v).map(([k, val]) => [r.path + '/' + k, clone(val)])); }
export function remove(r) { return send([[r.path, null]]); }
let seq = 0;
export function push(r) { const key = Date.now().toString(36).padStart(10, '0') + String(seq++).padStart(4, '0'); return { key, path: r.path + '/' + key }; }
export const orderByKey = () => ({});
export const limitToLast = (n) => ({ n });
export const query = (r, ...cs) => ({ path: r.path, limit: cs.find((c) => c.n)?.n });
export async function get(r) {
  await readyP;
  if (/\/slides\//.test(r.path)) window.__slideGets = (window.__slideGets || 0) + 1;
  let v = getAt(tree, r.path);
  if (r.limit && v && typeof v === 'object') { const ks = Object.keys(v).sort().slice(-r.limit); v = Object.fromEntries(ks.map((k) => [k, v[k]])); }
  return snap(r.path, v);
}
export function onValue(r, cb) {
  if (r.path === '.info/connected') { readyP.then(() => cb(snap(r.path, true))); return () => {}; }
  const l = { path: r.path, cb, last: undefined };
  listeners.add(l);
  readyP.then(() => { const v = getAt(tree, r.path); const s = JSON.stringify(v); if (l.last === undefined) { l.last = s; cb(snap(r.path, v)); } });
  return () => listeners.delete(l);
}
export const onDisconnect = () => ({ remove: async () => {} });
