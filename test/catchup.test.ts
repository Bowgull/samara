// His ask (2026-11-24): the update card says how many versions behind, and what each one brought (src/catchup.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { catchUp, historyOf, readHistory, HISTORY_MAX } from '../src/catchup.ts';
import { checkManifest } from '../src/ghrelease.ts';

const versions = [
  { semver: '1.60.0', name: 'Gojo', at: '2026-11-01T00:00:00Z' },
  { semver: '1.61.0', name: 'Gojo', at: '2026-11-05T00:00:00Z' },
  { semver: '1.62.0', name: 'Gojo', at: '2026-11-10T00:00:00Z' },
  { semver: '1.63.0', name: 'Gojo', at: '2026-11-20T00:00:00Z' },
];
const items = [
  { at: '2026-10-31T00:00:00Z', text: 'Old line', kind: 'fix' },
  { at: '2026-11-04T00:00:00Z', text: 'Tabs tidy themselves', kind: 'feature' },
  { at: '2026-11-09T00:00:00Z', text: 'Rail is smoother', kind: 'fix' },
  { at: '2026-11-15T00:00:00Z', text: 'Sync keeps both sides', kind: 'feature' },
];

test('history: the versions before this one, newest first, each with its own lines', () => {
  const h = historyOf(versions, items, '1.63.0');
  assert.deepEqual(h.map((s) => s.version), ['1.62.0', '1.61.0', '1.60.0']);
  assert.deepEqual(h[0]!.items, [{ text: 'Rail is smoother', kind: 'fix' }]);
  assert.deepEqual(h[1]!.items, [{ text: 'Tabs tidy themselves', kind: 'feature' }]);
  assert.deepEqual(h[2]!.items, [{ text: 'Old line', kind: 'fix' }]);
});

test('history reaches back at most HISTORY_MAX versions', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ semver: `1.${i}.0`, name: 'Gojo', at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));
  assert.equal(historyOf(many, [], '1.29.0').length, HISTORY_MAX);
});

const newest = { version: '1.63.0', notes: ['Sync keeps both sides'] };
const history = historyOf(versions, items, '1.63.0');

test('one version behind: the card is as it always was', () => {
  assert.deepEqual(catchUp(newest, history, '1.62.0'), { groups: [{ name: 'SAMARA', items: [{ text: 'Sync keeps both sides' }] }] });
});

test('three behind: says so, and lists each version it brings, newest first', () => {
  const c = catchUp(newest, history, '1.60.0');
  assert.equal(c.behind, 'You are 3 versions behind (you have 1.60.0). This one update brings all of them.');
  assert.deepEqual(c.groups.map((g) => g.name), ['SAMARA 1.63.0', 'SAMARA 1.62.0 · GOJO', 'SAMARA 1.61.0 · GOJO']);
});

test('a release without a history (before this change) shows only its own lines', () => {
  assert.equal(catchUp(newest, undefined, '1.50.0').behind, undefined);
});

test('further behind than the history reaches: "at least"', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ semver: `2.${i}.0`, name: 'Edward', at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));
  const c = catchUp({ version: '2.24.0', notes: ['x'] }, historyOf(many, [], '2.24.0'), '1.0.0');
  assert.match(c.behind!, /^You are at least 21 versions behind/);
});

test('readHistory drops anything a release would not write', () => {
  assert.deepEqual(readHistory([{ version: 'x', items: [] }, { version: '1.2.3', name: '<b>', items: [{ text: 'ok', kind: 'evil' }, { text: '' }] }, null]),
    [{ version: '1.2.3', name: '', items: [{ text: 'ok', kind: 'fix' }] }]);
  assert.deepEqual(readHistory('nope'), []);
});

test('a sealed manifest carries its history through the seal check', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const text = JSON.stringify({ v: 1, app: 'samara', version: '1.63.0', name: 'Gojo', commit: 'a'.repeat(40), at: '2026-11-20T00:00:00Z', notes: ['n'], items: [],
    bundle: { file: 'samara-bundle.tgz', sha256: 'b'.repeat(64), bytes: 10 }, history });
  const m = checkManifest(text, sign(null, Buffer.from(text), privateKey).toString('base64'), publicKey.export({ type: 'spki', format: 'pem' }).toString());
  assert.deepEqual(m?.history?.map((s) => s.version), ['1.62.0', '1.61.0', '1.60.0']);
});
