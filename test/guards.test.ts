// Security tripwires (Phase 0, 2026-11-24): rules a browser must never quietly break, checked on every push.
// They read the source, not a running Samara, so they are fast and run on every machine. A rule that trips is not
// always wrong code: it means a person looks before it ships. Each allowlist below is the reviewed state on 2026-11-24.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE = /\.(ts|mts|cts|mjs|cjs|js)$/;

function files(dir: string, keep: RegExp): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) out.push(...files(f, keep));
    else if (keep.test(n)) out.push(f);
  }
  return out;
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
const mainCode = () => [...files(path.join(ROOT, 'src'), CODE), ...files(path.join(ROOT, 'drm'), CODE)];

test('no window or view turns off one of Electron\'s safety switches', () => {
  const unsafe = /\b(nodeIntegration|nodeIntegrationInWorker|nodeIntegrationInSubFrames|webviewTag|allowRunningInsecureContent|experimentalFeatures)\s*:\s*true\b|\b(contextIsolation|sandbox|webSecurity)\s*:\s*false\b/;
  const bad: string[] = [];
  for (const f of mainCode()) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (unsafe.test(l)) bad.push(`${rel(f)}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(bad, []);
});

test('every Samara page has a strict content security policy', () => {
  // Source lists are read whole, not searched for a token: 'none' means nothing only when it stands alone, and a
  // missing script-src falls back to default-src.
  const bad: string[] = [];
  for (const f of files(path.join(ROOT, 'pages'), /\.html$/)) {
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(readFileSync(f, 'utf8'))?.[1];
    if (!csp) { bad.push(`${rel(f)}: no policy`); continue; }
    const dirs = new Map<string, string[]>();
    for (const part of csp.split(';')) {
      const [name, ...list] = part.trim().split(/\s+/);
      if (name && !dirs.has(name.toLowerCase())) dirs.set(name.toLowerCase(), list);
    }
    const def = dirs.get('default-src');
    if (!def || def.length !== 1 || def[0] !== "'none'") bad.push(`${rel(f)}: default-src is not exactly 'none'`);
    const script = dirs.get('script-src') ?? def ?? [];
    if (!(script.length === 1 && (script[0] === "'self'" || script[0] === "'none'"))) bad.push(`${rel(f)}: script-src is not exactly 'self' or 'none'`);
    if (!dirs.has('base-uri')) bad.push(`${rel(f)}: no base-uri`);
  }
  assert.deepEqual(bad, []);
});

/** Ways a handler says who may send to it (browseripc.ts, popoutipc.ts, and the rest). */
const SENDER_CHECK = /\btop\(e\)|\bfrom[A-Z]?\w*\(e\)|\.is[A-Z][A-Za-z]*\(e\.sender\)|e\.sender\s*[!=]==|senderFrame|isFrame\(/;
/** Reviewed 2026-11-24: channels that carry nothing a page could abuse, and check their sender inside the browser. */
const OPEN_CHANNELS = new Set(['tab:painted', 'tab:mayplay']);

test('every message a page can send is checked for who sent it', () => {
  const bad: string[] = [];
  for (const f of mainCode()) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/ipcMain\.(on|once|handle|handleOnce)\(\s*(['"`])([^'"`]+)\2/g)) {
      if (OPEN_CHANNELS.has(m[3]!)) continue;
      const body = s.slice(m.index!, m.index! + 600).split(/\n\s*ipcMain\./)[0]!;
      // A named handler (ipcMain.on('x', onAnswer)): its check is where it is defined.
      const named = /^ipcMain\.\w+\(\s*['"`][^'"`]+['"`]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/.exec(body)?.[1];
      const where = named ? (new RegExp(`const ${named}\\s*=[\\s\\S]{0,600}`).exec(s)?.[0] ?? '') : body;
      if (!SENDER_CHECK.test(where)) bad.push(`${rel(f)}: ${m[3]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('links leave Samara for the system only from the reviewed places', () => {
  // A new shell.openExternal can hand a page's address to another program (a custom scheme opens an app). Each new
  // call site is looked at, then added here.
  // Phase 4: the browser's four (unchanged) now sit in the parts that hold their methods.
  const reviewed: Record<string, number> = { 'src/browser.ts': 1, 'src/browser-address.ts': 1, 'src/browser-panes.ts': 1, 'src/browser-tv.ts': 1, 'src/pc.ts': 1, 'src/safety.ts': 2 };
  const seen: Record<string, number> = {};
  for (const f of mainCode()) {
    const n = [...readFileSync(f, 'utf8').matchAll(/shell\.openExternal\(/g)].length;
    if (n) seen[rel(f)] = n;
  }
  assert.deepEqual(seen, reviewed);
});
