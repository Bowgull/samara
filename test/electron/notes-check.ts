// Notes in Samara (N0, 2026-11-25), in real windows: the companion's notes come in at start (one already out on the
// screen gets its window), the quick note keeps a draft while he types and becomes a note on Enter, a sticky deleted
// goes to the Trash, the rail gets the page notes, and the Hyrule map file is written in the companion's format.
//
// Run: npx electron test/electron/notes-check.ts <folder for the pictures>
import { app, BrowserWindow, globalShortcut, screen, shell } from 'electron';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { servePages } from '../../src/pageserver.ts';
import { SamaraBrowser } from '../../src/browser.ts';
import { wireBrowser } from '../../src/browseripc.ts';
import { startNotes } from '../../src/noteswire.ts';
import { quickKeysFor, sayKey } from '../../src/notes.ts';

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
const noteWins = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && /\/note\.html/.test(w.webContents.getURL()));

// Nothing leaves the test for the system (CI, 2026-11-25): "Show in folder" ran xdg-open on the Linux runner, which
// started a real browser that held the check's output open until the job timed out. Each call is recorded instead.
const shown: string[] = [];
void shown;
(shell as any).showItemInFolder = (p: string) => { shown.push('folder:' + p); };
(shell as any).openPath = async (p: string) => { shown.push('path:' + p); return ''; };
(shell as any).openExternal = async (u: string) => { shown.push('link:' + u); };
app.whenReady().then(async () => {
  (screen as any).getCursorScreenPoint = () => ({ x: 400, y: 300 });
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'notes-check-'));
  // The companion's file, in its own folder, found by its shape.
  const comp = path.join(tmp, 'companion');
  mkdirSync(comp);
  writeFileSync(path.join(comp, 'notes.json'), JSON.stringify([
    { id: 'nold1', title: 'Raid night', html: '<div class="cl">Flasks</div>', cat: 'To-do', font: 'figtree', size: 'm', updated: 1795560487057, out: { x: 200, y: 200, w: 260, h: 220, opacity: 1, pinned: false } },
    { id: 'nold2', title: 'Wowhead tip', html: '<div>Check the vendor</div>', font: 'caveat', size: '18', src: { url: 'https://www.wowhead.com/', site: 'wowhead.com' }, updated: 1795474087057 },
    { id: 'nold3', title: 'Shrine', html: '<div>behind the waterfall</div>', cat: 'Zelda', font: 'figtree', size: 'm', place: { game: 'botw', x: 100, z: -200 }, updated: 1795474087057 },
  ]));
  const botw = path.join(tmp, 'botw'); mkdirSync(botw);
  process.env.SAMARA_BOTW_DIR = botw;
  const stateDir = path.join(tmp, 'state');
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const b = new SamaraBrowser({ origin: pages.origin, stateDir, preloadPath: path.join(SRC, 'samarapreload.cjs'), tabPreloadPath: path.join(SRC, 'tabpreload.cjs'),
    settingsPreloadPath: path.join(SRC, 'settingspreload.cjs'), thingsPreloadPath: path.join(SRC, 'thingspreload.cjs') }) as any;
  wireBrowser(() => b);
  const hub = startNotes({ browser: b, here: SRC, stateDir, origin: pages.origin, dev: 'pc', log: (s) => console.log('LOG ' + s), companionFile: path.join(comp, 'notes.json') });
  await wait(2500);

  check('the companion\'s notes came in', hub.store.list().length === 3, String(hub.store.list().length));
  check('...with their font and size', hub.store.get('nold2')?.font === 'caveat' && hub.store.get('nold2')?.size === '18');
  check('the companion\'s file is untouched', JSON.parse(readFileSync(path.join(comp, 'notes.json'), 'utf8')).length === 3);
  check('the note that was out on the screen has its window', noteWins().length === 1, String(noteWins().length));
  check('the rail has the page note', (b.railNotes as { id: string }[]).some((n) => n.id === 'nold2'));
  const map = JSON.parse(readFileSync(path.join(botw, 'notes.json'), 'utf8'));
  check('the Hyrule map file has the pin, in the companion\'s format', map.v === 1 && map.notes[0]?.id === 'nold3' && map.notes[0]?.x === 100 && Array.isArray(map.notes[0]?.lines));
  const sticky = noteWins()[0]!;
  try { writeFileSync(path.join(OUT, 'notes-sticky.png'), (await sticky.webContents.capturePage()).toPNG()); } catch { /* no picture */ }
  const shown = await sticky.webContents.executeJavaScript("document.querySelector('.nbody')?.textContent ?? ''");
  check('the sticky shows its words', /Flasks/.test(shown), shown);

  // The quick note: a draft while he types, a note on Enter.
  hub.quick();
  await wait(1500);
  const q = noteWins().find((w) => /\?quick/.test(w.webContents.getURL()));
  check('the quick note opens', !!q);
  if (q) {
    await q.webContents.executeJavaScript("(() => { const b = document.querySelector('.nbody'); b.innerHTML = '<div>buy oat milk tomorrow morning</div>'; b.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
    await wait(1000);
    const drafts = existsSync(path.join(stateDir, 'notes', 'drafts')) ? readdirSync(path.join(stateDir, 'notes', 'drafts')) : [];
    check('a draft is kept while he types', drafts.length === 1, drafts.join(','));
    try { writeFileSync(path.join(OUT, 'notes-quick.png'), (await q.webContents.capturePage()).toPNG()); } catch { /* no picture */ }
    q.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    q.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    q.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await wait(800);
    const kept = hub.store.list().find((n) => /oat milk/.test(n.html));
    check('Enter keeps it as a note', !!kept, kept?.title ?? 'none');
    check('...titled from its first words', kept?.title === 'buy oat milk tomorrow', kept?.title);
    check('...the draft is let go', readdirSync(path.join(stateDir, 'notes', 'drafts')).length === 0);
    check('...and the window goes', !noteWins().some((w) => /\?quick/.test(w.webContents.getURL())));
  }

  // Delete from the sticky: to the Trash, the window gone.
  await sticky.webContents.executeJavaScript('window.samara.noteDelete(); true');
  await wait(400);
  check('a deleted sticky goes to the Trash', hub.store.trash().some((n) => n.id === 'nold1') && !hub.store.get('nold1'));
  check('...and its window goes', noteWins().length === 0, String(noteWins().length));
  // Open one from the rail: out on the screen.
  b.onNoteOpen('nold2');
  await wait(1200);
  check('a note opened from the rail comes out on the screen', noteWins().length === 1 && !!hub.store.get('nold2')?.out);
  // A page cannot speak for another note: a save from the sticky with another id changes only its own.
  await noteWins()[0]!.webContents.executeJavaScript("window.samara.noteSave({ id: 'nold3', title: 'Hacked', html: '<div>x</div>' }); true");
  await wait(300);
  check('a note window only ever saves its own note', hub.store.get('nold3')?.title === 'Shrine' && hub.store.get('nold2')?.title === 'Hacked');

  // A restart: everything is still there.
  hub.flush();
  const { NotesStore } = await import('../../src/notestore.ts');
  const again = new NotesStore({ dir: path.join(stateDir, 'notes'), dev: 'pc', log: () => {} });
  check('after a restart every note is there', again.list().length === 3 && again.trash().length === 1, `${again.list().length} + ${again.trash().length}`);
  check('Settings › Notes has its numbers', (b.notesHub.status() as { notes: number }).notes === 3);
  // Q1: this machine's quick-note key is held (the Mac's Control + Option + N, the PC's Ctrl + Num *), and Settings names it.
  const ks = (b.notesHub.status() as { quickKeys?: string[] }).quickKeys ?? [];
  const qk = quickKeysFor(process.platform)[0]!;
  check('the quick-note key is held, and named for Settings', globalShortcut.isRegistered(qk) && ks.includes(sayKey(qk, process.platform === 'darwin')), JSON.stringify(ks));

  console.log('pictures: ' + OUT);
  console.log(bad ? `${bad} FAILED` : 'ALL PASS'); app.exit(bad ? 1 : 0);
});
