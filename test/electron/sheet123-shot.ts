// Sheet 123 (2026-11-25): pictures of the real bar growing, for checking by eye. The band and the list layer are
// separate views, so each is captured and laid over the other where Samara placed it. Rows come through Samara's real
// path (b.suggest stands in for his history). Run: npx electron test/electron/sheet123-shot.ts <out-prefix>
import { app, BrowserWindow, nativeImage } from 'electron';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
  b.open('about:blank');
  for (let i = 0; i < 100 && !b.win; i++) await wait(150);
  b.win.setContentSize(W, 700);
  await wait(4000);
  const fw = b.win.webContents;
  b.suggest = (typed: string) => typed ? [
    { kind: 'search', title: typed, url: '' },
    { kind: 'history', title: 'Claude', url: 'https://claude.ai/' },
    { kind: 'history', title: 'Claude Code overview', url: 'https://docs.claude.com/claude-code' },
    { kind: 'history', title: 'anthropics/claude-code', url: 'https://github.com/anthropics/claude-code' },
    { kind: 'history', title: 'r/ClaudeAI', url: 'https://www.reddit.com/r/ClaudeAI/' },
  ] : [];
  b.guesses = async () => [];
  // the band and the list layer, laid together as the screen shows them
  const shot = async (name: string) => {
    const frame = await fw.capturePage({ x: 0, y: 0, width: W, height: 520 });
    const v = b.pane.sugV, vis = v && !v.webContents.isDestroyed() && v.getVisible();
    const parts = [{ src: frame.toDataURL(), x: 0, y: 0 }];
    if (vis) { const bb = v.getBounds(); parts.push({ src: (await v.webContents.capturePage()).toDataURL(), x: bb.x, y: bb.y }); }
    const comp = new BrowserWindow({ show: false, width: W, height: 520, webPreferences: { offscreen: true } });
    await comp.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:#888">${parts.map((p) => `<img src="${p.src}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:auto">`).join('')}</body>`));
    await wait(400);
    writeFileSync(`${out}-${name}.png`, (await comp.webContents.capturePage({ x: 0, y: 0, width: W, height: 520 })).toPNG());
    comp.destroy();
    console.log('shot ' + name + (vis ? ' ' + JSON.stringify(v.getBounds()) : ' (no layer)'));
  };
  await shot('closed');
  await fw.executeJavaScript(`document.getElementById('slot').click(); 1`); await wait(300); fw.focus();
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
  app.exit(0);
});
