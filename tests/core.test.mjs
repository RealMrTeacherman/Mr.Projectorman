// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodePoints, decodePoints, fitBox, distToSegment, hitStroke, strokesHit,
  clampSlide, makeCode, isValidCode, inkKey, staleInkKeys, neighbors, isPresentable, PEN_WIDTH,
} from '../js/core.js';

test('points survive an encode/decode round trip (rounded to 4 places)', () => {
  const pts = [{ x: 0.123456, y: 0.5 }, { x: 1, y: 0 }];
  assert.deepEqual(decodePoints(encodePoints(pts)), [{ x: 0.1235, y: 0.5 }, { x: 1, y: 0 }]);
});

test('encode clamps points that slide off the edge', () => {
  assert.deepEqual(encodePoints([{ x: -0.2, y: 1.4 }]), [0, 1]);
});

test('decode accepts the object form Firebase can return', () => {
  assert.deepEqual(decodePoints({ 0: 0.1, 1: 0.2, 2: 0.3, 3: 0.4 }), [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }]);
  assert.deepEqual(decodePoints(null), []);
});

test('fitBox letterboxes a 16:9 slide in a tall phone area', () => {
  const b = fitBox(390, 600, 16 / 9);
  assert.equal(b.w, 390);
  assert.ok(Math.abs(b.h - 219.375) < 1e-9);
  assert.ok(Math.abs(b.y - (600 - 219.375) / 2) < 1e-9);
});

test('fitBox pillarboxes a 16:9 slide in a 4:3 projector', () => {
  const b = fitBox(1024, 768, 16 / 9);
  assert.equal(b.w, 1024);
  const c = fitBox(1000, 400, 16 / 9);
  assert.equal(c.h, 400);
  assert.ok(Math.abs(c.x - (1000 - 400 * 16 / 9) / 2) < 1e-9);
});

test('fitBox returns an empty box for bad input', () => {
  assert.deepEqual(fitBox(0, 100, 1.7), { x: 0, y: 0, w: 0, h: 0 });
});

