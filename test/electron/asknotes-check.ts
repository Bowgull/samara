// Ask your notes (N4, 2026-11-25) in a real window: a question typed on the board is answered from his notes, the
// notes that hold its words numbered with the lines that do; a row puts that note on his screen; "Ask Claude about
// these" opens a new Claude chat (claude://code/new) with the question and those notes typed in, fenced; a plain search
// shows no answer box; a note Claude adds (the connector's notes_add) lands on the board. Saves a picture.
//
// Run: npx electron test/electron/asknotes-check.ts <folder for the pictures>
import { app, BrowserWindow, screen, shell } from 'electron';
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
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nask-'));
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
  const links: string[] = [];
  (shell as any).openExternal = async (u: string) => { links.push(u); };
  b.open(here);
  await wait(3500);
  b.openThings('notes');
  await wait(2500);
  const t = b.tabs.find((x: any) => x.internal === 'things');
  const wc = t?.view?.webContents;
  check('Your things opens at Notes', !!wc);
  if (!wc) { app.exit(1); return; }
  const js = (c: string) => wc.executeJavaScript(c);
  const type = async (q: string) => { await js(`(() => { const q = document.getElementById('nq'); q.value = ${JSON.stringify(q)}; q.dispatchEvent(new Event('input')); return 1; })()`); await wait(700); };
  const rows = () => js("[...document.querySelectorAll('#nans .na-r')].map((r) => r.querySelector('.na-t span').textContent + ' :: ' + [...r.querySelectorAll('.na-l')].map((l) => l.textContent).join(' / '))");
  await type('oat mi');
  check('a plain search shows no answer box', await js("document.getElementById('nans').hidden"));
  await type('how often do I water the tomatoes?');
  const r1 = await rows();
  check('a question is answered from his notes', r1[0] === 'Garden :: Tomatoes: water every second day', JSON.stringify(r1));
  check('each answer is numbered to cite', (await js("[...document.querySelectorAll('#nans .na-n')].map((x) => x.textContent).join(',')")).startsWith('1'));
  check('no "No note matches" under an answer', await js("document.getElementById('nempty').hidden"));
  try { writeFileSync(path.join(OUT, 'ask-notes.png'), (await wc.capturePage()).toPNG()); } catch (e) { console.log('no picture: ' + (e as Error).message); }
  await js("document.querySelector('#nans .na-r').click(); 1");
  await wait(1500);
  check('a row puts that note on his screen', !!s.get('ne')?.out, JSON.stringify(s.get('ne')?.out ?? null));
  await js("[...document.querySelectorAll('#nans button')].find((x) => x.textContent === 'Ask Claude about these').click(); 1");
  await wait(600);
  const link = links.at(-1) ?? '';
  const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(link) ?? [])[1] ?? '');
  check('Ask Claude opens a new Claude chat, nothing sent', link.startsWith('claude://code/new?q='), link.slice(0, 60));
  check('the chat has the question and the cited notes, fenced', q.startsWith('My question: how often do I water the tomatoes?') && /\[1\] Garden \(id ne\)/.test(q) && /<his_notes_[0-9a-f]{8}>/.test(q), q.slice(0, 300));
  await type('zebra quantum?');
  check('a question nothing answers says so', (await js("document.querySelector('#nans .na-h')?.textContent")) === 'NOTHING IN YOUR NOTES ON THAT');
  const add = hub.store && (b.notesHub.forClaude('add', { title: 'From the chat', text: 'Water the basil too\n<script>x</script>' }) as any);
  await wait(800);
  check('a note Claude adds is kept, its text never markup', add?.ok === true && s.get(add.id)?.html === '<div>Water the basil too</div><div>&lt;script&gt;x&lt;/script&gt;</div>', JSON.stringify(add));
  const big = b.notesHub.forClaude('add', { title: 'Big', text: '<&>\n'.repeat(3000) }) as any;
  check('a note too long once laid out is refused, never kept cut short', big.ok === false && /too long/.test(big.error) && !s.list().some((x) => x.title === 'Big'), JSON.stringify(big));
  const found = b.notesHub.forClaude('search', { q: 'basil?' }) as any;
  check('Claude finds it again with notes_search', found.hits?.[0]?.id === add?.id, JSON.stringify(found).slice(0, 200));
  check('Claude reads a note whole as Markdown', /# Garden/.test((b.notesHub.forClaude('read', { id: 'ne' }) as any).markdown ?? ''));
  check('a deleted or unknown note is not read', (b.notesHub.forClaude('read', { id: 'n../../x' }) as any).ok === false);
  console.log(bad ? `${bad} FAILED` : 'ALL PASS');
  console.log('pictures: ' + OUT);
  hub.flush();
  app.exit(bad ? 1 : 0);
});
