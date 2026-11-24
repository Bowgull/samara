// Samara's speed, held to a budget (phase 5, 2026-11-24). Four numbers, on local pages only so a slow network never
// moves them:
//   start:  new SamaraBrowser() to the front tab's first contentful paint, from a saved session of six tabs;
//   memory: what one ordinary page costs (the median page process's private memory);
//   idle:   the processor use of all of Samara's processes over 10 s while nothing happens;
//   switch: clicking an awake background tab to its page drawing a frame (median of 10 switches).
// Budgets are in speed-budgets.json, one set per system. Over budget fails; RECORD=1 only prints.
// Off screen, never focused, never sends input. Prints "SPEED {...}" and a line per number.
//
// Run: npx electron test/electron/speed-check.ts   (CI runs it alone, after the other checks, so they cannot slow it)
import { app, BrowserWindow, screen } from 'electron';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { overBudget, type Budgets, type Speed } from '../../tools/speedbudget.ts';

process.on('uncaughtException', (e) => { console.log('HARNESS NOTE ' + String((e as Error)?.message ?? e).split('\n')[0]); });
process.on('unhandledRejection', (e) => { console.log('HARNESS REJECTION ' + String((e as Error)?.message ?? e).split('\n')[0]); });
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, 150_000).unref();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 47999;
app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'samara-speed-ud-')));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => { /* the check decides */ });
// Linux runs under a virtual display, where a see-through or off-screen window is never drawn at all (measured: no
// first paint in 30 s), so there it is shown plainly; on a Mac or Windows it is see-through, which they still draw.
BrowserWindow.prototype.show = function (this: BrowserWindow) { if (process.platform !== 'linux') this.setOpacity(0); this.showInactive(); };
BrowserWindow.prototype.focus = function () { /* never in a test */ };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? NaN; };

// An ordinary article page: text, a few images, a little script, like a news or docs page.
const PAGE = (n: string) => `<!doctype html><title>Page ${n}</title><style>body{font:16px/1.5 sans-serif;max-width:720px;margin:24px auto}
img{width:100%;height:160px;background:#ddd}</style><h1>Page ${n}</h1>
${Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i} of page ${n}. ${'Words that fill a line of an ordinary article. '.repeat(4)}</p>${i % 2 === 0 ? `<img src="/img/${i}.svg">` : ''}`).join('')}
<script>let k = 0; for (let i = 0; i < 2e5; i++) k += i % 7; document.title += ' ' + (k % 3);</script>`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160"><rect width="640" height="160" fill="#8ab"/></svg>`;

