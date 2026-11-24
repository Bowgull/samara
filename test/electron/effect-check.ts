// Phase 1 (2026-11-24): levers judged by what they do. A button with no telling words (an icon, "→") that sends a form,
// or posts to the site, is held back and asks him, and nothing reaches the site. A search still goes. Plain moves stay
// free. Once he allows it, the same press goes through.
//
// Run: npx electron test/electron/effect-check.ts
import { app, BrowserWindow, screen } from 'electron';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 47936;
process.on('uncaughtException', (e) => { console.log('HARNESS NOTE ' + String((e as Error).message).split('\n')[0]); });
process.on('unhandledRejection', (e) => { console.log('HARNESS REJECTION ' + String((e as Error)?.stack ?? e)); app.exit(2); });
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, 90_000).unref();
app.on('window-all-closed', () => { /* the test decides */ });
const HERE = path.dirname(fileURLToPath(import.meta.url));
BrowserWindow.prototype.show = function (this: BrowserWindow) { this.setPosition(-6000, 100); this.showInactive(); };
BrowserWindow.prototype.focus = function () { /* not in a test */ };
let bad = 0;
const check = (what: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  -- ' + d.slice(0, 260) : ''}`); if (!ok) bad++; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const posts: string[] = [];
const PAGE = `<!doctype html><title>Form</title><body>
<form id="f" action="/sent" method="post"><input name="msg" id="msg" value="hello"><button type="button" id="icon" aria-label="→" onclick="document.getElementById('f').submit()">→</button></form>
<button type="button" id="ajax" aria-label="★">★</button>
<form role="search" action="/find"><input type="search" name="q" value="zora"><button type="button" id="go" aria-label="→" onclick="this.form.requestSubmit()">→</button></form>
<button type="button" id="more" aria-label="More">More</button><div id="out"></div>
<script>
document.getElementById('ajax').onclick = () => fetch('/api/star', { method: 'POST', body: '{}' }).catch(() => {});
document.getElementById('more').onclick = () => { fetch('/api/track', { method: 'POST', body: '{}' }).catch(() => {}); document.getElementById('out').textContent = 'more shown'; };
</script></body>`;

app.whenReady().then(async () => {
  (screen as any).getCursorScreenPoint = () => ({ x: -20000, y: 500 });
  const site = http.createServer((q, r) => {
    if (q.method !== 'GET') posts.push(q.url ?? '');
    if (q.url?.startsWith('/find')) { r.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Found</title><p>found</p>'); return; }
    if (q.url === '/sent') { r.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Sent</title><p>sent</p>'); return; }
    if (q.url?.startsWith('/api/')) { r.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'); return; }
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE);
  });
  await new Promise<void>((r) => site.listen(PORT, '127.0.0.1', () => r()));
  const { servePages } = await import('../../src/pageserver.ts');
  const { SamaraBrowser } = await import('../../src/browser.ts');
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const b = new SamaraBrowser({ origin: pages.origin, stateDir: mkdtempSync(path.join(os.tmpdir(), 'effect-')), preloadPath: path.join(HERE, '..', '..', 'src', 'samarapreload.cjs'),
    tabPreloadPath: path.join(HERE, '..', '..', 'src', 'tabpreload.cjs'), settingsPreloadPath: path.join(HERE, '..', '..', 'src', 'settingspreload.cjs'), thingsPreloadPath: path.join(HERE, '..', '..', 'src', 'thingspreload.cjs'), testLocal: true }) as any;
  // No window: the session's pages are its own hidden pages (a real tab out of sight reads as covered).
  const drive = (op: string, a: Record<string, unknown>) => b.drive(op, a);
  const job = (await drive('start', { kind: 'claude', name: 'Effects' })).job;
  const open = async () => { const o = await drive('open', { job, url: `http://127.0.0.1:${PORT}/` }); const r = await drive('read', { page: o.page }); return { page: o.page, n: (label: string) => r.items.find((i: any) => i.label === label)?.n, items: r.items }; };

  let pg = await open();
  const icon = pg.items.find((i: any) => i.label === '→' && i.weight === 'free');
  check('the icon button looks free by its words', Boolean(icon), JSON.stringify(pg.items.map((i: any) => [i.n, i.label, i.weight])));
  const r1 = await drive('click', { page: pg.page, n: icon?.n });
  check('pressing it would send the form: it asks him, and nothing was sent', r1.ok === false && r1.needs === 'lever' && /send the form/.test(r1.what) && !posts.includes('/sent'), JSON.stringify(r1) + ' posts ' + posts.join(','));
  const r2 = await drive('click', { page: pg.page, n: pg.n('★') });
  check('a star that posts to the site asks him, and nothing reached it', r2.ok === false && r2.needs === 'lever' && !posts.includes('/api/star'), JSON.stringify(r2) + ' posts ' + posts.join(','));
  const r3 = await drive('click', { page: pg.page, n: pg.n('More') });
  check('a plain button stays free (its analytics are not a send)', r3.ok === true, JSON.stringify(r3));
  const go = pg.items.filter((i: any) => i.label === '→')[1];
  const r4 = await drive('click', { page: pg.page, n: go?.n });
  await wait(600);
  check('a search form still goes', r4.ok === true && /Found/.test(b.driver.page(pg.page).title), JSON.stringify(r4));
  pg = await open();
  const icon2 = pg.items.find((i: any) => i.label === '→');
  const r5 = await drive('click', { page: pg.page, n: icon2?.n, allowed: true });
  await wait(600);
  check('once he allows it, the same press sends', r5.ok === true && posts.includes('/sent'), JSON.stringify(r5) + ' posts ' + posts.join(','));
  // Enter in the field: already asks by its kind (a text field sends its form); with his OK it goes.
  console.log(bad ? `FAILED ${bad}` : 'ALL PASSED');
  app.exit(bad ? 1 : 0);
});
