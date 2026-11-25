// 2026-10-25 (his report: logging in to Stremio did not offer to save the login): a login page whose button is not a real
// button and has no form (as Stremio's) is still caught when his click sends it, and only once the login worked.
// shop.example is mapped here. Run: npx electron test/electron/login-catch-check.ts
import { app, BrowserWindow } from 'electron';
import https from 'node:https';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testCert } from './testcert.ts';
process.on('unhandledRejection', (e) => { console.log('HARNESS REJECTION ' + String((e as Error)?.message ?? e)); app.exit(2); });
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, 90_000).unref();
app.commandLine.appendSwitch('host-resolver-rules', 'MAP shop.example 127.0.0.1');
// Off screen, Windows counts the window as hidden behind others and stops its pages taking input (CI 2026-11-25: the
// page saw no clicks at all). As in autofill-check: keep its pages running as if in front.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const HERE = path.dirname(fileURLToPath(import.meta.url));
app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'lc-ud-')));
app.on('window-all-closed', () => {});
BrowserWindow.prototype.show = function (this: BrowserWindow) { this.setPosition(-6000, 100); this.showInactive(); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (w: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${w}${d ? ' (' + d + ')' : ''}`); if (!ok) bad++; };
// A login drawn the Stremio way: no form, a <div> for a button; a right password replaces the boxes, a wrong one does not.
const PAGE = `<!doctype html><body style="margin:0;font:16px sans-serif">
<div id="box" style="padding:20px"><input id="u" type="email" name="email" style="display:block;width:300px;height:30px">
<input id="p" type="password" style="display:block;width:300px;height:30px;margin-top:10px">
<div id="go" style="margin-top:10px;width:120px;height:40px;background:#7b5bf5;color:#fff">Log in</div></div>
<script>document.getElementById('go').onclick = () => { if (document.getElementById('p').value === 'right') document.getElementById('box').innerHTML = '<p>Welcome</p>'; };</script></body>`;
app.whenReady().then(async () => {
  const CERT = process.env.TEST_CERT_DIR || testCert();
  const srv = https.createServer({ key: readFileSync(path.join(CERT, 'test-key.pem')), cert: readFileSync(path.join(CERT, 'test-cert.pem')) }, (q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(PAGE); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as any).port;
  const { servePages } = await import('../../src/pageserver.ts');
  const { SamaraBrowser } = await import('../../src/browser.ts');
  const { wireBrowser } = await import('../../src/browseripc.ts');
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const P = (f: string) => path.join(HERE, '..', '..', 'src', f);
  const b: any = new SamaraBrowser({ origin: pages.origin, preloadPath: P('samarapreload.cjs'), tabPreloadPath: P('tabpreload.cjs'), settingsPreloadPath: P('settingspreload.cjs'), thingsPreloadPath: P('thingspreload.cjs'), stateDir: mkdtempSync(path.join(os.tmpdir(), 'lc-s-')) });
  wireBrowser(() => b);
  b.ses.setCertificateVerifyProc((_r: unknown, cb: (n: number) => void) => cb(0));
  let offered = 0; const band = b.afBand.bind(b); b.afBand = (...a: any[]) => { if (b.afSave) offered++; return band(...a); };
  // What happened, for a failure on a machine we cannot watch: the clicks the page saw, and the logins Samara heard.
  let heard = 0; const cred = b.afCred.bind(b); b.afCred = (...a: any[]) => { heard++; return cred(...a); };
  const tryLogin = async (pw: string) => {
    b.open(`https://shop.example:${port}/login`);
    for (let i = 0; i < 60 && !b.cur()?.view; i++) await wait(150);
    const wc = b.cur().view.webContents;
    for (let i = 0; i < 40 && !(await wc.executeJavaScript(`!!document.getElementById('go')`).catch(() => false)); i++) await wait(200);
    await wc.executeJavaScript(`document.getElementById('u').value = 'me@example.com'; document.getElementById('p').value = ${JSON.stringify(pw)}; 1`);
    b.win.focus(); wc.focus(); await wait(200);
    // A move first: Windows' Chromium places a click by the last mouse position it saw.
    const c = (x: number, y: number) => { wc.sendInputEvent({ type: 'mouseMove', x, y }); wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); };
    c(500, 400); await wait(400);           // the first click into a fresh window only focuses it
    const go = await wc.executeJavaScript(`(() => { const r = document.getElementById('go').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    await wc.executeJavaScript(`window.__clicks = []; addEventListener('click', (e) => __clicks.push([e.isTrusted, e.target.id || e.target.tagName]), true); 1`);
    c(go.x, go.y);
    // Offered 2.5 s after the click once the page has moved on; a slow runner gets up to 10 s.
    for (let i = 0; i < 40 && !(pw === 'right' && offered > 0); i++) await wait(250);
    await wait(pw === 'right' ? 200 : 3500);
  };
  await tryLogin('wrong');
  check('a wrong password is never offered', offered === 0 && !b.afSave, `offered ${offered}`);
  await tryLogin('right');
  const seen = await b.cur().view.webContents.executeJavaScript('JSON.stringify(window.__clicks ?? null)').catch(() => '?');
  console.log(`HARNESS NOTE clicks the page saw ${seen}; logins heard ${heard}; focused ${b.cur().view.webContents.isFocused()}`);
  check('a login with no real button and no form is caught once it worked', offered > 0 && b.afSave?.user === 'me@example.com' && b.afSave?.pass === 'right', JSON.stringify(b.afSave && { user: b.afSave.user, host: b.afSave.host }));
  console.log(bad ? `${bad} FAILED` : 'ALL PASS');
  srv.close(); app.exit(bad ? 1 : 0);
});
