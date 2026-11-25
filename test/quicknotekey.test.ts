// Q1 (2026-11-25): the quick-note key works on a MacBook (no number pad): Control + Option + N there; on the PC
// Ctrl + Num * as before, and Ctrl + Alt + N for a laptop. Each is said the way that keyboard reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quickKeysFor, sayKey } from '../src/notes.ts';

test('the Mac has a quick-note key a MacBook can press (no number pad)', () => {
  const mac = quickKeysFor('darwin');
  assert.deepEqual(mac, ['Control+Alt+N']);
  for (const k of mac) assert.doesNotMatch(k, /num/i, 'nothing on a number pad');
  assert.equal(sayKey(mac[0]!, true), 'Control + Option + N');
});

test('the PC keeps Ctrl + Num * and adds Ctrl + Alt + N for a laptop', () => {
  assert.deepEqual(quickKeysFor('win32'), ['Control+nummult', 'Control+Alt+N']);
  assert.deepEqual(quickKeysFor('win32').map((k) => sayKey(k, false)), ['Ctrl + Num *', 'Ctrl + Alt + N']);
});
