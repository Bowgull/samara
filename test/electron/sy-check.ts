// SY (his "sync everything", 2026-10-14): the lists he makes in one browser arrive in the other, money sites never travel.
// Two real browsers off screen; what one hands the sync is given to the other, as the brain would pass it on.
//
// Run: npx electron test/electron/sy-check.ts
import { app, BrowserWindow, screen } from 'electron';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { servePages } from '../../src/pageserver.ts';
import { SamaraBrowser } from '../../src/browser.ts';

process.on('uncaughtException', (e) => { console.log('HARNESS NOTE ' + String((e as Error).message).split('\n')[0]); });
process.on('unhandledRejection', (e) => { console.log('HARNESS REJECTION ' + String((e as Error)?.stack ?? e)); app.exit(2); });
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, 60_000).unref();
app.on('window-all-closed', () => { /* the test decides */ });
const HERE = path.dirname(fileURLToPath(import.meta.url));
BrowserWindow.prototype.show = function (this: BrowserWindow) { this.setPosition(-6000, 100); this.showInactive(); };
BrowserWindow.prototype.focus = function () { /* not in a test */ };
let bad = 0;
const check = (what: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  -- ' + d : ''}`); if (!ok) bad++; };

app.whenReady().then(async () => {
  (screen as any).getCursorScreenPoint = () => ({ x: -20000, y: 500 });
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const make = () => new SamaraBrowser({ origin: pages.origin, stateDir: mkdtempSync(path.join(os.tmpdir(), 'sy-')), preloadPath: path.join(HERE, '..', '..', 'src', 'samarapreload.cjs'),
    tabPreloadPath: path.join(HERE, '..', '..', 'src', 'tabpreload.cjs'), settingsPreloadPath: path.join(HERE, '..', '..', 'src', 'settingspreload.cjs'), thingsPreloadPath: path.join(HERE, '..', '..', 'src', 'thingspreload.cjs') });
  const pc = make() as any, mac = make() as any;
  pc.popupOk.add('twitch.tv'); pc.trusted.add('github.com'); pc.httpOk.add('192.168.1.10'); pc.paused.add('youtube.com');
  pc.prefs.dark = false; pc.prefs.darkOff = ['reddit.com'];
  // Phase R: Earlier replaced the Stash, and travels the same way (money sites never).
  pc.earlier.add([{ key: 'k1', url: 'https://wowhead.com/x', title: 'Wowhead', at: 1 }, { key: 'k2', url: 'https://www.rbcroyalbank.com/accounts', title: 'Bank', at: 1 }]);
  const sent = JSON.parse(JSON.stringify(pc.syncTarget.prefs()));
  check('the bank tab never leaves the PC', !JSON.stringify(sent).includes('rbcroyalbank'));
  mac.syncTarget.setPrefs(sent);
  check('popups allowed on the same sites', mac.popupOk.has('twitch.tv'));
  // A site the other machine trusts waits for his yes here (peer lists), it is never trusted silently.
  check('downloads trusted on the other machine wait for his yes here', mac.peerTrusted.has('github.com') && !mac.trusted.has('github.com'));
  check('plain-http exceptions from the other machine wait for his yes here', mac.peerHttp.has('192.168.1.10') && !mac.httpOk.has('192.168.1.10'));
  check('ads paused on the same sites', mac.paused.has('youtube.com'));
  check('dark mode setting and its exceptions', mac.prefs.dark === false && mac.prefs.darkOff.includes('reddit.com'));
  check('Earlier, without the bank tab', mac.earlier.entries.length === 1 && mac.earlier.entries[0].url === 'https://wowhead.com/x', JSON.stringify(mac.earlier.entries));
  mac.syncTarget.setPrefs({ ...sent, lists: { ...sent.lists, popupOk: ['ok.example', 'not a host!', 42] } });
  check('a bad entry from the other side is dropped', [...mac.popupOk].join() === 'ok.example', [...mac.popupOk].join());
  pages.close();
  console.log(bad ? `${bad} failed` : 'all passed');
  setTimeout(() => app.exit(bad ? 1 : 0), 300);
});
