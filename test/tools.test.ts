// U1 (2026-11-25): Samara's tools in one place. The tools key's menu lists Timer, Music player, Snip and New note in the
// ☰ menu's order, only the ones that started, with the quick-note key beside New note; the key is the same on both machines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toolsMenu, toolsKeyFor } from '../src/tools.ts';

test('the tools menu: Timer, Music player, Snip, New note, with the quick-note key beside New note', () => {
  const did: string[] = [];
  const rows = toolsMenu({ timer: () => did.push('timer'), music: () => did.push('music'), snip: () => did.push('snip'), note: () => did.push('note') }, 'Control+Alt+N');
  assert.deepEqual(rows.map((r) => r.label), ['Timer', 'Music player', 'Snip', 'New note']);
  assert.equal(rows[3]!.accelerator, 'Control+Alt+N');
  assert.equal(rows[3]!.registerAccelerator, false, 'shown only: the notes hold the key themselves');
  (rows[0]!.click as () => void)(); (rows[3]!.click as () => void)();
  assert.deepEqual(did, ['timer', 'note']);
});

test('only the tools that started; none at all says so', () => {
  assert.deepEqual(toolsMenu({ timer: null, music: () => {}, snip: null, note: () => {} }, null).map((r) => r.label), ['Music player', 'New note']);
  const none = toolsMenu({}, null);
  assert.equal(none.length, 1);
  assert.equal(none[0]!.enabled, false);
});

test('the tools key is Control + Option + T on the Mac and Ctrl + Num / on the PC (never Ctrl + Alt + a letter there: AltGr)', () => {
  assert.equal(toolsKeyFor('darwin'), 'Control+Alt+T');
  assert.equal(toolsKeyFor('win32'), 'Control+numdiv');
});

test('the ☰ menu has a TOOLS group with the four tools', () => {
  const html = readFileSync(new URL('../pages/browser.html', import.meta.url), 'utf8');
  const grp = /<div class="gh" id="mg4">TOOLS[\s\S]*?<\/div>\n([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  assert.deepEqual([...grp.matchAll(/class="mrow" id="(m-[a-z]+)"/g)].map((m) => m[1]), ['m-timer', 'm-music', 'm-snip', 'm-newnote']);
});
