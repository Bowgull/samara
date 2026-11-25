// Autofill, sheet 77 (2026-10-23), in the real browser off screen, against a made-up shop over https and a stand-in
// Bitwarden (test/fixtures/fake-bw.mjs): the light shows by an email box, Tab fills it, the arrow takes the next email,
// one click fills a whole form, the PIN opens Bitwarden in the address bar without the page seeing the digits, five
// wrong PINs wipe the seal, and a new login is offered and kept after he says Save.
// QA fixes (2026-11-25): a changed password updates his login (F3), a sign-in left hidden in the page still offers to keep
// the login (F6), and the key fills a login inside a frame (F4). Parts that need the computer's own lock (the PIN) say
// SKIP where there is none (Linux with no keyring, the CI runner).
// Run: npx electron test/electron/autofill-check.ts
import { app, BrowserWindow, safeStorage } from 'electron';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.on('uncaughtException', (e) => console.log('HARNESS NOTE ' + (e as Error).message));
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, Number(process.env.TMO) || 150_000).unref();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 47993, SHOP = `https://shop.example:${PORT}`;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'af-'));
process.env.SAMARA_TEST_BW = path.join(HERE, '..', 'fixtures', 'fake-bw.mjs');
process.env.FAKE_BW_DIR = tmp;
writeFileSync(path.join(tmp, 'items.json'), JSON.stringify([
  { id: '11111111-1111-1111-1111-111111111111', type: 1, name: 'Northwind', login: { username: 'alex@example.com', password: 'opensesame', totp: 'otpauth://keep', uris: [{ uri: 'https://shop.example' }] } },
  { id: '44444444-4444-4444-4444-444444444444', type: 1, name: 'Auth', login: { username: 'framed@example.com', password: 'inframe', uris: [{ uri: 'https://auth.example' }] } }]));
