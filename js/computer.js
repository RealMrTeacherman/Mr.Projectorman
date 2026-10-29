// computer.js: the classroom computer. Shows decks, presents on the projector,
// and draws whatever ink the phone sends.
import {
  configured, missingKeys, initError, auth, db, P, ref, set, update, push, remove, get, onValue,
  GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, stayPresent, keepAwake,
} from './firebase.js';
import { fitBox, renderInk, inkKey, makeCode, staleInkKeys, isPresentable } from './core.js';
import { createSlideCache } from './slides.js';
import {
  SLIDES_MIME, PPTX_MIME, getDriveToken, pickDeck, convertInDrive, uploadAndConvert, deleteFile,
  readDeck, slidePicture, toJpeg,
} from './drive.js';
import { startDeck, endDeck, step, toggleMode } from './live.js';

const $ = (id) => document.getElementById(id);
const show = (id, on) => { $(id).hidden = !on; };

window.__appStarted = true;

const slides = createSlideCache(() => S.uid);

const S = {
  uid: null,
  name: '',
  decks: {},
  live: null,
  remotes: {},
  phonesOnline: {},
  jobs: {},          // deckId → import running in this tab
  ink: {},
  inkSub: null,
  inkPath: null,
  pairCode: null,
  pairKnown: null,   // remote ids that existed when the code was shown
  wake: null,
  presenting: false,
};

// ---------- Start up ----------
if (!configured) {
  show('notConfigured', true);
  $('missingKeys').textContent = missingKeys.length ? `Missing from config.js: ${missingKeys.join(', ')}` : '';
} else if (initError) {
  window.showStartupProblem(`Firebase didn’t accept the settings in js/config.js:\n${initError}`);
} else {
  onAuthStateChanged(auth, (user) => {
    if (!user || user.isAnonymous) {
      show('signedOut', true);
      show('home', false);
      return;
    }
    if (S.uid === user.uid) return;
    S.uid = user.uid;
    S.name = user.displayName || user.email || 'you';
    show('signedOut', false);
    show('home', true);
    $('whoami').textContent = `Signed in as ${S.name}`;
    begin();
  });
}

$('signInBtn').addEventListener('click', async () => {
  $('signInError').hidden = true;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    $('signInError').textContent = `Sign-in didn’t finish (${err.code || err.message}). If a popup was blocked, allow popups for this site and try again.`;
    $('signInError').hidden = false;
  }
});
$('signOutBtn').addEventListener('click', () => signOut(auth).then(() => location.reload()));

function begin() {
  const u = S.uid;
  stayPresent(P.projectorOnline(u));
  onValue(ref(db, P.decks(u)), (snap) => { S.decks = snap.val() || {}; renderDecks(); applyLive(); });
  onValue(ref(db, P.remotes(u)), (snap) => { S.remotes = snap.val() || {}; renderPhones(); checkNewPhone(); });
  onValue(ref(db, P.phonesOnline(u)), (snap) => { S.phonesOnline = snap.val() || {}; renderPhones(); renderPill(); });
  onValue(ref(db, P.live(u)), (snap) => { S.live = snap.val(); applyLive(); renderDecks(); });
}

