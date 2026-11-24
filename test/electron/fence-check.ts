// Phase 1 (2026-11-24): the plan he allowed is a Claude session's fence. Sites in the plan open (with his login where the
// plan said so); a site outside it is refused every way it can come: browser_open, a link, a redirect, a pop-up. It is
// never opened quietly logged out instead. A session with no plan keeps the older rule.
//
// Run: npx electron test/electron/fence-check.ts
import { app, BrowserWindow, screen } from 'electron';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 47934;
app.commandLine.appendSwitch('host-resolver-rules', `MAP www.linkedin.com 127.0.0.1:${PORT}, MAP boards.greenhouse.io 127.0.0.1:${PORT}, MAP evil.example.com 127.0.0.1:${PORT}`);
process.on('uncaughtException', (e) => { console.log('HARNESS NOTE ' + String((e as Error).message).split('\n')[0]); });
process.on('unhandledRejection', (e) => { console.log('HARNESS REJECTION ' + String((e as Error)?.stack ?? e)); app.exit(2); });
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, 90_000).unref();
app.on('window-all-closed', () => { /* the test decides */ });
const HERE = path.dirname(fileURLToPath(import.meta.url));
BrowserWindow.prototype.show = function (this: BrowserWindow) { this.setPosition(-6000, 100); this.showInactive(); };
BrowserWindow.prototype.focus = function () { /* not in a test */ };
let bad = 0;
const check = (what: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  -- ' + d.slice(0, 240) : ''}`); if (!ok) bad++; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EVIL = `http://evil.example.com:${PORT}/`;
let evilHits = 0;

app.whenReady().then(async () => {
  (screen as any).getCursorScreenPoint = () => ({ x: -20000, y: 500 });
  const site = http.createServer((q, r) => {
    const host = String(q.headers.host ?? '');
    if (host.startsWith('evil.')) { evilHits++; r.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Evil</title><p>evil</p>'); return; }
    if (q.url === '/go') { r.writeHead(302, { Location: EVIL }).end(); return; }
    r.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><title>Jobs on ${host}</title><p>Jobs</p><a id="out" href="${EVIL}">out</a>`);
  });
  await new Promise<void>((r) => site.listen(PORT, '127.0.0.1', () => r()));
  const { servePages } = await import('../../src/pageserver.ts');
  const { SamaraBrowser } = await import('../../src/browser.ts');
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fence-'));
  const b = new SamaraBrowser({ origin: pages.origin, stateDir: dir, preloadPath: path.join(HERE, '..', '..', 'src', 'samarapreload.cjs'),
    tabPreloadPath: path.join(HERE, '..', '..', 'src', 'tabpreload.cjs'), settingsPreloadPath: path.join(HERE, '..', '..', 'src', 'settingspreload.cjs'), thingsPreloadPath: path.join(HERE, '..', '..', 'src', 'thingspreload.cjs'), testLocal: true }) as any;
  b.open('about:blank');
  await wait(2500);
  const d = b.driver;
  const j = d.startJob('claude', 'Look at jobs', { login: ['www.linkedin.com'], denied: [], steps: ['Read the job list'], allowed: ['boards.greenhouse.io', 'www.linkedin.com'] });
  const gh = await d.open(j.id, `http://boards.greenhouse.io:${PORT}/`);
  check('a site in the plan opens', /Jobs on boards\.greenhouse\.io/.test(gh.title), gh.title);
  const li = await d.open(j.id, `http://www.linkedin.com:${PORT}/`);
  check('a site in the plan with his login opens signed in', !li.guest, JSON.stringify(li));
  let err = '';
  try { await d.open(j.id, EVIL); } catch (e) { err = (e as Error).message; }
  check('browser_open outside the plan is refused, with a way forward', /not in the plan the user allowed/.test(err) && /browser_plan/.test(err), err);
  const p = d.page(gh.page);
  // A link on the page.
  await p.wc.executeJavaScript(`document.getElementById('out').click(); 1`);
  await wait(800);
  check('a link outside the plan is refused, not opened logged out', p.blocked === EVIL && !p.handoff && /greenhouse/.test(p.url), `blocked ${p.blocked} handoff ${p.handoff} url ${p.url}`);
  // A redirect.
  p.blocked = null;
  await p.wc.executeJavaScript(`location.href = '/go'; 1`);
  await wait(1000);
  check('a redirect outside the plan is refused', p.blocked === EVIL && !/evil/.test(p.wc.getURL()), `blocked ${p.blocked} at ${p.wc.getURL()}`);
  // A pop-up.
  p.blocked = null;
  await p.wc.executeJavaScript(`window.open(${JSON.stringify(EVIL)}); 1`, true);
  await wait(800);
  check('a pop-up outside the plan is refused', !/evil/.test(p.wc.getURL()) && d.pagesOf(j).every((x: any) => !/evil/.test(x.wc.getURL())), `blocked ${p.blocked}`);
  check('the site outside the plan was never reached', evilHits === 0, `${evilHits} requests`);
  // A session with no plan keeps the older rule: off its sites, logged out.
  const k = d.startJob('claude', 'Quick look');
  await d.open(k.id, `http://boards.greenhouse.io:${PORT}/`);
  const g = await d.open(k.id, EVIL);
  check('a session with no plan still opens other sites logged out', g.guest === true, JSON.stringify(g));
  console.log(bad ? `FAILED ${bad}` : 'ALL PASSED');
  app.exit(bad ? 1 : 0);
});
