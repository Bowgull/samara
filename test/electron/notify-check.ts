// Notifications (2026-11-25, his ask: Gmail and Discord should notify), in the real browser off screen: a secure site
// that asks gets one Allow / Block ask; his answer is kept (no second ask, after a reload too); Block is kept the same
// way; a frame from another site is refused without an ask; the shield's rule changes the answer; and a "click" a page
// makes up on its own notification never brings the tab to the front.
// Run: npx electron test/electron/notify-check.ts
import { app, BrowserWindow } from 'electron';
import https from 'node:https';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testCert } from './testcert.ts';
process.on('unhandledRejection', (e) => { console.log('HARNESS REJECTION ' + String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')); app.exit(2); });
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, 120_000).unref();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 47977;
app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'ntf-ud-')));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP mail.example 127.0.0.1, MAP chat.example 127.0.0.1, MAP ads.other 127.0.0.1');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('window-all-closed', () => {});
BrowserWindow.prototype.show = function (this: BrowserWindow) { this.setPosition(-6000, 100); this.showInactive(); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (w: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${w}${d ? ' (' + d + ')' : ''}`); if (!ok) bad++; };
const PAGES: Record<string, string> = {
  '/': '<!doctype html><title>Inbox</title><p>Inbox</p>',
  '/framed': `<!doctype html><title>Framed</title><iframe src="https://ads.other:${PORT}/" style="width:300px;height:200px"></iframe>`,
};

app.whenReady().then(async () => {
  const CERT = process.env.TEST_CERT_DIR || testCert();
  https.createServer({ key: readFileSync(path.join(CERT, 'test-key.pem')), cert: readFileSync(path.join(CERT, 'test-cert.pem')) }, (q, r) => {
    const p = (q.url ?? '/').split('?')[0]!;
    r.writeHead(PAGES[p] ? 200 : 404, { 'Content-Type': 'text/html' }).end(PAGES[p] ?? 'no');
  }).listen(PORT, '127.0.0.1');
  const { servePages } = await import('../../src/pageserver.ts');
  const { SamaraBrowser } = await import('../../src/browser.ts');
  const { wireBrowser } = await import('../../src/browseripc.ts');
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const P = (f: string) => path.join(HERE, '..', '..', 'src', f);
  const b: any = new SamaraBrowser({ origin: pages.origin, stateDir: mkdtempSync(path.join(os.tmpdir(), 'ntf-s-')), preloadPath: P('samarapreload.cjs'), tabPreloadPath: P('tabpreload.cjs'), settingsPreloadPath: P('settingspreload.cjs'), thingsPreloadPath: P('thingspreload.cjs') });
  wireBrowser(() => b);
  const asks = () => b.notices.all.filter((n: any) => n.title === 'Show notifications?');
  const open = async (url: string) => {
    b.open(url);
    for (let i = 0; i < 60 && !(b.cur()?.view && b.cur().url.startsWith(url.slice(0, 20))); i++) await wait(150);
    const wc = b.cur().view.webContents as Electron.WebContents;
    for (let i = 0; i < 40 && wc.isLoading(); i++) await wait(150);
    await wait(300);
    return wc;
  };
  // requestPermission needs his click in the page, as a real site's button would.
  const request = async (wc: Electron.WebContents) => {
    const click = () => { for (const type of ['mouseDown', 'mouseUp'] as const) wc.sendInputEvent({ type, x: 20, y: 20, button: 'left', clickCount: 1 }); };
    wc.focus(); click(); await wait(300);             // the first click into a fresh window only focuses it
    await wc.executeJavaScript(`window.__ans = 'waiting'; document.body.onclick = () => Notification.requestPermission().then((a) => { window.__ans = a; }); 1`);
    click();
    await wait(700);
  };
  const answer = async (wc: Electron.WebContents) => { for (let i = 0; i < 20; i++) { const a = await wc.executeJavaScript('window.__ans'); if (a !== 'waiting') return a; await wait(150); } return 'waiting'; };

  // 1 · the first ask: one Allow / Block card; Allow is kept
  const mail = await open(`https://mail.example:${PORT}/`);
  await request(mail);
  check('a site that asks gets one ask', asks().length === 1, String(asks().length));
  await request(mail);
  check('...asking again while it is up adds no second ask', asks().length === 1, String(asks().length));
  b.notices.answer(asks()[0].id, 'yes'); await wait(300);
  check('Allow: the page hears "granted"', (await answer(mail)) === 'granted');
  check('...and Notification.permission says so', await mail.executeJavaScript('Notification.permission') === 'granted');
  check('...and it is kept as his rule', b.rules.notify('mail.example') === 'allow');
  mail.reload(); await wait(1500);
  check('after a reload it is still granted, with no ask', await mail.executeJavaScript('Notification.permission') === 'granted' && asks().length === 0);

  // 2 · Block is kept too
  const chat = await open(`https://chat.example:${PORT}/`);
  await request(chat);
  b.notices.answer(asks()[0]?.id, 'no'); await wait(300);
  check('Block: the page hears "denied" and it is kept', (await answer(chat)) === 'denied' && b.rules.notify('chat.example') === 'block');
  await request(chat);
  check('...and it never asks again', asks().length === 0 && (await answer(chat)) === 'denied');

  // 3 · a frame from another site inside a page is refused without an ask
  const framed = await open(`https://mail.example:${PORT}/framed`);
  const fr = framed.mainFrame.framesInSubtree.find((f) => f.url.includes('ads.other'));
  const fa = await fr?.executeJavaScript('Notification.requestPermission()').catch(() => 'error');
  check('a frame from another site is refused, with no ask', fa === 'denied' && asks().length === 0, String(fa));

  // 4 · the shield's rule changes it: Block on mail.example
  b.setSiteRule('notify', 'block', 'mail.example');
  check('the shield turns it off for the site', b.siteState(`https://mail.example:${PORT}/`)?.notify === 'block');

  // 5 · a page's own made-up click on its notification never brings it to the front
  b.setSiteRule('notify', 'allow', 'mail.example');
  let fronted = 0; const real = b.notifyClick.bind(b); b.notifyClick = (s: unknown) => { fronted++; return real(s); };
  await mail.executeJavaScript(`(() => { const n = new Notification('Hi'); n.dispatchEvent(new Event('click')); return 1; })()`).catch(() => 0);
  await wait(400);
  check('a click the page makes up is ignored', fronted === 0, String(fronted));
  check('Notification still looks like the real one to the page', await mail.executeJavaScript(`Notification.name === 'Notification' && typeof Notification.requestPermission === 'function'`));

  console.log(bad ? `${bad} FAILED` : 'ALL PASS'); app.exit(bad ? 1 : 0);
});
