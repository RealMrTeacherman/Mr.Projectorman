// drive.js: everything that talks to Google Drive and Google Slides.
// Used only on the computer. The permission token lives in memory here and is never saved anywhere.
import { firebaseConfig } from './config.js';
import { auth, GoogleAuthProvider, reauthenticateWithPopup } from './firebase.js';
import { extractNotes } from './core.js';

export const SLIDES_MIME = 'application/vnd.google-apps.presentation';
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TEMP_PREFIX = '[Slide Remote temporary] ';

let cached = null; // { token, expires }

/** A Drive permission token for the signed-in teacher. Asks Google (popup) only when needed. */
export async function getDriveToken() {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const provider = new GoogleAuthProvider();
  provider.addScope(SCOPE);
  let result;
  try {
    // Re-confirms the SAME account, so choosing a different one can't switch who's signed in.
    result = await reauthenticateWithPopup(auth.currentUser, provider);
  } catch (err) {
    const code = err.code || '';
    if (/user-mismatch/.test(code)) throw new Error('Please choose the same Google account you’re signed in to Slide Remote with.');
    if (/popup-blocked/.test(code)) throw new Error('Chrome blocked the Google window. Allow popups for this site and try again.');
    if (/popup-closed|cancelled-popup/.test(code)) throw new Error('The Google window closed before finishing.');
    throw new Error(`Google sign-in didn’t finish (${code || err.message}).`);
  }
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new Error('Google didn’t give Drive permission. Try again, and leave the Drive box checked.');
  cached = { token, expires: Date.now() + 50 * 60_000 };
  return token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Call a Google API with the token. Waits and retries when Google says "slow down". */
async function call(token, url, opts = {}, apiName = 'Google Drive') {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await sleep(Math.min(60_000, 4000 * 2 ** attempt));
      continue;
    }
    throw new Error(await explain(res, apiName));
  }
}

async function explain(res, apiName) {
  let msg = `${res.status}`;
  try {
    const body = await res.json();
    msg = (body.error && (body.error.message || body.error.status)) || msg;
  } catch { /* no JSON body */ }
  if (res.status === 401) { cached = null; return 'Google’s permission expired. Try again.'; }
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) return `The ${apiName} API is turned off for this project. (${msg})`;
  if (res.status === 404) return `Google couldn’t open that file. (${msg})`;
  return `${apiName} said: ${msg}`;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Couldn’t load Google’s file picker.'));
    document.head.appendChild(s);
  });
}

/** Open Google's file picker. Resolves with { id, name, mimeType } or null if closed. */
export async function pickDeck(token) {
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve, reject) => window.gapi.load('picker', { callback: resolve, onerror: reject }));
  const P = window.google.picker;
  const mimes = `${SLIDES_MIME},${PPTX_MIME}`;
  return new Promise((resolve) => {
    new P.PickerBuilder()
      .addView(new P.DocsView(P.ViewId.DOCS).setMimeTypes(mimes).setIncludeFolders(true).setMode(P.DocsViewMode.LIST))
      .addView(new P.DocsView(P.ViewId.DOCS).setMimeTypes(mimes).setEnableDrives(true).setIncludeFolders(true).setMode(P.DocsViewMode.LIST))
      .enableFeature(P.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setDeveloperKey(firebaseConfig.apiKey)
      .setAppId(String(firebaseConfig.messagingSenderId || ''))
      .setOrigin(`${location.protocol}//${location.host}`)
      .setTitle('Choose a deck')
      .setCallback((data) => {
        if (data.action === P.Action.PICKED) {
          const d = data.docs[0];
          resolve({ id: d.id, name: d.name, mimeType: d.mimeType });
        } else if (data.action === P.Action.CANCEL) {
          resolve(null);
        }
      })
      .build()
      .setVisible(true);
  });
}

/** Turn a PowerPoint already in Drive into a temporary Google Slides copy. Returns its id. */
export async function convertInDrive(token, fileId, name) {
  const res = await call(token, `https://www.googleapis.com/drive/v3/files/${fileId}/copy?supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: TEMP_PREFIX + name, mimeType: SLIDES_MIME }),
  });
  return (await res.json()).id;
}

/** Upload a PowerPoint from this computer as a temporary Google Slides copy. Returns its id. */
export async function uploadAndConvert(token, file) {
  const boundary = `slideremote${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: TEMP_PREFIX + file.name.replace(/\.pptx$/i, ''), mimeType: SLIDES_MIME });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: ${PPTX_MIME}\r\n\r\n`,
    file,
    `\r\n--${boundary}--`,
  ]);
  const res = await call(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()).id;
}

export async function deleteFile(token, fileId) {
  try {
    await call(token, `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, { method: 'DELETE' });
    return true;
  } catch {
    return false;
  }
}

/** Title, slide ids in order, speaker notes, and the slide shape. */
export async function readDeck(token, presId) {
  const fields = 'title,pageSize,slides(objectId,slideProperties(notesPage(notesProperties(speakerNotesObjectId),pageElements(objectId,shape(text(textElements(textRun(content))))))))';
  const res = await call(token, `https://slides.googleapis.com/v1/presentations/${presId}?fields=${encodeURIComponent(fields)}`, {}, 'Google Slides');
  const pres = await res.json();
  const notes = extractNotes(pres);
  const w = pres.pageSize && pres.pageSize.width && pres.pageSize.width.magnitude;
  const h = pres.pageSize && pres.pageSize.height && pres.pageSize.height.magnitude;
  return {
    title: pres.title || 'Untitled deck',
    slideIds: notes.map((n) => n.id),
    notes: notes.map((n) => n.notes),
    aspect: w && h ? w / h : 16 / 9,
  };
}

/** One slide as a compact JPEG (data URL), at 1600 px wide. */
export async function slidePicture(token, presId, pageId) {
  const res = await call(token, `https://slides.googleapis.com/v1/presentations/${presId}/pages/${pageId}/thumbnail?thumbnailProperties.thumbnailSize=LARGE&thumbnailProperties.mimeType=PNG`, {}, 'Google Slides');
  const { contentUrl } = await res.json();
  return toJpeg(contentUrl, null);
}

/** Load a picture and re-save it as JPEG, optionally shrunk to `width`. */
export async function toJpeg(src, width, quality = 0.82) {
  let objectUrl = null;
  try {
    if (!src.startsWith('data:')) {
      const r = await fetch(src);
      if (!r.ok) throw new Error(`picture download failed (${r.status})`);
      objectUrl = URL.createObjectURL(await r.blob());
    }
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('Couldn’t read a slide picture.'));
      im.src = objectUrl || src;
    });
    const w = width || img.naturalWidth;
    const h = Math.round((img.naturalHeight / img.naturalWidth) * w);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
