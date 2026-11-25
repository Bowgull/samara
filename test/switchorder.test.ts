// Phase 2: the engine's back doors closed before castLabs signs it, and back as shipped when castLabs refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFuses, SENTINEL } from '../src/fusewire.ts';
import { SwitchOrder, signWithSwitches } from '../src/switchorder.ts';
import type { Signed } from '../src/evs.ts';

// An engine as castLabs ships it: back doors open (RunAsNode on, NODE_OPTIONS on, inspector on), login lock off.
const engine = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'switchorder-'));
  const exe = path.join(dir, 'electron.exe');
  writeFileSync(exe, Buffer.concat([Buffer.from('MZ....'), Buffer.from(SENTINEL), Buffer.from([1, 5, 0x31, 0x30, 0x31, 0x31, 0x31]), Buffer.from('....')]));
  return { dir, exe, stockFile: path.join(dir, 'stock-fuses.txt'), order: new SwitchOrder(path.join(dir, 'switch-order.json')) };
};
const run = (e: ReturnType<typeof engine>, v: string, answers: Signed[], wires: string[] = []) => signWithSwitches({ v, fuseFile: e.exe, stockFile: e.stockFile, order: e.order, log: () => {}, sign: async () => { try { wires.push(readFuses(e.exe)); } catch { wires.push('none'); } return answers.shift() ?? 'failed'; } });

test('back doors closed before castLabs signs; the login lock is left as castLabs shipped it', async () => {
  const e = engine(), wires: string[] = [];
  assert.deepEqual(await run(e, '44.11.4', ['ok'], wires), { r: 'ok', closed: true });
  assert.deepEqual(wires, ['00001'], 'signed with the three back doors closed, lock off, the fifth switch untouched');
  assert.equal(readFileSync(e.stockFile, 'utf8'), '10111', 'the switches as shipped are kept');
});

test('castLabs refuses: back as shipped, signed again, and learned for the major', async () => {
  const e = engine(), wires: string[] = [];
  assert.deepEqual(await run(e, '44.11.4', ['denied', 'ok'], wires), { r: 'ok', closed: false });
  assert.deepEqual(wires, ['00001', '10111']);
  assert.equal(e.order.read().stockOnly, 44);
  const again: string[] = [];
  assert.deepEqual(await run(e, '44.12.0', ['ok'], again), { r: 'ok', closed: false });
  assert.deepEqual(again, ['10111'], 'the same major is not tried closed again');
  const next: string[] = [];
  assert.deepEqual(await run(e, '45.0.1', ['ok'], next), { r: 'ok', closed: true });
  assert.deepEqual(next, ['00001'], 'a new major tries again');
});

test('a sign-in or other failure with the doors closed is not taken as a refusal', async () => {
  const e = engine();
  assert.deepEqual(await run(e, '44.11.4', ['signin']), { r: 'signin', closed: true });
  assert.equal(existsSync(path.join(e.dir, 'switch-order.json')), false);
});

test('an engine whose switches cannot be read is signed as it is', async () => {
  const e = engine();
  writeFileSync(e.exe, 'no wire here');
  assert.deepEqual(await run(e, '44.11.4', ['ok']), { r: 'ok', closed: false });
});
