// Timers in Samara (T1, 2026-11-25): the timer keeps its time through a restart, rings once, and every key does what it
// did in the companion: +1 / +5 / scroll never under 10 s, pause and go on, turn it over, five at most, a finished one
// kept for ten minutes, and a time typed in Custom read the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Timers, MAX_TIMERS, DONE_KEEP_MS, MIN_LEFT_MS, MAX_MS, COLOURS, parseCustom, sayDuration, tidyLabel, isTimerAction } from '../src/timers.ts';

const file = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'timers-')), 'timers.json');
const T0 = 1_800_000_000_000;

test('a timer is kept on disk and comes back after a restart, as it was', () => {
  const f = file();
  const a = new Timers(f);
  const t = a.start(25 * 60_000, 'Pizza', T0)!;
  assert.equal(t.label, 'Pizza'); assert.equal(t.end, T0 + 25 * 60_000); assert.equal(t.colour, 'blue');
  const b = new Timers(f);
  assert.deepEqual(b.list(), [t]);
});

test('one that ran out while Samara was closed goes off once, at the next look', () => {
  const f = file();
  new Timers(f).start(60_000, '', T0);
  const b = new Timers(f);
  const due = b.due(T0 + 5 * 60_000);
  assert.equal(due.length, 1);
  assert.equal(due[0]!.done, T0 + 60_000, 'marked done when it ran out, not when it was noticed');
  assert.equal(b.due(T0 + 6 * 60_000).length, 0, 'never rings twice');
  assert.equal(new Timers(f).due(T0 + 7 * 60_000).length, 0, 'not after a restart either');
});

test('five at most; a finished one makes room, a running one never does', () => {
  const s = new Timers(file());
  for (let i = 0; i < MAX_TIMERS; i++) assert.ok(s.start(60_000 * (i + 1), '', T0));
  assert.equal(s.start(60_000, '', T0), null);
  assert.deepEqual(s.list().map((t) => t.colour), [...COLOURS], 'each its own sand colour');
  s.due(T0 + 60_000);
  assert.ok(s.start(60_000, 'New', T0 + 60_000), 'the finished one made room');
  assert.equal(s.list().length, MAX_TIMERS);
});

test('+1, -1 and scrolling: never under 10 seconds, never over a day', () => {
  const s = new Timers(file());
  const t = s.start(30_000, '', T0)!;
  assert.equal(s.act(t.id, 'add', T0, { ms: 60_000 })!.end, T0 + 90_000);
  assert.equal(s.act(t.id, 'add', T0, { ms: -10 * 60_000 })!.end, T0 + MIN_LEFT_MS);
  assert.equal(s.act(t.id, 'add', T0, { ms: 2 * MAX_MS })!.end, T0 + MIN_LEFT_MS, 'a silly number is ignored');
  assert.ok(s.act(t.id, 'add', T0, { ms: MAX_MS })!.end <= T0 + MAX_MS);
});

test('pause keeps what was left; go on starts from there', () => {
  const s = new Timers(file());
  const t = s.start(10 * 60_000, '', T0)!;
  const p = s.act(t.id, 'pause', T0 + 4 * 60_000)!;
  assert.equal(p.paused, 6 * 60_000);
  assert.equal(s.due(T0 + 60 * 60_000).length, 0, 'a paused timer never rings');
  assert.equal(s.nextAt(), null);
  const g = s.act(t.id, 'pause', T0 + 60 * 60_000)!;
  assert.equal(g.paused, 0); assert.equal(g.end, T0 + 66 * 60_000);
});