app.whenReady().then(async () => {
  // When the front page was asked for, from Samara's start: splits a slow start into Samara's part and the page's.
  let asked = 0, t0 = performance.now();
  (screen as any).getCursorScreenPoint = () => ({ x: -20000, y: 500 });
  http.createServer((q, r) => {
    const u = q.url ?? '/';
    // Pictures arrive slowly, as on a real site, so a page that waits for them before drawing shows up as a slow start.
    if (u.startsWith('/img/')) { setTimeout(() => r.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(SVG), 300 + (Number(u.split('/')[2]?.split('.')[0]) % 7) * 100); return; }
    if (u === '/p/0' && !asked) asked = Math.round(performance.now() - t0);
    r.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE(u.slice(3) || '0'));
  }).listen(PORT, '127.0.0.1');
  const { servePages } = await import('../../src/pageserver.ts');
  const { SamaraBrowser } = await import('../../src/browser.ts');
  const { wireBrowser } = await import('../../src/browseripc.ts');
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'samara-speed-state-'));
  const url = (i: number) => `http://127.0.0.1:${PORT}/p/${i}`;
  writeFileSync(path.join(stateDir, 'browser-tabs.json'), JSON.stringify({ v: 1, at: new Date().toISOString(), active: 0, fronts: [0],
    tabs: [0, 1, 2, 3, 4, 5].map((i) => ({ url: url(i), title: `Page ${i}`, opener: null, scrollY: 0, zoom: 0, muted: false, trail: null, done: false, win: 0 })),
    trails: [], closed: [] }));

  // 1. Start.
  t0 = performance.now();
  const b: any = new SamaraBrowser({ origin: pages.origin, stateDir, preloadPath: path.join(HERE, '..', '..', 'src', 'samarapreload.cjs'),
    tabPreloadPath: path.join(HERE, '..', '..', 'src', 'tabpreload.cjs'), settingsPreloadPath: path.join(HERE, '..', '..', 'src', 'settingspreload.cjs'),
    thingsPreloadPath: path.join(HERE, '..', '..', 'src', 'thingspreload.cjs') } as any);
  wireBrowser(() => b);
  b.open();
  // The band's own page: when its document was in, and when everything it loads was.
  let frameReady = 0, frameLoaded = 0;
  b.win?.webContents.once('dom-ready', () => { frameReady = Math.round(performance.now() - t0); });
  b.win?.webContents.once('did-finish-load', () => { frameLoaded = Math.round(performance.now() - t0); });
  let startMs = NaN;
  for (let i = 0; i < 400 && Number.isNaN(startMs); i++) {
    const wc = b.cur()?.view?.webContents;
    const r = wc && !wc.isDestroyed() ? await wc.mainFrame.executeJavaScript('(() => { const p = performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint"); return p ? performance.timeOrigin + p.startTime : null; })()', true).catch(() => null) : null;
    if (typeof r === 'number') startMs = Math.round(r - (performance.timeOrigin + t0));
    else await wait(25);
  }
  console.log(`start: first page drawn ${startMs} ms after Samara began (asked for at ${asked} ms; band ready ${frameReady} ms, fully loaded ${frameLoaded} ms)`);

  // Wake every saved tab (a restored session keeps them asleep until visited), then leave the first in front.
  const ids: number[] = b.tabs.map((t: any) => t.id);
  for (const id of ids) { b.lastGesture.set(id, Date.now()); b.activate(id); await wait(700); }
  b.activate(ids[0]);
  const framed = (t: any) => t.view.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))', true);
  for (const t of b.tabs) await Promise.race([framed(t).catch(() => 0), wait(5000)]);
  await wait(6000);   // let start-up work (lists, saving, pictures) finish

  // 2. Memory of one ordinary page.
  const pids = new Set<number>(b.tabs.map((t: any) => t.view?.webContents.getOSProcessId()).filter(Boolean));
  const mem = app.getAppMetrics().filter((m) => pids.has(m.pid)).map((m) => (m.memory.privateBytes ?? m.memory.workingSetSize) / 1024);
  const pageMB = Math.round(median(mem));
  console.log(`memory: ${mem.length} page processes, median ${pageMB} MB each`);

  // 3. Idle processor, everything Samara runs.
  app.getAppMetrics(); await wait(10_000);
  const idleCpu = Math.round(app.getAppMetrics().reduce((n, m) => n + (m.cpu?.percentCPUUsage ?? 0), 0) * 10) / 10;
  console.log(`idle: ${idleCpu}% of one core over 10 s`);

  // 4. Switching to an awake background tab.
  const times: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t = b.tabs[1 + (i % (b.tabs.length - 1))];
    if (b.cur() === t) b.activate(ids[0]);
    await wait(300);
    const s = performance.now();
    b.lastGesture.set(t.id, Date.now()); b.activate(t.id);
    await Promise.race([framed(t), wait(5000)]);
    times.push(Math.round(performance.now() - s));
    b.activate(ids[0]);
  }
  const switchMs = median(times);
  console.log(`switch: median ${switchMs} ms (${times.join(', ')})`);

  const m: Speed = { startMs, pageMB, idleCpu, switchMs };
  console.log('SPEED ' + JSON.stringify({ ...m, askedMs: asked, frameReady, frameLoaded, system: process.platform, machine: `${os.cpus()[0]?.model} x${os.cpus().length}` }));
  const budgets: Budgets = JSON.parse(readFileSync(path.join(HERE, 'speed-budgets.json'), 'utf8'));
  const over = budgets[process.platform] ? overBudget(m, budgets[process.platform]!) : [`no budget for ${process.platform}`];
  for (const o of over) console.log((process.env.RECORD === '1' ? 'OVER (recorded only) ' : 'FAIL  over budget: ') + o);
  if (!over.length) console.log('PASS  all four within budget');
  app.exit(over.length && process.env.RECORD !== '1' ? 1 : 0);
});
