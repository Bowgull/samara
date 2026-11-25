// Timers in Samara (T1, 2026-11-25), in real windows: ☰ › Timer opens the dial, Start puts an hourglass on the screen
// showing its name and time, its keys reach the store (and only for itself), a timer rings on the dot with a notice whose
// Again turns it over, a typed time is read by Samara, a sixth timer is refused, and a timer outlives a restart.
//
// Run: npx electron test/electron/timer-check.ts <folder for the pictures>
import { app, BrowserWindow, Notification, screen, shell } from 'electron';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { servePages } from '../../src/pageserver.ts';
import { SamaraBrowser } from '../../src/browser.ts';
import { wireBrowser } from '../../src/browseripc.ts';
import { startTimers } from '../../src/timerswire.ts';
import { timerMenu } from '../../src/timerwin.ts';
import { Timers } from '../../src/timers.ts';

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
const timerWins = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && /\/timer\.html/.test(w.webContents.getURL()));
const dialWin = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && /\/timerset\.html/.test(w.webContents.getURL())) ?? null;
const shot = async (w: BrowserWindow, name: string) => { try { writeFileSync(path.join(OUT, name), (await w.webContents.capturePage()).toPNG()); } catch { /* no picture */ } };
(shell as any).openExternal = async () => {};
// Nothing reaches the system's notices from a test.
(Notification as any).isSupported = () => false;

