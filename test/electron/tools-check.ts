// U1 (2026-11-25), in real windows: the tools key is held, its menu comes up by the pointer from a tiny see-through window
// that goes when the menu closes, each row starts its tool (Snip a moment later, so the menu is not in the picture), and
// ☰ › Tools › New note is the quick note.
//
// Run: npx electron test/electron/tools-check.ts <folder for the pictures>
import { app, BrowserWindow, Menu, globalShortcut, screen } from 'electron';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { servePages } from '../../src/pageserver.ts';
import { SamaraBrowser } from '../../src/browser.ts';
import { wireBrowser } from '../../src/browseripc.ts';
import { startTools } from '../../src/toolswire.ts';

process.on('uncaughtException', (e) => { console.log('HARNESS NOTE ' + String((e as Error).message).split('\n')[0]); });
process.on('unhandledRejection', (e) => { console.log('HARNESS REJECTION ' + String((e as Error)?.stack ?? e)); app.exit(2); });
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, 60_000).unref();
app.on('window-all-closed', () => { /* the test decides */ });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', '..', 'src');
let bad = 0;
const check = (what: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  -- ' + d.slice(0, 200) : ''}`); if (!ok) bad++; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await wait(50); } return f(); };

// The system menu cannot be clicked in a test: the menu it would show, and its close, are caught here.
let shown: { menu: Electron.Menu; opts: Electron.PopupOptions } | null = null;
(Menu.prototype as any).popup = function (opts: Electron.PopupOptions) { shown = { menu: this, opts }; };

app.whenReady().then(async () => {
  (screen as any).getCursorScreenPoint = () => ({ x: 420, y: 310 });
  const did: string[] = [];
  const tools = startTools({ hubs: { timer: () => did.push('timer'), music: () => did.push('music'), snip: () => did.push('snip'), note: () => did.push('note') },
    noteKey: 'Control+nummult', log: (s) => console.log('LOG ' + s) });
  check('the tools key is held (the PC\'s: Ctrl + Num /)', globalShortcut.isRegistered('Control+numdiv') && tools.key === 'Ctrl + Num /', String(tools.key));

  tools.open();
  check('its menu comes up', !!shown);
  const anchor = shown?.opts.window as BrowserWindow | undefined;
  check('...hung from a tiny window at the pointer', !!anchor && !anchor.isDestroyed() && anchor.getBounds().x === 420 && anchor.getBounds().y === 310 && anchor.getBounds().width <= 2, JSON.stringify(anchor?.getBounds()));
  check('...on top', !!anchor?.isAlwaysOnTop());
  check('...listing the tools in the ☰ order', JSON.stringify(shown?.menu.items.map((i) => i.label)) === JSON.stringify(['Timer', 'Music player', 'Snip', 'New note']));
  tools.open();
  check('pressing the key again while it is up makes no second one', BrowserWindow.getAllWindows().filter((w) => w.getTitle() === 'Samara tools').length === 1);
  shown!.menu.items[0]!.click();
  check('Timer starts the timer', did.includes('timer'));
  shown!.menu.items[2]!.click();
  check('Snip waits for the menu to go first', !did.includes('snip'));
  check('...then snips', await until(() => did.includes('snip')));
  shown!.opts.callback?.();
  check('the little window goes when the menu closes', await until(() => !!anchor && anchor.isDestroyed()));

  // ☰ › Tools › New note.
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tools-check-'));
  const stateDir = path.join(tmp, 'state'); mkdirSync(stateDir, { recursive: true });
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const b = new SamaraBrowser({ origin: pages.origin, stateDir, preloadPath: path.join(SRC, 'samarapreload.cjs'), tabPreloadPath: path.join(SRC, 'tabpreload.cjs'),
    settingsPreloadPath: path.join(SRC, 'settingspreload.cjs'), thingsPreloadPath: path.join(SRC, 'thingspreload.cjs') }) as any;
  wireBrowser(() => b);
  b.quickNote = () => did.push('quick');
  b.act('newnote');
  check('☰ › Tools › New note is the quick note', did.includes('quick'));

  tools.close();
  check('closing lets the key go', !globalShortcut.isRegistered('Control+numdiv'));
  pages.close();
  console.log(bad ? `${bad} FAILED` : 'ALL PASS');
  app.exit(bad ? 1 : 0);
});
