// N3 (2026-11-25): a note pinned to words on a page is found again, the right one of several, with the page's spaces
// changed around it; and a reminder's picks ring when they say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findQuote, quoteAround, pageKey, deepOf, paintCode } from '../src/anchorpaint.ts';
import { remindAt, cleanRemind } from '../src/notes.ts';

const page = 'Flasks are cheap. Buy flasks before raid. The boss hits hard, so buy flasks before raid night and bring food.';

test('the right occurrence is found by its surroundings', () => {
  const q = quoteAround('hits hard, so ', 'buy flasks before raid', ' night and bring');
  const hit = findQuote(page, q.exact, q.prefix, q.suffix)!;
  assert.equal(page.slice(hit[0], hit[1]), 'buy flasks before raid');
  assert.ok(hit[0] > page.indexOf('boss'), 'the second one, not the first');
});

test('spaces and line breaks changed on the page are forgiven', () => {
  const moved = page.replace('buy flasks before raid night', 'buy   flasks\n  before raid night');
  const hit = findQuote(moved, 'buy flasks before raid', 'so ', ' night')!;
  assert.equal(moved.slice(hit[0], hit[1]).replace(/\s+/g, ' '), 'buy flasks before raid');
  assert.equal(findQuote(page, 'not on the page', '', ''), null);
  assert.equal(findQuote(page, 'x', '', ''), null, 'one letter is too little to pin');
});

test('the page code carries the matcher as plain JavaScript and the pins as data', () => {
  const code = paintCode([{ id: 'na', title: '</script><b>', exact: 'a "quote"', prefix: '', suffix: '', deep: '#000' }], 'na');
  assert.doesNotThrow(() => new Function(code));
  assert.match(code, /"a \\"quote\\""/);
});

test('one page is one page: no #part, no trailing slash; colours by category', () => {
  assert.equal(pageKey('https://a.example/x/#top'), pageKey('https://a.example/x'));
  assert.equal(deepOf('To-do'), '#2f78b8');
  assert.equal(deepOf('Mine'), '#9a4478');
});

test('reminders ring when picked, on the machine that set them', () => {
  const now = new Date(2026, 10, 25, 14, 0).getTime();
  assert.equal(remindAt('hour', now), now + 3_600_000);
  assert.equal(new Date(remindAt('tonight', now)!).getHours(), 20);
  assert.equal(remindAt('tonight', new Date(2026, 10, 25, 21, 0).getTime()), null, 'tonight has gone');
  const t = new Date(remindAt('tomorrow', now)!); assert.equal(t.getDate(), 26); assert.equal(t.getHours(), 9);
  assert.equal(new Date(remindAt('week', now)!).getDate(), 3);
  assert.deepEqual(cleanRemind({ at: now, dev: 'mac', done: true }), { at: now, done: true, dev: 'mac' });
  assert.deepEqual(cleanRemind({ at: now, dev: 'tv' }), { at: now });
});
