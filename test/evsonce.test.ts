// Phase 2: on the PC, castLabs' sign-in is asked once per engine, and a sign-in done any way at all carries on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineUpdates } from '../src/engineupdate.ts';
import { SENTINEL } from '../src/fusewire.ts';
import type { Evs } from '../src/evs.ts';

test('PC engine: castLabs sign-in told once, a quiet watch resumes when he signs in', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'evsonce-'));
  const dir = path.join(root, 'shell', 'engines', 'castlabs-44.11.4');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'electron.exe'), Buffer.concat([Buffer.from('MZ....'), Buffer.from(SENTINEL), Buffer.from([1, 4, 0x31, 0x30, 0x31, 0x31]), Buffer.from('....')]));
  let told = 0, watches = 0, answer: 'signin' | 'ok' = 'signin', quiet: ((ok: boolean) => void) | null = null;
  const evs = { sign: async () => answer, loginStamp: () => 0, watchSignin: (_s: number, done: (ok: boolean) => void) => { watches++; quiet = done; return () => {}; } } as unknown as Evs;
  const u = new EngineUpdates({ shellDir: path.join(root, 'shell'), stateDir: root, quietNow: () => true, changed: () => {}, signinNeeded: () => { told++; }, evs });
  let checks = 0;
  (u as unknown as { check: () => Promise<void> }).check = async () => { checks++; };
  assert.equal(await u.switchesAndSign('44.11.4'), 'signin');
  assert.equal(await u.switchesAndSign('44.11.4'), 'signin');
  assert.equal(told, 1, 'one note, not one per check');
  assert.equal(watches, 1);
  assert.equal(u.signin, 'ask');
  quiet!(true);
  assert.equal(u.signin, null);
  assert.equal(checks, 1, 'carries on by itself');
  answer = 'ok';
  assert.equal(await u.switchesAndSign('44.11.4'), 'ok');
  u.stop();
});
