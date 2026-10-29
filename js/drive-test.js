// drive-test.js: checks, step by step, that Google allows Drive import for this account.
import { firebaseConfig } from './config.js';
import { configured, initError, auth, GoogleAuthProvider, signInWithPopup } from './firebase.js';
import { extractNotes } from './core.js';

window.__appStarted = true;

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SLIDES_MIME = 'application/vnd.google-apps.presentation';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const $ = (id) => document.getElementById(id);

function row(state, title, detail = '') {
  const li = document.createElement('li');
  li.className = state;
  li.innerHTML = '<span class="mark"></span><div><div class="t"></div><div class="d"></div></div>';
  li.querySelector('.mark').textContent = state === 'ok' ? '✓' : state === 'bad' ? '!' : '…';
  li.querySelector('.t').textContent = title;
  li.querySelector('.d').textContent = detail;
  $('results').appendChild(li);
  return li;
}

function finish(ok, text) {
  const s = $('summary');
  s.className = `summary ${ok ? 'ok' : 'bad'}`;
  s.textContent = text;
  s.hidden = false;
  $('go').disabled = false;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn’t load ${src}`));
    document.head.appendChild(s);
  });
}

/** Turn a Google API error into a plain explanation. */
async function explain(res, apiName) {
  let msg = `${res.status}`;
  try {
    const body = await res.json();
    msg = (body.error && (body.error.message || body.error.status)) || msg;
  } catch { /* no JSON body */ }
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) return `The ${apiName} is turned off for this project. Turn it on (setup step 1), wait two minutes, and run the check again.\n\nGoogle said: ${msg}`;
  if (/admin|policy|domain|organization/i.test(msg)) return `Your district’s Google settings appear to block this.\n\nGoogle said: ${msg}`;
  if (res.status === 429) return `Google’s per-minute limit was reached. Wait a minute and run the check again.\n\nGoogle said: ${msg}`;
  if (res.status === 401) return `Google’s permission expired. Run the check again.\n\nGoogle said: ${msg}`;
  if (res.status === 404) return `Google couldn’t open that file with this permission. Try a deck you own.\n\nGoogle said: ${msg}`;
  return `Google said: ${msg}`;
}

/** Download a picture Google hosts and re-save it as a compact JPEG (what the app stores). */
async function saveAsJpeg(url) {
  let bitmapSrc;
  try {
    const blob = await fetch(url).then((r) => { if (!r.ok) throw new Error(`picture download failed (${r.status})`); return r.blob(); });
    bitmapSrc = URL.createObjectURL(blob);
  } catch (first) {
    bitmapSrc = url; // fall back to loading it as an image
  }
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Chrome blocked reading the slide picture.'));
    im.src = bitmapSrc;
  });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.82); // throws if the picture "tainted" the canvas
}

const api = (token) => (url, opts = {}) => fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });

async function checkDeck(call, id, label) {
  const fields = 'title,slides(objectId,slideProperties(notesPage(notesProperties(speakerNotesObjectId),pageElements(objectId,shape(text(textElements(textRun(content))))))))';
  const res = await call(`https://slides.googleapis.com/v1/presentations/${id}?fields=${encodeURIComponent(fields)}`);
  if (!res.ok) { row('bad', `Couldn’t read the slides and notes${label}`, await explain(res, 'Google Slides API')); return false; }
  const pres = await res.json();
  const notes = extractNotes(pres);
  const withNotes = notes.filter((n) => n.notes);
  const sample = withNotes.length ? `\nFirst note starts: “${withNotes[0].notes.slice(0, 70)}${withNotes[0].notes.length > 70 ? '…' : ''}”` : '';
  row('ok', `Read “${pres.title}”${label}`, `${notes.length} slides, ${withNotes.length} with speaker notes.${sample}`);

  // Slide-by-slide pictures (no whole-deck size limit).
  const tryThese = (pres.slides || []).slice(0, 3);
  let totalMs = 0;
  let totalKb = 0;
  let firstUrl = '';
  let dims = '';
  for (const s of tryThese) {
    const t0 = performance.now();
    const res = await call(`https://slides.googleapis.com/v1/presentations/${id}/pages/${s.objectId}/thumbnail?thumbnailProperties.thumbnailSize=LARGE&thumbnailProperties.mimeType=PNG`);
    if (!res.ok) { row('bad', `Couldn’t get a slide picture${label}`, await explain(res, 'Google Slides API')); return false; }
    const { contentUrl, width, height } = await res.json();
    let jpeg;
    try {
      jpeg = await saveAsJpeg(contentUrl);
    } catch (err) {
      row('bad', `Got a slide picture but the browser wouldn’t let the app save it${label}`, String(err.message || err));
      return false;
    }
    totalMs += performance.now() - t0;
    totalKb += (jpeg.length * 3) / 4 / 1024;
    if (!firstUrl) { firstUrl = jpeg; dims = `${width}×${height}`; }
  }
  const each = totalMs / tryThese.length / 1000;
  const minutes = Math.max(1, Math.round((pres.slides.length * each) / 60));
  const li = row('ok', `Saved slide pictures one at a time${label}`,
    `Tested ${tryThese.length} of ${pres.slides.length} slides: about ${each.toFixed(1)} seconds and ${Math.round(totalKb / tryThese.length)} KB each (${dims}). `
    + `Bringing in the whole deck would take roughly ${minutes} minute${minutes === 1 ? '' : 's'}, once.`);
  const img = document.createElement('img');
  img.src = firstUrl;
  img.alt = 'First slide as the app would store it';
  img.style.cssText = 'display:block;max-width:260px;margin-top:8px;border:1px solid #D5DBE3;border-radius:6px';
  li.querySelector('.d').appendChild(img);
  return true;
}

