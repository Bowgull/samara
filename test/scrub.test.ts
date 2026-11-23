// The repo is public. This walks every tracked text file and fails on names and words that must never be in it, so they
// cannot come back by accident. gitleaks (pre-commit, pre-push and CI) covers keys, tokens and addresses on top.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const files = execFileSync('git', ['-C', ROOT, 'ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const TEXT = /\.(ts|mjs|cjs|js|html|css|json|md|yml|yaml|ps1|py|swift|toml|txt|svg)$/i;
const SELF = 'test/scrub.test.ts';

// Built from pieces so this file does not trip its own check.
const j = (...p: string[]) => p.join('');
const BANNED: [string, RegExp][] = [
  ['the companion app\'s name', new RegExp(j('\\b', 'a', 'ang'), 'i')],
  ['the old repo\'s name', new RegExp(j('ai', 'vatar'), 'i')],
  ['a personal name', new RegExp(j('\\b(jo', 'shua|jo', 'sh\\b|bo', 'cas)'), 'i')],
  ['a machine name', new RegExp(j('\\bSha', 'dow\\b(?![- ]?(dom|root|host|box|color|blur|offset|ed|s\\b))'))],
  ['the private window', new RegExp(j('secret ?win', 'dow|secret', 'main|secret', 'guard|secret', 'launch|secret', 'logins|seal', 'dir|samara-sec', 'ret|samara:ni', 'ght|night\\.ht', 'ml|yan', 'dex|isSecret', 'Page'), 'i')],
];

test('no banned name or word in any tracked text file', () => {
  const hits: string[] = [];
  for (const f of files) {
    if (f === SELF || f === 'package-lock.json' || !TEXT.test(f)) continue;
    let s: string; try { s = readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    s.split('\n').forEach((line, i) => { for (const [what, re] of BANNED) if (re.test(line)) hits.push(`${f}:${i + 1} (${what}): ${line.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(hits.slice(0, 40), [], `${hits.length} hits`);
});

test('no game pictures or saves anywhere in the repo', () => {
  const bad = files.filter((f) => /\.sav$/i.test(f) || (/hyrule|botw|zelda/i.test(f) && /\.(png|jpe?g|webp|gif|bin)$/i.test(f)));
  assert.deepEqual(bad, []);
});
