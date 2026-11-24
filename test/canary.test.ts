// Phase 4: canary releases (src/canary.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Canary, MAC_WAIT_MS, PeerVerdicts, WATCH_MS, helperCrashed, macMayTake, ownPage, verdictOf } from '../src/canary.ts';

const dir = () => mkdtempSync(path.join(os.tmpdir(), 'canary-'));
const w = (o: object = {}) => ({ version: '1.31.0', since: 0, unclean: 0, own: 0, helpers: 0, ...o });

test('the rule: closed unexpectedly once, own pages twice, helpers three times; a quiet day is good', () => {
  assert.equal(verdictOf(w(), WATCH_MS - 1).v, 'watching');
  assert.equal(verdictOf(w(), WATCH_MS).v, 'good');
  assert.equal(verdictOf(w({ unclean: 1 }), 5).v, 'bad');
  assert.equal(verdictOf(w({ own: 1 }), 5).v, 'watching');
  assert.equal(verdictOf(w({ own: 2 }), 5).v, 'bad');
  assert.equal(verdictOf(w({ helpers: 2 }), 5).v, 'watching');
  assert.equal(verdictOf(w({ helpers: 3 }), 5).v, 'bad');
});

test('what counts: Samara\'s own pages and helpers that crashed, not websites or helpers closed on purpose', () => {
  assert.equal(ownPage('file:///app/pages/browser.html'), true);
  assert.equal(ownPage('http://127.0.0.1:4100/rail'), true);
  assert.equal(ownPage('https://www.youtube.com/'), false);
  assert.equal(helperCrashed('crashed'), true);
  assert.equal(helperCrashed('oom'), true);
  assert.equal(helperCrashed('clean-exit'), false);
  assert.equal(helperCrashed('killed'), false);
});

test('a new version starts a watch; an unclean close counts only when the last run was that same version', () => {
  const d = dir(), file = path.join(d, 'canary.json');
  let now = 1000;
  const a = new Canary({ file, version: '1.31.0', unclean: true, now: () => now });
  assert.equal(a.settle(), null, 'the unclean close was the version before');
  const b = new Canary({ file, version: '1.31.0', unclean: true, now: () => now });
  assert.deepEqual(b.settle(), { v: 'bad', version: '1.31.0', why: 'Samara closed unexpectedly on it' });
  assert.equal(b.settle(), null, 'given once');
  assert.equal(new Canary({ file, version: '1.31.0', unclean: false, now: () => now }).given(), 'bad', 'kept for the next start');
  const c = new Canary({ file, version: '1.32.0', unclean: false, now: () => now });
  c.record('own'); c.record('helper');
  now += WATCH_MS;
  c.record('own');
  assert.deepEqual(c.settle(), { v: 'good', version: '1.32.0' }, 'trouble after the day does not count');
});

test('not a release (no version): nothing is watched', () => {
  const c = new Canary({ file: path.join(dir(), 'c.json'), version: '', unclean: true });
  c.record('own'); c.record('own');
  assert.equal(c.settle(), null);
});

test('the Mac: waits its day, takes it at once on the PC\'s good, never on its bad; his check skips only the wait', () => {
  assert.equal(macMayTake(null, 0, MAC_WAIT_MS - 1, false), false);
  assert.equal(macMayTake(null, 0, MAC_WAIT_MS, false), true);
  assert.equal(macMayTake('good', 0, 1, false), true);
  assert.equal(macMayTake('bad', 0, MAC_WAIT_MS * 9, true), false);
  assert.equal(macMayTake(null, 0, 1, true), true);
  const p = new PeerVerdicts(path.join(dir(), 'peer.json'));
  p.set('1.31.0', 'bad'); p.set('1.31.0', 'good'); p.set('1.32.0', 'good'); p.set('not a version', 'good');
  assert.equal(p.get('1.31.0'), 'bad', 'bad stays bad');
  assert.equal(p.get('1.32.0'), 'good');
  assert.equal(p.get('1.33.0'), null);
});

test('a bad verdict outlives the turn-back: the version before starts a new watch, the bad one is still there to tell', () => {
  const d = dir(), file = path.join(d, 'canary.json');
  const bad = new Canary({ file, version: '1.31.0', unclean: false });
  bad.record('own'); bad.record('own');
  assert.equal(bad.settle()?.v, 'bad');
  const back = new Canary({ file, version: '1.30.0', unclean: false });
  assert.equal(back.given(), null, 'the version before is watched afresh');
  assert.deepEqual(back.history(), { '1.31.0': 'bad' }, 'and the bad verdict is kept to tell the Mac');
});
