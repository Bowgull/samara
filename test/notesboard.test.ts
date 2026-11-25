// Notes in Samara (N1, 2026-11-25): finding a note as he types, and the copy locked with his passphrase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchNotes } from '../src/notes.ts';
import { lockNotes, unlockNotes, MIN_PASS } from '../src/notelock.ts';

const n = (title: string, html: string, updated: number, more: { cat?: string; site?: string } = {}) =>
  ({ title, html, updated, ...(more.cat ? { cat: more.cat } : {}), ...(more.site ? { src: { url: `https://${more.site}/`, site: more.site } } : {}) });
const notes = [
  n('Groceries', '<div>buy oat milk</div><div>bread</div>', 3),
  n('Raid night', '<div class="cl">Flasks</div>', 2, { cat: 'To-do', site: 'wowhead.com' }),
  n('Note', '<div>Milkshake recipe from Zoë</div>', 1, { cat: 'Idea' }),
];

test('every word typed must start a word in the note; a title hit ranks first', () => {
  assert.deepEqual(searchNotes(notes, 'oat mi').map((x) => x.title), ['Groceries']);
  assert.deepEqual(searchNotes(notes, 'milk').map((x) => x.title), ['Groceries', 'Note']);
  assert.deepEqual(searchNotes(notes, 'raid').map((x) => x.title), ['Raid night']);
  assert.deepEqual(searchNotes(notes, 'wowhead').map((x) => x.title), ['Raid night'], 'the site it came from');
  assert.deepEqual(searchNotes(notes, 'todo').map((x) => x.title), [], 'words, not letters run together');
  assert.deepEqual(searchNotes(notes, 'to').map((x) => x.title), ['Raid night'], 'its category');
  assert.deepEqual(searchNotes(notes, 'zoe').map((x) => x.title), ['Note'], 'accents folded');
  assert.deepEqual(searchNotes(notes, 'flask nothing'), []);
  assert.deepEqual(searchNotes(notes, '  ').map((x) => x.updated), [3, 2, 1], 'nothing typed: newest first');
});

test('a locked copy opens with its passphrase only, and a changed file does not open', () => {
  const payload = { v: 1, own: ['Garden'], notes: [{ id: 'na', title: 'Secret plan', html: '<div>x</div>' }] };
  const text = lockNotes(payload, 'correct horse battery');
  assert.doesNotMatch(text, /Secret plan|Garden/);
  assert.deepEqual(unlockNotes(text, 'correct horse battery'), payload);
  assert.throws(() => unlockNotes(text, 'wrong horse battery'), /wrong/);
  const j = JSON.parse(text); j.data = Buffer.from('x' + Buffer.from(j.data, 'base64').toString('binary'), 'binary').toString('base64');
  assert.throws(() => unlockNotes(JSON.stringify(j), 'correct horse battery'), /wrong/);
  assert.throws(() => unlockNotes('{"hello":1}', 'x'), /notours/);
  assert.throws(() => unlockNotes(JSON.stringify({ ...JSON.parse(text), kdf: { ...JSON.parse(text).kdf, n: 1 << 30 } }), 'x'), /notours/, 'a file asking for absurd work is refused');
  assert.throws(() => lockNotes(payload, 'short'), new RegExp(String(MIN_PASS)));
});
