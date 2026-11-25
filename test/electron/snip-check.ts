// Snip in Samara (S1, 2026-11-25), in real windows: ☰ › Snip freezes the screen in the overlay, the box he draws is
// cut from it and saved as a PNG in his snips folder, a notice offers Ask Claude / Pin it / Show / Got it, Ask Claude
// opens a new Claude chat with the snip's name and the door hands that chat the picture (and nothing else), a pinned
// snip shows the picture and never takes the keyboard, with no Samara window the snip is pinned instead, and on a Mac
// without Screen Recording Samara asks for it first.
//
// Run: npx electron test/electron/snip-check.ts <folder for the pictures>
import { app, BrowserWindow, nativeImage, screen, shell } from 'electron';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { servePages } from '../../src/pageserver.ts';
import { SamaraBrowser } from '../../src/browser.ts';
import { wireBrowser } from '../../src/browseripc.ts';
import { startSnip } from '../../src/snipwire.ts';

process.on('uncaughtException', (e) => { console.log('HARNESS NOTE ' + String((e as Error).message).split('\n')[0]); });
process.on('unhandledRejection', (e) => { console.log('HARNESS REJECTION ' + String((e as Error)?.stack ?? e)); app.exit(2); });
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, 60_000).unref();
app.on('window-all-closed', () => { /* the test decides */ });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', '..', 'src');
const OUT = path.resolve(process.argv[process.argv.length - 1]?.endsWith('.ts') ? os.tmpdir() : process.argv[process.argv.length - 1]!);
mkdirSync(OUT, { recursive: true });
BrowserWindow.prototype.focus = function () { /* not in a test */ };
let bad = 0;
const check = (what: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  -- ' + d.slice(0, 200) : ''}`); if (!ok) bad++; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean | Promise<boolean>, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await wait(100); } return false; };
const byPage = (page: string) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().endsWith('/' + page));
const shot = async (w: BrowserWindow, name: string) => { try { writeFileSync(path.join(OUT, name), (await w.webContents.capturePage()).toPNG()); } catch { /* no picture */ } };
(shell as any).openExternal = async () => {};
(shell as any).showItemInFolder = () => {};

/** A made-up screen: dark blue, with a red box at (80, 80) to (320, 220) in the screen's own points (he snips inside it). */
function fakeScreen(d: Electron.Display): Electron.NativeImage {
  const sf = d.scaleFactor || 1;
  const W = Math.round(d.bounds.width * sf), H = Math.round(d.bounds.height * sf);
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const red = x >= 80 * sf && x < 320 * sf && y >= 80 * sf && y < 220 * sf;
    buf[i] = red ? 0 : 80; buf[i + 1] = red ? 0 : 30; buf[i + 2] = red ? 255 : 20; buf[i + 3] = 255;   // BGRA
  }
  return nativeImage.createFromBitmap(buf, { width: W, height: H, scaleFactor: 1 });
}