// ---------- Deck grid ----------
function renderDecks() {
  const grid = $('deckGrid');
  grid.querySelectorAll('.deck').forEach((el) => el.remove());
  const entries = Object.entries(S.decks).sort((a, b) => (b[1].lastUsed || b[1].created || 0) - (a[1].lastUsed || a[1].created || 0));
  const add = $('addCard');
  for (const [id, d] of entries) {
    const card = document.createElement('div');
    const importing = d.status === 'importing';
    const running = !!S.jobs[id];
    card.className = 'deck' + (S.live && S.live.deckId === id ? ' live' : '');
    card.innerHTML = `
      <button class="open" type="button">
        <img class="thumb" alt="">
        <span class="name"></span>
        <span class="meta"></span>
      </button>
      <div class="progress" hidden><span class="bar"></span></div>
      <div class="tools"></div>`;
    if (d.thumb) card.querySelector('.thumb').src = d.thumb;
    card.querySelector('.name').textContent = d.title || 'Untitled deck';
    const meta = card.querySelector('.meta');
    const tools = card.querySelector('.tools');
    const tool = (label, fn, danger) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'linkish' + (danger ? ' danger' : '');
      b.textContent = label;
      b.addEventListener('click', fn);
      tools.appendChild(b);
    };

    if (importing) {
      const pr = d.progress || { done: 0, total: 0 };
      const verb = d.rev ? 'Updating' : 'Bringing in';
      meta.textContent = running
        ? `${verb} slides: ${pr.done} of ${pr.total || '…'}`
        : `${verb} stopped at ${pr.done} of ${pr.total || '…'}`;
      const bar = card.querySelector('.progress');
      bar.hidden = false;
      bar.querySelector('.bar').style.width = `${pr.total ? Math.round((pr.done / pr.total) * 100) : 3}%`;
      if (!running) {
        if (d.driveId) tool('Try again', () => runImport({ deckId: id }));
        tool(d.rev ? 'Keep the old version' : 'Remove', () => abandonImport(id), true);
      }
    } else {
      meta.textContent = `${d.count} slide${d.count === 1 ? '' : 's'} · ${usedText(d.lastUsed)}`;
      if (d.driveId) tool('Update from Drive', () => runImport({ deckId: id }));
      tool('Clear drawings', () => {
        if (confirm(`Erase every drawing in “${d.title}”?`)) remove(ref(db, P.inkDeck(S.uid, id)));
      });
      tool('Delete', () => deleteDeck(id, d), true);
    }
    const open = card.querySelector('.open');
    if (isPresentable(d)) open.addEventListener('click', () => startDeck(S.uid, id));
    else open.disabled = true;
    grid.insertBefore(card, add);
  }
}

async function deleteDeck(id, d) {
  if (!confirm(`Delete “${d.title}” and its drawings? This can’t be undone.`)) return;
  if (S.live && S.live.deckId === id) await endDeck(S.uid);
  await Promise.all([
    remove(ref(db, P.deck(S.uid, id))),
    remove(ref(db, P.slides(S.uid, id))),
    remove(ref(db, P.notesAll(S.uid, id))),
    remove(ref(db, P.inkDeck(S.uid, id))),
  ]);
}

function usedText(ts) {
  if (!ts) return 'not used yet';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'used today';
  if (days === 1) return 'used yesterday';
  if (days < 7) return `used ${days} days ago`;
  return `used ${new Date(ts).toLocaleDateString()}`;
}

// ---------- Adding a deck from a PDF ----------
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let pdfjsReady = null;
function loadPdfjs() {
  if (!pdfjsReady) {
    pdfjsReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS;
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { pdfjsReady = null; reject(new Error('Could not load the PDF reader.')); };
      document.head.appendChild(s);
    });
  }
  return pdfjsReady;
}

async function renderPage(page, width, quality) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { url: canvas.toDataURL('image/jpeg', quality), aspect: base.width / base.height };
}

let adding = false;
async function addPdf(file) {
  if (adding) return;
  adding = true;
  const sub = $('addSub');
  $('addCard').classList.add('busy');
  try {
    sub.textContent = 'Opening the PDF…';
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const deckId = push(ref(db, P.decks(S.uid))).key;
    let aspect = 16 / 9;
    let thumb = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      sub.textContent = `Preparing slide ${i} of ${pdf.numPages}…`;
      const page = await pdf.getPage(i);
      const big = await renderPage(page, 1600, 0.82);
      if (i === 1) {
        aspect = big.aspect;
        thumb = (await renderPage(page, 480, 0.7)).url;
      }
      await set(ref(db, P.slide(S.uid, deckId, i - 1)), big.url);
    }
    // The deck only appears once every slide is saved.
    await set(ref(db, P.deck(S.uid, deckId)), {
      title: file.name.replace(/\.pdf$/i, ''),
      count: pdf.numPages,
      aspect,
      thumb,
      created: Date.now(),
      lastUsed: 0,
    });
  } catch (err) {
    alert(`That PDF couldn’t be added: ${err.message || err}`);
  } finally {
    adding = false;
    $('addCard').classList.remove('busy');
    resetAddText();
  }
}

function resetAddText() {
  $('addSub').textContent = 'or drop a PDF or PowerPoint here';
}

function addFile(file) {
  if (!file) return;
  if (/\.pptx$/i.test(file.name) || file.type === PPTX_MIME) runImport({ file });
  else if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') addPdf(file);
  else alert('Slide Remote takes PDF and PowerPoint (.pptx) files, or decks straight from Google Drive.');
  $('fileInput').value = '';
}

