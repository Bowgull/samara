// Your things › Notes (N1, 2026-11-25) in a real window: the board draws every note on its paper, the search narrows it
// as he types, a category chip filters, Delete sends one to the Trash and Restore brings it back, versions list, a
// locked copy is written and brought back, and the rail has This page / Site / All. Saves a picture of the board.
//
// Run: npx electron test/electron/notesboard-check.ts <folder for the pictures>
import { app, BrowserWindow, dialog, screen } from 'electron';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { servePages } from '../../src/pageserver.ts';
import { SamaraBrowser } from '../../src/browser.ts';
import { wireBrowser } from '../../src/browseripc.ts';
import { startNotes } from '../../src/noteswire.ts';

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

app.whenReady().then(async () => {
  (screen as any).getCursorScreenPoint = () => ({ x: 400, y: 300 });
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nboard-'));
  app.setPath('documents', path.join(tmp, 'docs'));
  const site = http.createServer((_q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Guide</title><body style="background:#223">guide</body>'); });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  const here = `http://127.0.0.1:${(site.address() as any).port}/guide`;
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const stateDir = path.join(tmp, 'state');
  const b = new SamaraBrowser({ origin: pages.origin, stateDir, preloadPath: path.join(SRC, 'samarapreload.cjs'), tabPreloadPath: path.join(SRC, 'tabpreload.cjs'),
    settingsPreloadPath: path.join(SRC, 'settingspreload.cjs'), thingsPreloadPath: path.join(SRC, 'thingspreload.cjs') }) as any;
  wireBrowser(() => b);
  const hub = startNotes({ browser: b, here: SRC, stateDir, origin: pages.origin, dev: 'pc', log: (s) => console.log('LOG ' + s), companionFile: path.join(tmp, 'none.json') });
  const s = hub.store;
  s.save({ id: 'na', title: 'Groceries', html: '<div>buy oat milk</div><div>bread</div><div>eggs</div>' });
  s.save({ id: 'nb', title: 'Raid night', html: '<div class="cl done">Flasks x6</div><div class="cl">Stat food</div><div class="cl">Repair bot</div>', cat: 'To-do', src: { url: here, site: '127.0.0.1' } }, { trusted: true });
  s.save({ id: 'nc', title: 'Shrine ideas', html: '<div>Behind the waterfall, the cave near the stable</div>', cat: 'Idea' });
  s.save({ id: 'nd', title: 'For the essay', html: '<div>Ask Claude to tighten the second paragraph.</div>', cat: 'For Claude' });
  s.save({ id: 'ne', title: 'Garden', html: '<div>Tomatoes: water every second day</div>', cat: 'Garden' });
  s.save({ id: 'nf', title: 'Wi-Fi', html: '<div>Guest network on the router label</div>', cat: 'Reference' });
  b.open(here);
  await wait(3500);
  b.openThings('notes');
  await wait(2500);
  const t = b.tabs.find((x: any) => x.internal === 'things');
  const wc = t?.view?.webContents;
  check('Your things opens at Notes', !!wc);
  if (!wc) { app.exit(1); return; }
  const js = (c: string) => wc.executeJavaScript(c);
  const cards = () => js("[...document.querySelectorAll('#nboard .ncard')].map((c) => c.querySelector('.nc-t')?.textContent ?? '')");
  check('every note is on the board', (await cards()).length === 6, JSON.stringify(await cards()));
  check('the chips list the categories that have notes', (await js("[...document.querySelectorAll('.nchip')].map((c) => c.textContent).join('|')")).includes('To-do1'));
  try { writeFileSync(path.join(OUT, 'notes-board.png'), (await wc.capturePage()).toPNG()); } catch (e) { console.log('no picture: ' + (e as Error).message); }
  await js("(() => { const q = document.getElementById('nq'); q.value = 'oat mi'; q.dispatchEvent(new Event('input')); return 1; })()");
  await wait(500);
  check('the search narrows as he types', JSON.stringify(await cards()) === '["Groceries"]', JSON.stringify(await cards()));
  await js("(() => { const q = document.getElementById('nq'); q.value = ''; q.dispatchEvent(new Event('input')); return 1; })()");
  await wait(400);
  await js("[...document.querySelectorAll('.nchip')].find((c) => c.textContent.startsWith('Idea')).click(); 1");
  await wait(400);
  check('a category chip filters', JSON.stringify(await cards()) === '["Shrine ideas"]', JSON.stringify(await cards()));
  await js("document.querySelector('.ncard .nb.danger').click(); 1");
  await wait(500);
  check('Delete sends it to the Trash', !s.get('nc') && s.trash().some((n) => n.id === 'nc'));
  await js("[...document.querySelectorAll('.nchip')].find((c) => c.classList.contains('trash')).click(); 1");
  await wait(400);
  check('the Trash lists it', JSON.stringify(await cards()) === '["Shrine ideas"]', JSON.stringify(await cards()));
  try { writeFileSync(path.join(OUT, 'notes-trash.png'), (await wc.capturePage()).toPNG()); } catch { /* no picture */ }
  await js("document.querySelector('.ncard .nb').click(); 1");
  await wait(500);
  check('Restore brings it back', !!s.get('nc'));
  // versions: an earlier one, listed and restored
  s.save({ id: 'na', html: '<div>buy oat milk</div>' });
  const ver = await wc.executeJavaScript("window.things.note('versions', 'na')");
  check('versions are listed', Array.isArray(ver) && ver.length === 1 && /bread/.test(ver[0].html), JSON.stringify(ver).slice(0, 120));
  await wc.executeJavaScript(`window.things.note('restorever', 'na', ${JSON.stringify(ver[0].stamp)})`);
  check('a version restored is the note again', /bread/.test(s.get('na')?.html ?? ''));
  // the locked copy, written and brought back (the file picker answered by the test)
  const msg = await wc.executeJavaScript("window.things.notesLock('export', 'correct horse battery')");
  const dir = path.join(tmp, 'docs', 'Samara notes');
  const files = readdirSync(dir).filter((f) => f.endsWith('.samaranotes'));
  check('a locked copy is written', files.length === 1 && /6 notes/.test(msg), msg);
  s.remove('nf'); s.gc();
  (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(dir, files[0]!)] });
  const wrong = await wc.executeJavaScript("window.things.notesLock('import', 'not the passphrase')");
  check('a wrong passphrase does not open it', /does not open/.test(wrong), wrong);
  const back = await wc.executeJavaScript("window.things.notesLock('import', 'correct horse battery')");
  check('bringing it back never removes what is here', /already here|Brought back/.test(back) && s.list().length === 5, `${back} / ${s.list().length}`);
  check('a short passphrase is refused', /at least 8/.test(await wc.executeJavaScript("window.things.notesLock('export', 'short')")));
  // the rail's tabs
  b.activate(b.tabs.find((x: any) => !x.internal).id);
  await wait(800);
  const f = b.win.webContents;
  await f.executeJavaScript("document.getElementById('m-sitenotes').click(); 1");
  await wait(1200);
  const rail = async (k: string) => { await f.executeJavaScript(`document.querySelector('.sr-tab[data-tab="${k}"]').click(); 1`); await wait(200); return f.executeJavaScript("document.querySelectorAll('#siterail .sr-card').length"); };
  check('the rail: This page', await rail('page') === 1);
  check('the rail: All', await rail('all') === 5, String(await rail('all')));
  try { writeFileSync(path.join(OUT, 'notes-rail-all.png'), (await f.capturePage()).toPNG()); } catch { /* no picture */ }
  console.log('pictures: ' + OUT);
  console.log(bad ? `${bad} FAILED` : 'ALL PASS'); app.exit(bad ? 1 : 0);
});
