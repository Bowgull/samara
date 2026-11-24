// Phase 1 (2026-11-24): is Samara's own code still what the release shipped? Each release lists every code file
// (src/, and the pages' scripts, markup and styles) with its fingerprint, in integrity.json, sealed with his release key
// (integrity.sig) like the release itself. A little after start Samara checks its files against that list, in the
// background. Anything running as him can edit these files; this does not stop that, it makes sure he hears about it.
// A run from the source folder (no integrity.json) is not checked.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { RELEASE_KEY } from './ghrelease.ts';

/** The files a release lists: Samara's code, never its pictures or libraries. */
export const CODE = /\.(ts|mts|cts|js|mjs|cjs|html|css|json)$/i;
export const ROOTS = ['src', 'pages'];

/** Every code file under the roots, as relative paths with forward slashes, sorted. */
export function codeFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(dir, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      const st = statSync(path.join(dir, r));
      if (st.isDirectory()) walk(r); else if (CODE.test(name)) out.push(r);
    }
  };
  for (const root of ROOTS) if (existsSync(path.join(dir, root))) walk(root);
  return out.sort();
}
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

/** The list a release carries (written by tools/release/samara-release.mjs). */
export function listOf(dir: string, version: string): string {
  return JSON.stringify({ v: 1, app: 'samara', version, files: Object.fromEntries(codeFiles(dir).map((f) => [f, sha(path.join(dir, f))])) });
}

export type Integrity = { state: 'dev' } | { state: 'ok'; files: number } | { state: 'unsealed'; why: string } | { state: 'changed'; changed: string[]; missing: string[]; added: string[] };

/** Check the app folder against its sealed list. */
export function checkIntegrity(dir: string, pub: string = RELEASE_KEY): Integrity {
  const lf = path.join(dir, 'integrity.json'), sf = path.join(dir, 'integrity.sig');
  if (!existsSync(lf)) return { state: 'dev' };
  let text = '', sig = '';
  try { text = readFileSync(lf, 'utf8'); sig = readFileSync(sf, 'utf8').trim(); } catch { return { state: 'unsealed', why: 'the seal on the list of files is missing' }; }
  let ok = false;
  try { ok = verify(null, Buffer.from(text), createPublicKey(pub), Buffer.from(sig, 'base64')); } catch { ok = false; }
  if (!ok) return { state: 'unsealed', why: "the list of files does not carry the release's seal" };
  let files: Record<string, string>;
  try { const j = JSON.parse(text); if (j?.v !== 1 || j.app !== 'samara' || !j.files || typeof j.files !== 'object') throw new Error(); files = j.files; } catch { return { state: 'unsealed', why: 'the list of files cannot be read' }; }
  const changed: string[] = [], missing: string[] = [];
  for (const [f, h] of Object.entries(files)) {
    const p = path.join(dir, f);
    if (!existsSync(p)) missing.push(f); else if (sha(p) !== h) changed.push(f);
  }
  const added = codeFiles(dir).filter((f) => !(f in files));
  return changed.length || missing.length || added.length ? { state: 'changed', changed, missing, added } : { state: 'ok', files: Object.keys(files).length };
}

/** In plain words, for the log and the notice. */
export function sayIntegrity(r: Integrity): string {
  if (r.state === 'ok') return `Samara's ${r.files} code files are as released`;
  if (r.state === 'dev') return 'running from the source folder: not checked';
  if (r.state === 'unsealed') return `Samara's files could not be checked: ${r.why}`;
  const n = r.changed.length + r.missing.length + r.added.length;
  const first = [...r.changed, ...r.added, ...r.missing].slice(0, 3).join(', ');
  return `${n} of Samara's code files ${n === 1 ? 'is' : 'are'} not as released (${first}${n > 3 ? ', …' : ''})`;
}
