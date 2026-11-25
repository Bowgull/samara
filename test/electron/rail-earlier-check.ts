// Phase R (2026-11-24, his pick A: tabs and auto-tidy): the new rail and Earlier, in Samara's real band and tray layer.
// Starts from a tabs file of before (two loose tabs, a trail of two, one on the done shelf, a link's tab) and a Stash.
//   1. The move: the old files are copied aside, the trail, done and Stash pages are in Earlier with where they came
//      from, the loose tabs stay open, a link's tab still knows its opener, and a second run changes nothing.
//   2. The rail: Today newest opened first; a click does not move a tab; Pin puts it on top with the line under it.
//   3. A tab untouched for 12 hours fades with TONIGHT; clicking TONIGHT keeps it.
//   4. The overnight tidy moves faded tabs to Earlier (never the one in front) and says so; it runs once a night.
//   5. Closing a tab goes back to the tab that opened it, not its neighbour.
//   6. Earlier in the tray: day groups, the search, × removes for good, a click brings the page back as a tab.
//
// Run:  npx electron test/electron/rail-earlier-check.ts
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.on('uncaughtException', (e) => { console.log('HARNESS NOTE ' + String((e as Error)?.message ?? e).split('\n')[0]); });
process.on('unhandledRejection', (e) => { console.log('HARNESS REJECTION ' + String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')); app.exit(2); });
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, 120_000).unref();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 47997;
app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'railearlier-ud-')));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('window-all-closed', () => { /* the check decides */ });
BrowserWindow.prototype.show = function (this: BrowserWindow) { this.setOpacity(0); this.showInactive(); };
BrowserWindow.prototype.focus = function () { /* never in a test */ };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (what: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  -- ' + d : ''}`); if (!ok) bad++; };
const U = (p: string) => `http://127.0.0.1:${PORT}/${p}`;

app.whenReady().then(async () => {
  http.createServer((q, r) => r.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><title>Page ${q.url}</title><body style="height:4000px"><p>${q.url}</p>`)).listen(PORT, '127.0.0.1');
  const { servePages } = await import('../../src/pageserver.ts');
  const { SamaraBrowser } = await import('../../src/browser.ts');
  const { wireBrowser } = await import('../../src/browseripc.ts');
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'railearlier-state-'));
  const v1 = { v: 1, active: 5, fronts: [5], closed: [], trails: [{ id: 5, name: 'ZORA ARMOR', named: true }], tabs: [
    { url: U('loose-a'), title: 'Loose A', opener: null, scrollY: 0, zoom: 0, win: 0, trail: null },
    { url: U('loose-b'), title: 'Loose B', opener: null, scrollY: 0, zoom: 0, win: 0, trail: null },
    { url: U('zora-1'), title: 'Zora 1', opener: null, scrollY: 300, zoom: 0, win: 0, trail: 5 },
    { url: U('zora-2'), title: 'Zora 2', opener: 2, scrollY: 0, zoom: 0, win: 0, trail: 5 },
    { url: U('done-1'), title: 'Done 1', opener: null, scrollY: 0, zoom: 0, win: 0, trail: null, done: true },
    { url: U('from-a'), title: 'From A', opener: 0, scrollY: 0, zoom: 0, win: 0, trail: null } ] };
  writeFileSync(path.join(stateDir, 'browser-tabs.json'), JSON.stringify(v1));
  writeFileSync(path.join(stateDir, 'browser-stash.json'), JSON.stringify([{ id: 1, name: 'RECIPES', at: Date.now() - 3 * 86_400_000, tabs: [{ url: U('soup'), title: 'Soup' }, { url: U('bread'), title: 'Bread' }] }]));
  const b: any = new SamaraBrowser({ origin: pages.origin, stateDir, preloadPath: path.join(HERE, '..', '..', 'src', 'samarapreload.cjs'),
    tabPreloadPath: path.join(HERE, '..', '..', 'src', 'tabpreload.cjs'), settingsPreloadPath: path.join(HERE, '..', '..', 'src', 'settingspreload.cjs'),
    thingsPreloadPath: path.join(HERE, '..', '..', 'src', 'thingspreload.cjs') } as any);
  wireBrowser(() => b);

  // (1) The move ran in the constructor, before any tab came back.
  check('the files of before are copied aside, untouched', existsSync(path.join(stateDir, 'browser-tabs.v1.json')) && existsSync(path.join(stateDir, 'browser-stash.v1.json'))
    && JSON.parse(readFileSync(path.join(stateDir, 'browser-tabs.v1.json'), 'utf8')).tabs.length === 6);
  const E = () => b.earlier.entries as { key: string; url: string; from?: string; at: number; scrollY?: number }[];
  const froms = E().map((e) => `${e.url.split('/').pop()}:${e.from}`).sort();
  check('trail, done and Stash pages are in Earlier with where they came from', JSON.stringify(froms) === JSON.stringify(['bread:stash: RECIPES', 'done-1:done shelf', 'soup:stash: RECIPES', 'zora-1:trail: ZORA ARMOR', 'zora-2:trail: ZORA ARMOR']), froms.join(', '));
  check('a page keeps its scroll spot in Earlier', E().find((e) => e.url.endsWith('zora-1'))?.scrollY === 300);
  check('the Stash is emptied (its pages are in Earlier)', b.stash.length === 0 && readFileSync(path.join(stateDir, 'browser-stash.json'), 'utf8').trim() === '[]');
  const n0 = E().length;
  b.earlier.d.migrated = false; b.railMove(stateDir);
  check('running the move twice changes nothing', E().length === n0, `${n0} -> ${E().length}`);

  b.open();
  const band = b.win.webContents as Electron.WebContents;
  await new Promise<void>((r) => { if (!band.isLoading()) r(); else band.once('did-finish-load', () => r()); });
  for (let i = 0; i < 50 && !b.pane.trayReady; i++) await wait(100);
  await wait(800);
  const web = () => (b.tabs as any[]).filter((t) => t.url.startsWith('http://127.0.0.1'));
  const byName = (n: string) => web().find((t) => t.url.endsWith('/' + n));
  check('the loose tabs stay open, nothing else', JSON.stringify(web().map((t) => t.url.split('/').pop())) === JSON.stringify(['loose-a', 'loose-b', 'from-a']), web().map((t) => t.url).join(' '));
  check('a link\'s tab still knows the tab it came from', byName('from-a')?.opener === byName('loose-a')?.id);
  check('no trails are left', b.trails.length === 0);

  // (2) The rail.
  const tray = b.trayV.webContents as Electron.WebContents;
  const order = () => tray.executeJavaScript(`[...document.querySelectorAll('#tabs .tp')].map((r) => r.textContent.match(/Page \\/([a-z-]+)|Loose [AB]|From A/)?.[0] ?? r.textContent)`, true) as Promise<string[]>;
  const titles = async () => (await order()).map((s) => s.replace(/^Page \//, '').replace('Loose A', 'loose-a').replace('Loose B', 'loose-b').replace('From A', 'from-a'));
  check('Today is newest opened first', JSON.stringify(await titles()) === JSON.stringify(['from-a', 'loose-b', 'loose-a']), (await titles()).join(' '));
  b.activate(byName('loose-a').id); await wait(400);
  check('clicking a tab does not move it', JSON.stringify(await titles()) === JSON.stringify(['from-a', 'loose-b', 'loose-a']), (await titles()).join(' '));
  b.tabAct(byName('loose-b').id, 'pin'); await wait(400);
  const pinned = await tray.executeJavaScript(`(() => { const r = document.querySelector('#tabs .tp'); return { pin: r.classList.contains('pin'), line: Boolean(document.querySelector('#tabs #pindiv')) }; })()`, true) as { pin: boolean; line: boolean };
  check('Pin puts it on top, with the line under the pinned', (await titles())[0] === 'loose-b' && pinned.pin && pinned.line, JSON.stringify(pinned));
  await b.snapshot(true);
  const saved = JSON.parse(readFileSync(path.join(stateDir, 'browser-tabs.json'), 'utf8'));
  check('the pin and when he last looked are saved', saved.tabs.some((t: any) => t.url.endsWith('/loose-b') && t.pinned === true) && saved.tabs.every((t: any) => Number.isFinite(t.lastSeen)) && saved.tabs.every((t: any) => !('trail' in t)));

  // (3) Fading.
  b.activate(byName('from-a').id); await wait(200);
  byName('loose-a').lastSeen = Date.now() - 13 * 3_600_000; b.sendTabs(); await wait(400);
  const fade = () => tray.executeJavaScript(`(() => { const r = [...document.querySelectorAll('#tabs .tp')].find((x) => x.title.endsWith('/loose-a')); return r ? { fade: r.classList.contains('fade'), tag: Boolean(r.querySelector('.tonight')) } : null; })()`, true) as Promise<{ fade: boolean; tag: boolean } | null>;
  const f1 = await fade();
  check('a tab untouched for 12 hours fades with TONIGHT', Boolean(f1?.fade && f1.tag), JSON.stringify(f1));
  await tray.executeJavaScript(`[...document.querySelectorAll('#tabs .tp')].find((x) => x.title.endsWith('/loose-a')).querySelector('.tonight').click(); 1`, true);
  await wait(400);
  const f2 = await fade();
  check('clicking TONIGHT keeps it', f2?.fade === false && f2.tag === false, JSON.stringify(f2));
  byName('loose-b').lastSeen = Date.now() - 20 * 3_600_000; b.sendTabs(); await wait(400);
  check('the pinned tab never fades', (await tray.executeJavaScript(`(() => { const r = document.querySelector('#tabs .tp.pin'); return r && !r.classList.contains('fade') && !r.querySelector('.tonight'); })()`, true)) === true);

  // (4) The overnight tidy.
  const idA = byName('loose-a').id;
  byName('loose-a').lastSeen = Date.now() - 13 * 3_600_000;
  byName('from-a').lastSeen = Date.now() - 13 * 3_600_000;           // in front: never moved
  b.earlier.d.lastTidy = 0;
  const moved = b.railTidy(Date.now());
  check('the tidy moves the faded tab to Earlier, never the pinned or the one in front', moved === 1 && !byName('loose-a') && Boolean(byName('loose-b')) && Boolean(byName('from-a')) && E().some((e) => e.url.endsWith('/loose-a')), `moved ${moved}`);
  check('and runs once a night', b.railTidy(Date.now()) === 0);
  void idA;

  // (5) Closing goes back to the opener.
  const parent = byName('loose-b').id;
  const kid = b.newTab(U('kid'), parent, true); await wait(300);
  b.newTab(U('other'), null, false); await wait(300);
  b.activate(kid); await wait(200);
  b.close(kid); await wait(300);
  check('closing a tab goes back to the tab that opened it', b.active === parent, `active ${b.active}, opener ${parent}`);

  // (6) Earlier in the tray.
  b.tray(true, { x: 42, y: 62 }); await wait(500);
  await tray.executeJavaScript(`document.getElementById('earlierkey').click(); 1`, true);
  await wait(500);
  const view = await tray.executeJavaScript(`({ shown: !document.getElementById('earlier').hidden, tabsHidden: document.querySelector('.tabpanel:not(.earlier)').hidden, days: [...document.querySelectorAll('#earlierlist .eday')].map((d) => d.textContent), rows: document.querySelectorAll('#earlierlist .erow').length })`, true) as { shown: boolean; tabsHidden: boolean; days: string[]; rows: number };
  check('Earlier opens in place of the tabs, in day groups', view.shown && view.tabsHidden && view.rows === E().length && view.days[0] === 'TODAY' && view.days.length >= 2, JSON.stringify(view));
  await tray.executeJavaScript(`(() => { const q = document.getElementById('earlierq'); q.value = 'zora'; q.dispatchEvent(new Event('input')); return 1; })()`, true);
  await wait(200);
  const found = await tray.executeJavaScript(`[...document.querySelectorAll('#earlierlist .erow')].map((r) => r.title.split('/').pop())`, true) as string[];
  check('the search finds by name or where it came from', JSON.stringify(found.sort()) === JSON.stringify(['zora-1', 'zora-2']), found.join(' '));
  const before = E().length;
  await tray.executeJavaScript(`[...document.querySelectorAll('#earlierlist .erow')].find((r) => r.title.endsWith('/zora-2')).querySelector('.x').click(); 1`, true);
  await wait(400);
  check('× removes it for good', E().length === before - 1 && !E().some((e) => e.url.endsWith('/zora-2')) && Boolean(b.earlier.gone[Object.keys(b.earlier.gone)[0]]));
  await tray.executeJavaScript(`[...document.querySelectorAll('#earlierlist .erow')].find((r) => r.title.endsWith('/zora-1')).click(); 1`, true);
  await wait(1500);
  const back = byName('zora-1');
  check('a click brings it back as the tab in front, out of Earlier', Boolean(back) && b.active === back.id && !E().some((e) => e.url.endsWith('/zora-1')));
  const sy = back?.view ? await back.view.webContents.executeJavaScript('scrollY', true) : -1;
  check('where he left it', Math.abs(sy - 300) < 5, `scrollY ${sy}`);
  const after = await tray.executeJavaScript(`({ earlier: document.getElementById('earlier').hidden, n: document.getElementById('earliern').textContent })`, true) as { earlier: boolean; n: string };
  check('the rail is back on the tabs, the count follows', after.earlier === true && after.n === String(E().length), JSON.stringify(after));
  b.tray(false);
  await wait(300);
  console.log(bad ? `FAILED ${bad}` : 'ALL PASSED');
  app.exit(bad ? 1 : 0);
});