async function handlePick(token, doc) {
  const call = api(token);
  row('ok', `Picked “${doc.name}”`, doc.mimeType === PPTX_MIME ? 'PowerPoint file' : 'Google Slides deck');

  if (doc.mimeType === SLIDES_MIME) {
    const ok = await checkDeck(call, doc.id, '');
    return ok ? finish(true, 'Everything works. Drive import can be built for this account.') : finish(false, 'One step failed. Copy the red step to Claude.');
  }

  // PowerPoint: make a temporary Google Slides copy, read it, then delete it.
  const copy = await call(`https://www.googleapis.com/drive/v3/files/${doc.id}/copy?supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `[Slide Remote temporary] ${doc.name}`, mimeType: SLIDES_MIME }),
  });
  if (!copy.ok) { row('bad', 'Couldn’t convert the PowerPoint', await explain(copy, 'Google Drive API')); return finish(false, 'PowerPoint conversion failed. Copy the red step to Claude.'); }
  const { id } = await copy.json();
  row('ok', 'Converted the PowerPoint to a temporary Google Slides copy');
  let ok = false;
  try {
    ok = await checkDeck(call, id, ' (converted copy)');
  } finally {
    const del = await call(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`, { method: 'DELETE' });
    row(del.ok ? 'ok' : 'bad', del.ok ? 'Deleted the temporary copy' : 'Couldn’t delete the temporary copy', del.ok ? '' : 'You can delete the file starting with “[Slide Remote temporary]” from your Drive by hand.');
  }
  finish(ok, ok ? 'Everything works, PowerPoint included. Drive import can be built for this account.' : 'One step failed. Copy the red step to Claude.');
}

$('go').addEventListener('click', async () => {
  $('results').innerHTML = '';
  $('summary').hidden = true;
  $('go').disabled = true;

  if (!configured || initError) { row('bad', 'Firebase settings problem', initError || 'js/config.js is incomplete.'); return finish(false, 'Fix config.js first.'); }
  if (!firebaseConfig.messagingSenderId) { row('bad', 'config.js is missing messagingSenderId', 'Copy the full config from Firebase Project settings; the file picker needs this number.'); return finish(false, 'Fix config.js first.'); }

  // 1. Sign in and ask for permission to files you pick.
  const provider = new GoogleAuthProvider();
  provider.addScope(SCOPE);
  provider.setCustomParameters({ prompt: 'consent select_account' });
  let result;
  try {
    result = await signInWithPopup(auth, provider);
  } catch (err) {
    const code = err.code || err.message;
    const hint = /popup-closed/.test(code)
      ? 'The Google window closed before finishing. If it said “Access blocked” or mentioned your administrator, the district is blocking this app for school accounts; tell Claude exactly what it said.'
      : /popup-blocked/.test(code) ? 'Chrome blocked the popup. Allow popups for this site and try again.'
        : /unauthorized-domain/.test(code) ? 'Add realmrteacherman.github.io under Firebase › Authentication › Settings › Authorized domains.'
          : '';
    row('bad', 'Google sign-in didn’t finish', `${hint}\n\n(${code})`.trim());
    return finish(false, 'Sign-in step failed.');
  }
  row('ok', `Signed in as ${result.user.email}`);

  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) { row('bad', 'Google didn’t hand back a Drive permission'); return finish(false, 'Permission step failed.'); }
  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`).then((r) => r.json()).catch(() => ({}));
  if (!String(info.scope || '').includes(SCOPE)) {
    row('bad', 'Drive permission wasn’t granted', 'On Google’s screen, the box allowing access to files you pick must be checked. If there was no such box, the consent screen setup (step 2) is missing the drive.file permission.');
    return finish(false, 'Permission step failed.');
  }
  row('ok', 'Drive permission granted', 'Only for files you pick, not your whole Drive.');

  // 2. Open Google's file picker.
  try {
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise((resolve, reject) => window.gapi.load('picker', { callback: resolve, onerror: reject }));
  } catch (err) {
    row('bad', 'Couldn’t load Google’s file picker', String(err.message || err));
    return finish(false, 'Picker step failed.');
  }
  const P = window.google.picker;
  const mimes = `${SLIDES_MIME},${PPTX_MIME}`;
  const myDrive = new P.DocsView(P.ViewId.DOCS).setMimeTypes(mimes).setIncludeFolders(true).setMode(P.DocsViewMode.LIST);
  const shared = new P.DocsView(P.ViewId.DOCS).setMimeTypes(mimes).setEnableDrives(true).setIncludeFolders(true).setMode(P.DocsViewMode.LIST);
  const waiting = row('', 'Pick a deck in the Google window', 'If the window shows an error about the API key or developer key, see setup step 3.');
  new P.PickerBuilder()
    .addView(myDrive)
    .addView(shared)
    .enableFeature(P.Feature.SUPPORT_DRIVES)
    .setOAuthToken(token)
    .setDeveloperKey(firebaseConfig.apiKey)
    .setAppId(String(firebaseConfig.messagingSenderId))
    .setOrigin(`${location.protocol}//${location.host}`)
    .setTitle('Pick a deck to test')
    .setCallback((data) => {
      if (data.action === P.Action.PICKED) {
        waiting.remove();
        handlePick(token, data.docs[0]).catch((err) => { row('bad', 'Something unexpected went wrong', String(err.message || err)); finish(false, 'Copy the red step to Claude.'); });
      } else if (data.action === P.Action.CANCEL) {
        waiting.remove();
        row('bad', 'The picker closed without a deck chosen');
        finish(false, 'Run it again and pick a deck.');
      }
    })
    .build()
    .setVisible(true);
});
