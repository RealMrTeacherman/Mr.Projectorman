// remote.js: the phone. Pairs once, then reconnects on its own every time it opens.
import {
  configured, missingKeys, initError, auth, db, P, ref, set, remove, get, onValue, push,
  query, orderByKey, limitToLast, signInAnonymously, onAuthStateChanged, stayPresent, keepAwake,
} from './firebase.js';
import {
  PENS, HIGHLIGHT, PEN_WIDTH, HIGHLIGHT_WIDTH, encodePoints, fitBox, renderInk,
  strokesHit, inkKey, isValidCode, isPresentable, CODE_LENGTH,
} from './core.js';
import { createSlideCache } from './slides.js';
import { startDeck, endDeck, step, toggleMode } from './live.js';

const $ = (id) => document.getElementById(id);
const OWNER_KEY = 'slideRemote.owner';
const TOOL_KEY = 'slideRemote.tool';
const SCREENS = ['notConfigured', 'starting', 'setup', 'decks', 'remote'];

function showScreen(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
}

window.__appStarted = true;

const slides = createSlideCache(() => S.owner);

const S = {
  uid: null,
  owner: localStorage.getItem(OWNER_KEY),
  decks: {},
  live: null,
  projectorOn: false,
  ink: {},
  inkPath: null,
  inkSub: null,
  subs: [],
  box: null,
  wake: null,
  tool: JSON.parse(localStorage.getItem(TOOL_KEY) || '{"kind":"pen","color":"blue"}'),
  draw: null, // { key, path, stroke, pts, lastWrite, timer }
};

// ---------- Start up ----------
if (!configured) {
  showScreen('notConfigured');
  $('missingKeys').textContent = missingKeys.length ? `Missing from config.js: ${missingKeys.join(', ')}` : '';
} else if (initError) {
  window.showStartupProblem(`Firebase didn’t accept the settings in js/config.js:\n${initError}`);
} else {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      signInAnonymously(auth).catch((err) => {
        showScreen('setup');
        setupError(`Couldn’t reach the server (${err.code || err.message}). Check your connection and reopen the app.`);
      });
      return;
    }
    if (S.uid === user.uid) return;
    S.uid = user.uid;
    if (S.owner) begin();
    else openSetup();
  });
}

// ---------- One-time setup ----------
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function openSetup(notice) {
  showScreen('setup');
  const needInstall = isIOS && !standalone && !sessionStorage.getItem('skipInstall');
  $('installCard').hidden = !needInstall;
  $('codeNum').textContent = needInstall ? '2' : '1';
  $('codeCard').classList.toggle('current', !needInstall);
  $('setupNotice').hidden = !notice;
  if (notice) $('setupNotice').textContent = notice;
}

$('skipInstall').addEventListener('click', () => {
  sessionStorage.setItem('skipInstall', '1');
  openSetup();
});

function setupError(msg) {
  $('codeError').textContent = msg;
  $('codeError').hidden = !msg;
}

function phoneName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  return 'Phone';
}

$('codeInput').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
  setupError('');
});

$('codeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('codeInput').value.trim();
  if (!isValidCode(code)) { setupError(`The code is ${CODE_LENGTH} numbers.`); return; }
  if (!S.uid) { setupError('Still connecting. Try again in a moment.'); return; }
  $('connectBtn').disabled = true;
  try {
    const snap = await get(ref(db, P.pairing(code)));
    const p = snap.val();
    if (!p || !p.owner || p.expires < Date.now()) {
      setupError('That code didn’t work. Check the number on the computer, or tap “New code” there.');
      return;
    }
    await set(ref(db, P.remote(p.owner, S.uid)), { code, name: phoneName(), added: Date.now() });
    localStorage.setItem(OWNER_KEY, p.owner);
    S.owner = p.owner;
    begin();
  } catch (err) {
    setupError(`That code didn’t work (${err.code || err.message}). Tap “New code” on the computer and try again.`);
  } finally {
    $('connectBtn').disabled = false;
  }
});

function unpaired() {
  S.subs.forEach((off) => off());
  S.subs = [];
  localStorage.removeItem(OWNER_KEY);
  S.owner = null;
  openSetup('This phone isn’t connected to a classroom computer anymore. Enter a new code to reconnect.');
}

// ---------- Connected ----------
function begin() {
  showScreen('starting');
  const o = S.owner;
  const denied = (err) => { if (err && /permission/i.test(err.code || err.message || '')) unpaired(); };
  S.subs.push(stayPresent(P.phoneOnline(o, S.uid)));
  S.subs.push(onValue(ref(db, P.projectorOnline(o)), (snap) => { S.projectorOn = snap.val() === true; renderStatus(); }, denied));
  S.subs.push(onValue(ref(db, P.decks(o)), (snap) => { S.decks = snap.val() || {}; route(); }, denied));
  S.subs.push(onValue(ref(db, P.live(o)), (snap) => { S.live = snap.val(); route(); }, denied));
}

