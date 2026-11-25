// The music player in Samara (M1, 2026-11-25), in real windows, with a pretend Spotify: ☰ › Music player opens it;
// what his account plays (on his phone) is drawn with the device's name; Play / pause, Next and the volume become the
// Web API's calls on that device; the ··· menu lists his devices and moves the music; with no sign-in the menu offers
// "Sign in to Spotify" and the sign-in comes back by itself; nothing is asked of Spotify while the player is closed.
//
// Run: npx electron test/electron/music-check.ts <folder for the pictures>
import { app, BrowserWindow, screen, shell } from 'electron';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { servePages } from '../../src/pageserver.ts';
import { SamaraBrowser } from '../../src/browser.ts';
import { wireBrowser } from '../../src/browseripc.ts';
import { startMusic } from '../../src/musicwire.ts';
import type { Fetch } from '../../src/spotify.ts';

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
const check = (what: string, ok: boolean, d: unknown = '') => { const s = typeof d === 'string' ? d : JSON.stringify(d); console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${s ? '  -- ' + s.slice(0, 240) : ''}`); if (!ok) bad++; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean | Promise<boolean>, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await f()) return true; } catch { /* not yet */ } await wait(100); } return false; };
const playerWin = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && /\/miniplayer\.html/.test(w.webContents.getURL())) ?? null;
const menuWin = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && /\/playermenu\.html/.test(w.webContents.getURL())) ?? null;
const shot = async (w: BrowserWindow, name: string) => { try { writeFileSync(path.join(OUT, name), (await w.webContents.capturePage()).toPNG()); } catch { /* no picture */ } };
(shell as any).openExternal = async () => {};
const ID = 'b2'.repeat(16);

// A pretend Spotify: his phone plays a song; every call is written down.
const calls: string[] = [];
let playing = true;
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const fakeFetch: Fetch = async (url, init) => {
  const m = init?.method ?? 'GET';
  const p = url.replace('https://api.spotify.com/v1', '');
  calls.push(`${m} ${p}`);
  const j = (o: unknown, status = 200) => ({ ok: status < 300, status, json: async () => o, text: async () => (o === null ? '' : JSON.stringify(o)), headers: { get: () => null } });
  if (url.includes('accounts.spotify.com/api/token')) return j({ access_token: 'tok', refresh_token: 'refresh-token-2', expires_in: 3600 });
  if (url.startsWith('https://i.scdn.co/')) return { ...j({}), arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) as ArrayBuffer };
  if (m === 'GET' && p.startsWith('/me/player?')) return j({ device: { id: 'phone1', name: 'His Phone', type: 'Smartphone', volume_percent: 60 }, is_playing: playing, progress_ms: 61_000,
    item: { id: 'trk1', name: 'Maria También', duration_ms: 241_000, artists: [{ name: 'Khruangbin' }], album: { name: 'Con Todo El Mundo', images: [{ url: 'https://i.scdn.co/image/a', width: 640 }] } } });
  if (m === 'GET' && p === '/me/player/devices') return j({ devices: [{ id: 'phone1', name: 'His Phone', type: 'Smartphone', is_active: true }, { id: 'desk1', name: 'Desk PC', type: 'Computer', is_active: false }] });
  if (p.startsWith('/me/player/pause')) { playing = false; return j(null, 204); }
  if (p.startsWith('/me/player/play')) { playing = true; return j(null, 204); }
  return j(null, 204);
};

app.whenReady().then(async () => {
  (screen as any).getCursorScreenPoint = () => ({ x: 400, y: 300 });
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'music-check-'));
  const stateDir = path.join(tmp, 'state'); mkdirSync(stateDir, { recursive: true });
  // the companion's sign-in, in a folder beside Samara's
  const appData = path.join(tmp, 'appdata'); mkdirSync(path.join(appData, 'Old'), { recursive: true });
  writeFileSync(path.join(appData, 'Old', 'spotify.json'), JSON.stringify({ clientId: ID, refreshToken: 'refresh-token-1' }));
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const b = new SamaraBrowser({ origin: pages.origin, stateDir, preloadPath: path.join(SRC, 'samarapreload.cjs'), tabPreloadPath: path.join(SRC, 'tabpreload.cjs'),
    settingsPreloadPath: path.join(SRC, 'settingspreload.cjs'), thingsPreloadPath: path.join(SRC, 'thingspreload.cjs') }) as any;
  wireBrowser(() => b);
  const hub = startMusic({ here: SRC, stateDir, origin: pages.origin, appData, log: (s) => console.log('LOG ' + s), platform: 'win32', fetch: fakeFetch, lyrics: async () => null });
  b.musicHub = hub;
  check('the companion\'s Spotify sign-in came over', hub.connected === true);
  await wait(300);
  check('nothing is asked of Spotify while the player is closed', calls.length === 0, calls);

  // ☰ › Music player
  b.act('music');
  check('☰ › Music player opens it', await until(() => !!playerWin()));
  const w = playerWin()!;
  const js = (s: string) => w.webContents.executeJavaScript(s, true);
  check('it draws', await until(async () => (await js(`window.__ready ? window.__ready.then(() => !!document.querySelector('.full .time')) : false`)) === true, 12_000));
  check('it never takes the keyboard', !w.isFocusable());
  check('what his phone plays is drawn: the song, the artist, the album', await until(async () => /MARIA TAMBIÉN\s+·\s+KHRUANGBIN/.test(await js(`document.querySelector('.full .scroll').textContent`)), 8000),
    await js(`document.querySelector('.full .scroll').textContent`));
  const where = await js(`document.querySelector('.full .tags')?.textContent ?? ''`);
  check('...on His Phone', /HIS PHONE/i.test(where), where);
  await wait(800);
  await shot(w, 'music-player.png');

  // The keys, on that device.
  const press = (sel: string) => js(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); const r = t.getBoundingClientRect(); const o = { bubbles: true, button: 0, pointerId: 3, clientX: r.left + 5, clientY: r.top + 5, screenX: 100, screenY: 100 };
    t.dispatchEvent(new PointerEvent('pointerdown', o)); t.dispatchEvent(new PointerEvent('pointerup', o)); t.dispatchEvent(new MouseEvent('click', o)); return 1; })()`);
  calls.length = 0;
  await press('[title="Play / pause"]');
  check('Play / pause pauses his phone', await until(() => calls.some((c) => c.startsWith('PUT /me/player/pause?device_id=phone1'))), calls);
  await press('[title="Next"]');
  check('Next goes to the next song on his phone', await until(() => calls.some((c) => c.startsWith('POST /me/player/next?device_id=phone1'))), calls);
  await js(`window.player.cmd('volume', 0.25); 1`);
  check('the volume, on his phone', await until(() => calls.some((c) => c.startsWith('PUT /me/player/volume?volume_percent=25&device_id=phone1'))), calls);
  await js(`window.player.cmd('volume', 7); window.player.cmd('rm', 1); 1`);
  await wait(300);
  check('a key out of range, or one that is not a key, goes nowhere', !calls.some((c) => /volume_percent=700|\/rm/.test(c)), calls);

  // The ··· menu: his devices, and moving the music.
  await js(`document.querySelector('.full [title="Picture and bars"]').click(); 1`);
  check('··· opens its menu', await until(() => !!menuWin()?.isVisible()));
  const m = menuWin()!;
  const mjs = (s: string) => m.webContents.executeJavaScript(s, true);
  check('the menu lists his devices, His Phone ticked', await until(async () => (await mjs(`[...document.querySelectorAll('button[data-device]')].map((b) => b.innerText.trim() + (b.querySelector('[data-tick]') ? '*' : '')).join(',')`)) === 'His Phone*,Desk PC'),
    await mjs(`[...document.querySelectorAll('button[data-device]')].map((b) => b.innerText.trim()).join(',')`).catch(() => ''));
  await shot(m, 'music-menu.png');
  calls.length = 0;
  await mjs(`document.querySelector('button[data-device="desk1"]').click(); 1`);
  check('picking Desk PC moves the music there', await until(() => calls.includes('PUT /me/player')), calls);

  // Closed: Spotify is asked nothing more.
  w.close();
  await until(() => !playerWin());
  await wait(5500);
  calls.length = 0;
  await wait(6000);
  check('closed: Spotify is asked nothing', calls.length === 0, calls);
  hub.close();

  // No sign-in on this computer: the menu offers it, and it comes back by itself.
  const state2 = path.join(tmp, 'state2'); mkdirSync(state2);
  const opened: string[] = [];
  const hub2 = startMusic({ here: SRC, stateDir: state2, origin: pages.origin, appData: path.join(tmp, 'nothing'), log: (s) => console.log('LOG2 ' + s), platform: 'win32', fetch: fakeFetch, lyrics: async () => null,
    openUrl: (u) => { opened.push(u); void (async () => { const start = await fetch(u, { redirect: 'manual' }); void start; const n = new URL(u).searchParams.get('n'); const go = await fetch(`http://127.0.0.1:47835/start?n=${n}&id=${ID}`, { redirect: 'manual' }); const s = new URL(go.headers.get('location')!).searchParams.get('state'); await fetch(`http://127.0.0.1:47835/callback?state=${s}&code=c0de`); })(); } });
  check('no sign-in here', hub2.connected === false);
  hub2.open();
  check('the player opens anyway', await until(() => !!playerWin()));
  const w2 = playerWin()!;
  await until(async () => (await w2.webContents.executeJavaScript(`window.__ready ? window.__ready.then(() => true) : false`, true)) === true, 12_000);
  await wait(500);
  await w2.webContents.executeJavaScript(`document.querySelector('.full [title="Picture and bars"]').click(); 1`, true);
  check('its menu offers Sign in to Spotify', await until(async () => (await menuWin()?.webContents.executeJavaScript(`document.querySelector('button[data-signin]')?.innerText.trim() ?? ''`, true)) === 'Sign in to Spotify'));
  await shot(menuWin()!, 'music-signin.png');
  await menuWin()!.webContents.executeJavaScript(`document.querySelector('button[data-signin]').click(); 1`, true);
  check('the sign-in finishes by itself and Samara is signed in', await until(() => hub2.connected === true, 10_000), opened);
  check('...and then shows what his phone plays', await until(async () => /MARIA/.test(await w2.webContents.executeJavaScript(`document.querySelector('.full .scroll').textContent`, true)), 10_000));
  hub2.close();

  console.log('pictures: ' + OUT);
  console.log(bad ? `${bad} FAILED` : 'ALL PASS'); app.exit(bad ? 1 : 0);
});
