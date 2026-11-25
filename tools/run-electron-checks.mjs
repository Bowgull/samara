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
const listFile = args.find((a, i) => !a.startsWith('--') && !(jobsAt >= 0 && i === jobsAt + 1)) ?? path.join(ROOT, 'test/electron/ci-checks.txt');
const TIMEOUT_MS = 5 * 60_000;

const checks = readFileSync(listFile, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
/** The fixed local ports a check's own pretend sites listen on (47xxx), read from its source. Two checks that share a
 *  port never run at the same time: the second could not listen and would fail for the wrong reason. */
const portsOf = (name) => new Set(readFileSync(path.join(ROOT, 'test/electron', name), 'utf8').match(/\b4[6-9]\d{3}\b/g) ?? []);
const ports = new Map(checks.map((c) => [c, portsOf(c)]));
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
    // Done when the check's own process exits. Not 'close' alone: a program a check starts (2026-11-25: xdg-open
    // opening a real browser on the Linux runner) can keep the output pipes open long after, and the run never ended.
    let done = false;
    const finish = (code) => { if (done) return; done = true; clearTimeout(kill); resolve({ name, code, secs: Math.round((Date.now() - started) / 1000), out }); };
    p.on('close', (code) => finish(code));
    p.on('exit', (code, signal) => { setTimeout(() => finish(code ?? (signal ? 1 : 0)), 2000); });
    p.on('error', (e) => { if (done) return; done = true; clearTimeout(kill); resolve({ name, code: -1, secs: 0, out: String(e) }); });
  });
}

/** Up to n at once, in list order, never two that share a port. */
async function pool(items, n, fn) {
  const results = [];
  const waiting = items.map((name, i) => ({ name, i }));
  const busy = new Set();
  const clash = (name) => [...ports.get(name) ?? []].some((p) => busy.has(p));
  let wake = () => {};
  const worker = async () => {
    while (waiting.length) {
      const at = waiting.findIndex((w) => !clash(w.name));
      if (at < 0) { await new Promise((r) => { wake = r; }); continue; }
      const { name, i } = waiting.splice(at, 1)[0];
      const mine = [...ports.get(name) ?? []];
      for (const p of mine) busy.add(p);
      try { results[i] = await fn(name); } finally { for (const p of mine) busy.delete(p); wake(); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}

const first = await pool(checks, jobs, run);
const failed = first.filter((r) => r.code !== 0);
// --no-retry: a failure stands (the speed budget: a run over budget that passes the second time is still over budget).
const second = args.includes('--no-retry') ? failed.map((r) => ({ ...r })) : await pool(failed.map((r) => r.name), 1, run);
const flaky = second.filter((r) => r.code === 0).map((r) => r.name);
const broken = second.filter((r) => r.code !== 0);

for (const r of first) console.log(`${r.code === 0 ? 'PASS ' : flaky.includes(r.name) ? 'FLAKY' : 'FAIL '} ${r.name} (${r.secs}s)`);
// A check's measurements (lines starting "SPEED "), shown whether it passed or not, so the numbers are in every log.
for (const r of [...first, ...(args.includes('--no-retry') ? [] : second)]) for (const l of r.out.split('\n')) if (l.startsWith('SPEED ')) console.log(`${r.name}: ${l}`);
for (const r of broken) {
  const all = r.out.split('\n');
  const lines = [...all.filter((l) => /FAIL|HARNESS|RUNNER/.test(l)), ...all.filter((l) => /Error/.test(l) && !/No handler registered/.test(l))].slice(0, 15);
  console.log(`\n---- ${r.name} (exit ${r.code})\n${lines.join('\n')}`);
}
// A check that passed only on its second go: what failed the first time, so a flaky step can be traced, not guessed.
for (const r of first.filter((x) => flaky.includes(x.name))) {
  const lines = r.out.split('\n').filter((l) => /FAIL|HARNESS|RUNNER/.test(l)).slice(0, 8);
  console.log(`\n---- ${r.name} (flaky; its first go)\n${lines.join('\n')}`);
}
console.log(`\n${checks.length - failed.length} passed, ${flaky.length} flaky, ${broken.length} failed, of ${checks.length}`);
process.exit(broken.length ? 1 : 0);
