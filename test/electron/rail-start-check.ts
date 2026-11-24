// Phase R (2026-11-24): the rail stays shut at start and never slides out late, and the shut list is kept current so
// an open never rebuilds it mid-slide. Samara's real band and tray layer, a restored session of 6 tabs.
//   1. Samara opens with the mouse already resting on the rail's handle: nothing opens until the mouse really moves.
//   2. A real move onto the handle opens it (after the usual 0.25 s rest).
//   3. A tab opened while the rail is shut is already in its list before the next open (no rebuild on open).
//   4. An open asked for before the rail's page has loaded is refused, not slid out late.
//   5. A click in the address bar selects the whole address (typing replaces it) without painting the selection;
//      arrow keys bring the normal selection back.
//
// Run:  npx electron test/electron/rail-start-check.ts
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.on('uncaughtException', (e) => { console.log('HARNESS NOTE ' + String((e as Error)?.message ?? e).split('\n')[0]); });
process.on('unhandledRejection', (e) => { console.log('HARNESS REJECTION ' + String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')); app.exit(2); });
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, 120_000).unref();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 47996;
app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'railstart-ud-')));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('window-all-closed', () => { /* the check decides */ });
BrowserWindow.prototype.show = function (this: BrowserWindow) { this.setOpacity(0); this.showInactive(); };
BrowserWindow.prototype.focus = function () { /* never in a test */ };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (what: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  -- ' + d : ''}`); if (!ok) bad++; };

app.whenReady().then(async () => {
  http.createServer((q, r) => r.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><title>Page ${q.url}</title><body><p>${q.url}</p>`)).listen(PORT, '127.0.0.1');
  const { servePages } = await import('../../src/pageserver.ts');
  const { SamaraBrowser } = await import('../../src/browser.ts');
  const { wireBrowser } = await import('../../src/browseripc.ts');
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'railstart-state-'));
  const tabs = Array.from({ length: 6 }, (_, i) => ({ url: `http://127.0.0.1:${PORT}/p/${i}`, title: `Tab ${i + 1}`, scrollY: 0, zoom: 0, win: 0, trail: null }));
  writeFileSync(path.join(stateDir, 'browser-tabs.json'), JSON.stringify({ v: 1, active: 0, fronts: [0], tabs, trails: [], closed: [] }));
  const b: any = new SamaraBrowser({ origin: pages.origin, stateDir, preloadPath: path.join(HERE, '..', '..', 'src', 'samarapreload.cjs'),
    tabPreloadPath: path.join(HERE, '..', '..', 'src', 'tabpreload.cjs'), settingsPreloadPath: path.join(HERE, '..', '..', 'src', 'settingspreload.cjs'),
    thingsPreloadPath: path.join(HERE, '..', '..', 'src', 'thingspreload.cjs') } as any);
  wireBrowser(() => b);
  b.open();
  const band = b.win.webContents as Electron.WebContents;
  // (4) Before the rail's page has loaded: an open is refused, and nothing slides out once it loads.
  await new Promise<void>((r) => { if (!band.isLoading()) r(); else band.once('did-finish-load', () => r()); });
  b.tray(true, { x: 42, y: 62 });
  const earlyOn = b.trayOn;
  await wait(6000);
  check('an open before the rail has loaded is refused, never a late slide', earlyOn === false && b.trayOn === false, `on at ask ${earlyOn}, later ${b.trayOn}`);
  check('the rail is drawn before he can reach for it', b.pane.trayReady === true);

  // (1) The mouse was already on the handle: the page lays out under it (an enter with no movement).
  const k = await band.executeJavaScript(`(() => { const r = document.getElementById('drawerkey').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`, true) as [number, number];
  await band.executeJavaScript(`(() => { const h = document.getElementById('drawerkey'); h.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false })); h.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 120 })); h.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 120 })); return true; })()`, true);
  await wait(700);
  check('a mouse already resting on the edge at start does not open the rail', b.trayOn === false);

  // (2) A real move onto the handle opens it.
  // A hand's pace: one move a frame or so apart, so the page sees each (moves inside one frame are merged).
  for (const dx of [60, 30, 8, 0]) { band.sendInputEvent({ type: 'mouseMove', x: k[0] + dx, y: k[1] }); await wait(120); }
  await wait(900);
  check('a real move onto the handle opens it', b.trayOn === true);
  b.tray(false); await wait(800);

  // (3) A tab opened while the rail is shut reaches its list before the next open.
  const tray = b.trayV.webContents as Electron.WebContents;
  const rows = () => tray.executeJavaScript(`document.querySelectorAll('#tabs .tp').length`, true) as Promise<number>;
  const before = await rows();
  b.newTab(`http://127.0.0.1:${PORT}/p/new`, null, false);
  await wait(900);
  const shutRows = await rows();
  let msgs = 0;
  const realSend = tray.send.bind(tray);
  (tray as any).send = (ch: string, ...a: unknown[]) => { if (ch === 'browser:tabs') msgs++; return realSend(ch, ...a); };
  b.tray(true, { x: 42, y: 62 });
  await wait(400);
  check('a tab opened while the rail is shut is in its list before it opens', shutRows === before + 1, `${before} -> ${shutRows}`);
  check('opening sends no list (nothing rebuilt mid-slide)', msgs === 0, `${msgs} list messages during the open`);
  b.tray(false);
  await wait(500);
  // (5) The address bar: no highlight on click, typing still replaces.
  await band.executeJavaScript(`document.getElementById('slot').click(); 1`, true);
  await wait(300);
  const sel = await band.executeJavaScript(`(() => { const e = document.querySelector('.slot .edit'); return { all: e.selectionStart === 0 && e.selectionEnd === e.value.length && e.value.length > 0, bg: getComputedStyle(e, '::selection').backgroundColor }; })()`, true) as { all: boolean; bg: string };
  check('a click selects the whole address, unpainted', sel.all && /rgba\(0, 0, 0, 0\)|transparent/.test(sel.bg), JSON.stringify(sel));
  band.sendInputEvent({ type: 'keyDown', keyCode: 'Left' }); band.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
  await wait(150);
  // (Chromium reports an unstyled ::selection as transparent, so the rule that hides it is what is checked.)
  const hidden2 = await band.executeJavaScript(`document.querySelector('.slot .edit').matches('.allsel')`, true) as boolean;
  check('moving in the text paints the selection again', hidden2 === false);
  await band.executeJavaScript(`document.querySelector('.slot .edit').select(); 1`, true);
  band.sendInputEvent({ type: 'char', keyCode: 'w' });
  await wait(150);
  const typed = await band.executeJavaScript(`document.querySelector('.slot .edit').value`, true) as string;
  check('typing replaces the address', typed === 'w', JSON.stringify(typed));
  band.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await wait(200);
  console.log(bad ? `FAILED ${bad}` : 'ALL PASSED');
  app.exit(bad ? 1 : 0);
});
