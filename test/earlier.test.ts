// Phase R: Earlier's own file (src/earlier.ts): kept across restarts, one entry per key, removals stick, sync joins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EarlierStore } from '../src/earlier.ts';
import type { EarlierEntry } from '../src/rail.ts';

const e = (key: string, at: number, url = `https://a.test/${key}`): EarlierEntry => ({ key, url, title: key, at });
const file = () => path.join(mkdtempSync(path.join(tmpdir(), 'earlier-')), 'browser-earlier.json');

test('kept across restarts, newest first, one per key', () => {
  const f = file();
  const a = new EarlierStore(f);
  a.add([e('k1', 100), e('k2', 300)]);
  a.add([e('k1', 100)]);
  const b = new EarlierStore(f);
  assert.deepEqual(b.entries.map((x) => x.key), ['k2', 'k1']);
});

test('a removed entry stays removed when the other machine still has it', () => {
  const f = file();
  const a = new EarlierStore(f);
  a.add([e('k1', 100), e('k2', 200)]);
  assert.equal(a.take('k1')?.url, 'https://a.test/k1');
  a.join([e('k1', 100), e('k3', 50)], {});
  assert.deepEqual(a.entries.map((x) => x.key), ['k2', 'k3']);
});

test('the other side removing one removes it here', () => {
  const a = new EarlierStore(file());
  a.add([e('k1', 100), e('k2', 200)]);
  assert.equal(a.join([], { k2: 500 }), true);
  assert.deepEqual(a.entries.map((x) => x.key), ['k1']);
});

test('only web addresses, a broken file starts empty, migrated and lastTidy are kept', () => {
  const f = file();
  writeFileSync(f, '{not json');
  const a = new EarlierStore(f);
  assert.equal(a.entries.length, 0);
  a.add([e('k1', 1, 'javascript:alert(1)'), e('k2', 2)]);
  a.tidied(1234); a.markMigrated();
  const b = new EarlierStore(f);
  assert.deepEqual(b.entries.map((x) => x.key), ['k2']);
  assert.equal(b.lastTidy, 1234);
  assert.equal(b.migrated, true);
  assert.ok(JSON.parse(readFileSync(f, 'utf8')).entries.length === 1);
});