function renderStatus() {
  for (const el of [$('deckStatus'), $('liveStatus')]) {
    el.classList.toggle('on', S.projectorOn);
    el.querySelector('.stext').textContent = S.projectorOn ? (el.id === 'liveStatus' ? 'Live' : 'Computer ready') : 'Computer not open';
  }
  $('sideDot').classList.toggle('on', S.projectorOn);
}

function currentDeck() {
  const d = S.live && S.live.deckId ? S.decks[S.live.deckId] : null;
  return isPresentable(d) ? d : null;
}

function route() {
  const deck = currentDeck();
  if (deck) showRemote(deck);
  else showDecks();
  renderStatus();
}

// ---------- Deck list ----------
function showDecks() {
  stopInk();
  showScreen('decks');
  const list = $('deckList');
  list.innerHTML = '';
  const entries = Object.entries(S.decks).filter(([, d]) => isPresentable(d)).sort((a, b) => (b[1].lastUsed || b[1].created || 0) - (a[1].lastUsed || a[1].created || 0));
  $('deckEmpty').hidden = entries.length > 0;
  for (const [id, d] of entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'deck-item';
    b.innerHTML = '<img alt=""><span><span class="n"></span><span class="m"></span></span>';
    if (d.thumb) b.querySelector('img').src = d.thumb;
    b.querySelector('.n').textContent = d.title || 'Untitled deck';
    b.querySelector('.m').textContent = `${d.count} slide${d.count === 1 ? '' : 's'}`;
    b.addEventListener('click', () => startDeck(S.owner, id));
    list.appendChild(b);
  }
}

// ---------- Remote ----------
async function showRemote(deck) {
  const live = S.live;
  const wasHidden = $('remote').hidden;
  showScreen('remote');
  if (wasHidden) {
    keepAwake().then((l) => { S.wake = l; });
    requestAnimationFrame(layout);
  }
  const remoteEl = $('remote');
  remoteEl.style.setProperty('--aspect', String(deck.aspect || 16 / 9));
  remoteEl.classList.toggle('whiteboard', live.mode === 'whiteboard');
  $('veil').hidden = live.mode !== 'hidden';
  $('deckTitle').textContent = deck.title || '';

  const i = live.slide || 0;
  const n = i + 1;
  $('counter').textContent = live.mode === 'whiteboard' ? 'Whiteboard' : `Slide ${n} of ${deck.count}`;
  $('sideCount').textContent = live.mode === 'whiteboard' ? 'Board' : `${n} / ${deck.count}`;
  document.querySelectorAll('[data-action="whiteboard"]').forEach((b) => b.setAttribute('aria-pressed', String(live.mode === 'whiteboard')));
  document.querySelectorAll('[data-action="hidden"]').forEach((b) => b.setAttribute('aria-pressed', String(live.mode === 'hidden')));

  watchInk(P.ink(S.owner, live.deckId, inkKey(live, deck)));

  slides.warm(live.deckId, deck, i);
  const [src, next, notes] = await Promise.all([
    slides.slide(live.deckId, deck, i),
    slides.slide(live.deckId, deck, i + 1),
    slides.deckNotes(live.deckId, deck),
  ]);
  if (S.live !== live) return;
  const img = $('slideImg');
  if (img.getAttribute('src') !== src) img.src = src;
  $('nextImg').src = next || '';
  $('nextText').textContent = i + 1 < deck.count ? `Up next: slide ${n + 1}` : 'This is the last slide.';
  const note = live.mode === 'whiteboard' ? '' : (notes[i] || '');
  $('notesText').textContent = note;
  $('upnext').classList.toggle('has-notes', !!note);
  layout();
}

function layout() {
  const stage = $('stage');
  const deck = currentDeck();
  if (!deck || $('remote').hidden) return;
  const r = stage.getBoundingClientRect();
  const box = fitBox(r.width, r.height, deck.aspect || 16 / 9);
  Object.assign($('slideBox').style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
  S.box = box;
  drawInk();
}
new ResizeObserver(layout).observe($('stage'));
window.addEventListener('orientationchange', () => setTimeout(layout, 250));

function stopInk() {
  if (S.inkSub) S.inkSub();
  S.inkSub = null;
  S.inkPath = null;
  S.ink = {};
  if (S.wake) { S.wake.release().catch(() => {}); S.wake = null; }
}

function watchInk(path) {
  if (path === S.inkPath) return;
  if (S.inkSub) S.inkSub();
  S.inkPath = path;
  S.ink = {};
  drawInk();
  S.inkSub = onValue(ref(db, path), (snap) => { S.ink = snap.val() || {}; drawInk(); });
}

function drawInk() {
  if (!S.box) return;
  let strokes = S.ink;
  let extra = null;
  // While drawing, show our own line from memory so it never lags behind the finger.
  if (S.draw && S.draw.path === S.inkPath) {
    strokes = { ...S.ink };
    delete strokes[S.draw.key];
    extra = { ...S.draw.stroke, p: encodePoints(S.draw.pts) };
  }
  renderInk($('inkCanvas'), strokes, S.box.w, S.box.h, window.devicePixelRatio || 1, extra);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('remote').hidden) keepAwake().then((l) => { S.wake = l; });
});