app.whenReady().then(async () => {
  (screen as any).getCursorScreenPoint = () => ({ x: 400, y: 300 });
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'snip-check-'));
  const stateDir = path.join(tmp, 'state'), dir = path.join(tmp, 'Samara snips');
  mkdirSync(stateDir, { recursive: true });
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const b = new SamaraBrowser({ origin: pages.origin, stateDir, preloadPath: path.join(SRC, 'samarapreload.cjs'), tabPreloadPath: path.join(SRC, 'tabpreload.cjs'),
    settingsPreloadPath: path.join(SRC, 'settingspreload.cjs'), thingsPreloadPath: path.join(SRC, 'thingspreload.cjs') }) as any;
  wireBrowser(() => b);
  const opened: string[] = [];
  let screenAllowed = true;
  const hub = startSnip({ browser: b, here: SRC, stateDir, origin: pages.origin, dir, log: (s) => console.log('LOG ' + s),
    grab: async (d) => fakeScreen(d), openUrl: (u) => opened.push(u), screenOk: () => screenAllowed });
  b.snipHub = hub;
  const notes: { kick: string; title: string; keys: { act: string }[]; on?: (a: string) => void }[] = [];
  let windowOpen = true;
  b.hasWindow = () => windowOpen;
  b.note = (_t: string, n: any, on?: (a: string) => void) => { notes.push({ ...n, on }); return notes.length; };
  const files = () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : []);

  // ☰ › Snip: the overlay with the frozen screen.
  b.act('snip');
  check('☰ › Snip puts the overlay up', await until(() => byPage('snip.html').length === 1));
  const ov = byPage('snip.html')[0]!;
  await until(() => !ov.webContents.isLoading());
  check('...showing the frozen screen', await until(async () => (await ov.webContents.executeJavaScript("document.getElementById('shot').naturalWidth")) > 0));
  check('...over everything', ov.isAlwaysOnTop());
  await shot(ov, 'snip-overlay.png');
  // A click (too small) is not a snip: nothing saved, the overlay goes.
  await ov.webContents.executeJavaScript("window.samara.snipDone({ x: 10, y: 10, w: 3, h: 3, vw: innerWidth, vh: innerHeight }); true");
  check('a click is not a snip: nothing saved, the overlay goes', await until(() => byPage('snip.html').length === 0) && files().length === 0);

  // Again, and he drags round the red box.
  b.act('snip');
  await until(() => byPage('snip.html').length === 1);
  const ov2 = byPage('snip.html')[0]!;
  await until(() => !ov2.webContents.isLoading());
  await until(async () => (await ov2.webContents.executeJavaScript("document.getElementById('shot').naturalWidth")) > 0);
  // the box, drawn with the mouse like he would
  // The overlay may not be quite the screen's size (a window manager keeps a bar), and the frozen screen is stretched to
  // fill it: he drags round what he sees, so the box is drawn where (100, 100) to (300, 200) of the screen shows.
  const d0 = screen.getDisplayNearestPoint({ x: 400, y: 300 });
  const view = await ov2.webContents.executeJavaScript('({ w: innerWidth, h: innerHeight })') as { w: number; h: number };
  const kx = view.w / d0.bounds.width, ky = view.h / d0.bounds.height;
  await ov2.webContents.executeJavaScript(`(() => {
    const ev = (t, x, y) => window.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, bubbles: true }));
    ev('pointerdown', ${100 * kx}, ${100 * ky}); ev('pointermove', ${200 * kx}, ${150 * ky}); ev('pointerup', ${300 * kx}, ${200 * ky}); return true; })()`);
  check('the box he drew is saved as a PNG in his snips folder', await until(() => files().length === 1), JSON.stringify(files()));
  const file = path.join(dir, files()[0] ?? 'none');
  check('...named by the time', /^Snip \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\.png$/.test(path.basename(file)), path.basename(file));
  const img = nativeImage.createFromPath(file);
  const sf = screen.getDisplayNearestPoint({ x: 400, y: 300 }).scaleFactor || 1;
  check('...the size of the box', Math.abs(img.getSize().width - 200 * sf) <= 2 * sf && Math.abs(img.getSize().height - 100 * sf) <= 2 * sf, JSON.stringify(img.getSize()));
  const px = img.toBitmap();
  check('...and it is inside the red box, from corner to corner', px[2] === 255 && px[1] === 0 && px[px.length - 2] === 255 && px[px.length - 3] === 0, `${px[0]},${px[1]},${px[2]}`);
  check('the overlay goes', await until(() => byPage('snip.html').length === 0));

  // The notice.
  const n = notes.find((x) => x.kick === 'Snip saved');
  check('a notice says it is saved and copied', !!n && /Copied/.test(n.title), JSON.stringify(n));
  check('...with Ask Claude, Pin it, Show, Got it', JSON.stringify(n?.keys.map((k) => k.act)) === JSON.stringify(['ask', 'pin', 'show', 'ok']));

  // Ask Claude: a new chat in the Claude app, with the snip's name typed in.
  n?.on?.('ask');
  const link = opened[0] ?? '';
  check('Ask Claude opens a new Claude chat', link.startsWith('claude://code/new?q='), link.slice(0, 60));
  const q = decodeURIComponent(link.replace(/^claude:\/\/code\/new\?q=/, '').replace(/&folder=.*$/, ''));
  const id = /snip: (sn[a-f0-9]{16})/.exec(q)?.[1] ?? '';
  check('...with the snip\'s name and its file typed in', !!id && q.includes(file), q.slice(0, 160));
  const got = hub.forClaude(id);
  check('the door hands that chat the picture', got.ok === true && got.width === img.getSize().width && got.png.length > 100, JSON.stringify({ ...got, png: undefined }));
  check('...and nothing for a name it did not give', hub.forClaude('sn0000000000000000').ok === false && hub.forClaude('../' + path.basename(file)).ok === false && hub.forClaude(file).ok === false);
  check('the name is kept for after a restart', existsSync(path.join(stateDir, 'snips.json')));

  // Pin it.
  n?.on?.('pin');
  check('Pin it puts the snip on the screen', await until(() => byPage('pinsnip.html').length === 1));
  const pw = byPage('pinsnip.html')[0]!;
  await until(() => !pw.webContents.isLoading());
  check('...showing the picture and its name', await until(async () => {
    const s = await pw.webContents.executeJavaScript("({ w: document.getElementById('pic').naturalWidth, t: document.getElementById('what').textContent })");
    return s.w > 0 && s.t === 'Snip';
  }));
  check('...never taking the keyboard', pw.isFocusable() === false);
  check('...on top', pw.isAlwaysOnTop());
  await wait(300);
  await shot(pw, 'snip-pinned.png');
  // A pinned snip's page cannot finish someone else's snip (same preload, different window).
  b.act('snip');
  await until(() => byPage('snip.html').length === 1);
  await pw.webContents.executeJavaScript("window.samara.snipDone({ x: 0, y: 0, w: 50, h: 50, vw: 100, vh: 100 }); true");
  await wait(400);
  check('a pinned snip cannot finish the overlay\'s snip', byPage('snip.html').length === 1 && files().length === 1);
  await byPage('snip.html')[0]!.webContents.executeJavaScript("window.samara.snipDone(null); true");
  check('Esc / cancel: the overlay goes, nothing saved', await until(() => byPage('snip.html').length === 0) && files().length === 1);
  // Its keys.
  await pw.webContents.executeJavaScript("document.getElementById('pin').click(); true");
  check('its pin key takes it off the top', await until(() => !pw.isAlwaysOnTop()));
  const asked = opened.length;
  await pw.webContents.executeJavaScript("document.getElementById('ask').click(); true");
  check('its Ask Claude opens a new chat about the same snip', await until(() => opened.length === asked + 1) && opened[asked]!.includes(id));
  await pw.webContents.executeJavaScript("document.getElementById('close').click(); true");
  check('its close key takes it away', await until(() => byPage('pinsnip.html').length === 0));

  // With no Samara window open the snip is pinned instead.
  windowOpen = false;
  const before = notes.length;
  await hub.start();
  await until(() => byPage('snip.html').length === 1);
  const ov3 = byPage('snip.html')[0]!;
  await until(() => !ov3.webContents.isLoading());
  await until(async () => (await ov3.webContents.executeJavaScript("document.getElementById('shot').naturalWidth")) > 0);
  await ov3.webContents.executeJavaScript("window.samara.snipDone({ x: 50, y: 50, w: 100, h: 80, vw: innerWidth, vh: innerHeight }); true");
  check('with no Samara window, the snip is pinned instead of a notice', await until(() => byPage('pinsnip.html').length === 1) && notes.length === before && files().length === 2);
  windowOpen = true;

  // The Mac without Screen Recording: asked first, no frozen screen.
  screenAllowed = false;
  await hub.start();
  const ask = notes[notes.length - 1];
  check('without Screen Recording, Samara asks for it and shows no overlay', ask?.title === 'Allow Screen Recording' && byPage('snip.html').length === 0, JSON.stringify(ask));
  ask?.on?.('open');
  check('...and Open settings goes to that page of System Settings', opened[opened.length - 1] === 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');

  hub.close();
  check('closing takes every snip window away', await until(() => byPage('pinsnip.html').length === 0 && byPage('snip.html').length === 0));
  pages.close();
  console.log(bad ? `${bad} FAILED` : 'ALL PASS');
  app.exit(bad ? 1 : 0);
});
