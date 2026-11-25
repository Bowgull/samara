// Q1 (2026-11-25): the quick-note key works on a MacBook (no number pad): Control + Option + N there; on the PC
// Ctrl + Num * as before (Ctrl + Alt + a letter is AltGr on many Windows keyboards). Each is said the way that keyboard reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quickKeysFor, sayKey } from '../src/notes.ts';

test('the Mac has a quick-note key a MacBook can press (no number pad)', () => {
  const mac = quickKeysFor('darwin');
  assert.deepEqual(mac, ['Control+Alt+N']);
  for (const k of mac) assert.doesNotMatch(k, /num/i, 'nothing on a number pad');
  assert.equal(sayKey(mac[0]!, true), 'Control + Option + N');
});

test('the PC keeps Ctrl + Num *, and takes no Ctrl + Alt + letter (that is AltGr on many keyboards)', () => {
  assert.deepEqual(quickKeysFor('win32'), ['Control+nummult']);
  assert.equal(sayKey('Control+nummult', false), 'Ctrl + Num *');
  for (const k of quickKeysFor('win32')) assert.doesNotMatch(k, /Control\+Alt\+[A-Z]$/);
});