// ---------- Tools ----------
function renderTools() {
  document.querySelectorAll('[data-tool]').forEach((b) => {
    const on = b.dataset.tool === S.tool.kind && (b.dataset.tool !== 'pen' || b.dataset.color === S.tool.color);
    b.setAttribute('aria-pressed', String(on));
  });
}
document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
  S.tool = b.dataset.tool === 'pen' ? { kind: 'pen', color: b.dataset.color } : { ...S.tool, kind: b.dataset.tool };
  localStorage.setItem(TOOL_KEY, JSON.stringify(S.tool));
  renderTools();
}));
renderTools();

// ---------- Drawing ----------
const canvas = $('inkCanvas');

function toPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
}

function eraseAt(pt) {
  if (!S.box || !S.inkPath) return;
  for (const key of strokesHit(S.ink, pt, S.box.w, S.box.h, 14)) {
    delete S.ink[key];
    remove(ref(db, `${S.inkPath}/${key}`));
  }
  drawInk();
}

function writeStroke(final) {
  const d = S.draw;
  if (!d) return;
  clearTimeout(d.timer);
  d.timer = null;
  d.lastWrite = performance.now();
  set(ref(db, `${d.path}/${d.key}`), { ...d.stroke, p: encodePoints(d.pts) });
  if (final) S.draw = null;
}

function scheduleWrite() {
  const d = S.draw;
  if (!d || d.timer) return;
  const wait = Math.max(0, 40 - (performance.now() - d.lastWrite));
  d.timer = setTimeout(() => writeStroke(false), wait);
}

let erasing = false;

canvas.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary || !S.inkPath || S.draw) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  closeMore();
  const pt = toPoint(e);
  if (S.tool.kind === 'eraser') {
    erasing = true;
    eraseAt(pt);
    return;
  }
  const hl = S.tool.kind === 'hl';
  S.draw = {
    key: push(ref(db, S.inkPath)).key,
    path: S.inkPath,
    stroke: hl ? { c: HIGHLIGHT, w: HIGHLIGHT_WIDTH, hl: true } : { c: PENS[S.tool.color] || PENS.blue, w: PEN_WIDTH },
    pts: [pt],
    lastWrite: 0,
    timer: null,
  };
  drawInk();
  scheduleWrite();
});

canvas.addEventListener('pointermove', (e) => {
  if (!e.isPrimary) return;
  if (erasing) { eraseAt(toPoint(e)); return; }
  const d = S.draw;
  if (!d) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events.length ? events : [e]) {
    const pt = toPoint(ev);
    const last = d.pts[d.pts.length - 1];
    if (Math.hypot(pt.x - last.x, pt.y - last.y) > 0.0015) d.pts.push(pt);
  }
  drawInk();
  scheduleWrite();
});

function endPointer(e) {
  if (!e.isPrimary) return;
  erasing = false;
  if (S.draw) writeStroke(true);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

// ---------- Buttons ----------
let clearTimer = null;
function armClear() {
  document.querySelectorAll('[data-action="clear"]').forEach((b) => {
    b.classList.add('armed');
    const lbl = b.querySelector('.lbl');
    if (lbl) lbl.textContent = 'Tap again';
  });
  clearTimeout(clearTimer);
  clearTimer = setTimeout(disarmClear, 3000);
}
function disarmClear() {
  clearTimeout(clearTimer);
  clearTimer = null;
  document.querySelectorAll('[data-action="clear"]').forEach((b) => {
    b.classList.remove('armed');
    const lbl = b.querySelector('.lbl');
    if (lbl) lbl.textContent = 'Clear';
  });
}

function closeMore() {
  $('moreMenu').hidden = true;
  document.querySelector('[data-action="more"]').setAttribute('aria-expanded', 'false');
}

async function undo() {
  if (!S.inkPath) return;
  const path = S.inkPath;
  const snap = await get(query(ref(db, path), orderByKey(), limitToLast(1)));
  snap.forEach((child) => { remove(ref(db, `${path}/${child.key}`)); });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) {
    if (!e.target.closest('#moreMenu')) closeMore();
    return;
  }
  const deck = currentDeck();
  const a = b.dataset.action;
  if (a !== 'clear') disarmClear();
  if (a !== 'more') closeMore();
  if (!deck && a !== 'more') return;
  switch (a) {
    case 'next': step(S.owner, S.live, deck.count, 1); break;
    case 'back': step(S.owner, S.live, deck.count, -1); break;
    case 'undo': undo(); break;
    case 'clear':
      if (clearTimer) { disarmClear(); if (S.inkPath) remove(ref(db, S.inkPath)); } else armClear();
      break;
    case 'whiteboard': toggleMode(S.owner, S.live, 'whiteboard'); break;
    case 'hidden': toggleMode(S.owner, S.live, 'hidden'); break;
    case 'decks': endDeck(S.owner); break;
    case 'more': {
      const open = $('moreMenu').hidden;
      $('moreMenu').hidden = !open;
      b.setAttribute('aria-expanded', String(open));
      break;
    }
    default: break;
  }
});