$('fileInput').addEventListener('change', (e) => addFile(e.target.files[0]));
$('driveBtn').addEventListener('click', async () => {
  try {
    const token = await getDriveToken();
    const doc = await pickDeck(token);
    if (doc) runImport({ doc });
  } catch (err) {
    alert(err.message || err);
  }
});
const addCard = $('addCard');
addCard.addEventListener('dragover', (e) => { e.preventDefault(); addCard.classList.add('drag'); });
addCard.addEventListener('dragleave', () => addCard.classList.remove('drag'));
addCard.addEventListener('drop', (e) => {
  e.preventDefault();
  addCard.classList.remove('drag');
  addFile(e.dataTransfer.files[0]);
});

// ---------- Importing through Google (Drive decks and PowerPoint files) ----------
/**
 * One import job. Starts a new deck ({doc} picked in Drive, or {file} uploaded),
 * or updates/retries an existing Drive deck ({deckId}).
 * Slides go into a fresh version folder; the deck switches over only when every slide is in,
 * so whatever is on the projector is never disturbed.
 */
async function runImport({ doc = null, file = null, deckId = null }) {
  if (deckId && S.jobs[deckId]) return;
  const existing = deckId ? S.decks[deckId] : null;
  let token;
  try {
    token = await getDriveToken();
  } catch (err) {
    alert(err.message || err);
    return;
  }
  const source = existing
    ? { id: existing.driveId, mimeType: existing.driveMime, name: existing.title }
    : doc;

  const id = deckId || push(ref(db, P.decks(S.uid))).key;
  const rev = ((existing && Math.max(existing.rev || 0, existing.pendingRev || 0)) || 0) + 1;
  S.jobs[id] = true;
  let tempId = null;
  try {
    const base = { status: 'importing', progress: { done: 0, total: 0 }, pendingRev: rev };
    if (existing) {
      // A stopped attempt may have left part of a version behind; clear it first.
      if (existing.pendingRev && existing.pendingRev !== existing.rev) await remove(ref(db, P.slideSet(S.uid, id, existing.pendingRev)));
      await update(ref(db, P.deck(S.uid, id)), base);
    } else {
      await set(ref(db, P.deck(S.uid, id)), {
        ...base,
        title: file ? file.name.replace(/\.pptx$/i, '') : doc.name.replace(/\.pptx$/i, ''),
        count: 0,
        created: Date.now(),
        lastUsed: 0,
        ...(doc ? { driveId: doc.id, driveMime: doc.mimeType } : {}),
      });
    }
    renderDecks();

    let presId = source ? source.id : null;
    if (file) tempId = await uploadAndConvert(token, file);
    else if (source.mimeType === PPTX_MIME) tempId = await convertInDrive(token, source.id, source.name);
    if (tempId) presId = tempId;

    const info = await readDeck(token, presId);
    const total = info.slideIds.length;
    if (!total) throw new Error('That deck has no slides.');
    await update(ref(db, P.deck(S.uid, id)), { progress: { done: 0, total } });

    // Two at a time: faster, while staying under Google's limits (drive.js slows down if asked).
    let next = 0;
    let done = 0;
    let thumb = '';
    const worker = async () => {
      while (next < total) {
        const i = next++;
        const pic = await slidePicture(token, presId, info.slideIds[i]);
        await set(ref(db, P.slide(S.uid, id, i, rev)), pic);
        if (i === 0) thumb = await toJpeg(pic, 480, 0.7);
        done++;
        update(ref(db, P.deck(S.uid, id)), { progress: { done, total } });
      }
    };
    await Promise.all([worker(), worker()]);

    const hasNotes = info.notes.some(Boolean);
    if (hasNotes) await set(ref(db, P.notes(S.uid, id, rev)), info.notes);

    const oldRev = existing && existing.rev;
    // The switch-over: one update, so both devices see the whole new version at once.
    await update(ref(db, P.deck(S.uid, id)), {
      // A converted PowerPoint's own title is the temporary copy's name, so use the file's name.
      title: existing ? existing.title : (file ? file.name : (tempId ? doc.name : info.title)).replace(/\.pptx$/i, ''),
      count: total,
      aspect: info.aspect,
      thumb,
      slideIds: info.slideIds,
      hasNotes,
      rev,
      updated: Date.now(),
      status: null,
      progress: null,
      pendingRev: null,
    });
    if (oldRev && oldRev !== rev) {
      remove(ref(db, P.slideSet(S.uid, id, oldRev)));
      remove(ref(db, P.notes(S.uid, id, oldRev)));
    }
    if (S.live && S.live.deckId === id && (S.live.slide || 0) >= total) {
      update(ref(db, P.live(S.uid)), { slide: total - 1 });
    }
    // Drawings for slides that were deleted from the deck.
    const inkSnap = await get(ref(db, P.inkDeck(S.uid, id)));
    for (const k of staleInkKeys(Object.keys(inkSnap.val() || {}), info.slideIds)) remove(ref(db, P.ink(S.uid, id, k)));
  } catch (err) {
    alert(`That deck couldn’t be brought in: ${err.message || err}`);
  } finally {
    if (tempId) deleteFile(token, tempId);
    delete S.jobs[id];
    renderDecks();
  }
}

