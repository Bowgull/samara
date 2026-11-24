import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overBudget } from '../tools/speedbudget.ts';

const B = { startMs: 1000, pageMB: 100, idleCpu: 5, switchMs: 200 };

test('within budget, nothing to say', () => {
  assert.deepEqual(overBudget({ startMs: 1000, pageMB: 99, idleCpu: 0, switchMs: 10 }, B), []);
});

test('each number over its budget is named', () => {
  const o = overBudget({ startMs: 1001, pageMB: 101, idleCpu: 5.1, switchMs: 201 }, B);
  assert.equal(o.length, 4);
  assert.match(o[0]!, /^start 1001 ms/);
  assert.match(o[3]!, /^tab switch 201 ms/);
});

test('a number that could not be measured fails rather than passing', () => {
  assert.deepEqual(overBudget({ startMs: NaN, pageMB: 1, idleCpu: 0, switchMs: 1 }, B), ['start NaN ms, budget 1000 ms']);
});
