// core.js: pure helpers shared by the computer and phone pages.
// No Firebase or DOM-global access here, so everything can be unit tested in Node.

export const PENS = {
  black: '#1B2330',
  blue: '#2459D6',
  red: '#C8372D',
  green: '#1E7B4A',
};
export const HIGHLIGHT = '#F5C518';

// Stroke widths are a fraction of the slide's width, so a line looks the same
// thickness on the phone and on the projector.
export const PEN_WIDTH = 0.0055;
export const HIGHLIGHT_WIDTH = 0.032;

const round4 = (n) => Math.round(n * 10000) / 10000;
const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** [{x,y}] in 0..1 → flat array [x1,y1,x2,y2,…] rounded to 4 decimals. */
export function encodePoints(points) {
  const out = [];
  for (const p of points) out.push(round4(clamp01(p.x)), round4(clamp01(p.y)));
  return out;
}

/** Flat array (or the object form Firebase sometimes returns) → [{x,y}]. */
export function decodePoints(flat) {
  if (!flat) return [];
  const arr = Array.isArray(flat)
    ? flat
    : Object.keys(flat).sort((a, b) => Number(a) - Number(b)).map((k) => flat[k]);
  const pts = [];
  for (let i = 0; i + 1 < arr.length; i += 2) pts.push({ x: arr[i], y: arr[i + 1] });
  return pts;
}

/** Largest box with the given aspect (w/h) that fits inside cw × ch, centered. */
export function fitBox(cw, ch, aspect) {
  if (!(cw > 0) || !(ch > 0) || !(aspect > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  let w = cw;
  let h = w / aspect;
  if (h > ch) {
    h = ch;
    w = h * aspect;
  }
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/** Distance from point p to segment a–b (all in the same units). */
export function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Does a tap at `pt` (normalized) touch `stroke`? Measured in slide pixels
 * (w × h) so the tolerance feels the same whatever the slide's shape.
 */
export function hitStroke(stroke, pt, w, h, tolPx) {
  const pts = decodePoints(stroke && stroke.p);
  if (!pts.length) return false;
  const half = ((stroke.w || PEN_WIDTH) * w) / 2;
  const tol = tolPx + half;
  const P = { x: pt.x * w, y: pt.y * h };
  if (pts.length === 1) return Math.hypot(P.x - pts[0].x * w, P.y - pts[0].y * h) <= tol;
  for (let i = 1; i < pts.length; i++) {
    const a = { x: pts[i - 1].x * w, y: pts[i - 1].y * h };
    const b = { x: pts[i].x * w, y: pts[i].y * h };
    if (distToSegment(P, a, b) <= tol) return true;
  }
  return false;
}

/** Keys of every stroke the tap touches. `strokes` is {key: stroke}. */
export function strokesHit(strokes, pt, w, h, tolPx) {
  const hits = [];
  for (const [key, s] of Object.entries(strokes || {})) {
    if (hitStroke(s, pt, w, h, tolPx)) hits.push(key);
  }
  return hits;
}

/** Keep the slide number inside 0..count-1. */
export function clampSlide(n, count) {
  if (!(count > 0)) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(n) || 0));
}

/** Six-digit pairing code. `rand` returns 0..1 (injectable for tests). */
export function makeCode(rand = Math.random) {
  return String(Math.floor(rand() * 1e6)).padStart(6, '0');
}

export function isValidCode(code) {
  return /^[0-9]{6}$/.test(String(code || ''));
}

/** Draw one stroke onto a 2D context sized w × h (CSS pixels). */
export function drawStroke(ctx, stroke, w, h) {
  const pts = decodePoints(stroke && stroke.p);
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.c || PENS.black;
  ctx.fillStyle = stroke.c || PENS.black;
  ctx.lineWidth = Math.max(1, (stroke.w || PEN_WIDTH) * w);
  if (stroke.hl) ctx.globalAlpha = 0.42;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x * w, pts[0].y * h, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Smooth the line by curving through the midpoints between samples.
    ctx.beginPath();
    ctx.moveTo(pts[0].x * w, pts[0].y * h);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = ((pts[i].x + pts[i + 1].x) / 2) * w;
      const my = ((pts[i].y + pts[i + 1].y) / 2) * h;
      ctx.quadraticCurveTo(pts[i].x * w, pts[i].y * h, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x * w, last.y * h);
    ctx.stroke();
  }
  ctx.restore();
}

/** Size a canvas for crisp lines, clear it, and draw every stroke in key order. */
export function renderInk(canvas, strokes, w, h, dpr = 1, extra = null) {
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const keys = Object.keys(strokes || {}).sort();
  // Highlighter goes underneath pen ink, like a real highlighter.
  for (const k of keys) if (strokes[k] && strokes[k].hl) drawStroke(ctx, strokes[k], w, h);
  for (const k of keys) if (strokes[k] && !strokes[k].hl) drawStroke(ctx, strokes[k], w, h);
  if (extra) drawStroke(ctx, extra, w, h);
}

/** Ink is stored per slide; the whiteboard uses its own key. */
export function inkKey(live) {
  if (!live) return null;
  return live.mode === 'whiteboard' ? 'wb' : String(live.slide || 0);
}
