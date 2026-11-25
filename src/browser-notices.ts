// Phase 4 (2026-11-24): SamaraBrowser's notices methods, moved out of browser.ts unchanged. They run as the browser's own
// methods (browser.ts puts them on SamaraBrowser.prototype), so `this` is the browser.
import { BrowserWindow, WebContentsView, screen } from 'electron';
import path from 'node:path';
import { SAFE_WEB_PREFERENCES, lockDown } from './safety.ts';
import { run } from './page.ts';
import { remote } from './tvremote.ts';
import { STILL_ASKING_JS, fillScript } from './vault.ts';
import { DETAIL_KINDS, PIN_MAX, PIN_MIN, pinOk, detailFor, fillDetailsScript, samePin } from './autofill.ts';
import type { FieldKind } from './autofill.ts';
import { bankSite } from './visits.ts';
import { cleanNotice } from './notices.ts';
import type { NoticeFrom, NoticeIn, NoticeShown } from './notices.ts';
import { keep } from './mockhome.ts';
import type { SamaraBrowser, Tab, Pane } from './browser.ts';
import { FILL_WORLD } from './browser.ts';

export const NoticesPart = {
  /** The notices' layer for this window, made once and kept hidden. */
  noticeView(this: SamaraBrowser, P: Pane = this.pane): WebContentsView | null {
    const w = P.win;
    if (!w || w.isDestroyed()) return null;
    if (P.noticeV && !P.noticeV.webContents.isDestroyed()) return P.noticeV;
    const v = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, preload: path.join(path.dirname(this.o.preloadPath), 'noticepreload.cjs'), backgroundThrottling: false } });
    lockDown(v.webContents);
    v.setBackgroundColor('#00000000');
    v.setVisible(false);
    v.webContents.on('did-finish-load', () => { if (this.noticeNow && this.noticePane === P && v.getVisible()) v.webContents.send('notice:show', { ...this.noticeNow, fresh: true, sound: false }); });
    void v.webContents.loadURL(`${this.o.origin}/notice.html`).catch(() => { /* its window closed while it loaded */ });
    P.noticeV = v;
    return v;
  },

  isNotice(this: SamaraBrowser, sender: Electron.WebContents): boolean {
    const p = this.panes.find((x) => x.noticeV && !x.noticeV.webContents.isDestroyed() && x.noticeV.webContents === sender);
    if (p) this.pane = p;
    return Boolean(p);
  },

  /** The queue's word: a new notice drops (the last one rises first), one changes in place, or none is left. */
  noticeShow(this: SamaraBrowser, s: NoticeShown | null): void {
    this.noticeNow = s;
    const P = this.noticePane, v = P?.noticeV && !P.noticeV.webContents.isDestroyed() ? P.noticeV : null;
    if (s && !s.fresh) { if (v && P!.noticeOn === s.notice.id) v.webContents.send('notice:show', s); return; }
    const gen = ++this.noticeGen, up = Boolean(v?.getVisible());
    if (up) v!.webContents.send('notice:show', { leave: true });
    // It rises (0.3 s) before the next one is placed, so one never jumps sideways into the other.
    setTimeout(() => {
      if (gen !== this.noticeGen) return;
      if (v && !v.webContents.isDestroyed()) v.setVisible(false);
      if (P) P.noticeOn = null;
      if (!this.noticeNow) { this.noticePane = null; return; }
      void this.noticePlace(gen);
    }, up ? 320 : 0);
  },

  /** Put the layer under the key it comes from and drop the notice in. */
  async noticePlace(this: SamaraBrowser, gen: number): Promise<void> {
    const P = this.pane, w = P.win, s0 = this.noticeNow;
    if (!w || w.isDestroyed() || !s0) return;
    const a = await this.noticeAnchor(P, s0.notice.from);
    const s = this.noticeNow;
    if (gen !== this.noticeGen || !s || w.isDestroyed()) return;
    const v = this.noticeView(P);
    if (!v) return;
    v.setBounds(this.noticeBounds(w, a, s.notice.small === true));
    w.contentView.addChildView(v);
    v.setVisible(true);
    P.noticeOn = s.notice.id; this.noticePane = P;
    v.webContents.send('notice:show', { ...s, fresh: true, sound: s.notice.kind === 'need' });
  },

  /** Under the key: right-hand keys hang it from their right edge, left-hand ones (the shield) from their left. */
  noticeBounds(this: SamaraBrowser, w: BrowserWindow, a: { left: number; right: number; bottom: number } | null, small: boolean, h?: number, wid?: number): Electron.Rectangle {
    const [cw, ch] = w.getContentSize();
    const W = wid ?? (small ? 300 : 356) + 32, H = h ?? (small ? 88 : 260);
    const k = a ?? { left: cw - 140, right: cw - 110, bottom: 64 };
    const x = (k.left + k.right) / 2 > cw / 2 ? k.right + 12 + 16 - W : k.left - 20 - 16;
    const y = Math.max(0, Math.round(k.bottom - 6));
    return { x: Math.max(0, Math.min(cw - W, Math.round(x))), y, width: Math.min(W, cw), height: Math.max(0, Math.min(H, ch - y)) };
  },

  /** Ask the frame where the key is (and pulse it); a frame that does not answer in 0.4 s gets the right-hand side. */
  noticeAnchor(this: SamaraBrowser, P: Pane, from: NoticeFrom): Promise<{ left: number; right: number; bottom: number } | null> {
    const w = P.win;
    if (!w || w.isDestroyed()) return Promise.resolve(null);
    if (this.noticeAsk) { this.noticeAsk.done(null); this.noticeAsk = null; }
    return new Promise((done) => {
      const seq = ++this.noticeAskSeq;
      const t = setTimeout(() => { if (this.noticeAsk?.seq === seq) { this.noticeAsk = null; done(null); } }, 400);
      this.noticeAsk = { seq, done: (a) => { clearTimeout(t); done(a); } };
      w.webContents.send('browser:noticeFrom', { seq, from });
    });
  },

  /** The frame's answer: the key's left and right edges and where the band (or a chip hanging from it) ends. */
  noticeAt(this: SamaraBrowser, m: unknown): void {
    const a = this.noticeAsk, o = (m ?? {}) as Record<string, unknown>;
    if (!a || o.seq !== a.seq) return;
    this.noticeAsk = null;
    const n = (x: unknown) => (Number.isFinite(Number(x)) ? Math.round(Number(x)) : NaN);
    const r = { left: n(o.left), right: n(o.right), bottom: n(o.bottom) };
    a.done(Object.values(r).every(Number.isFinite) ? r : null);
  },

  /** The window changed size: the notice moves with its key (no second drop). */
  async noticeFollow(this: SamaraBrowser): Promise<void> {
    const P = this.noticePane, s = this.noticeNow, v = P?.noticeV;
    if (!P || !s || !v || v.webContents.isDestroyed() || !v.getVisible() || !P.win || P.win.isDestroyed()) return;
    const a = await this.noticeAnchor(P, s.notice.from);
    if (!v.getVisible() || v.webContents.isDestroyed() || P.win.isDestroyed()) return;
    const b = v.getBounds();
    v.setBounds(this.noticeBounds(P.win, a, s.notice.small === true, b.height, b.width));
  },

  /** The notice drew this big: the layer is exactly that, so it never covers the page round it. */
  noticeSize(this: SamaraBrowser, wd: number, h: number): void {
    const P = this.pane, w = P.win, v = P.noticeV;
    if (!w || w.isDestroyed() || !v || v.webContents.isDestroyed() || this.noticePane !== P) return;
    const [cw, ch] = w.getContentSize(), b = v.getBounds();
    const width = Math.max(40, Math.min(cw, Math.round(wd))), height = Math.max(0, Math.min(ch - b.y, Math.round(h)));
    // a wider notice than the guess keeps its right edge (it hangs from a right-hand key)
    const x = width !== b.width && b.x + b.width >= cw / 2 ? Math.max(0, b.x + b.width - width) : b.x;
    if (height !== b.height || width !== b.width) v.setBounds({ x, y: b.y, width, height });
  },

  /** A button on the notice. The TV's code is checked without the notice going (a wrong code stays, and shakes). */
  noticeAct(this: SamaraBrowser, id: number, act: string, value?: string): void {
    if (act === 'code') { if (this.tvNotice?.id === id && typeof value === 'string') void this.tvAct('code:' + value.slice(0, 6)); return; }
    this.notices.answer(id, act.slice(0, 40), typeof value === 'string' ? value.slice(0, 200) : undefined);
  },

  noticeHover(this: SamaraBrowser, on: boolean): void { this.notices.hover(on); },

  /** A download row on the notice: dragged out, or clicked open (only files on the notice showing). */
  noticeFile(this: SamaraBrowser, sender: Electron.WebContents, id: number, act: 'drag' | 'open'): void {
    if (!this.notices.current?.files?.some((f) => f.id === id)) return;
    if (act === 'drag') this.dlDrag(sender, id); else this.dlAct('open', id);
  },

  /** The TV's asks follow tvAsk: link (the code), asleep, setup; playing stays in the TV's own chip. */
  tvNoticeSync(this: SamaraBrowser): void {
    const ask = this.tvAsk === 'playing' ? null : this.tvAsk, err = this.tvLinkErr, had = this.tvNotice;
    if (had && had.ask !== ask) { this.tvNotice = null; this.notices.drop(had.id); }
    if (!ask) return;
    if (had && had.ask === ask) { if (had.err !== err) { had.err = err; this.notices.update(had.id, { err: err.slice(0, 200) }); } return; }
    const name = this.tv?.name ?? this.tvName ?? 'your TV', Name = name === 'your TV' ? 'Your TV' : name;
    const n: NoticeIn = ask === 'link'
      ? { kind: 'need', from: 'menu', icon: 'tv', kick: Name, title: 'Link Samara to it', rows: [{ g: '', v: 'Type the code your TV is showing. Only this once.' }], code: true, ...(err ? { err } : {}),
        keys: [{ label: 'Link', act: 'code' }, { label: 'Not now', act: 'nolink', plain: true }] }
      : ask === 'asleep'
        ? { kind: 'bad', from: 'menu', icon: 'tv', kick: Name, title: 'Didn\u2019t wake up', rows: [{ g: 'Try', v: 'Turn it on with its remote, then try again. Or send this window, which works with the TV asleep.' }],
          keys: [{ label: 'Try again', act: 'retry' }, { label: 'Send window', act: 'send:window', plain: true }, { label: 'Close', act: 'close', plain: true }] }
        : { kind: 'need', from: 'menu', icon: 'tv', kick: Name, title: 'Show this window there?', rows: [{ g: 'Once only', v: `Your Mac needs ${name} as a second screen. Samara opens the place to turn it on.` }],
          keys: [{ label: 'Open Displays', act: 'displays' }, { label: 'Not now', act: 'close', plain: true }] };
    const id = this.notices.push(cleanNotice(n), (act) => { if (this.tvNotice?.id === id) this.tvNotice = null; void this.tvAct(act); });
    this.tvNotice = { id, ask, err };
  },

  lightHide(this: SamaraBrowser): void {
    const seq = ++this.lightSeq;
    // The layer goes with its light (after the 90 ms fade): an invisible layer left over the page would catch his clicks.
    for (const p of this.panes) { const v = p.lightV; if (v && !v.webContents.isDestroyed() && v.getVisible()) { v.webContents.send('light:show', null); setTimeout(() => { if (seq === this.lightSeq && !v.webContents.isDestroyed()) v.setVisible(false); }, 100); } }
  },

  /** Beside the box: right of it, half a light's height above its middle. */
  lightShow(this: SamaraBrowser, m: { item: 'letter' | 'card' | 'key'; text: string; count: string }): void {
    const a = this.af, t = a ? this.tabs.find((x) => x.id === a.tab) : undefined, v = this.lightView(), w = this.win;
    if (!a || !t?.view || !v || !w || t.id !== this.active || this.drawerOpen) return;
    const vb = t.view.getBounds(), z = t.view.webContents.getZoomFactor();
    const W = 440, H = 44;
    const x = Math.round(vb.x + (a.rect.x + a.rect.w) * z + 2), y = Math.round(vb.y + (a.rect.y + a.rect.h / 2) * z - H / 2);
    if (y < vb.y - 4 || y + H > vb.y + vb.height + 4) return;            // the box is off the page's visible part
    v.setBounds({ x, y, width: Math.max(60, Math.min(W, vb.x + vb.width - x)), height: H });
    this.lightSeq++;
    w.contentView.addChildView(v);                                          // on top of the page
    v.setVisible(true);
    v.webContents.send('light:show', m);
  },

  /** What the light offers for the box he is in, if anything; null hides it. */
  async afDecide(this: SamaraBrowser): Promise<void> {
    const a = this.af, t = a ? this.tabs.find((x) => x.id === a.tab) : undefined;
    if (!a || !t?.view || !a.empty) { this.lightHide(); return; }
    const url = t.view.webContents.getURL();
    if (!url.startsWith('https:') || this.listed(url).length) { this.lightHide(); return; }
    let host = ''; try { host = new URL(url).hostname; } catch { return; }
    const loginBox = a.kind === 'password' || ((a.kind === 'username' || a.kind === 'email') && a.kinds.includes('password'));
    if (loginBox) {
      if (this.vault.current()) {
        const logins = await this.vault.loginsFor(url);
        if (this.af !== a) return;
        if (logins && logins.length) { a.offer = 'login'; a.logins = logins; a.login = 0; this.lightShow(this.afLoginLabel()); return; }
      } else if (a.kind === 'password' && (this.siteKnown(host) || !this.sites)) {
        // Bitwarden is locked and this site has a login: the bar calls him for his PIN (or the master password).
        this.lightHide();
        if (this.pinSeal.has()) { this.afPin = { digits: '', then: 'fill' }; this.afBand('call'); }
        else { this.afBand('call'); void this.vaultKey(); }
        return;
      }
    }
    if (DETAIL_KINDS.includes(a.kind)) {
      const d = this.details.get(), v = detailFor(d, a.kind, 0);
      if (v || (a.kind !== 'email' && d.name)) { a.offer = 'details'; a.email = 0; this.lightShow(this.afDetailsLabel()); return; }
    }
    a.offer = null; this.lightHide();
  },

  afLoginLabel(this: SamaraBrowser) { const a = this.af!; const l = a.logins[a.login]!; return { item: 'key' as const, text: l.username || l.name, count: a.logins.length > 1 ? `${a.login + 1}/${a.logins.length}` : '' }; },

  afDetailsLabel(this: SamaraBrowser) {
    const a = this.af!, d = this.details.get();
    if (a.kind === 'email') return { item: 'letter' as const, text: d.emails[a.email] ?? '', count: d.emails.length > 1 ? `${a.email + 1}/${d.emails.length}` : '' };
    return { item: 'card' as const, text: d.name || detailFor(d, a.kind), count: '' };
  },

  /** The tab says which box he is in (or none, or that he is typing). */
  afField(this: SamaraBrowser, sender: Electron.WebContents, m: unknown): void {
    const t = this.tabs.find((x) => x.view?.webContents === sender);
    if (!t || t.id !== this.active) return;
    const o = m as { kind?: unknown; kinds?: unknown; empty?: unknown; rect?: Record<string, unknown>; typing?: unknown } | null;
    if (!o) { this.af = null; this.lightHide(); if (this.afPin) setTimeout(() => { if (!this.af && this.afPin) { this.afPin = null; this.afBand(); } }, 400); return; }
    if (o.typing) { if (this.af) this.af.empty = false; this.lightHide(); return; }
    const kinds = (Array.isArray(o.kinds) ? o.kinds : []).filter((k): k is FieldKind => typeof k === 'string' && /^[a-z]{3,12}$/.test(k)).slice(0, 12);
    const kind = typeof o.kind === 'string' && /^[a-z]{3,12}$/.test(o.kind) ? o.kind as FieldKind : null;
    const r = o.rect ?? {}, rect = { x: Number(r.x) || 0, y: Number(r.y) || 0, w: Number(r.w) || 0, h: Number(r.h) || 0 };
    if (!kind) { this.af = null; this.lightHide(); return; }
    this.af = { tab: t.id, kind, kinds, empty: o.empty === true, rect, offer: null, email: 0, logins: [], login: 0 };
    void this.afDecide();
  },

  /** He clicked the light, or pressed Tab while it showed (`one`: Tab fills only the box he is in, finding 2). */
  async afPick(this: SamaraBrowser, one = false): Promise<void> {
    const a = this.af, t = a ? this.tabs.find((x) => x.id === a.tab) : undefined, wc = t?.view?.webContents;
    if (!a || !t || !wc || wc.isDestroyed() || !a.offer) return;
    this.pane.lightV?.webContents.send('light:show', { give: true });
    if (a.offer === 'login') {
      const l = a.logins[a.login];
      const s = l ? await this.vault.secret(l.id) : null;
      if (!s || this.af !== a) return;
      await run<number>(wc, fillScript(s.username, s.password), { world: FILL_WORLD, ms: 2000, fallback: 0 });
    } else {
      const d = this.details.get(), values: Partial<Record<FieldKind, string>> = {};
      for (const k of DETAIL_KINDS) { const v = detailFor(d, k, k === 'email' ? a.email : 0); if (v) values[k] = v; }
      // Tab fills the box he is in; his click on the light fills the form, and the fill itself finds the form's boxes
      // (never the page's own list of them) and skips any he cannot see (finding 2).
      const whole = !one;
      await run<number>(wc, fillDetailsScript(values, whole), { world: FILL_WORLD, ms: 2000, fallback: 0 });
    }
    this.afSound('fill');
    a.empty = false;
    setTimeout(() => this.lightHide(), 120);
  },

  /** The wheel on the light, or an arrow key in the box: his next email (or login). */
  afFlick(this: SamaraBrowser, d: number): void {
    const a = this.af;
    if (!a?.offer) return;
    if (a.offer === 'login' && a.logins.length > 1) { a.login = (a.login + d + a.logins.length) % a.logins.length; this.pane.lightV?.webContents.send('light:show', { flick: true, ...this.afLoginLabel() }); }
    const n = this.details.get().emails.length;
    if (a.offer === 'details' && a.kind === 'email' && n > 1) { a.email = (a.email + d + n) % n; this.pane.lightV?.webContents.send('light:show', { flick: true, ...this.afDetailsLabel() }); }
  },

  /** Keys in the page, before the page sees them. True: autofill took it. */
  afKey(this: SamaraBrowser, tab: Tab, input: Electron.Input): boolean {
    // Security check 2026-10-24 (finding 1): a key taken for his PIN is taken whole. Stopping only the press let the page
    // hear each release, and read the PIN from it; the release of the last number comes after the PIN is done, so the
    // keys taken are remembered until they come up.
    if (input.type === 'keyUp') { if (this.afTaken.delete(input.code || input.key)) return true; return false; }
    if (input.type !== 'keyDown' || tab.id !== this.active) return false;
    if (this.afPin) {
      const take = () => { this.afTaken.add(input.code || input.key); return true; };
      if (/^[0-9]$/.test(input.key) && !input.meta && !input.control) { void this.afPinDigit(input.key); return take(); }
      if (input.key === 'Backspace') { this.afPin.digits = this.afPin.digits.slice(0, -1); this.afBand(); return take(); }
      if (input.key === 'Escape') { this.afPin = null; this.afBand(); return take(); }
      return false;
    }
    const a = this.af;
    if (!a?.offer || !a.empty || !this.pane.lightV?.getVisible()) return false;
    if (input.key === 'Tab' && !input.shift && !input.meta && !input.control && !input.alt) { void this.afPick(true); return true; }
    if ((input.key === 'ArrowDown' || input.key === 'ArrowUp') && !input.shift && !input.meta) {
      const many = a.offer === 'login' ? a.logins.length > 1 : a.kind === 'email' && this.details.get().emails.length > 1;
      if (!many) return false;
      this.afFlick(input.key === 'ArrowDown' ? 1 : -1); return true;
    }
    return false;
  },

  async afPinDigit(this: SamaraBrowser, d: string): Promise<void> {
    const p = this.afPin;
    const len = this.pinSeal.length();
    if (!p || p.checking || p.digits.length >= len) return;   // keys while a PIN is being checked are dropped
    p.digits += d;
    this.afBand();
    if (p.digits.length < len) return;
    p.checking = true;
    const r = await this.pinSeal.open(p.digits);
    p.digits = ''; p.checking = false;
    if (r === 'gone') { this.afPin = null; this.vault.lockHard(); this.afBand('wrong'); this.note('', { kind: 'need', from: 'shield', icon: 'key', kick: 'Five wrong PINs', title: 'Master password again', rows: [{ g: 'Why', v: 'Bitwarden needs your master password again.' }] }); void this.vaultKey(); return; }
    if ('wrong' in r) { this.afBand('wrong'); return; }
    const ok = await this.vault.useSession(r.session);
    this.afPin = null;
    if (!ok) { this.pinSeal.wipe(); this.afBand(); this.note('', { kind: 'need', from: 'shield', icon: 'key', kick: 'Bitwarden', title: 'Master password again', rows: [{ g: 'Do this', v: 'Type it in the Bitwarden box that opens.' }] }); void this.vaultKey(); return; }
    this.afBand('open');
    void this.learnSites();
    if (p.then === 'save') { this.afSaveAsk(); return; }
    // Open now: the light offers the login, and his click on it fills (finding 3: the PIN alone filled at once, even on a
    // page that had only put a password box in front of him).
    setTimeout(() => { void this.afDecide(); }, 450);
  },

  /** His PIN, from Settings, while Bitwarden is open: typed twice, sealed with the session. */
  async afSetPin(this: SamaraBrowser, value: unknown): Promise<void> {
    const v = (value && typeof value === 'object' ? value : {}) as { pin?: unknown; again?: unknown };
    const pin = String(v.pin ?? ''), again = String(v.again ?? '');
    const say = (text: string, ok = false) => { this.pushSettings(); const wc = this.tabs.find((x) => x.internal === 'settings')?.view?.webContents; if (wc && !wc.isDestroyed()) wc.send('settings:afpin', { ok, text }); };
    if (!pinOk(pin)) { say(`A PIN is ${PIN_MIN} to ${PIN_MAX} numbers.`); return; }
    if (!samePin(pin, again)) { say('The two did not match.'); return; }
    const session = this.vault.current();
    if (!session) { say('Open Bitwarden once first (use a login), then set your PIN.'); return; }
    say((await this.pinSeal.seal(pin, session)) ? 'Your PIN is set.' : 'This computer cannot keep a PIN safely, so none was set.', true);
  },

  /** A login he just sent on a page: offered after the page moves on, if it is new or changed. */
  afCred(this: SamaraBrowser, sender: Electron.WebContents, m: unknown): void {
    const t = this.tabs.find((x) => x.view?.webContents === sender);
    const o = (m && typeof m === 'object' ? m : {}) as { user?: unknown; pass?: unknown };
    if (!t || typeof o.pass !== 'string' || !o.pass) return;
    let host = ''; try { const u = new URL(sender.getURL()); if (u.protocol !== 'https:') return; host = u.hostname.replace(/^www\./, ''); } catch { return; }
    if (this.listed(sender.getURL()).length || bankSite(sender.getURL())) return;
    this.afSave = { tab: t.id, host, user: String(o.user ?? '').slice(0, 200), pass: o.pass.slice(0, 500), at: Date.now(), asked: false };
    const mine = this.afSave;
    setTimeout(() => { void this.afSaveCheck(mine); }, 2500);
    setTimeout(() => { if (this.afSave === mine) { this.afSave = null; this.afBand(); } }, 5 * 60_000);
  },

  async afSaveCheck(this: SamaraBrowser, s: NonNullable<typeof this.afSave>): Promise<void> {
    if (this.afSave !== s) return;
    const t = this.tabs.find((x) => x.id === s.tab), wc = t?.view?.webContents;
    if (!wc || wc.isDestroyed()) { this.afSave = null; return; }
    // Still a password box he can see on the page: it did not work (a wrong password is never offered). QA fix F6
    // (2026-11-25): a box the page only hid after signing in (kept in the page, not shown) no longer counts, or such
    // sites would never offer to keep the login.
    const still = await run<boolean>(wc, STILL_ASKING_JS, { ms: 800, fallback: false });
    if (still) { this.afSave = null; return; }
    if (this.vault.current()) {
      const logins = await this.vault.loginsFor('https://' + s.host);
      for (const l of logins ?? []) if (l.username === s.user) {
        const sec = await this.vault.secret(l.id, false);
        if (sec?.password === s.pass) { this.afSave = null; return; }
        // QA fix F3: the same username with another password is a changed password: the card offers to update it.
        if (sec) { s.update = l.id; break; }
      }
    }
    if (this.afSave === s) this.afBand();
  },

  /** "Save this login" clicked: the card shows exactly what will be kept (needs Bitwarden open: the PIN first). */
  afSaveAsk(this: SamaraBrowser): void {
    const s = this.afSave;
    if (!s) return;
    if (!this.vault.current()) {
      if (this.pinSeal.has()) { this.afPin = { digits: '', then: 'save' }; this.afBand('call'); }
      else void this.vaultKey();
      return;
    }
    this.win?.webContents.send('browser:afsave', { site: s.host, user: s.user, pass: s.pass, update: Boolean(s.update) });
  },

  /** The card's Save: what he saw, perhaps edited. */
  async afSaveGo(this: SamaraBrowser, m: unknown): Promise<void> {
    const o = (m && typeof m === 'object' ? m : {}) as { site?: unknown; user?: unknown; pass?: unknown };
    const site = String(o.site ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]{3,253}$/.test(site) || typeof o.pass !== 'string' || !o.pass) return;
    const user = String(o.user ?? '');
    // QA fix F3: a changed password goes into the login he has, as long as he left the site and username as offered.
    const s = this.afSave, update = s?.update && s.host === site && s.user === user ? s.update : null;
    const ok = update ? await this.vault.updatePassword(update, o.pass) : await this.vault.create(site, user, o.pass);
    this.afSave = null;
    this.afBand(ok ? 'open' : undefined);
    this.note('', ok ? { from: 'shield', small: true, icon: 'key', kick: update ? 'Password updated in Bitwarden' : 'Kept in Bitwarden', title: site } : { kind: 'bad', from: 'shield', icon: 'key', kick: 'Bitwarden', title: 'Did not keep it', rows: [{ g: 'Try', v: 'Again from the key.' }] });
    if (ok) void this.learnSites();
  },

  /** The address bar's key: what it shows now. `beat`: one moment to play (the call, opening, a wrong PIN). */
  afBand(this: SamaraBrowser, beat?: 'call' | 'open' | 'wrong'): void {
    this.afBandMode = this.afPin ? 'pin' : this.afSave ? 'save' : 'idle';
    this.win?.webContents.send('browser:af', { mode: this.afBandMode, n: this.afPin?.digits.length ?? 0, of: this.pinSeal.length(), beat: beat ?? null });
    if (beat === 'call') this.afSound('call');
    if (beat === 'open') this.afSound('unlock');
    if (beat === 'wrong') this.afSound('wrong');
  },

  afSound(this: SamaraBrowser, name: 'call' | 'unlock' | 'fill' | 'wrong'): void { if (this.prefs.afSounds) this.win?.webContents.send('browser:afsound', name); }
};
