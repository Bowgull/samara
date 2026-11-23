// brand.ts: Samara.exe carries its own name and icon, so Task Manager says Samara, not Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { brands, rceditArgs } from '../src/brand.ts';

test('Samara gets its own file, name and icon', () => {
  const b = brands('/shell');
  assert.deepEqual(b.map((x) => [x.file, x.name]), [['Samara.exe', 'Samara']]);
  assert.equal(b[0]!.icon, path.join('/shell', 'pages', 'art', 'samara', 'samara.ico'));
});

test('Task Manager reads the name from FileDescription, so it is set, with the icon', () => {
  const a = rceditArgs('X:/e/Samara.exe', brands('/shell')[0]!);
  assert.equal(a[0], 'X:/e/Samara.exe');
  assert.deepEqual(a.slice(1, 3), ['--set-icon', path.join('/shell', 'pages', 'art', 'samara', 'samara.ico')]);
  const pairs = new Map<string, string>();
  for (let i = 3; i < a.length; i += 3) { assert.equal(a[i], '--set-version-string'); pairs.set(a[i + 1]!, a[i + 2]!); }
  assert.equal(pairs.get('FileDescription'), 'Samara');
  assert.equal(pairs.get('ProductName'), 'Samara');
  assert.equal(pairs.get('OriginalFilename'), 'Samara.exe');
});