/** Give up on a stopped import: remove a deck that never finished, or keep the last good version. */
async function abandonImport(id) {
  const d = S.decks[id];
  if (!d) return;
  if (!d.rev) {
    await Promise.all([remove(ref(db, P.deck(S.uid, id))), remove(ref(db, P.slides(S.uid, id)))]);
    return;
  }
  if (d.pendingRev && d.pendingRev !== d.rev) await remove(ref(db, P.slideSet(S.uid, id, d.pendingRev)));
  await update(ref(db, P.deck(S.uid, id)), { status: null, progress: null, pendingRev: null });
}

// ---------- Phones and pairing ----------
const CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1E7B4A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L19 7"/></svg>';
const PHONE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3E4A5C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>';

function phoneIsOnline() { return Object.keys(S.phonesOnline).some((rid) => S.remotes[rid]); }

function renderPhones() {
  const chip = $('phoneChip');
  const count = Object.keys(S.remotes).length;
  if (phoneIsOnline()) {
    const rid = Object.keys(S.phonesOnline).find((r) => S.remotes[r]);
    chip.className = 'chip on';
    chip.innerHTML = `<span class="badge">${CHECK}</span><span><div class="t1">Your phone is connected</div><div class="t2"></div></span>`;
    chip.querySelector('.t2').textContent = `${S.remotes[rid].name || 'Phone'} · remembered`;
  } else if (count) {
    chip.className = 'chip';
    chip.innerHTML = `<span class="badge">${PHONE}</span><span><div class="t1">Phone not open</div><div class="t2">Tap Slide Remote on your phone</div></span>`;
  } else {
    chip.className = 'chip';
    chip.innerHTML = `<span class="badge">${PHONE}</span><button type="button"><div class="t1">Set up your phone</div><div class="t2">One time, takes a minute</div></button>`;
    chip.querySelector('button').addEventListener('click', openPairing);
  }

  const list = $('phoneList');
  list.innerHTML = '';
  if (!count) {
    list.innerHTML = '<li class="none">No phones yet.</li>';
  }
  for (const [rid, r] of Object.entries(S.remotes)) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${r.name || 'Phone'}${S.phonesOnline[rid] ? ' (open now)' : ''}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'linkish danger';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => {
      if (confirm('Remove this phone? It will need a new code to connect again.')) remove(ref(db, P.remote(S.uid, rid)));
    });
    li.append(label, btn);
    list.appendChild(li);
  }
}

function secureRandom() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

async function newCode() {
  await dropCode();
  for (let tries = 0; tries < 6; tries++) {
    const code = makeCode(secureRandom);
    try {
      await set(ref(db, P.pairing(code)), { owner: S.uid, ownerName: S.name, expires: Date.now() + 10 * 60 * 1000 });
      S.pairCode = code;
      S.pairKnown = new Set(Object.keys(S.remotes));
      $('pairCode').textContent = code;
      $('pairStatus').textContent = 'The code works for 10 minutes. You only need it once per phone.';
      return;
    } catch {
      // Code already in use by someone else; try another.
    }
  }
  $('pairStatus').textContent = 'Couldn’t make a code. Check your internet connection and try “New code.”';
}

async function dropCode() {
  if (!S.pairCode) return;
  const c = S.pairCode;
  S.pairCode = null;
  try { await remove(ref(db, P.pairing(c))); } catch { /* already gone */ }
}

function checkNewPhone() {
  if (!S.pairCode || !S.pairKnown) return;
  const fresh = Object.keys(S.remotes).find((rid) => !S.pairKnown.has(rid));
  if (!fresh) return;
  $('pairStatus').textContent = `Connected: ${S.remotes[fresh].name || 'phone'}. You won’t need a code on it again.`;
  $('pairCode').textContent = '✓';
  dropCode();
}

