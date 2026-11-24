// Phase 1 (2026-11-24): Samara's code checked against its release's sealed list of files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkIntegrity, listOf, sayIntegrity } from '../src/integrity.ts';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const app = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'integ-'));
  mkdirSync(path.join(d, 'src')); mkdirSync(path.join(d, 'pages', 'art'), { recursive: true });
  writeFileSync(path.join(d, 'src', 'pc.ts'), 'console.log(1)');
  writeFileSync(path.join(d, 'pages', 'browser.js'), 'x()');
  writeFileSync(path.join(d, 'pages', 'art', 'icon.png'), 'png');
  return d;
};
const seal = (d: string, key = privateKey) => { const l = listOf(d, '1.2.3'); writeFileSync(path.join(d, 'integrity.json'), l); writeFileSync(path.join(d, 'integrity.sig'), sign(null, Buffer.from(l), key).toString('base64')); };

test('a run from the source folder is not checked', () => {
  assert.deepEqual(checkIntegrity(app(), pub), { state: 'dev' });
});

test('files as released check out; pictures are not listed', () => {
  const d = app(); seal(d);
  assert.deepEqual(checkIntegrity(d, pub), { state: 'ok', files: 2 });
  assert.ok(!Object.keys(JSON.parse(readFileSync(path.join(d, 'integrity.json'), 'utf8')).files).some((f) => f.endsWith('.png')));
});

test('a changed, added or missing code file is reported by name', () => {
  const d = app(); seal(d);
  writeFileSync(path.join(d, 'src', 'pc.ts'), 'evil()');
  writeFileSync(path.join(d, 'src', 'extra.cjs'), 'more()');
  const r = checkIntegrity(d, pub);
  assert.equal(r.state, 'changed');
  if (r.state === 'changed') { assert.deepEqual(r.changed, ['src/pc.ts']); assert.deepEqual(r.added, ['src/extra.cjs']); }
  assert.match(sayIntegrity(r), /2 of Samara's code files are not as released \(src\/pc\.ts, src\/extra\.cjs\)/);
});

test('a list sealed with another key, or edited after sealing, is not trusted', () => {
  const d = app(); seal(d, generateKeyPairSync('ed25519').privateKey);
  assert.equal(checkIntegrity(d, pub).state, 'unsealed');
  const e = app(); seal(e);
  const j = JSON.parse(readFileSync(path.join(e, 'integrity.json'), 'utf8')); j.files['src/pc.ts'] = '0'.repeat(64);
  writeFileSync(path.join(e, 'integrity.json'), JSON.stringify(j));
  assert.equal(checkIntegrity(e, pub).state, 'unsealed');
});

test('every release carries the sealed list inside its bundle', () => {
  const s = readFileSync('tools/release/samara-release.mjs', 'utf8');
  assert.match(s, /listOf\(shell, version\)/);
  assert.match(s, /'integrity\.json', 'integrity\.sig'\]/);
  for (const f of ['src/pc.ts', 'src/macbrowser.ts']) assert.match(readFileSync(f, 'utf8'), /checkIntegrity\(app\.getAppPath\(\)\)/, f);
});
