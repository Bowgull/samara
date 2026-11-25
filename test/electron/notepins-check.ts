// N3 (2026-11-25) in real windows: "Note this" on a selection makes a note pinned to the words and puts it on the screen;
// back on the page, the words are marked (CSS highlight) with a ribbon in the margin; a real click on the ribbon opens
// the note, a page's own script cannot; "Jump to it" opens the page at the words; a reminder rings once, on this machine.
//
// Run: npx electron test/electron/notepins-check.ts <folder for the pictures>
import { app, BrowserWindow, screen } from 'electron';
import http from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { servePages } from '../../src/pageserver.ts';
import { SamaraBrowser } from '../../src/browser.ts';
import { wireBrowser } from '../../src/browseripc.ts';
import { startNotes } from '../../src/noteswire.ts';
import { run } from '../../src/page.ts';

process.on('uncaughtException', (e) => { console.log('HARNESS NOTE ' + String((e as Error).message).split('\n')[0]); });
process.on('unhandledRejection', (e) => { console.log('HARNESS REJECTION ' + String((e as Error)?.stack ?? e)); app.exit(2); });
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, 90_000).unref();
app.on('window-all-closed', () => { /* the test decides */ });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', '..', 'src');
const OUT = path.resolve(process.argv[process.argv.length - 1]?.endsWith('.ts') ? os.tmpdir() : process.argv[process.argv.length - 1]!);
mkdirSync(OUT, { recursive: true });
BrowserWindow.prototype.focus = function () { /* not in a test */ };
let bad = 0;
const check = (what: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  -- ' + d.slice(0, 200) : ''}`); if (!ok) bad++; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const noteWins = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && /\/note\.html/.test(w.webContents.getURL()));

const PAGE = `<!doctype html><title>Raid guide</title><body style="margin:40px 120px;font:18px sans-serif;background:#fff">
<p>Flasks are cheap. Buy flasks before raid.</p><p style="margin-top:900px">The boss hits hard, so <span>buy flasks</span> before raid night and bring food.</p>
<script>window.forge = () => { const h = document.querySelector('samara-pins'); h && h.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!h; };</script></body>`;

app.whenReady().then(async () => {
  (screen as any).getCursorScreenPoint = () => ({ x: 400, y: 300 });
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'npins-'));
  const site = http.createServer((_q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE); });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(site.address() as any).port}/guide`;
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const stateDir = path.join(tmp, 'state');
  const b = new SamaraBrowser({ origin: pages.origin, stateDir, preloadPath: path.join(SRC, 'samarapreload.cjs'), tabPreloadPath: path.join(SRC, 'tabpreload.cjs'),
    settingsPreloadPath: path.join(SRC, 'settingspreload.cjs'), thingsPreloadPath: path.join(SRC, 'thingspreload.cjs') }) as any;
  wireBrowser(() => b);
  const hub = startNotes({ browser: b, here: SRC, stateDir, origin: pages.origin, dev: 'pc', log: (s) => console.log('LOG ' + s), companionFile: path.join(tmp, 'none.json') });
  const s = hub.store;
  b.open(url);
  await wait(3500);
  const tab = b.tabs.find((x: any) => !x.internal);
  const wc = tab.view.webContents;
  // select the SECOND "buy flasks before raid" (the one after "so ")
  await run(wc, `(() => { const p = document.querySelectorAll('p')[1]; const t = p.childNodes[0]; const span = p.querySelector('span'); const r = document.createRange();
    r.setStart(span.firstChild, 0); r.setEnd(span.nextSibling, ' before raid'.length); getSelection().removeAllRanges(); getSelection().addRange(r); return getSelection().toString(); })()`);
  await b.noteThis(tab);
  await wait(1500);
  const n = s.list()[0];
  check('Note this keeps the words as a note', !!n && n.anchor?.exact === 'buy flasks before raid', JSON.stringify(n?.anchor));
  check('...with what comes before and after', /so $/.test(n?.anchor?.prefix ?? '') && /^ night/.test(n?.anchor?.suffix ?? ''), JSON.stringify(n?.anchor));
  check('...and from this page', n?.src?.url === url);
  check('...and puts it on the screen to add a thought', noteWins().length === 1);
  wc.reload();
  await wait(3000);
  check('back on the page, its words are marked', b.pinIds.get(tab.id)?.has(n!.id) === true);
  const marked = await run(wc, `CSS.highlights.has('samara-note') && [...CSS.highlights.get('samara-note')][0].toString()`, { fallback: '' });
  check('...the right ones (the second time those words appear)', marked === 'buy flasks before raid', String(marked));
  const where = await run<any>(wc, `(() => { const it = globalThis.__samaraPins.items[0]; it.r.startContainer.parentElement.scrollIntoView({ block: 'center' }); const r = it.b.getBoundingClientRect(); return { x: r.left + 6, y: r.top + 6, sy: scrollY }; })()`, { world: 999 });
  await wait(300);
  const where2 = await run<any>(wc, `(() => { const r = globalThis.__samaraPins.items[0].b.getBoundingClientRect(); return { x: r.left + 6, y: r.top + 6 }; })()`, { world: 999 });
  try { writeFileSync(path.join(OUT, 'notepins-page.png'), (await wc.capturePage()).toPNG()); } catch { /* no picture */ }
  check('the ribbon sits in the margin beside the words', where2.x > 0 && where2.x < 120, JSON.stringify(where2));
  void where;
  b.notesHub.boardAct('back', n!.id);
  await wait(500);
  check('(taken off the screen first)', noteWins().length === 0);
  const forged = await run(wc, 'window.forge()', { fallback: false });
  await wait(500);
  check("a page's own script cannot open it", forged === true && noteWins().length === 0);
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(where2.x), y: Math.round(where2.y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(where2.x), y: Math.round(where2.y), button: 'left', clickCount: 1 });
  await wait(1200);
  check('a real click on the ribbon opens the note', noteWins().length === 1);
  // Jump to it: with the page closed, it opens at the words.
  b.close(tab.id, false);
  await wait(800);
  const tabs = b.tabs.filter((x: any) => !x.internal).length;
  check('Jump to it opens the page', b.notesHub.boardAct('jump', n!.id) === true);
  await wait(3500);
  const jt = b.tabs.filter((x: any) => !x.internal && x.url.startsWith(url)).pop();
  const seen = jt ? await run<any>(jt.view.webContents, `(() => { const r = [...CSS.highlights.get('samara-note')][0].getBoundingClientRect(); return { top: r.top, h: innerHeight, sy: scrollY, jump: CSS.highlights.has('samara-note-jump') }; })()`, { fallback: null }) : null;
  check('...scrolled so the words are in view', !!seen && seen.sy > 0 && seen.top > 0 && seen.top < seen.h, `${JSON.stringify(seen)} (tabs before ${tabs})`);
  // A reminder: rings once, here.
  s.save({ id: n!.id, remind: { at: Date.now() - 1000, dev: 'pc' } });
  s.save({ title: 'Mac one', remind: { at: Date.now() - 1000, dev: 'mac' } });
  await wait(31_000);
  check('a reminder rings and is marked done', s.get(n!.id)?.remind?.done === true);
  check("...one set on the other machine does not ring here", s.list().find((x) => x.title === 'Mac one')?.remind?.done !== true);
  console.log('pictures: ' + OUT);
  console.log(bad ? `${bad} FAILED` : 'ALL PASS'); app.exit(bad ? 1 : 0);
});