function openPairing() {
  $('remoteUrl').textContent = new URL('.', location.href).href.replace(/^https?:\/\//, '');
  $('pairDialog').showModal();
  newCode();
}
$('pairLink').addEventListener('click', openPairing);
$('newCodeBtn').addEventListener('click', newCode);
$('closePairBtn').addEventListener('click', () => $('pairDialog').close());
$('pairDialog').addEventListener('close', dropCode);
window.addEventListener('beforeunload', () => { if (S.pairCode) remove(ref(db, P.pairing(S.pairCode))); });

// ---------- Presenting ----------
function currentDeck() {
  const d = S.live && S.live.deckId ? S.decks[S.live.deckId] : null;
  return isPresentable(d) ? d : null;
}

async function applyLive() {
  const deck = currentDeck();
  if (!deck) {
    if (S.presenting) stopPresentingUI();
    return;
  }
  const live = S.live;
  if (!S.presenting) startPresentingUI();

  const stage = $('stage');
  stage.classList.toggle('hidden-screen', live.mode === 'hidden');
  stage.classList.toggle('whiteboard', live.mode === 'whiteboard');
  layout();
  renderPill();

  // Ink for this slide (or the whiteboard).
  const path = P.ink(S.uid, live.deckId, inkKey(live, deck));
  if (path !== S.inkPath) {
    if (S.inkSub) S.inkSub();
    S.inkPath = path;
    S.ink = {};
    drawInk();
    S.inkSub = onValue(ref(db, path), (snap) => { S.ink = snap.val() || {}; drawInk(); });
  }

  const i = live.slide || 0;
  slides.warm(live.deckId, deck, i);
  const src = await slides.slide(live.deckId, deck, i);
  if (S.live !== live) return; // something newer arrived while loading
  const img = $('slideImg');
  if (img.getAttribute('src') !== src) img.src = src;
}

function startPresentingUI() {
  S.presenting = true;
  show('home', false);
  show('stage', true);
  keepAwake().then((l) => { S.wake = l; });
  if (!document.fullscreenElement) {
    show('fsHint', true);
    setTimeout(() => show('fsHint', false), 8000);
  }
  poke();
}

function stopPresentingUI() {
  S.presenting = false;
  if (S.inkSub) S.inkSub();
  S.inkSub = null;
  S.inkPath = null;
  show('stage', false);
  show('home', true);
  if (S.wake) { S.wake.release().catch(() => {}); S.wake = null; }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function layout() {
  const deck = currentDeck();
  if (!deck) return;
  const box = fitBox(window.innerWidth, window.innerHeight, deck.aspect || 16 / 9);
  const el = $('slideBox');
  Object.assign(el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
  S.box = box;
  drawInk();
}

function drawInk() {
  if (!S.box) return;
  renderInk($('inkCanvas'), S.ink, S.box.w, S.box.h, window.devicePixelRatio || 1);
}

function renderPill() {
  const deck = currentDeck();
  if (!deck || !S.live) return;
  $('pillDot').classList.toggle('on', phoneIsOnline());
  $('pillText').textContent = S.live.mode === 'whiteboard' ? 'Whiteboard' : `${(S.live.slide || 0) + 1} / ${deck.count}`;
}

window.addEventListener('resize', layout);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.presenting) keepAwake().then((l) => { S.wake = l; });
});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
  show('fsHint', false);
}

$('stage').addEventListener('click', (e) => {
  if (e.target.closest('#exitBtn')) return;
  if (!document.fullscreenElement) toggleFullscreen();
});
$('exitBtn').addEventListener('click', () => endDeck(S.uid));

document.addEventListener('keydown', (e) => {
  if (!S.presenting || e.metaKey || e.ctrlKey || e.altKey) return;
  const deck = currentDeck();
  if (!deck) return;
  const k = e.key;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) step(S.uid, S.live, deck.count, 1);
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) step(S.uid, S.live, deck.count, -1);
  else if (k === 'b' || k === 'B' || k === '.') toggleMode(S.uid, S.live, 'hidden');
  else if (k === 'w' || k === 'W') toggleMode(S.uid, S.live, 'whiteboard');
  else if (k === 'f' || k === 'F') toggleFullscreen();
  else if (k === 'Escape' && !document.fullscreenElement) endDeck(S.uid);
  else return;
  e.preventDefault();
  poke();
});

// Hide the mouse and the Stop button when nobody is touching the computer.
let idleTimer = null;
function poke() {
  $('stage').classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => $('stage').classList.add('idle'), 2500);
}
document.addEventListener('mousemove', () => { if (S.presenting) poke(); });