test('a finished timer: again, 5 more, rename and colour work; +1 and pause do not', () => {
  const s = new Timers(file());
  const t = s.start(60_000, 'Tea', T0)!;
  s.due(T0 + 60_000);
  assert.ok(s.act(t.id, 'add', T0 + 61_000)!.done, '+1 does nothing to a finished one');
  assert.ok(s.act(t.id, 'pause', T0 + 61_000)!.done);
  const r = s.act(t.id, 'rename', T0, { label: '  Green\n tea  ' })!;
  assert.equal(r.label, 'Green tea');
  const again = s.act(t.id, 'again', T0 + 70_000, { ms: 5 * 60_000 })!;
  assert.equal(again.done, undefined); assert.equal(again.end, T0 + 70_000 + 5 * 60_000); assert.equal(again.total, 5 * 60_000);
  assert.equal(s.act(t.id, 'colour', T0, { colour: 'purple' })!.colour, 'blue', 'only the five sands');
  assert.equal(s.act(t.id, 'colour', T0, { colour: 'jade' })!.colour, 'jade');
  assert.equal(s.act(t.id, 'stop'), null);
  assert.equal(s.list().length, 0);
});

test('a finished timer nobody answers goes after ten minutes, and nextAt says when', () => {
  const s = new Timers(file());
  const t = s.start(60_000, '', T0)!;
  assert.equal(s.nextAt(), T0 + 60_000);
  s.due(T0 + 60_000);
  assert.equal(s.nextAt(), T0 + 60_000 + DONE_KEEP_MS);
  assert.deepEqual(s.expire(T0 + 60_000 + DONE_KEEP_MS - 1), []);
  assert.deepEqual(s.expire(T0 + 60_000 + DONE_KEEP_MS), [t.id]);
  assert.equal(s.nextAt(), null);
});

test('a broken or tampered file starts empty rather than failing, and bad rows are dropped', () => {
  const f = file();
  writeFileSync(f, '{not json');
  assert.deepEqual(new Timers(f).list(), []);
  writeFileSync(f, JSON.stringify([
    { id: 't1', label: 'ok', total: 60_000, end: T0, paused: 0 },
    { id: '../x', label: 'bad id', total: 60_000, end: T0, paused: 0 },
    { id: 't2', label: 'too long', total: MAX_MS * 2, end: T0, paused: 0 },
    { id: 't3', label: 'odd colour', total: 60_000, end: T0, paused: 0, colour: 'red' },
    'nonsense',
  ]));
  assert.deepEqual(new Timers(f).list().map((t) => t.id), ['t1']);
});

test('a new timer is refused outside one second to a day; the file is written at once', () => {
  const f = file();
  const s = new Timers(f);
  assert.equal(s.start(0, '', T0), null);
  assert.equal(s.start(NaN, '', T0), null);
  assert.equal(s.start(MAX_MS + 1, '', T0), null);
  s.start(MAX_MS, 'Day', T0);
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).length, 1);
});

test('Custom: minutes, m:ss, and h/m/s words; nothing under 10 s or over a day', () => {
  assert.equal(parseCustom('25'), 25 * 60_000);
  assert.equal(parseCustom('1:30'), 90_000);
  assert.equal(parseCustom('1h 20m'), 80 * 60_000);
  assert.equal(parseCustom('2h'), 2 * 3_600_000);
  assert.equal(parseCustom('90s'), 90_000);
  assert.equal(parseCustom(' 1.5 '), 90_000);
  assert.equal(parseCustom('5s'), null);
  assert.equal(parseCustom('25h'), null);
  assert.equal(parseCustom('soon'), null);
  assert.equal(parseCustom(''), null);
  assert.equal(parseCustom(undefined), null);
});

test('said back in plain words; names are one short line; only the known keys', () => {
  assert.equal(sayDuration(25 * 60_000), '25 minutes');
  assert.equal(sayDuration(65 * 60_000), '1 hour 5 minutes');
  assert.equal(sayDuration(90_000), '1 minute 30 seconds');
  assert.equal(tidyLabel('a\tb\u0007c ' + 'x'.repeat(80)).length, 40);
  assert.ok(isTimerAction('pause') && !isTimerAction('delete') && !isTimerAction(undefined));
});
