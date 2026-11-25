// Phase 1 (2026-11-24): DNS over HTTPS (Quad9) is turned on at start, on both machines, and a failure never stops Samara.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECURE_DNS, secureDns } from '../src/privacy.ts';

test('Quad9 over HTTPS, falling back only when it cannot be reached', () => {
  let got: any = null;
  const lines: string[] = [];
  assert.equal(secureDns({ configureHostResolver: (o) => { got = o; } }, (s) => lines.push(s)), true);
  assert.deepEqual(got.secureDnsServers, ['https://dns.quad9.net/dns-query']);
  assert.equal(got.secureDnsMode, 'automatic');
  assert.ok(got.secureDnsServers.every((u: string) => u.startsWith('https://')));
  assert.match(lines[0]!, /Quad9/);
  assert.notEqual(got.secureDnsServers, SECURE_DNS.secureDnsServers, 'a copy, never the shared list');
});

test('a resolver that refuses is logged, and the start goes on', () => {
  const lines: string[] = [];
  assert.equal(secureDns({ configureHostResolver: () => { throw new Error('not ready'); } }, (s) => lines.push(s)), false);
  assert.match(lines[0]!, /could not be turned on: not ready/);
});

test('both the PC and the Mac turn it on when the app is ready', () => {
  for (const f of ['src/pc.ts', 'src/macbrowser.ts']) {
    const s = readFileSync(f, 'utf8');
    const ready = s.indexOf('app.whenReady().then(');
    assert.ok(ready > 0 && s.indexOf('secureDns(app', ready) > ready && s.indexOf('secureDns(app', ready) - ready < 300, f);
  }
});
