// Packs one Samara release: the app's code, pages and engine glue, plus a manifest stamped with the release key
// (Ed25519). A Samara installs a release only when the stamp checks out against the public half it already carries.
// Run: SAMARA_RELEASE_KEY=<pem> node tools/release/samara-release.mjs <version> <out dir> [notes file]
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';   // a Windows path, never /D:/...
import { checkNewest, read } from './version.mjs';

const [version, out, notesFile] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !out) { console.error('usage: samara-release.mjs <x.y.z> <out dir> [notes file]'); process.exit(2); }
// His version rule (version.mjs): only the newest version in releases.json can be released, and only if its number and
// its name are what the lines it adds make them.
const rec = read('releases.json'), items = read('whats-new.json').items;
const v = rec.versions.at(-1), before = rec.versions.at(-2);
if (v?.semver !== version) { console.error(`releases.json's newest version is ${v?.semver}, not ${version}: ship with tools/release/ship.mjs`); process.exit(2); }
const why = checkNewest(rec.versions, items);
if (why) { console.error(why); process.exit(2); }
const lines = items.filter((i) => Date.parse(i.at) > (before ? Date.parse(before.at) : -Infinity) && Date.parse(i.at) <= Date.parse(v.at));
const pem = process.env.SAMARA_RELEASE_KEY;
if (!pem) { console.error('SAMARA_RELEASE_KEY is not set: a release is never published unstamped'); process.exit(2); }
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const shell = repo;
mkdirSync(out, { recursive: true });

// Same files and order as macBrowserBundle, plus assets/ when there is one (2026-11-25: Samara's own repo has none; its
// icons live in pages/art/samara). On GitHub (GNU tar) owner and times are fixed too, so the same code always
// makes the same package; a Mac's own tar (for a trial run here) has no such switches.
// Phase 1 (2026-11-24): the list of every code file and its fingerprint, sealed with the same key, goes inside the
// bundle; each Samara checks its own files against it after start (src/integrity.ts).
const { listOf } = await import('../../src/integrity.ts');
const { historyOf } = await import('../../src/catchup.ts');
const list = listOf(shell, version);
writeFileSync(path.join(out, 'integrity.json'), list);
writeFileSync(path.join(out, 'integrity.sig'), sign(null, Buffer.from(list), createPrivateKey(pem)).toString('base64'));
const bundle = path.join(out, 'samara-bundle.tgz');
const gnu = /GNU tar/.test(execFileSync('tar', ['--version'], { encoding: 'utf8' }));
execFileSync('tar', [...(gnu ? ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '--mtime=@0'] : []), '-czf', bundle,
  '-C', shell, 'src', 'pages', 'drm', ...(existsSync(path.join(shell, 'assets')) ? ['assets'] : []), 'test/electron/engine-safety-check.ts', 'package.json', 'package-lock.json', '-C', path.resolve(out), 'integrity.json', 'integrity.sig'], { stdio: 'inherit', env: { ...process.env, GZIP: '-n' } });
const bytes = readFileSync(bundle);

const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
void notesFile;   // what it brings comes from whats-new.json now, the same lines the rule counted
const notes = lines.map((l) => String(l.text)).slice(0, 30);
const manifest = {
  v: 1, app: 'samara', version, name: v.name, commit, at: new Date().toISOString(), notes,
  items: lines.slice(0, 30).map((l) => ({ text: String(l.text), kind: l.kind === 'major' || l.kind === 'feature' ? l.kind : 'fix' })),
  bundle: { file: 'samara-bundle.tgz', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
  // The versions before this one and their lines (catchup.ts), so a Samara that skipped some can say how far behind it was.
  history: historyOf(rec.versions, items, version),
};
const text = JSON.stringify(manifest, null, 1);
writeFileSync(path.join(out, 'manifest.json'), text);
writeFileSync(path.join(out, 'manifest.sig'), sign(null, Buffer.from(text), createPrivateKey(pem)).toString('base64'));
console.log(`samara ${version} ${v.name} (${commit.slice(0, 7)}): bundle ${(bytes.length / 1e6).toFixed(1)} MB, stamped`);
