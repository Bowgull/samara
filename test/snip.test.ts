// S1 (2026-11-25): Snip in Samara, the plain parts: the box he drew, where it falls on the picture, the file's name, the
// pinned window's size, and what Ask Claude types into the new chat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBox, cropFor, snipName, pinSize, MAX_W, MAX_H, MIN_W, BAR, ROOM_R, askText, SNIP_ID } from '../src/snipplan.ts';
import { samaraTask, POPOUT_TASKS } from '../src/jumplist.ts';
import { TASK_GLYPH, GLYPHS } from '../src/taskbaricons.ts';

test('a box is numbers inside the page, at least 8 px each way', () => {
  assert.deepEqual(cleanBox({ x: 10, y: 20, w: 100, h: 50, vw: 1440, vh: 900 }), { x: 10, y: 20, w: 100, h: 50, vw: 1440, vh: 900 });
  assert.equal(cleanBox(null), null);
  assert.equal(cleanBox({ x: 10, y: 20, w: 4, h: 50, vw: 1440, vh: 900 }), null, 'a click is not a snip');
  assert.equal(cleanBox({ x: '10', y: 20, w: 100, h: 50, vw: 1440, vh: 900 }), null);
  assert.equal(cleanBox({ x: -5, y: 20, w: 100, h: 50, vw: 1440, vh: 900 }), null);
  assert.equal(cleanBox({ x: 1400, y: 20, w: 100, h: 50, vw: 1440, vh: 900 }), null, 'off the page');
  assert.equal(cleanBox({ x: 0, y: 0, w: 100, h: 50, vw: Infinity, vh: 900 }), null);
});

test('the crop is scaled to the picture (a Retina screen is twice the page) and kept inside it', () => {
  const r = { x: 10, y: 20, w: 100, h: 50, vw: 1440, vh: 900 };
  assert.deepEqual(cropFor(r, { width: 2880, height: 1800 }), { x: 20, y: 40, width: 200, height: 100 });
  assert.deepEqual(cropFor(r, { width: 1440, height: 900 }), { x: 10, y: 20, width: 100, height: 50 });
  const edge = cropFor({ x: 1400, y: 880, w: 40, h: 20, vw: 1440, vh: 900 }, { width: 1440, height: 899 });
  assert.ok(edge.x + edge.width <= 1440 && edge.y + edge.height <= 899);
});

test('a snip is named by the time, with nothing either machine refuses in a file name', () => {
  const n = snipName(new Date(2026, 10, 5, 9, 3, 7));
  assert.equal(n, 'Snip 2026-11-05 09.03.07.png');
  assert.doesNotMatch(n, /[:\\/*?"<>|]/);
});

test('a pinned snip fits 360 x 300, never narrower than its bar needs', () => {
  const big = pinSize(1920, 1080);
  assert.ok(big.picW <= MAX_W && big.picH <= MAX_H);
  assert.equal(big.width, big.picW + ROOM_R);
  assert.equal(big.height, big.picH + BAR);
  assert.equal(pinSize(20, 400).picW, MIN_W, 'a thin snip still has room for its bar');
  assert.deepEqual(pinSize(300, 100), { width: 300 + ROOM_R, height: 100 + BAR, picW: 300, picH: 100 }, 'a small one is not blown up');
});

test('Ask Claude types the snip name and its file, for him to finish and send', () => {
  const t = askText('sn0123456789abcdef', '/Users/x/Pictures/Samara snips/Snip 2026-11-25 10.00.00.png');
  assert.match(t, /browser_snip/);
  assert.match(t, /snip: sn0123456789abcdef/);
  assert.match(t, /Samara snips\/Snip 2026-11-25 10\.00\.00\.png/);
  assert.ok(t.endsWith('\n\n'), 'room for his question');
  assert.ok(SNIP_ID.test('sn0123456789abcdef'));
  for (const bad of ['sn0123', '../x.png', 'sn0123456789abcdefg', 'SN0123456789ABCDEF', '']) assert.ok(!SNIP_ID.test(bad), bad);
});

test('Snip is on the taskbar list, with its own picture', () => {
  assert.ok((POPOUT_TASKS as readonly string[]).includes('snip'));
  assert.equal(samaraTask('snip'), 'snip');
  assert.equal(TASK_GLYPH.snip, 'snip');
  const g = GLYPHS.snip!;
  assert.equal(g.length, 16);
  for (const row of g) assert.equal(row.length, 16);
});
