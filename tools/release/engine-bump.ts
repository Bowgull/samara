// Phase 2 (2026-11-24): the bump bot's brain, run every day by .github/workflows/engine-bump.yml.
// Samara's code is tested on stock Electron of the same version as castLabs' engine (package.json: `electron`, and
// castLabs' own build as `electron-drm`). When castLabs ships a newer stable engine, this moves both to it, so the
// real-window gate runs Samara's code on the engine the machines are about to get, before they get it. A new major
// is prepared the same way, marked as a major: it never goes in without his click.
// It also says when Electron has shipped a security release castLabs has not built yet (shown in the run's summary).
//
//   node tools/release/engine-bump.ts             prints the plan as JSON, changes nothing
//   node tools/release/engine-bump.ts --write     rewrites package.json when there is a bump
// The pure parts are exported for test/enginebump.test.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VER = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
type Rel = { tag_name?: unknown; prerelease?: unknown; draft?: unknown };
type Pkg = { dependencies?: Record<string, unknown> };
export interface Plan { from: string; to: string; major: boolean }
const num = (v: string): number[] => v.split('.').map(Number);
export const newer = (a: string, b: string): boolean => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
export const major = (v: string): number => Number(VER.exec(v)?.[1] ?? NaN);

/** castLabs' newest stable Widevine engine from its GitHub releases ({ tag_name, prerelease, draft }), or null. */
export function newestCastlabs(releases: Rel[] | null | undefined): string | null {
  let best: string | null = null;
  for (const r of releases ?? []) {
    const m = /^v(\d{1,4}\.\d{1,4}\.\d{1,4})\+wvcus$/.exec(String(r?.tag_name ?? ''));
    if (!m || r.prerelease || r.draft) continue;
    if (!best || newer(m[1]!, best)) best = m[1]!;
  }
  return best;
}

/** What package.json pins now: the stock Electron and castLabs' tag, as plain versions. */
export function pinned(pkg: Pkg | null | undefined): { stock: string | null; drm: string | null } {
  const stock = String(pkg?.dependencies?.electron ?? '');
  const drm = /#v(\d{1,4}\.\d{1,4}\.\d{1,4})\+wvcus$/.exec(String(pkg?.dependencies?.['electron-drm'] ?? ''))?.[1] ?? null;
  return { stock: VER.test(stock) ? stock : null, drm };
}

/**
 * The bump, or null when there is none. `to` is castLabs' newest; it moves only forward, and only to a version stock
 * Electron also published (castLabs builds on Electron's releases, and the gate needs the stock one to run).
 */
export function bumpPlan(pkg: Pkg, castlabs: string | null, stockVersions: string[]): Plan | null {
  const have = pinned(pkg);
  if (!castlabs || !VER.test(castlabs) || !have.stock || !have.drm) return null;
  if (!newer(castlabs, have.drm) || newer(have.stock, castlabs)) return null;
  if (!stockVersions.includes(castlabs)) return null;
  return { from: have.drm, to: castlabs, major: major(castlabs) !== major(have.drm) };
}

/** package.json's text with both engines moved to `v`, everything else exactly as it was. */
export function applyBump(text: string, v: string): string {
  if (!VER.test(v)) throw new Error('not a version: ' + v);
  const out = text
    .replace(/("electron"\s*:\s*")\d{1,4}\.\d{1,4}\.\d{1,4}(")/, `$1${v}$2`)
    .replace(/("electron-drm"\s*:\s*"github:castlabs\/electron-releases#v)\d{1,4}\.\d{1,4}\.\d{1,4}(\+wvcus")/, `$1${v}$2`);
  const p = pinned(JSON.parse(out));
  if (p.stock !== v || p.drm !== v) throw new Error('package.json did not take the bump');
  return out;
}

/** Electron security releases castLabs has not built yet: stock versions in castLabs' major, newer than castLabs. */
export function aheadOfCastlabs(castlabs: string | null, stockVersions: string[]): string[] {
  if (!castlabs) return [];
  return stockVersions.filter((v) => VER.test(v) && major(v) === major(castlabs) && newer(v, castlabs)).sort((a, b) => (newer(a, b) ? -1 : 1));
}

/** The PR's branch and title. */
export const branchFor = (v: string): string => `bump/engine-v${v}`;
export const titleFor = (p: Plan): string => `Engine ${p.to}${p.major ? ' (new major)' : ''}: castLabs ${p.to}+wvcus and Electron ${p.to}`;

// ---------------------------------------------------------------- the run
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const gh = (url: string) => fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Samara engine bump', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) } });
  const releases = await (await gh('https://api.github.com/repos/castlabs/electron-releases/releases?per_page=60')).json();
  const castlabs = newestCastlabs(Array.isArray(releases) ? releases : []);
  const el = await (await fetch('https://releases.electronjs.org/releases.json')).json();
  const stock = (Array.isArray(el) ? el : []).map((x: { version?: unknown }) => String(x.version ?? '')).filter((v) => VER.test(v));
  const text = readFileSync('package.json', 'utf8');
  const plan = bumpPlan(JSON.parse(text), castlabs, stock);
  const ahead = aheadOfCastlabs(castlabs, stock);
  const result = { castlabs, plan, ahead, branch: plan ? branchFor(plan.to) : '', title: plan ? titleFor(plan) : '' };
  console.log(JSON.stringify(result, null, 1));
  if (plan && process.argv.includes('--write')) writeFileSync('package.json', applyBump(text, plan.to));
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `to=${plan?.to ?? ''}\nmajor=${plan?.major ? 'yes' : ''}\nbranch=${result.branch}\ntitle=${result.title}\nahead=${ahead.join(' ')}\n`, { flag: 'a' });
  }
}
