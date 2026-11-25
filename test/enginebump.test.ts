// Phase 2: the bump bot's rules (tools/release/engine-bump.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aheadOfCastlabs, applyBump, branchFor, bumpPlan, newestCastlabs, pinned, titleFor } from '../tools/release/engine-bump.ts';

const pkg = (stock: string, drm: string) => ({ dependencies: { electron: stock, 'electron-drm': `github:castlabs/electron-releases#v${drm}+wvcus` } });
const rel = (tag: string, o: { prerelease?: boolean; draft?: boolean } = {}) => ({ tag_name: tag, prerelease: !!o.prerelease, draft: !!o.draft });

test('castLabs newest: stable Widevine tags only, highest number wins', () => {
  assert.equal(newestCastlabs([rel('v44.9.3+wvcus'), rel('v45.0.0+wvcus', { prerelease: true }), rel('v44.11.4+wvcus'), rel('v44.12.0+wvcus', { draft: true }), rel('v44.13.0'), rel('v43.9.9+wvcus')]), '44.11.4');
  assert.equal(newestCastlabs([]), null);
});

test('reads what package.json pins', () => {
  assert.deepEqual(pinned(pkg('44.7.0', '44.5.1')), { stock: '44.7.0', drm: '44.5.1' });
  assert.deepEqual(pinned({ dependencies: { electron: '^44.7.0' } }), { stock: null, drm: null });
});

test('bumps both to castLabs newest when Electron published it too', () => {
  assert.deepEqual(bumpPlan(pkg('44.7.0', '44.5.1'), '44.11.4', ['44.11.4']), { from: '44.5.1', to: '44.11.4', major: false });
  assert.deepEqual(bumpPlan(pkg('44.11.4', '44.11.4'), '45.0.1', ['45.0.1']), { from: '44.11.4', to: '45.0.1', major: true });
});

test('no bump: already there, older, stock ahead, or no stock build to test on', () => {
  assert.equal(bumpPlan(pkg('44.11.4', '44.11.4'), '44.11.4', ['44.11.4']), null);
  assert.equal(bumpPlan(pkg('44.11.4', '44.11.4'), '44.9.3', ['44.9.3']), null);
  assert.equal(bumpPlan(pkg('44.12.0', '44.5.1'), '44.11.4', ['44.11.4']), null);
  assert.equal(bumpPlan(pkg('44.7.0', '44.5.1'), '44.11.4', []), null);
  assert.equal(bumpPlan(pkg('44.7.0', '44.5.1'), null, ['44.11.4']), null);
});

test('package.json rewrite moves exactly the two engines', () => {
  const text = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const out = applyBump(text, '44.11.4');
  assert.deepEqual(pinned(JSON.parse(out)), { stock: '44.11.4', drm: '44.11.4' });
  const a = text.split('\n'), b = out.split('\n');
  assert.equal(a.length, b.length);
  assert.equal(a.filter((l, i) => l !== b[i]).length, 2);
  assert.throws(() => applyBump(text, 'latest'));
});

test('Electron security releases castLabs has not built yet, same major only', () => {
  assert.deepEqual(aheadOfCastlabs('44.11.4', ['44.11.4', '44.12.0', '44.11.5', '45.0.0', '44.9.0']), ['44.12.0', '44.11.5']);
  assert.deepEqual(aheadOfCastlabs(null, ['44.12.0']), []);
});

test('branch and title', () => {
  assert.equal(branchFor('44.11.4'), 'bump/engine-v44.11.4');
  assert.match(titleFor({ from: '44.11.4', to: '45.0.1', major: true }), /45\.0\.1 \(new major\)/);
});
