// Phase 3: bookmarks and settings as items (src/syncitems.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { flatMarks, flatPrefs, prune, restamp, unflatMarks, unflatPrefs, GONE_KEEP_MS, type Items } from '../src/syncitems.ts';

test('settings round-trip: each setting, each listed site and each site\'s rules are their own item; Earlier travels as it is', () => {
  const p = { search: 'ddg', sounds: true, autofill: { name: 'x' }, lists: { popupOk: ['a.com'], trusted: ['b.com', 'c.com'], httpOk: [], adsPaused: ['d.com'], siteRules: { 'e.com': { camera: 'block' } }, earlier: { entries: [1], gone: {} } } };
  const f = flatPrefs(p);
  assert.deepEqual(Object.keys(f).sort(), ['l.adsPaused.d.com', 'l.popupOk.a.com', 'l.trusted.b.com', 'l.trusted.c.com', 'p.autofill', 'p.search', 'p.sounds', 'r.e.com']);
  assert.deepEqual(unflatPrefs(f, { lists: true, earlier: p.lists.earlier }), p);
  delete f['l.popupOk.a.com'];
  assert.deepEqual((unflatPrefs(f, { lists: true }).lists as Record<string, unknown>).popupOk, [], 'an emptied list is still there, so the removal reaches the browser');
});

test('bookmarks round-trip in the order asked, the rest after', () => {
  const list = [{ title: 'A', url: 'https://a/', folder: '' }, { title: 'B', url: 'https://b/', folder: 'Bar' }, { title: 'A2', url: 'https://a/', folder: '' }];
  const f = flatMarks(list);
  assert.equal(Object.keys(f).length, 2, 'one per address, the first wins');
  assert.deepEqual(unflatMarks(f, ['https://b/']).map((m) => m.url), ['https://b/', 'https://a/']);
});

test('restamp: new, changed and removed items get the time; unchanged keep theirs; old removal markers are forgotten', () => {
  const i: Items = {};
  restamp(i, { a: 1, b: 2 }, 10);
  restamp(i, { a: 1, b: 3, c: 4 }, 20);
  assert.equal(i.a!.at, 10); assert.equal(i.b!.at, 20); assert.equal(i.c!.at, 20);
  restamp(i, { a: 1 }, 30);
  assert.deepEqual([i.b!.gone, i.c!.gone], [true, true]);
  prune(i, 30 + GONE_KEEP_MS + 1);
  assert.deepEqual(Object.keys(i), ['a']);
});