app.whenReady().then(async () => {
  (screen as any).getCursorScreenPoint = () => ({ x: 400, y: 300 });
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'timer-check-'));
  const stateDir = path.join(tmp, 'state');
  mkdirSync(stateDir, { recursive: true });
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const b = new SamaraBrowser({ origin: pages.origin, stateDir, preloadPath: path.join(SRC, 'samarapreload.cjs'), tabPreloadPath: path.join(SRC, 'tabpreload.cjs'),
    settingsPreloadPath: path.join(SRC, 'settingspreload.cjs'), thingsPreloadPath: path.join(SRC, 'thingspreload.cjs') }) as any;
  wireBrowser(() => b);
  const told: string[] = [];
  const hub = startTimers({ browser: b, here: SRC, stateDir, origin: pages.origin, log: (s) => console.log('LOG ' + s), notify: (t, body) => told.push(`${t}: ${body}`) });
  b.timersHub = hub;
  const notes: { title: string; keys: { act: string }[]; on?: (a: string) => void }[] = [];
  b.hasWindow = () => true;
  b.note = (_t: string, n: any, on?: (a: string) => void) => { notes.push({ ...n, on }); return notes.length; };
  b.notices.drop = () => {};

  // ☰ › Timer: the dial.
  b.act('timer');
  check('☰ › Timer opens the dial', await until(() => !!dialWin()));
  const dial = dialWin()!;
  await until(() => !dial.webContents.isLoading());
  await wait(400);
  await shot(dial, 'timer-dial.png');
  const dialLooks = await dial.webContents.executeJavaScript("({ presets: document.querySelectorAll('.pre').length, time: document.querySelector('.dial .dt')?.textContent ?? '', fits: document.querySelector('.tset').scrollHeight <= document.querySelector('.tset').clientHeight + 1 })");
  check('the dial shows its presets and ten minutes to start', dialLooks.presets === 5 && dialLooks.time === '10:00', JSON.stringify(dialLooks));
  check('everything on the dial fits its window', dialLooks.fits === true, JSON.stringify(dialLooks));
  // He picks 25 minutes and names it.
  await dial.webContents.executeJavaScript("document.querySelector('.pre[data-p=\"30\"]').click(); document.getElementById('name').value = 'Pizza'; document.getElementById('go').click(); true");
  check('Start sets it, and the dial goes', await until(() => hub.list().length === 1 && !dialWin()), JSON.stringify(hub.list()));
  check('...for thirty minutes, named Pizza', hub.list()[0]?.total === 30 * 60_000 && hub.list()[0]?.label === 'Pizza', JSON.stringify(hub.list()[0]));

  // The hourglass.
  check('an hourglass is on the screen', await until(() => timerWins().length === 1));
  const tw = timerWins()[0]!;
  await until(() => !tw.webContents.isLoading());
  await wait(800);
  await shot(tw, 'timer-running.png');
  const face = await tw.webContents.executeJavaScript("({ name: document.getElementById('np').textContent, left: document.getElementById('left').textContent })");
  check('it shows its name and time', face.name === 'Pizza' && /^(30:00|29:5\d)$/.test(face.left), JSON.stringify(face));
  check('it never takes the keyboard', tw.isFocusable() === false);

  // Its keys: pause (the store keeps what was left), +5.
  await tw.webContents.executeJavaScript("window.samara.timerAct({ action: 'pause' }); true");
  check('pause reaches the store', await until(() => (hub.list()[0]?.paused ?? 0) > 0));
  await tw.webContents.executeJavaScript("window.samara.timerAct({ action: 'pause' }); window.samara.timerAct({ action: 'add', ms: 300000 }); true");
  check('go on, and +5', await until(() => hub.list()[0]?.paused === 0 && hub.list()[0]!.total === 35 * 60_000), JSON.stringify(hub.list()[0]));
  await tw.webContents.executeJavaScript("window.samara.timerAct({ action: 'rename', label: 'Pizza in the oven' }); true");
  check('rename', await until(() => hub.list()[0]?.label === 'Pizza in the oven'));
  // A page cannot act for another timer, nor the dial for a timer.
  const other = hub.start(60 * 60_000, 'Other');
  check('a second timer starts', other === null && hub.list().length === 2);
  await until(() => timerWins().length === 2);
  // the page names the other timer; Samara goes by which window spoke
  await tw.webContents.executeJavaScript(`window.samara.timerAct({ id: '${hub.list()[1]!.id}', action: 'rename', label: 'Mine' }); true`);
  await wait(400);
  check('a timer window only ever acts for its own timer', hub.list()[0]!.label === 'Mine' && hub.list()[1]!.label === 'Other', JSON.stringify(hub.list().map((t) => t.label)));

  // Its menu: the rows he knows.
  const rows = timerMenu(hub.list()[0]!, { start() {}, custom() {}, rename() {}, colour() {}, restart() {}, stop() {} }).map((r) => r.label ?? '-');
  check('its menu: New timer, Rename, Colour, Restart, Stop', rows.join(',') === 'New timer,Rename,Colour,Restart,-,Stop', rows.join(','));

  // A short one rings on the dot: the hourglass hops, a notice with Again / 5 more / Got it, and the system's notice.
  hub.start(1500, 'Tea');
  const tea = () => hub.list().find((t) => t.label === 'Tea');
  check('it rings on time', await until(() => !!tea()?.done, 4000), JSON.stringify(tea()));
  check('...with a notice: Again, 5 more, Got it', notes.some((n) => n.title === 'Tea' && n.keys.map((k) => k.act).join(',') === 'again,more,ok'), JSON.stringify(notes.map((n) => n.title)));
  check('...and the system\'s notice', told.some((t) => /Tea/.test(t)), told.join(' | '));
  await wait(600);
  for (const w of timerWins()) { const n = await w.webContents.executeJavaScript("document.getElementById('np').textContent"); if (/Tea/.test(n)) { await shot(w, 'timer-done.png'); check('the hourglass says time\'s up', /time's up/.test(n), n); } }
  notes.find((n) => n.title === 'Tea')!.on!('more');
  check('5 more turns it over for five minutes', await until(() => !tea()?.done && tea()?.total === 5 * 60_000), JSON.stringify(tea()));

  // A typed time is read by Samara; a bad one is refused on the dial.
  hub.setup();
  await until(() => !!dialWin() && !dialWin()!.webContents.isLoading());
  await wait(300);
  await dialWin()!.webContents.executeJavaScript("document.getElementById('typed').value = 'soon'; document.getElementById('go').click(); true");
  // Samara's answer comes back over IPC: waited for, not timed (a slow runner took longer than 400 ms)
  const badShown = await until(async () => (await dialWin()?.webContents.executeJavaScript("document.getElementById('typed').classList.contains('bad')")) === true);
  check('a time Samara cannot read stays on the dial, marked', badShown && hub.list().length === 3);
  await dialWin()!.webContents.executeJavaScript("document.getElementById('typed').value = '1h 30m'; document.getElementById('go').click(); true");
  check('a typed time starts', await until(() => hub.list().some((t) => t.total === 90 * 60_000)));
  // Five at most.
  hub.start(60_000, 'Five');
  const sixth = hub.start(60_000, 'Six');
  check('a sixth is refused, in words', !!sixth && /5 timers/.test(sixth) && hub.list().length === 5, String(sixth));

  // Stop from the hourglass, and a restart keeps the rest.
  const five = hub.list().find((t) => t.label === 'Five')!;
  const named = async (name: string) => { for (const w of timerWins()) { if (w.webContents.isLoading()) continue; const n = await w.webContents.executeJavaScript("document.getElementById('np').textContent"); if (n === name) return w; } return null; };
  const found: (BrowserWindow | null)[] = [null];
  await until(async () => !!(found[0] = await named('Five')));
  await found[0]?.webContents.executeJavaScript("window.samara.timerAct({ action: 'stop' }); true");
  check('stop from the hourglass', await until(() => !hub.list().some((t) => t.id === five.id) && timerWins().length === 4), String(timerWins().length));
  const kept = new Timers(path.join(stateDir, 'timers.json')).list();
  check('after a restart every timer is there', kept.length === 4, String(kept.length));

  hub.close();
  check('quitting closes the windows', timerWins().length === 0 && !dialWin());
  console.log('pictures: ' + OUT);
  console.log(bad ? `${bad} FAILED` : 'ALL PASS'); app.exit(bad ? 1 : 0);
});
