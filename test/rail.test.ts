import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDLE_MS, afterClose, dayLabel, earlierGroups, entryKey, fading, joinEarlier, migrateV1, nextTidy, railOrder, staysPut, tidyDue, toPutAway, type EarlierEntry, type RailTab } from '../src/rail.ts';

const H = 60 * 60_000;
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const tab = (id: number, lastSeen: number, o: Partial<RailTab> = {}): RailTab => ({ id, lastSeen, opener: null, ...o });

test('a tab fades after 12 hours untouched, never before', () => {
  const now = at(2026, 11, 24, 20);
  assert.equal(fading(tab(1, now - IDLE_MS + 1), now, null), false);
  assert.equal(fading(tab(1, now - IDLE_MS), now, null), true);
});

test('pinned, playing, in a call, Claude\'s, the browser\'s own and the tab in front never move', () => {
  const now = at(2026, 11, 24, 20), old = now - 2 * IDLE_MS;
  for (const o of [{ pinned: true }, { audible: true }, { call: true }, { claudeJob: 3 }, { internal: 'settings' }]) assert.equal(fading(tab(1, old, o), now, null), false, JSON.stringify(o));
  assert.equal(staysPut(tab(7, old), 7), true);
  assert.deepEqual(toPutAway([tab(1, old, { pinned: true }), tab(2, old), tab(3, now), tab(4, old - H)], now, null), [4, 2]);
});

test('the overnight move: 3 AM local, once a night, and on the next start if Samara was shut', () => {
  assert.equal(nextTidy(at(2026, 11, 24, 20)), at(2026, 11, 25, 3));
  assert.equal(nextTidy(at(2026, 11, 25, 2, 59)), at(2026, 11, 25, 3));
  assert.equal(tidyDue(at(2026, 11, 24, 3, 5), at(2026, 11, 24, 22)), false, 'already ran tonight');
  assert.equal(tidyDue(at(2026, 11, 24, 3, 5), at(2026, 11, 25, 3, 1)), true, 'a new night');
  assert.equal(tidyDue(at(2026, 11, 20, 3), at(2026, 11, 24, 9)), true, 'shut for days: once on start');
  assert.equal(tidyDue(0, at(2026, 11, 24, 2)), true, 'never ran');
});

test('the rail: pinned as arranged, today newest first, Claude\'s apart', () => {
  const o = railOrder([tab(1, 10, { pinned: true }), tab(2, 30), tab(3, 20), tab(4, 50, { claudeJob: 1 }), tab(5, 5, { pinned: true }), tab(6, 40)]);
  assert.deepEqual(o, { pinned: [1, 5], today: [6, 3, 2], claude: [4] }, 'newest opened first, never by last looked');
});

test('closing goes back to the tab that opened it, else the last one used', () => {
  const open = [tab(1, 100), tab(2, 300), tab(3, 200)];
  assert.equal(afterClose(tab(9, 50, { opener: 3 }), open), 3);
  assert.equal(afterClose(tab(9, 50, { opener: 42 }), open), 2, 'opener gone: last used');
  assert.equal(afterClose(tab(9, 50), []), null);
});

const e = (url: string, title: string, when: number, from?: string): EarlierEntry => ({ key: entryKey(url, when), url, title, at: when, ...(from ? { from } : {}) });

test('Earlier: newest first, grouped by day, searched by every word in title or address', () => {
  const now = at(2026, 11, 24, 15);
  const list = [e('https://zeldadungeon.net/wiki/Zora_Armor', 'Zora Armor', at(2026, 11, 22, 3)), e('https://reddit.com/r/zelda/x', 'Fastest way to get the full Zora set?', at(2026, 11, 22, 3, 1)),
    e('https://news.ycombinator.com/item?id=1', 'Show HN: a pixel-art browser', at(2026, 11, 16, 3)), e('https://github.com/Bowgull/samara/pull/1', 'Phase 0', at(2026, 11, 24, 3))];
  const g = earlierGroups(list, now);
  assert.deepEqual(g.map((x) => [x.day, x.items.length]), [['TODAY', 1], ['SUNDAY', 2], ['NOV 16', 1]]);
  assert.deepEqual(earlierGroups(list, now, 'zora').flatMap((x) => x.items.map((i) => i.title)), ['Fastest way to get the full Zora set?', 'Zora Armor']);
  assert.deepEqual(earlierGroups(list, now, 'zelda armor').flatMap((x) => x.items.map((i) => i.title)), ['Zora Armor']);
  assert.equal(dayLabel(at(2026, 11, 23, 23), now), 'YESTERDAY');
  assert.equal(dayLabel(at(2025, 11, 23), now), 'NOV 23, 2025');
});

test('the move from trails: trail and done tabs to Earlier under their trail, loose tabs stay, the Stash comes along, nothing lost', () => {
  const now = at(2026, 11, 24, 15);
  const v1 = {
    tabs: [{ url: 'https://a.test/', title: 'Loose' }, { url: 'https://zd.test/zora', title: 'Zora Armor', trail: 2, lastSeen: at(2026, 11, 22, 18) },
      { url: 'https://r.test/z', title: 'Zora thread', trail: 2 }, { url: 'https://d.test/', title: 'Done one', done: true, lastSeen: at(2026, 11, 20) },
      { url: 'https://mock.test/', title: 'Sheet 3', trail: -1 }],
    trails: [{ id: 2, name: 'Zora armor', usedAt: at(2026, 11, 22, 19) }, { id: -1, name: 'MOCKUPS' }],
    stash: [{ name: 'Raid prep', at: at(2026, 11, 18), tabs: [{ url: 'https://wowhead.test/mc', title: 'Molten Core' }, { url: 'https://wowhead.test/bwl' }] }],
  };
  const m = migrateV1(v1, now);
  assert.deepEqual(m.keep, [0, 4], 'loose tab and the MOCKUPS trail stay open');
  assert.deepEqual(m.earlier.map((x) => [x.title, x.from]), [['Zora Armor', 'trail: Zora armor'], ['Zora thread', 'trail: Zora armor'], ['Done one', 'done shelf'], ['Molten Core', 'stash: Raid prep'], ['https://wowhead.test/bwl', 'stash: Raid prep']]);
  assert.equal(m.earlier[1]!.at, at(2026, 11, 22, 19), 'a tab with no time of its own takes its trail\'s');
  assert.equal(m.keep.length + m.earlier.length, v1.tabs.length + 2, 'every tab and stash page accounted for');
  assert.deepEqual(migrateV1({ tabs: [] }, now), { keep: [], earlier: [] });
});

test('Earlier syncs by key: both sides\' entries, a deletion stays deleted unless put away again later', () => {
  const x = e('https://x.test/', 'X', 100), y = e('https://y.test/', 'Y', 200), x2 = e('https://x.test/', 'X again', 300);
  assert.deepEqual(joinEarlier([x], [y, x]).map((i) => i.title), ['Y', 'X']);
  assert.deepEqual(joinEarlier([x, y], [], { [x.key]: 150 }).map((i) => i.title), ['Y']);
  assert.deepEqual(joinEarlier([x2], [], { [x.key]: 150 }).map((i) => i.title), ['X again'], 'a new put-away has its own key');
});
