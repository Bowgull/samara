import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, resetSwallowed, setSwallowSink, swallowCounts, swallowed, swallowSummary } from '../src/swallow.ts';

test('the first failure of a place is written, the rest only counted', () => {
  resetSwallowed();
  const lines: string[] = [];
  setSwallowSink((l) => lines.push(l));
  const e = Object.assign(new Error('EBUSY: resource busy\nat stack'), { code: 'EBUSY' });
  swallowed('engine.tidy', e); swallowed('engine.tidy', e); swallowed('bsync.save', new TypeError('x'));
  assert.deepEqual(lines, ['swallowed: engine.tidy: EBUSY: EBUSY: resource busy', 'swallowed: bsync.save: TypeError: x']);
  assert.deepEqual(swallowCounts(), [{ where: 'engine.tidy', n: 2 }, { where: 'bsync.save', n: 1 }]);
});

test('the hourly line names the places that failed since the last one, then starts again', () => {
  resetSwallowed();
  swallowed('a'); swallowed('b'); swallowed('b');
  assert.equal(swallowSummary(), 'swallowed this hour: b 2, a 1');
  assert.equal(swallowSummary(), null);
  for (let i = 0; i < 10; i++) swallowed('p' + i);
  assert.match(swallowSummary()!, /and 2 more places$/);
  assert.equal(swallowCounts().length, 12, 'the totals since start are kept');
});

test('a message is one short line, and a broken sink never throws', () => {
  resetSwallowed();
  assert.equal(describe('x'.repeat(500)).length, 160);
  assert.equal(describe(undefined), 'no error given');
  assert.equal(describe(null), 'object: null');
  setSwallowSink(() => { throw new Error('disk full'); });
  assert.doesNotThrow(() => swallowed('z', new Error('y')));
});
