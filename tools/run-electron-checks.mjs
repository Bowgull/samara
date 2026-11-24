// Run Samara's real-window checks (test/electron) the way CI does (Phase 0, 2026-11-24).
//
//   node tools/run-electron-checks.mjs [list file, default test/electron/ci-checks.txt] [--jobs N]
//
// Each check is its own Electron process with its own temp profile, so a few run at once. A check that fails is run
// once more on its own: passing then marks it FLAKY (reported, not failed), so a busy runner does not block a ship but
// a flaky check is still seen. Exit code 1 when any check failed twice.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const jobsAt = args.indexOf('--jobs');
const jobs = jobsAt >= 0 ? Math.max(1, Number(args[jobsAt + 1]) || 1) : 3;
const listFile = args.find((a, i) => !a.startsWith('--') && i !== jobsAt + 1) ?? path.join(ROOT, 'test/electron/ci-checks.txt');
const TIMEOUT_MS = 5 * 60_000;

const checks = readFileSync(listFile, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
const electron = createRequire(import.meta.url)('electron'); // the path to the Electron binary
// Linux runners have no setuid sandbox helper; Samara's own sandbox settings for pages are unchanged by this.
const extra = process.platform === 'linux' ? ['--no-sandbox'] : [];

function run(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = '';
    const env = { ...process.env };
    delete env.NODE_OPTIONS;   // Electron refuses some Node options, and a check must not inherit the runner's
    const p = spawn(electron, [...extra, path.join('test/electron', name)], { cwd: ROOT, env });
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const kill = setTimeout(() => { out += '\nRUNNER: timed out\n'; p.kill('SIGKILL'); }, TIMEOUT_MS);
    p.on('close', (code) => { clearTimeout(kill); resolve({ name, code, secs: Math.round((Date.now() - started) / 1000), out }); });
    p.on('error', (e) => { clearTimeout(kill); resolve({ name, code: -1, secs: 0, out: String(e) }); });
  });
}

async function pool(items, n, fn) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  }));
  return results;
}

const first = await pool(checks, jobs, run);
const failed = first.filter((r) => r.code !== 0);
const second = await pool(failed.map((r) => r.name), 1, run);
const flaky = second.filter((r) => r.code === 0).map((r) => r.name);
const broken = second.filter((r) => r.code !== 0);

for (const r of first) console.log(`${r.code === 0 ? 'PASS ' : flaky.includes(r.name) ? 'FLAKY' : 'FAIL '} ${r.name} (${r.secs}s)`);
for (const r of broken) {
  const lines = r.out.split('\n').filter((l) => /FAIL|HARNESS|RUNNER|Error/.test(l)).slice(0, 12);
  console.log(`\n---- ${r.name} (exit ${r.code})\n${lines.join('\n')}`);
}
console.log(`\n${checks.length - failed.length} passed, ${flaky.length} flaky, ${broken.length} failed, of ${checks.length}`);
process.exit(broken.length ? 1 : 0);