app.setPath('userData', path.join(tmp, 'ud'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP shop.example 127.0.0.1, MAP auth.example 127.0.0.1');
app.commandLine.appendSwitch('ignore-certificate-errors');
// Off screen and never focused (the test must not take his keyboard): keep its pages running at full speed.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('window-all-closed', () => {});
BrowserWindow.prototype.show = function (this: BrowserWindow) { this.setPosition(-6000, 100); this.showInactive(); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let all = true;
const ok = (name: string, pass: boolean, note = '') => { console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${note ? ' (' + note + ')' : ''}`); all = pass && all; return pass; };
const PAGES: Record<string, string> = {
  '/signin': `<!doctype html><title>Sign in</title><form action="/account" method="get" style="margin:40px">
    <label>Email <input id="email" type="email" autocomplete="username"></label><br><label>Password <input id="pw" type="password" autocomplete="current-password"></label><br><button>Continue</button></form>`,
  '/account': `<!doctype html><title>Account</title><p>Welcome back.</p>`,
  // F6: signed in, but the page keeps its sign-in box (hidden) in the page.
  '/account2': `<!doctype html><title>Account</title><p>Welcome back.</p><div style="display:none"><input type="password"></div>`,
  '/hidden': `<!doctype html><title>Join</title><form action="/account2" method="get" style="margin:40px"><input id="u" autocomplete="username"><input id="p" type="password"><button id="go" style="width:120px;height:40px">Join</button></form>`,
  // F4: the sign-in lives in a frame from auth.example.
  '/framed': `<!doctype html><title>Framed</title><p>Sign in below</p><iframe id="f" src="https://auth.example:${PORT}/inner" style="width:500px;height:240px"></iframe>`,
  '/framedhidden': `<!doctype html><title>Hidden</title><p>Nothing to see</p><iframe src="https://auth.example:${PORT}/inner" style="width:500px;height:240px;opacity:0"></iframe><iframe src="https://auth.example:${PORT}/inner" style="position:absolute;left:-3000px;width:500px;height:240px"></iframe>`,
  '/inner': `<!doctype html><title>Inner</title><form style="margin:10px"><input id="email" type="email" autocomplete="username"><input id="pw" type="password"></form>`,
  '/ship': `<!doctype html><title>Shipping</title><form style="margin:40px"><input id="name" autocomplete="name"><input id="mail" type="email"><input id="tel" type="tel">
    <input id="street" autocomplete="address-line1"><input id="city" autocomplete="address-level2"><input id="postal" autocomplete="postal-code"></form>`,
  '/new': `<!doctype html><title>New</title><form action="/account" method="get" style="margin:40px"><input id="u" autocomplete="username"><input id="p" type="password"><button id="go" style="width:120px;height:40px">Join</button></form>`,
};

app.whenReady().then(async () => {
  console.log('stage: cert');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem'), '-days', '1', '-subj', '/CN=shop.example'], { stdio: 'ignore' });
  https.createServer({ key: readFileSync(path.join(tmp, 'k.pem')), cert: readFileSync(path.join(tmp, 'c.pem')) }, (q, r) => {
    const p = (q.url ?? '/').split('?')[0]!;
    r.writeHead(PAGES[p] ? 200 : 404, { 'Content-Type': 'text/html' }).end(PAGES[p] ?? 'no');
  }).listen(PORT, '127.0.0.1');
  console.log('stage: server');
  const { servePages } = await import('../../src/pageserver.ts');
  const { SamaraBrowser } = await import('../../src/browser.ts');
  const { wireBrowser } = await import('../../src/browseripc.ts');
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const stateDir = path.join(tmp, 'state');
  const b: any = new SamaraBrowser({ origin: pages.origin, stateDir, preloadPath: path.join(HERE, '..', '..', 'src', 'samarapreload.cjs'),
    tabPreloadPath: path.join(HERE, '..', '..', 'src', 'tabpreload.cjs'), settingsPreloadPath: path.join(HERE, '..', '..', 'src', 'settingspreload.cjs'), thingsPreloadPath: path.join(HERE, '..', '..', 'src', 'thingspreload.cjs') });
  wireBrowser(() => b);
  console.log('stage: browser made');
  b.setSetting('afDetails', { name: 'Alex Example', emails: ['alex@example.com', 'alex.work@example.com'], phone: '555-0142', street: '12 Harbour St', city: 'Halifax', postal: 'B3H 1A1' });
  const shopTab = () => b.tabs.find((t: any) => t.view && !t.internal && !t.view.webContents.isDestroyed());
  const tab = () => shopTab().view.webContents as Electron.WebContents;
  const go = async (p: string) => { await Promise.race([tab().loadURL(SHOP + p).catch(() => {}), wait(6000)]); await wait(900); };
  const val = (sel: string) => tab().executeJavaScript(`document.querySelector(${JSON.stringify(sel)}).value`) as Promise<string>;
  const focus = async (sel: string) => { tab().focus(); await tab().executeJavaScript(`document.querySelector(${JSON.stringify(sel)}).focus(); 1`); await wait(700); };
  // Keys go straight to Samara's own key check for the tab (what before-input-event calls), so the test never takes the
  // keyboard from his other apps. Not taken there: typed into the page, as the page would get it.
  const KEYS: Record<string, string> = { Down: 'ArrowDown', Up: 'ArrowUp' };
  const key = async (k: string) => {
    const input = { type: 'keyDown', key: KEYS[k] ?? k, code: '', isAutoRepeat: false, shift: false, control: false, alt: false, meta: false } as unknown as Electron.Input;
    if (!b.afKey(shopTab(), input)) await tab().executeJavaScript(`(() => { const e = document.activeElement; if (e && 'value' in e && ${JSON.stringify(KEYS[k] ?? k)}.length === 1) e.value += ${JSON.stringify(k)}; return 1; })()`);
    await wait(250);
  };
  const lightOn = () => Boolean(b.pane.lightV?.getVisible());
  // His own click (a page's scripted click is ignored on purpose: security check 2026-10-24, finding 4).
  const click = async (sel: string) => {
    const r = await tab().executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    tab().focus();
    for (const type of ['mouseDown', 'mouseUp'] as const) tab().sendInputEvent({ type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
  };
  const fill = (u: string, p: string) => tab().executeJavaScript(`document.querySelector('#u, #email').value = ${JSON.stringify(u)}; document.querySelector('#p, #pw').value = ${JSON.stringify(p)}; 1`);
  const lockHere = safeStorage.isEncryptionAvailable();
  const skip = (name: string) => console.log(`SKIP ${name} (no lock of its own on this computer)`);
  // Waits for what it is waiting for (a busy Mac is slow), up to a limit.
  const until = async (f: () => unknown, ms = 8000) => { for (let t = 0; t < ms; t += 150) { if (await f()) return true; await wait(150); } return false; };

  console.log('stage: open');
  b.open(SHOP + '/signin');
  // A slow Mac can take a while to make the first window: wait for the tab, not a fixed time.
  for (let i = 0; i < 100 && !shopTab(); i++) await wait(300);
  await wait(1500);
  console.log('stage: opened ' + JSON.stringify(b.tabs.map((t: any) => ({ id: t.id, url: t.url, view: !!t.view, blocked: t.blocked, internal: t.internal }))) + ' panes ' + b.panes.length);
  // Box focus needs the window's focus (a page that is not focused gets no focus events): it is taken for this test's
  // ~40 seconds, off screen.
  b.win.focus(); b.win.webContents.focus();

  // 1 · the light by an email box, Tab fills, the arrow takes the next email (no login saved yet: Bitwarden is locked
  //     and there is no PIN, so only his details are offered for the email box)
  await go('/ship');
  console.log('stage: ship');
  await focus('#mail');
  console.log('stage: focused ' + JSON.stringify({ af: b.af && { kind: b.af.kind, offer: b.af.offer, empty: b.af.empty }, light: lightOn(), active: b.active, cur: b.cur()?.id, url: tab().getURL() }));
  ok('the light shows beside an email box', await until(lightOn, 3000) || (await focus('#mail'), await until(lightOn, 3000)));
  const lb = b.pane.lightV?.getBounds(), fb = await tab().executeJavaScript(`(() => { const r = document.querySelector('#mail').getBoundingClientRect(); return { x: r.right, y: r.top + r.height / 2 }; })()`);
  ok('...right beside the box', lb && Math.abs(lb.x - (shopTab().view.getBounds().x + fb.x)) <= 6, JSON.stringify({ lb, fb }));
  await key('Down'); await key('Tab');
  ok('the arrow then Tab fills the second email', (await val('#mail')) === 'alex.work@example.com', await val('#mail'));
  // Security check 2026-10-24 (finding 2, autofill-attacks-check.ts): Tab fills only the box he is in; the rest waits for his click.
  ok('...and only that box (Tab never fills the rest of the form)', (await val('#name')) === '' && (await val('#postal')) === '', `${await val('#name')} / ${await val('#postal')}`);
  ok('the light goes once it has filled', await until(() => !lightOn(), 3000));

  // 2 · a click on the light fills the whole form
  await go('/ship');
  await focus('#name');
  ok('the light shows by the name box', lightOn());
  await b.afPick(); await wait(400);
  ok('one click fills name, phone, street, city', (await val('#name')) === 'Alex Example' && (await val('#tel')) === '555-0142' && (await val('#street')) === '12 Harbour St' && (await val('#city')) === 'Halifax', [await val('#name'), await val('#tel'), await val('#street'), await val('#city')].join(' | '));
  ok('...and the main email', (await val('#mail')) === 'alex@example.com');

  // 3 · the PIN: open Bitwarden once with the master password, set a PIN, lock (it only forgets the session here)
  ok('the master password opens the stand-in Bitwarden', await b.vault.unlock('correct horse'));
  await b.learnSites();
  if (lockHere) {
  await b.afSetPin({ pin: '1234', again: '1234' }); await wait(300);
  ok('the PIN is sealed', b.pinSeal.has());
  b.vault.lock();
  ok('locking only forgets the session (the PIN can open it again)', b.vault.current() === null && JSON.parse(readFileSync(path.join(tmp, 'state.json'), 'utf8')).unlocked === true);
  await go('/signin');
  await focus('#pw');
  ok('a password box on a site with a login: the bar asks for the PIN', b.afPin !== null);
  await key('1'); await key('2'); await key('3');
  ok('the page never sees the PIN', (await val('#pw')) === '' && (await val('#email')) === '', `"${await val('#pw')}"`);
  await key('4'); await until(() => b.vault.current() !== null); await until(async () => (await val('#pw')) !== '');
  ok('the fourth digit opens Bitwarden', b.vault.current() !== null);
  ok('...and the light brings the login', (await val('#email')) === 'alex@example.com' && (await val('#pw')) === 'opensesame', `${await val('#email')} / ${(await val('#pw')).length} chars`);

  // 4 · five wrong PINs: the seal is gone, the master password again
  b.vault.lock();
  await go('/signin');
  await focus('#pw');
  for (let i = 0; i < 5; i++) { for (const d of '9999') await key(d); await until(() => !b.afPin?.checking, 4000); await wait(200); }
  ok('five wrong PINs wipe the seal', !b.pinSeal.has() && !existsSync(path.join(stateDir, 'autofill-pin.json')));
  ok('...and lock the tool itself', JSON.parse(readFileSync(path.join(tmp, 'state.json'), 'utf8')).unlocked === false);
  } else for (const n of ['the PIN is sealed', 'the PIN opens Bitwarden and the light brings the login', 'five wrong PINs wipe the seal']) skip(n);

  // 5 · a new login: offered after the page moves on; Save keeps exactly what he saw
  await b.vault.unlock('correct horse');
  await go('/new');
  await fill('newbie', 'hunter2!'); await click('#go');
  await until(() => b.afBandMode === 'save', 15000);
  ok('a new login waits behind the key', b.afSave !== null && b.afBandMode === 'save', JSON.stringify({ host: b.afSave?.host, user: b.afSave?.user }));
  await b.afSaveGo({ site: 'shop.example', user: 'newbie', pass: 'hunter2!' }); await wait(800);
  const made = existsSync(path.join(tmp, 'created.log')) ? readFileSync(path.join(tmp, 'created.log'), 'utf8') : '';
  ok('Save keeps it in Bitwarden, as he saw it', /"username":"newbie"/.test(made) && /"password":"hunter2!"/.test(made) && /shop\.example/.test(made));
  ok('the secret went in by stdin, never the command line', !made.includes('--') && b.afSave === null);


  // 6 · F3: a changed password updates the login he has (no second login), and nothing else in it changes
  const createdBefore = readFileSync(path.join(tmp, 'created.log'), 'utf8');
  await go('/signin');
  await fill('alex@example.com', 'newpass-1'); await click('button');
  await until(() => b.afBandMode === 'save', 15000);
  ok('a changed password is offered as an update', b.afSave?.update === '11111111-1111-1111-1111-111111111111', JSON.stringify(b.afSave && { user: b.afSave.user, update: b.afSave.update }));
  await b.afSaveGo({ site: 'shop.example', user: 'alex@example.com', pass: 'newpass-1' }); await wait(800);
  const edited = existsSync(path.join(tmp, 'edited.log')) ? readFileSync(path.join(tmp, 'edited.log'), 'utf8') : '';
  ok('Update changes the password in his login', /^11111111-1111-1111-1111-111111111111 .*"password":"newpass-1"/.test(edited), edited.slice(0, 80));
  ok('...keeps the rest of it (name, two-step code)', /"name":"Northwind"/.test(edited) && /"totp":"otpauth:\/\/keep"/.test(edited));
  ok('...and never makes a second login', readFileSync(path.join(tmp, 'created.log'), 'utf8') === createdBefore);

  // 7 · F6: signed in, the page keeps a hidden password box: the login is still offered
  await go('/hidden');
  await fill('hid', 'hidden-ok'); await click('#go');
  await until(() => b.afBandMode === 'save', 15000);
  ok('a sign-in box left hidden in the page does not stop the offer', b.afSave?.user === 'hid', JSON.stringify(b.afSave && { user: b.afSave.user }));
  b.afSave = null; b.afBand();

  // 8 · F4: the key fills a login inside a frame, for the frame's own site
  await go('/framed'); await wait(800);
  const frame = () => tab().mainFrame.framesInSubtree.find((f) => f.url.includes('auth.example'));
  await b.vaultKey(); await wait(1200);
  const fv = (await frame()?.executeJavaScript(`[document.querySelector('#email').value, document.querySelector('#pw').value]`).catch(() => null)) as string[] | null | undefined;
  ok('the key fills the login inside a frame, for that frame\'s site', fv?.[0] === 'framed@example.com' && fv?.[1] === 'inframe', JSON.stringify(fv));
  ok('...and nothing of it lands in the page around it', await tab().executeJavaScript(`document.querySelectorAll('input').length`) === 0);

  // Codex on PR #14: a frame kept out of sight (see-through, or off the page) is never filled by the key.
  await go('/framedhidden'); await wait(800);
  await b.vaultKey(); await wait(1200);
  const hv = await Promise.all(tab().mainFrame.framesInSubtree.filter((f) => f.url.includes('auth.example'))
    .map((f) => f.executeJavaScript(`document.querySelector('#pw').value`).catch(() => '?'))) as string[];
  ok('a frame kept out of sight is never filled', hv.length === 2 && hv.every((v) => v === ''), JSON.stringify(hv));

  console.log(all ? 'ALL PASS' : 'FAILED'); app.exit(all ? 0 : 1);
});