test('distToSegment measures to the nearest point on the segment', () => {
  assert.equal(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
  assert.equal(distToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
});

test('eraser hits a stroke it touches and misses one far away', () => {
  const s = { w: PEN_WIDTH, p: encodePoints([{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }]) };
  assert.equal(hitStroke(s, { x: 0.5, y: 0.51 }, 1000, 562, 12), true);
  assert.equal(hitStroke(s, { x: 0.5, y: 0.8 }, 1000, 562, 12), false);
});

test('eraser can hit a single-dot stroke', () => {
  const dot = { p: [0.5, 0.5] };
  assert.equal(hitStroke(dot, { x: 0.505, y: 0.5 }, 1000, 562, 12), true);
});

test('strokesHit returns only the touched keys', () => {
  const strokes = {
    a: { p: encodePoints([{ x: 0, y: 0 }, { x: 1, y: 0 }]) },
    b: { p: encodePoints([{ x: 0, y: 1 }, { x: 1, y: 1 }]) },
  };
  assert.deepEqual(strokesHit(strokes, { x: 0.5, y: 0.001 }, 1000, 500, 10), ['a']);
});

test('clampSlide keeps navigation in range', () => {
  assert.equal(clampSlide(5, 12), 5);
  assert.equal(clampSlide(12, 12), 11);
  assert.equal(clampSlide(-1, 12), 0);
  assert.equal(clampSlide(3, 0), 0);
});

test('pairing codes are always eight digits', () => {
  assert.equal(makeCode(() => 0), '00000000');
  assert.equal(makeCode(() => 0.0000000421), '00000004');
  assert.equal(makeCode(() => 0.999999999), '99999999');
  assert.ok(isValidCode(makeCode()));
  assert.equal(isValidCode('123456'), false);
  assert.equal(isValidCode('1234a678'), false);
});

test('ink key separates slides from the whiteboard', () => {
  assert.equal(inkKey({ mode: 'slide', slide: 3 }), '3');
  assert.equal(inkKey({ mode: 'hidden', slide: 3 }), '3');
  assert.equal(inkKey({ mode: 'whiteboard', slide: 3 }), 'wb');
  assert.equal(inkKey(null), null);
});

test('Drive decks key drawings by slide id, so they follow reordered slides', () => {
  const before = { slideIds: ['a', 'b', 'c'] };
  const after = { slideIds: ['c', 'a', 'b'] }; // slide c moved to the front
  assert.equal(inkKey({ mode: 'slide', slide: 2 }, before), 's-c');
  assert.equal(inkKey({ mode: 'slide', slide: 0 }, after), 's-c');
  assert.equal(inkKey({ mode: 'whiteboard', slide: 0 }, after), 'wb');
});

test('drawings for deleted slides are found for cleanup; whiteboard is kept', () => {
  assert.deepEqual(staleInkKeys(['s-a', 's-b', 'wb', 's-gone'], ['a', 'b']), ['s-gone']);
  assert.deepEqual(staleInkKeys([], ['a']), []);
});

test('neighbors lists the slides to have ready, in order of need', () => {
  assert.deepEqual(neighbors(0, 224), [0, 1, 2, 3]);
  assert.deepEqual(neighbors(10, 224), [10, 11, 12, 9, 13]);
  assert.deepEqual(neighbors(223, 224), [223, 222]);
});

test('a deck still on its first import cannot be presented; an updating one can', () => {
  assert.equal(isPresentable({ count: 0, status: 'importing' }), false);
  assert.equal(isPresentable({ count: 5, status: 'importing' }), false);
  assert.equal(isPresentable({ count: 5, status: 'importing', rev: 1 }), true);
  assert.equal(isPresentable({ count: 5 }), true);
  assert.equal(isPresentable(null), false);
});

import { extractNotes } from '../js/core.js';

const slideWith = (id, notesText, notesId = `${id}-n`) => ({
  objectId: id,
  slideProperties: {
    notesPage: {
      notesProperties: { speakerNotesObjectId: notesId },
      pageElements: [
        { objectId: 'other', shape: { text: { textElements: [{ textRun: { content: 'slide number box' } }] } } },
        notesText == null ? { objectId: notesId } : {
          objectId: notesId,
          shape: { text: { textElements: [{ paragraphMarker: {} }, ...notesText.map((t) => ({ textRun: { content: t } }))] } },
        },
      ],
    },
  },
});

test('extractNotes reads each slide’s speaker notes in order, with slide ids', () => {
  const pres = { slides: [slideWith('a', ['Ask: which number ', 'is the whole?\n']), slideWith('b', null), slideWith('c', ['Turn and talk\n'])] };
  assert.deepEqual(extractNotes(pres), [
    { id: 'a', notes: 'Ask: which number is the whole?' },
    { id: 'b', notes: '' },
    { id: 'c', notes: 'Turn and talk' },
  ]);
});

test('extractNotes ignores other text boxes on the notes page', () => {
  const [one] = extractNotes({ slides: [slideWith('a', ['Real note'])] });
  assert.equal(one.notes, 'Real note');
});

test('extractNotes copes with missing data', () => {
  assert.deepEqual(extractNotes(null), []);
  assert.deepEqual(extractNotes({ slides: [{ objectId: 'x' }] }), [{ id: 'x', notes: '' }]);
});

import { isAllowedAccount, welcomeState } from '../js/core.js';

test('only verified accounts on the school domain are allowed', () => {
  const d = 'creswell.k12.or.us';
  assert.equal(isAllowedAccount({ email: 'jbiederman@creswell.k12.or.us', emailVerified: true }, d), true);
  assert.equal(isAllowedAccount({ email: 'Teacher@Creswell.K12.OR.US', emailVerified: true }, d), true);
  assert.equal(isAllowedAccount({ email: 'someone@gmail.com', emailVerified: true }, d), false);
  assert.equal(isAllowedAccount({ email: 'x@notcreswell.k12.or.us.evil.com', emailVerified: true }, d), false);
  assert.equal(isAllowedAccount({ email: 'x@evilcreswell.k12.or.us', emailVerified: true }, d), false);
  assert.equal(isAllowedAccount({ email: 'x@creswell.k12.or.us', emailVerified: false }, d), false);
  assert.equal(isAllowedAccount({ isAnonymous: true }, d), false);
  assert.equal(isAllowedAccount(null, d), false);
});

test('getting-started guide tracks the three steps and hides when done', () => {
  assert.deepEqual(welcomeState({ decks: {}, remotes: {}, everPresented: false }), { steps: { phone: false, deck: false, present: false }, show: true });
  assert.equal(welcomeState({ decks: { a: {} }, remotes: { r: {} }, everPresented: false }).show, true);
  assert.equal(welcomeState({ decks: { a: {} }, remotes: { r: {} }, everPresented: true }).show, false);
});
