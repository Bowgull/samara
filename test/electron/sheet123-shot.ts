// Sheet 123 (2026-11-25): pictures of the real bar growing, for checking by eye. The band and the list layer are
// separate views, so each is captured and laid over the other where Samara placed it. Rows come through Samara's real
// path (b.suggest stands in for his history). Run: npx electron test/electron/sheet123-shot.ts <out-prefix>
import { app, BrowserWindow, nativeImage } from 'electron';
import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.on('uncaughtException', (e) => console.log('HARNESS NOTE ' + (e as Error).message));
process.on('unhandledRejection', (e) => { console.log('HARNESS REJECTION ' + String((e as Error)?.message ?? e)); app.exit(2); });
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, 150_000).unref();
const HERE = path.dirname(fileURLToPath(import.meta.url));
app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 's123-ud-')));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.on('window-all-closed', () => {});
BrowserWindow.prototype.show = function (this: BrowserWindow) { this.setOpacity(0); this.showInactive(); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const out = process.argv[process.argv.length - 1];
  const W = Number(process.env.W) || 1440;
  const { servePages } = await import('../../src/pageserver.ts');
  const { SamaraBrowser } = await import('../../src/browser.ts');
  const { wireBrowser } = await import('../../src/browseripc.ts');
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const P = (f: string) => path.join(HERE, '..', '..', 'src', f);
  const b: any = new SamaraBrowser({ origin: pages.origin, preloadPath: P('samarapreload.cjs'), tabPreloadPath: P('tabpreload.cjs'), settingsPreloadPath: P('settingspreload.cjs'), thingsPreloadPath: P('thingspreload.cjs'), stateDir: mkdtempSync(path.join(os.tmpdir(), 's123-state-')) });
  wireBrowser(() => b);
  // a page of words for find (sheet 123 v13 mode D)
  const words = ['When I click the bar it grows and drops down, as one piece.', 'Let the wood grow with it, a drawer from under the band.',
    'The rows land after the drawer has opened.', 'How the bar growing covers the wood felt stuck on.', 'The bar grows, as one piece, and nothing else on the band moves.',
    'Close: the rows go first, then the drawer slides shut.', 'Its grain lines up with the band, so the drawer looks like it grew out of it.'];
  const site = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<title>Notes</title><body style="font:18px sans-serif;padding:120px 80px">${words.map((w) => `<p>${w}</p>`).join('')}`); });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  b.open(`http://127.0.0.1:${(site.address() as any).port}/`);
  for (let i = 0; i < 100 && !b.win; i++) await wait(150);
  b.win.setContentSize(W, 700);
  await wait(4000);
  const fw = b.win.webContents;
  // Sheet 123 v13 mode A: the empty bar goes through Samara's real rule, on made-up tabs and visits.
  const now = Date.now();
  const fake = { tabs: [
      { id: 1, url: 'https://claude.ai/', title: 'Claude', lastSeen: now },
      { id: 2, url: 'https://github.com/anthropics/claude-code', title: 'anthropics/claude-code', lastSeen: now - 1000 },
      { id: 3, url: 'https://www.youtube.com/', title: 'YouTube', lastSeen: now - 5000 },
      { id: 4, url: 'https://www.reddit.com/r/ClaudeAI/', title: 'r/ClaudeAI', lastSeen: now - 3000 },
      { id: 5, url: 'samara:hyrule', title: 'Hyrule', lastSeen: now, internal: true },
    ], active: 1, visits: { list: [
      { url: 'https://docs.claude.com/claude-code', title: 'Claude Code overview', at: now - 60_000 },
      { url: 'https://search.brave.com/search?q=claude+code+worktrees', title: 'claude code worktrees', at: now - 30_000 },
      { url: 'https://www.reddit.com/r/ClaudeAI/', title: 'r/ClaudeAI', at: now - 20_000 },
    ] }, iconOf: (u: string) => b.iconOf(u), marks: [], closed: [], ses: b.ses };
  const zero = (b.suggest as Function).call(fake, '');
  console.log('zero ' + JSON.stringify(zero.map((x: any) => x.kind + ':' + x.title)));
  b.suggest = (typed: string) => !typed ? zero : [
    { kind: 'search', title: typed, url: '' },
    { kind: 'history', title: 'Claude', url: 'https://claude.ai/' },
    { kind: 'history', title: 'Claude Code overview', url: 'https://docs.claude.com/claude-code' },
    { kind: 'history', title: 'anthropics/claude-code', url: 'https://github.com/anthropics/claude-code' },
    { kind: 'history', title: 'r/ClaudeAI', url: 'https://www.reddit.com/r/ClaudeAI/' },
  ];
  b.guesses = async () => [];
  // the band and the list layer, laid together as the screen shows them
  const shot = async (name: string) => {
    const frame = await fw.capturePage({ x: 0, y: 0, width: W, height: Number(process.env.H) || 520 });
    const v = b.pane.sugV, vis = v && !v.webContents.isDestroyed() && v.getVisible();
    const parts = [{ src: frame.toDataURL(), x: 0, y: 0 }];
    if (vis) { const bb = v.getBounds(); parts.push({ src: (await v.webContents.capturePage()).toDataURL(), x: bb.x, y: bb.y }); }
    const f = b.pane.floatV;
    if (f && !f.webContents.isDestroyed() && f.getVisible()) { const bb = f.getBounds(); parts.push({ src: (await f.webContents.capturePage()).toDataURL(), x: bb.x, y: bb.y }); }
    const comp = new BrowserWindow({ show: false, width: W, height: Number(process.env.H) || 520, webPreferences: { offscreen: true } });
    await comp.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:#888">${parts.map((p) => `<img src="${p.src}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:auto">`).join('')}</body>`));
    await wait(400);
    writeFileSync(`${out}-${name}.png`, (await comp.webContents.capturePage({ x: 0, y: 0, width: W, height: Number(process.env.H) || 520 })).toPNG());
    comp.destroy();
    console.log('shot ' + name + (vis ? ' ' + JSON.stringify(v.getBounds()) : ' (no layer)'));
  };
  await shot('closed');
  await fw.executeJavaScript(`document.getElementById('slot').click(); 1`); await wait(300); fw.focus();
  await wait(1200);
  await shot('empty');
  for (const k of 'clau') { fw.sendInputEvent({ type: 'char', keyCode: k }); await wait(90); }
  await wait(1200);
  console.log('state ' + JSON.stringify({ last: Boolean(b.pane.sugLast), v: Boolean(b.pane.sugV), vis: b.pane.sugV?.getVisible?.() }));
  console.log('frame ' + await fw.executeJavaScript(`JSON.stringify({ cls: document.getElementById('slot').className, editHidden: document.getElementById('edit').hidden, active: document.activeElement?.id })`));
  await shot('open');
  await fw.executeJavaScript(`JSON.stringify({ value: document.getElementById('edit').value, sel: [document.getElementById('edit').selectionStart, document.getElementById('edit').selectionEnd] })`).then((s: string) => console.log('bar ' + s));
  fw.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); fw.sendInputEvent({ type: 'keyUp', keyCode: 'Down' }); await wait(120);
  fw.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); fw.sendInputEvent({ type: 'keyUp', keyCode: 'Down' }); await wait(500);
  await shot('arrow');
  fw.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); fw.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await wait(60);
  fw.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); fw.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await wait(160);
  await shot('closing');
  await wait(600);
  await shot('shut');
  // Sheet 123 v13 mode C: the shield's drawer
  await fw.executeJavaScript(`document.getElementById('lock').click(); 1`); await wait(1000);
  const fv = b.pane.floatV;
  console.log('float ' + JSON.stringify({ has: Boolean(fv), vis: fv?.getVisible?.(), floated: await fw.executeJavaScript(`document.documentElement.classList.contains('floated')`) }));
  if (fv) console.log('floatdoc ' + JSON.stringify(fv.getBounds()) + ' ' + await fv.webContents.executeJavaScript(`JSON.stringify({ hidden: document.getElementById('sitepanel').hidden, r: document.getElementById('sitepanel').getBoundingClientRect(), op: getComputedStyle(document.documentElement).opacity, kids: [...document.getElementById('sitepanel').children].map((k) => k.className + ':' + Math.round(k.getBoundingClientRect().height) + ':' + getComputedStyle(k).display), slot: document.getElementById('slot').getBoundingClientRect(), band: document.getElementById('band').getBoundingClientRect(), parent: document.getElementById('sitepanel').offsetParent?.id, style: document.getElementById('sitepanel').getAttribute('style'), cs: (() => { const c = getComputedStyle(document.getElementById('sitepanel')); return [c.left, c.height, c.transform, c.display, c.position]; })() })`));
  await shot('shield');
  // closing: the rows go, the drawer slides shut, and only then is the panel hidden and the layer put away
  if (fv) {
    const sp = () => fv.webContents.executeJavaScript(`(() => { const p = document.getElementById('sitepanel'); return p.hidden ? 'hidden' : p.className; })()`);
    await fw.executeJavaScript(`document.getElementById('lock').click(); 1`);
    await wait(150); const mid = await sp(); await wait(500); const end = await sp();
    console.log('shieldclose ' + JSON.stringify({ mid, end, layer: fv.getVisible() }));
  }
  // The float layer is see-through and does not capture in this hidden window, so the same panel (same page, CSS and
  // placing code) is drawn in the band's own page for the picture.
  await fw.executeJavaScript(`(() => { const $ = (i) => document.getElementById(i); document.documentElement.classList.remove('floated');
    const p = $('sitepanel'), band = $('band'), b = band.getBoundingClientRect(), s = $('slot').getBoundingClientRect();
    const left = Math.round(s.left - b.left - 16), top = Math.round(s.bottom - b.top), woodTop = Math.max(0, Math.round(b.bottom - 4 - s.bottom));
    const bgY = parseFloat(getComputedStyle(band).backgroundPositionY) || 0;
    p.classList.add('grown'); p.style.left = left + 'px'; p.style.top = top + 'px'; p.style.width = Math.round(s.width + 32) + 'px';
    p.style.setProperty('--woodTop', woodTop + 'px'); p.style.setProperty('--woodPos', (-left) + 'px ' + (bgY - (top + woodTop)) + 'px');
    p.hidden = false; $('slot').classList.add('open'); $('lock').classList.add('open'); return 1; })()`);
  await wait(900);
  // the tab's page sits above the band's page; out of the way for this one picture
  const pv = b.tabs.find((t: { id: number }) => t.id === b.active)?.view; pv?.setVisible(false); await wait(200);
  writeFileSync(`${out}-shieldband.png`, (await fw.capturePage({ x: 0, y: 0, width: W, height: Number(process.env.H) || 520 })).toPNG());
  pv?.setVisible(true);
  await fw.executeJavaScript(`(() => { document.getElementById('sitepanel').hidden = true; document.getElementById('slot').classList.remove('open'); document.getElementById('lock').classList.remove('open'); document.documentElement.classList.add('floated'); return 1; })()`);
  // Sheet 123 v13 mode D: find, each match with the words around it
  fw.send('browser:findopen'); await wait(300); fw.focus();
  for (const k of 'grow') { fw.sendInputEvent({ type: 'char', keyCode: k }); await wait(90); }
  await wait(1200);
  await shot('find');
  fw.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); fw.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }); await wait(700);
  await shot('find-next');
  console.log('findbar ' + await fw.executeJavaScript(`document.getElementById('findn').textContent`));
  // a match clicked in the drawer: find goes there and stays open
  b.suggestAct('pick', 3); await wait(600);
  console.log('findjump ' + await fw.executeJavaScript(`JSON.stringify({ n: document.getElementById('findn').textContent, findOpen: !document.getElementById('find').hidden })`));
  fw.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); fw.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await wait(700);
  console.log('findclosed ' + JSON.stringify({ layer: b.pane.sugV?.getVisible?.() }));
  // Sheet 123 v13 mode E: two logins for this site (made up), in the drawer; Down, then Esc
  fw.send('browser:vault', { mode: 'pick', host: 'example.com', logins: [{ id: 'a', username: 'you@example.com', name: 'Personal' }, { id: 'b', username: 'you@example.org', name: 'Work' }] });
  await wait(900); fw.focus();
  await shot('vault');
  fw.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); fw.sendInputEvent({ type: 'keyUp', keyCode: 'Down' }); await wait(400);
  await shot('vault-down');
  fw.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); fw.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await wait(700);
  console.log('vaultclosed ' + JSON.stringify({ layer: b.pane.sugV?.getVisible?.() }));
  app.exit(0);
});
