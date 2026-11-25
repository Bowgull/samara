// Autofill (sheet 77): the page's preload cannot import anything, so it carries its own copy of the box reader; this keeps
// that copy and src/autofill.ts FIELD_KIND_JS the same, line for line. And his details are cleaned before they are kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FIELD_KIND_JS, PinSeal, cleanDetails, detailFor } from '../src/autofill.ts';

const norm = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
test('the preload reads boxes exactly as autofill does', () => {
  const pre = readFileSync(path.join(import.meta.dirname, '..', 'src', 'tabpreload.cjs'), 'utf8');
  const start = pre.indexOf('function fieldKind(el) {'), end = pre.indexOf('\n    }\n', start);
  assert.ok(start > 0 && end > start, 'fieldKind is in the preload');
  assert.equal(norm(pre.slice(start, end + 6)), norm(FIELD_KIND_JS));
});
test('his details: short plain text, real-looking emails, at most five', () => {
  const d = cleanDetails({ name: '  Alex\u0007 Example ', emails: ['a@b.co', 'not an email', 'a@b.co', 'c@d.io', 'e@f.io', 'g@h.io', 'i@j.io', 'k@l.io'], phone: 5550142, extra: 'dropped' });
  assert.equal(d.name, 'Alex Example');
  assert.deepEqual(d.emails, ['a@b.co', 'c@d.io', 'e@f.io', 'g@h.io', 'i@j.io']);
  assert.equal(d.phone, '5550142');
  assert.equal((d as unknown as Record<string, unknown>).extra, undefined);
  assert.equal(detailFor(d, 'given'), 'Alex');
  assert.equal(detailFor(d, 'family'), 'Example');
  assert.equal(detailFor(d, 'email', 1), 'c@d.io');
});
test('his phone is tidied, other countries kept as typed (sheet 83 v4)', () => {
  assert.equal(cleanDetails({ phone: '416-555-0142' }).phone, '(416) 555-0142');
  assert.equal(cleanDetails({ phone: '1 416 555 0142' }).phone, '+1 (416) 555-0142');
  assert.equal(cleanDetails({ phone: '+44 20 7946 0958' }).phone, '+44 20 7946 0958');
});
test('first and last name kept apart, as he typed them (sheet 83 v3)', () => {
  const d = cleanDetails({ given: 'Mary Ann', family: 'van der Berg', name: 'ignored' });
  assert.equal(detailFor(d, 'given'), 'Mary Ann');
  assert.equal(detailFor(d, 'family'), 'van der Berg');
  assert.equal(detailFor(d, 'name'), 'Mary Ann van der Berg');
});

test('a PIN the Keychain will not open is locked out, not forgotten (2026-10-27)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pin-'));
  const f = path.join(dir, 'autofill-pin.json');
  assert.equal(new PinSeal(f).unreadable(), false);          // no PIN at all
  writeFileSync(f, JSON.stringify({ v: 1, sealed: 'djEwbnSQ' }));
  const seal = new PinSeal(f);
  assert.equal(seal.has(), false);
  assert.equal(seal.unreadable(), true);
  writeFileSync(f, 'not json');
  assert.equal(seal.unreadable(), false);
});

// Phase 1 (2026-11-24): the PIN's own seal at the new cost, old seals moved up on their first right PIN, five wrong
// PINs and the seal is gone (the master password again). A stand-in for the Keychain, so this runs without Electron.
test('the PIN seal: new cost, old seals upgraded, five wrong and it is gone', async () => {
  const { PIN_COST, PIN_TRIES } = await import('../src/autofill.ts');
  const { createCipheriv, randomBytes, scryptSync } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const keeper = { lock: (x: string) => Buffer.from(x).toString('base64'), open: (x: string) => Buffer.from(x, 'base64').toString('utf8') };
  const inner = (f: string) => JSON.parse(keeper.open(JSON.parse(readFileSync(f, 'utf8')).sealed));
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pin2-'));
  const f = path.join(dir, 'autofill-pin.json');
  const seal = new PinSeal(f, keeper);
  assert.equal(await seal.seal('2468', 'SESSION-1'), true);
  assert.equal(inner(f).n, PIN_COST);
  assert.equal(PIN_COST >= 17, true);
  assert.deepEqual(await seal.open('2468'), { session: 'SESSION-1' });
  // A seal made before Phase 1 (cost 2^12, no n): it opens, and is sealed again at the new cost.
  const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync('1357', salt, 32, { N: 1 << 12, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  const c = createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update('OLD-SESSION', 'utf8'), c.final()]);
  writeFileSync(f, JSON.stringify({ v: 1, sealed: keeper.lock(JSON.stringify({ salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64'), check: 'v1', tries: 0, len: 4 })) }));
  const old = new PinSeal(f, keeper);
  assert.deepEqual(await old.open('1357'), { session: 'OLD-SESSION' });
  assert.equal(inner(f).n, PIN_COST, 'upgraded on the first right PIN');
  assert.deepEqual(await old.open('1357'), { session: 'OLD-SESSION' }, 'and still opens at the new cost');
  // Wrong PINs count down; the last one wipes the seal.
  for (let i = 1; i < PIN_TRIES; i++) assert.deepEqual(await old.open('0000'), { wrong: PIN_TRIES - i });
  assert.equal(await old.open('0000'), 'gone');
  assert.equal(old.has(), false);
});
