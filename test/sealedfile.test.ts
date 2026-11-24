// Phase 1 (2026-11-24): history and Earlier sealed at rest with the computer's key; a file the key will not open is
// never written over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSealed, sealText, Unreadable, type Keeper } from '../src/sealedfile.ts';
import { Visits } from '../src/visits.ts';
import { EarlierStore } from '../src/earlier.ts';

/** A stand-in for the Keychain: real AES with a key only this test holds. */
const keeperWith = (key: Buffer): Keeper => ({
  available: () => true,
  seal: (s) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(s, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); },
  open: (b) => { const x = Buffer.from(b, 'base64'); const d = createDecipheriv('aes-256-gcm', key, x.subarray(0, 12)); d.setAuthTag(x.subarray(12, 28)); return Buffer.concat([d.update(x.subarray(28)), d.final()]).toString('utf8'); },
});
const K = keeperWith(randomBytes(32));
const dir = () => mkdtempSync(path.join(os.tmpdir(), 'sealed-'));

test('written sealed: the address he visited is not in the file', () => {
  const f = path.join(dir(), 'browser-history.json');
  const v = new Visits(f, K);
  v.add('https://secret-diagnosis.example/page', 'My results');
  v.flush(); v.save(true);
  return new Promise<void>((r) => setTimeout(() => {
    const raw = readFileSync(f, 'utf8');
    assert.doesNotMatch(raw, /secret-diagnosis|My results/);
    assert.equal(new Visits(f, K).list[0]?.url, 'https://secret-diagnosis.example/page');
    r();
  }, 200));
});

test('a plain file of before is read, and sealed at its next write', () => {
  const f = path.join(dir(), 'browser-history.json');
  writeFileSync(f, JSON.stringify([{ url: 'https://old.example/', title: 'Old', at: Date.now() - 1000 }]));
  const v = new Visits(f, K);
  assert.equal(v.list.length, 1);
  v.add('https://new.example/', 'New'); v.flush(); v.save(true);
  return new Promise<void>((r) => setTimeout(() => { assert.doesNotMatch(readFileSync(f, 'utf8'), /old\.example/); assert.equal(new Visits(f, K).list.length, 2); r(); }, 200));
});

test('a sealed file the key will not open is never written over', () => {
  const f = path.join(dir(), 'browser-history.json');
  writeFileSync(f, sealText(JSON.stringify([{ url: 'https://kept.example/', title: 'Kept', at: Date.now() }]), K));
  const before = readFileSync(f, 'utf8');
  const other = keeperWith(randomBytes(32));
  assert.throws(() => readSealed(f, other), Unreadable);
  const v = new Visits(f, other);
  assert.equal(v.locked, true);
  v.add('https://new.example/', 'New'); v.flush(); v.save(true);
  return new Promise<void>((r) => setTimeout(() => { assert.equal(readFileSync(f, 'utf8'), before, 'untouched'); assert.equal(new Visits(f, K).list[0]?.url, 'https://kept.example/'); r(); }, 200));
});

test('Earlier: sealed, and left alone when the key will not open it', () => {
  const f = path.join(dir(), 'browser-earlier.json');
  const a = new EarlierStore(f, () => {}, K);
  a.add([{ key: 'k1', url: 'https://private.example/x', title: 'Private', at: 100 }]);
  assert.doesNotMatch(readFileSync(f, 'utf8'), /private\.example/);
  assert.equal(new EarlierStore(f, () => {}, K).entries[0]?.url, 'https://private.example/x');
  const before = readFileSync(f, 'utf8');
  const locked = new EarlierStore(f, () => {}, keeperWith(randomBytes(32)));
  assert.equal(locked.locked, true);
  assert.equal(locked.migrated, true, 'the one-time move never runs into a store that cannot keep what it moves');
  locked.add([{ key: 'k2', url: 'https://new.example/', title: 'New', at: 200 }]);
  assert.equal(readFileSync(f, 'utf8'), before);
});

test('no key on this machine: written plain, as before', () => {
  const none: Keeper = { available: () => false, seal: () => { throw new Error('no'); }, open: () => { throw new Error('no'); } };
  assert.equal(sealText('[1]', none), '[1]');
});
