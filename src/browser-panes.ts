// Phase 4 (2026-11-24): SamaraBrowser's panes methods, moved out of browser.ts unchanged. They run as the browser's own
// methods (browser.ts puts them on SamaraBrowser.prototype), so `this` is the browser.
import { BrowserWindow, Menu, WebContentsView, app, net, clipboard, nativeImage, screen, shell } from 'electron';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SAFE_WEB_PREFERENCES, lockDown } from './safety.ts';
import { servePages } from './pageserver.ts';
import { run, within } from './page.ts';
import { remote } from './tvremote.ts';
import { searchFor, setSearch } from './address.ts';
import { writeFileAtomic } from './atomic.ts';
import { SPLIT_GAP, SPLIT_HEAD, clampSplit, splitLeftWidth } from './splitview.ts';
import { readJson } from './store.ts';
import { goesInward, ownPopup, privateHost } from './driverrules.ts';
import { LOCK_AFTER } from './vault.ts';
import { cleanDetails } from './autofill.ts';
import { declineCookies } from './cookiedecline.ts';
import { NEW_CHAT_MAX, newChatLink, newPass, pickText } from './claudehand.ts';
import type { Chat } from './claudehand.ts';
import { keep } from './mockhome.ts';
import { SB_NAME } from './safebrowsing.ts';
import { failureWords, upgrade } from './secure.ts';
import { pageMenuItems, sendKindFor } from './pagemenu.ts';
import { WATCH_CSS, WATCH_HOSTS } from './watchmode.ts';
import { fading } from './rail.ts';
import type { SamaraBrowser, Tab, Pane } from './browser.ts';
import { PEEK_HEAD, lockPick, isWeb, liveView, toggleFull, appOf, OTHER_OPEN, STREMIO_WEB, startStremio, DEFAULT_HOME, hostOf, GESTURE_MS, PASS_MS, VIDEO_BACK_JS, SETTLED_JS, PAGE_RADIUS, PAGE_COLOUR, VEIL_FADE_MS, VEIL_DIM_MS, VEIL_INSTANT_MS, VEIL_MAX_MS, WAKE_FADE_MS } from './browser.ts';

export const PanesPart = {
  // ------------------------------------------------------------------ sheet 121 (4): two pages side by side
  /**
   * His pick (2026-11-20): two pages in one window. The page he is using has the gold edge; a wood peg between them shares
   * the space. Opened by dropping a tab at the window's right edge, or "Side by side" in the ⋯ menu; each page's × ends it
   * (both tabs stay open). The pair is remembered: picking either tab shows both again, and it comes back after a restart.
   */
  /** The pair in this window, when both of its tabs are still here (a pair that lost a tab is forgotten). */
  splitOf(this: SamaraBrowser, P: Pane = this.pane): { L: Tab; R: Tab; ratio: number } | null {
    const s = P.split;
    if (!s) return null;
    const L = this.tabs.find((x) => x.id === s.left && x.pane === P.id), R = this.tabs.find((x) => x.id === s.right && x.pane === P.id);
    if (!L || !R || L === R || L.lent || R.lent) { P.split = null; return null; }
    return { L, R, ratio: s.ratio };
  },

  /** The pair, while one of its tabs is the one in front (and no page is full screen). */
  splitShown(this: SamaraBrowser, P: Pane = this.pane): { L: Tab; R: Tab; ratio: number } | null {
    const x = this.splitOf(P);
    return x && (P.active === x.L.id || P.active === x.R.id) && P.fullTab === null ? x : null;
  },

  /** The other page of the pair shown with this one, if any. */
  partnerOf(this: SamaraBrowser, id: number, P: Pane = this.pane): Tab | null {
    const x = this.splitOf(P);
    return !x ? null : x.L.id === id ? x.R : x.R.id === id ? x.L : null;
  },

  /** In front: the tab in front of a window, or the other page of a pair shown beside it. */
  inFront(this: SamaraBrowser, t: Tab): boolean {
    return this.panes.some((p) => p.active === t.id || (this.splitShown(p) !== null && (p.split!.left === t.id || p.split!.right === t.id)));
  },

  /** The two pages' places (window pixels): the page area cut in two with the peg's gap, a name strip over each. */
  splitBoxes(this: SamaraBrowser, ratio: number): { left: Electron.Rectangle; right: Electron.Rectangle } | null {
    const w = this.win;
    if (!w || w.isDestroyed()) return null;
    const [cw, ch] = w.getContentSize();
    const x0 = this.inset.left, y0 = this.inset.top + SPLIT_HEAD, W = Math.max(0, cw - this.inset.left - this.inset.right), H = Math.max(0, ch - y0 - this.inset.bottom);
    const lw = splitLeftWidth(W, ratio);
    return { left: { x: x0, y: y0, width: lw, height: H }, right: { x: x0 + lw + SPLIT_GAP, y: y0, width: Math.max(0, W - lw - SPLIT_GAP), height: H } };
  },

  /** Lay out the pair (from place()). */
  placeSplit(this: SamaraBrowser, x: { L: Tab; R: Tab; ratio: number }): void {
    const b = this.splitBoxes(x.ratio);
    if (!b) return;
    for (const [t, r] of [[x.L, b.left], [x.R, b.right]] as const) {
      if (!t.view) continue;
      if (t.crashed || t.blocked || t.failed) { t.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); continue; }
      t.view.setBounds(r);
      if (!this.drawerOpen && !t.view.getVisible()) t.view.setVisible(true);
    }
    if (this.veil?.up && this.curtain) { const t = this.cur(); if (t?.view) this.curtain.setBounds(t.view.getBounds()); }
  },

  splitSend(this: SamaraBrowser): void {
    const P = this.pane, w = this.win;
    if (!w || w.isDestroyed()) return;
    const x = this.splitShown(P);
    const info = (t: Tab) => { let host = '', rest = ''; try { const u = new URL(t.url); host = u.hostname.replace(/^www\./, ''); rest = u.pathname === '/' ? '' : u.pathname; } catch { host = t.title; } return { id: t.id, title: t.title, host, rest, favicon: t.favicon || this.iconOf(t.url) }; };
    const msg = x ? { ratio: x.ratio, gap: SPLIT_GAP, head: SPLIT_HEAD, on: P.active === x.L.id ? 'left' : 'right', left: info(x.L), right: info(x.R) } : null;
    const sig = JSON.stringify(msg);
    if (this.splitSent.get(P) === sig) return;
    this.splitSent.set(P, sig);
    w.webContents.send('browser:sbs', msg);
  },

  /** Side by side with another tab: the one given (dropped at the right edge), or the last one he was on, or a new one. */
  splitOpen(this: SamaraBrowser, other?: number): void {
    const P = this.pane, a = this.cur();
    if (!a || a.lent || !this.alive(P)) return;
    const mine = this.paneTabs(P).filter((x) => !x.lent && !x.done);
    let left = a, right: Tab | undefined;
    const dropped = other === undefined ? undefined : mine.find((x) => x.id === other);
    if (dropped && dropped !== a) right = dropped;
    else {
      right = mine.filter((x) => x !== a).sort((p, q) => q.lastSeen - p.lastSeen)[0];
      if (dropped === a && right) { left = right; right = a; }      // the page in front was dropped at the edge: it goes right
    }
    if (!right) {
      const id = this.newTab(this.HOME, null, false);
      right = id === null ? undefined : this.tabs.find((x) => x.id === id);
      this.pane = P;
    }
    if (!right) return;
    P.split = { left: left.id, right: right.id, ratio: P.split?.ratio ?? 0.5 };
    for (const t of [left, right]) if (!t.view) this.wake(t); else this.thaw(t);
    this.pane = P;
    this.activate(dropped && dropped !== a ? dropped.id : a.id);
    this.changed();
  },

  /** The pair ends; both tabs stay open. `keep`: the page that stays in front (the other one's × was pressed). */
  splitClose(this: SamaraBrowser, keep?: number): void {
    const P = this.pane, x = this.splitOf(P);
    P.split = null;
    if (!x) { this.splitSend(); return; }
    const stay = keep === x.L.id || keep === x.R.id ? keep : P.active ?? x.L.id;
    this.activate(stay);
    this.changed();
  },

  /** The band: the peg was dragged (a share of the width), a page's strip was clicked, or its × pressed. */
  splitFromFrame(this: SamaraBrowser, a: Record<string, unknown>): void {
    const P = this.pane, x = this.splitOf(P);
    if (!x) return;
    if (typeof a.ratio === 'number' && Number.isFinite(a.ratio)) {
      P.split!.ratio = clampSplit(a.ratio);
      this.place();
      if (a.done === true) this.changed();
      return;
    }
    const id = Number(a.id);
    if (id !== x.L.id && id !== x.R.id) return;
    if (a.act === 'focus') this.activate(id);
    else if (a.act === 'close') this.splitClose(id === x.L.id ? x.R.id : x.L.id);
  },

  /** A page of the pair got the keyboard (he clicked into it): it becomes the page in front, with the gold edge. */
  splitFocus(this: SamaraBrowser, t: Tab): void {
    const P = this.paneOfTab(t);
    if (!P || !this.alive(P) || P.active === t.id) return;
    const x = this.splitShown(P);
    if (!x || (x.L !== t && x.R !== t)) return;
    this.pane = P;
    this.activate(t.id);
  },

  adoptSplits(this: SamaraBrowser): void {
    this.splitsWanted = this.splitsWanted.filter((s) => {
      if (!this.tabs.includes(s.L) || !this.tabs.includes(s.R)) return false;
      if (s.L.pane !== s.R.pane) return true;
      const P = this.panes.find((p) => p.id === s.L.pane);
      if (!P) return true;
      if (!P.split) { P.split = { left: s.L.id, right: s.R.id, ratio: s.ratio }; const was = this.pane; this.pane = P; if (P.active === s.L.id || P.active === s.R.id) this.activate(P.active!); this.pane = was; }
      return false;
    });
  },

  /** A page asked (Shift-click or a held press on a link). */
  peekLink(this: SamaraBrowser, sender: Electron.WebContents, href: string): void {
    const t = this.tabs.find((x) => x.view?.webContents === sender);
    if (!t || t.lent || t.internal) return;
    const P = this.paneOfTab(t);
    if (!P || !this.alive(P)) return;
    this.pane = P;
    this.linkPeek(href, t.id);
  },

  /** Open the peek over the page in front (a web address only). */
  linkPeek(this: SamaraBrowser, href: string, from: number | null = null): void {
    let url: string;
    try { const u = new URL(href); if (!/^https?:$/.test(u.protocol)) return; url = u.href; } catch { return; }
    const P = this.pane, w = this.win;
    if (!w || w.isDestroyed()) return;
    this.linkPeekClose();
    const shade = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, preload: this.o.preloadPath, backgroundThrottling: false } });
    lockDown(shade.webContents);
    shade.setBackgroundColor('#00000000');
    const view = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, session: this.ses, preload: this.o.tabPreloadPath, backgroundThrottling: false } });
    view.setBackgroundColor('#ffffff');
    try { view.setBorderRadius(12); } catch { /* square */ }
    const lp = { pane: P, shade, view, from, ready: false };
    this.lp = lp;
    const wc = view.webContents;
    // A link in it that wants a new window opens as a normal tab, behind.
    wc.setWindowOpenHandler(({ url: u }) => { if (/^https?:/i.test(u)) { this.pane = P; this.newTab(u, null, false); } return { action: 'deny' }; });
    const head = () => { if (this.lp !== lp || shade.webContents.isDestroyed() || !lp.ready) return; let host = '', rest = ''; try { const u = new URL(wc.getURL() || url); host = u.hostname.replace(/^www\./, ''); rest = u.pathname === '/' ? '' : u.pathname; } catch { host = url; } void shade.webContents.executeJavaScript(`peekHead(${JSON.stringify({ host, rest, title: wc.getTitle() })})`, true).catch(() => {}); };
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-stop-loading'] as const) wc.on(ev as 'did-navigate', head);
    const keys = (e: Electron.Event, input: Electron.Input) => { if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); this.linkPeekClose(); } };
    wc.on('before-input-event', keys);
    shade.webContents.on('before-input-event', keys);
    shade.webContents.on('did-finish-load', () => { lp.ready = true; this.placePeek(); head(); });
    void shade.webContents.loadURL(`${this.o.origin}/peek.html`).catch(() => { /* gone */ });
    void wc.loadURL(url).catch(() => { /* the page says so itself */ });
    w.contentView.addChildView(shade);
    w.contentView.addChildView(view);
    this.placePeek();
    wc.focus();
  },

  /** The box over the page area: two thirds of it wide (at least 640), centred, a little in from the top and bottom. */
  peekBox(this: SamaraBrowser): { shade: Electron.Rectangle; box: Electron.Rectangle } | null {
    const lp = this.lp, w = lp?.pane.win;
    if (!lp || !w || w.isDestroyed()) return null;
    const [cw, ch] = w.getContentSize(), ins = lp.pane.inset;
    const aw = Math.max(0, cw - ins.left - ins.right), ah = Math.max(0, ch - ins.top - ins.bottom);
    const bw = Math.min(aw - 40, Math.max(640, Math.round(aw * 0.66)));
    const x = ins.left + Math.round((aw - bw) / 2), y = ins.top + 22, h = Math.max(200, ah - 54);
    return { shade: { x: 0, y: 0, width: cw, height: ch }, box: { x, y, width: Math.max(0, bw), height: h } };
  },

  placePeek(this: SamaraBrowser): void {
    const lp = this.lp, b = this.peekBox();
    if (!lp || !b) return;
    lp.shade.setBounds(b.shade);
    lp.view.setBounds({ x: b.box.x, y: b.box.y + PEEK_HEAD, width: b.box.width, height: Math.max(0, b.box.height - PEEK_HEAD) });
    if (lp.ready && !lp.shade.webContents.isDestroyed()) void lp.shade.webContents.executeJavaScript(`peekBox(${JSON.stringify({ ...b.box, head: PEEK_HEAD })})`, true).catch(() => {});
  },

  /** Close it (Esc, the ×, a click outside, or he kept it). */
  linkPeekClose(this: SamaraBrowser): void {
    const lp = this.lp;
    if (!lp) return;
    this.lp = null;
    const w = lp.pane.win;
    for (const v of [lp.view, lp.shade]) {
      try { if (w && !w.isDestroyed()) w.contentView.removeChildView(v); } catch { /* gone */ }
      try { if (!v.webContents.isDestroyed()) v.webContents.close(); } catch { /* gone */ }
    }
    const t = this.tabs.find((x) => x.id === lp.pane.active);
    if (t?.view && !t.view.webContents.isDestroyed()) t.view.webContents.focus();
  },

  /** The strip's keys: keep it as a tab (in front), put it side by side with the page under it, or close it. */
  peekAct(this: SamaraBrowser, sender: Electron.WebContents, act: unknown): void {
    const lp = this.lp;
    if (!lp || sender !== lp.shade.webContents) return;
    this.pane = lp.pane;
    const url = lp.view.webContents.isDestroyed() ? '' : lp.view.webContents.getURL();
    if (act === 'close' || !/^https?:/i.test(url)) { this.linkPeekClose(); return; }
    if (act === 'tab') { this.linkPeekClose(); this.newTab(url, lp.from, true); return; }
    if (act === 'split') {
      this.linkPeekClose();
      const id = this.newTab(url, lp.from, false);
      this.pane = lp.pane;
      if (id !== null) this.splitOpen(id);
    }
  },

  // ------------------------------------------------------------------ the band's panels, floating over the live page
  /** The frame's panel layer: the frame's own page with ?float, see-through, the size of the window, on top while a panel is open. */
  floatView(this: SamaraBrowser): WebContentsView | null {
    const w = this.win, P = this.pane;
    if (!w || w.isDestroyed()) return null;
    if (liveView(P.floatV)) return P.floatV!;
    // Never slowed while hidden: a menu must draw the moment it shows. It does nothing at rest.
    const v = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, preload: this.o.preloadPath, backgroundThrottling: false } });
    lockDown(v.webContents);
    v.setBackgroundColor('#00000000');
    v.setVisible(false);
    P.floatReady = false;
    v.webContents.on('did-finish-load', () => {
      this.pane = P;
      // What the frame was told before this layer could listen: the tab list (with the site, zoom and update state),
      // the downloads, Claude's plan.
      for (const [ch, a] of P.floatLast ?? []) if (ch !== 'browser:openupdate') v.webContents.send(ch, ...a);
      P.floatReady = true;
      if (this.alive(P)) P.win!.webContents.send('browser:float', { ready: true });
    });
    v.webContents.on('render-process-gone', () => { P.floatReady = false; P.floatOn = false; if (this.alive(P)) P.win!.webContents.send('browser:float', { ready: false }); });
    // His keys work while a menu is open (Ctrl+T, Ctrl+L ...), the same as in the tab list.
    v.webContents.on('before-input-event', (e, input) => { this.pane = P; if (this.key(input)) e.preventDefault(); });
    void v.webContents.loadURL(`${this.o.origin}/browser.html?float=1`).catch(() => { /* its window closed while it loaded */ });
    P.floatV = v;
    return v;
  },

  isFloat(this: SamaraBrowser, sender: Electron.WebContents): boolean {
    const p = this.panes.find((x) => this.alive(x) && liveView(x.floatV) && sender === x.floatV!.webContents);
    if (p) this.pane = p;
    return Boolean(p);
  },

  /** Show the layer over everything (it covers the whole window, so a click anywhere else closes the panel), or put it away. */
  floatShow(this: SamaraBrowser, on: boolean): void {
    const w = this.win, P = this.pane, v = P.floatV;
    if (!w || w.isDestroyed() || !liveView(v)) return;
    if (!on) {
      if (!P.floatOn) return;
      P.floatOn = false;
      v.setVisible(false);
      // The keyboard goes back to the page he was on (or the band, when there is no page).
      const t = this.cur();
      if (t?.view && !t.lent && !t.view.webContents.isDestroyed() && t.view.getVisible()) t.view.webContents.focus(); else w.webContents.focus();
      return;
    }
    const [cw, ch] = w.getContentSize();
    v.setBounds({ x: 0, y: 0, width: cw, height: ch });
    if (!P.floatOn) w.contentView.addChildView(v);   // to the top, over the page, the tab list and the rune
    P.floatOn = true;
    v.setVisible(true);
    v.webContents.focus();
  },

  /** The frame: a key of the band was pressed; its panel opens in the layer. */
  floatFromFrame(this: SamaraBrowser, a: Record<string, unknown>): void {
    const P = this.pane;
    if (typeof a.click !== 'string' || !/^(menukey|star|lock|dlkey|upkey)$/.test(a.click)) return;
    const v = this.floatView();
    if (!v || !P.floatReady) return;
    this.floatShow(true);
    v.webContents.send('browser:float', { click: a.click, kb: a.kb === true });
  },

  /** The layer: a panel opened (show it) or the last one closed (put it away); the band's keys show which are open. */
  floatFromLayer(this: SamaraBrowser, a: Record<string, unknown>): void {
    const P = this.pane;
    if (a.open === true) this.floatShow(true);
    else if (a.open === false) this.floatShow(false);
    if (Array.isArray(a.over) && this.alive(P)) P.win!.webContents.send('browser:float', { over: a.over.filter((x) => typeof x === 'string').slice(0, 10) });
    // A menu line that works on the band itself (find on the page, this site's notes, the tab list): the band does it.
    if (typeof a.frame === 'string' && ['find', 'sitenotes', 'drawer'].includes(a.frame) && this.alive(P)) P.win!.webContents.send('browser:float', { do: a.frame });
  },

  /** The window changed size while a panel is open: the layer follows. */
  placeFloat(this: SamaraBrowser): void {
    const w = this.win, P = this.pane, v = P.floatV;
    if (!P.floatOn || !w || w.isDestroyed() || !liveView(v)) return;
    const [cw, ch] = w.getContentSize();
    v.setBounds({ x: 0, y: 0, width: cw, height: ch });
  },

  // ------------------------------------------------------------------ the window's size
  /**
   * Fill the screen, or back to a size easy to drag and resize (2026-10-25). A window he dragged or sized to fill the screen counts as
   * filled too (the Mac only calls it zoomed when its own button did it), and comes back to the size it had, or, when
   * that was the whole screen too, three quarters of it in the middle. The Mac glides it there.
   */
  fillOrShrink(this: SamaraBrowser, w: BrowserWindow): void {
    if (w.isDestroyed()) return;
    const area = screen.getDisplayMatching(w.getBounds()).workArea, b = w.getBounds();
    const fills = (r: Electron.Rectangle) => r.width >= area.width - 16 && r.height >= area.height - 16;
    if (!w.isMaximized() && !fills(b)) { w.maximize(); return; }
    if (w.isMaximized()) w.unmaximize();
    const was = w.getNormalBounds();
    const to = fills(was) ? { width: Math.round(area.width * 0.75), height: Math.round(area.height * 0.8) } : { width: was.width, height: was.height };
    w.setBounds({ x: Math.round(area.x + (area.width - to.width) / 2), y: Math.round(area.y + (area.height - to.height) / 2), ...to }, true);
  },

  curtainView(this: SamaraBrowser): WebContentsView | null {
    const w = this.win;
    if (!w || w.isDestroyed()) return null;
    if (this.curtain && !this.curtain.webContents.isDestroyed()) return this.curtain;
    const v = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES } });
    lockDown(v.webContents);
    v.setBackgroundColor('#00000000');
    try { v.setBorderRadius(PAGE_RADIUS); } catch { /* square */ }
    v.setVisible(false);
    w.contentView.addChildView(v);
    this.curtain = v;
    this.curtainReady = v.webContents.loadURL(`${this.o.origin}/curtain.html`).catch(() => {});
    // The picture never stands between him and the page (2026-10-23): it could
    // sit over a page for seconds after a load, taking his clicks. A press on it takes it away at once and the press,
    // and its release, go to the page underneath, at the same spot.
    const P = this.pane;
    let through: Tab | null = null;
    v.webContents.on('input-event', (_e, i) => {
      const m = i as Electron.MouseInputEvent;
      if (i.type === 'mouseDown') {
        this.pane = P;
        const t = this.tabs.find((x) => x.id === P.veil?.tab) ?? this.cur();
        if (P.veil) this.veilDown(0);
        v.setVisible(false);
        if (t?.waking) this.wokeUp(t);
        through = t?.view && !t.view.webContents.isDestroyed() ? t : null;
      }
      if (through && (i.type === 'mouseDown' || i.type === 'mouseUp') && through.view && !through.view.webContents.isDestroyed()) {
        through.view.webContents.sendInputEvent({ type: i.type, x: m.x, y: m.y, button: m.button ?? 'left', clickCount: m.clickCount ?? 1 });
        if (i.type === 'mouseUp') through = null;
      }
    });
    return v;
  },

  /**
   * `from`: the page he was looking at when he opened a new tab (2026-10-13: no glitchy blank frame). It stays on
   * screen until the curtain holds its picture, then the new tab is swapped in underneath and fades in as it draws.
   */
  async veilUp(this: SamaraBrowser, t: Tab, from?: Tab): Promise<void> {
    const P = this.pane;
    // However this ends, the new tab ends up shown and the one it came from hidden.
    const swap = () => {
      this.pane = P;
      if (!from || t.id !== this.active || !t.view) return;
      if (!this.drawerOpen) t.view.setVisible(true);
      if (from.view && from.id !== this.active && !from.lent) from.view.setVisible(false);
    };
    try { await this.veilUpInner(t, from); } finally { swap(); }
  },

  async veilUpInner(this: SamaraBrowser, t: Tab, from?: Tab): Promise<void> {
    const P = this.pane;
    if (this.veil?.tab === t.id) return;                       // a redirect inside one change keeps the same curtain
    if (t.id !== this.active || !t.view || t.lent || t.internal || this.drawerOpen || this.fullTab === t.id || t.crashed || t.blocked || t.failed) return;
    this.veilDown(0);
    const v = this.curtainView();
    if (!v) return;
    const nav = ++this.veilSeq;
    this.veil = { tab: t.id, nav, at: Date.now(), up: false, dimT: null, capT: null };
    // The hover picture if it is fresh and of this page; otherwise a new one. Nothing drawn yet: the wood.
    const p = this.peekShot;
    const shot = !t.drawn ? (t.waking && t.leftShot ? t.leftShot : from ? await this.shotOf(from) : null) : p && p.tab === t.id && Date.now() - p.at < 1500 ? p.shot : await this.shotOf(t);
    await P.curtainReady;
    this.pane = P;
    if (this.veil?.nav !== nav) return;                         // the new page drew first: a plain switch
    if (!v.webContents || v.webContents.isDestroyed()) { if (this.veil?.nav === nav) this.veil = null; return; }   // the window closed meanwhile
    const ok = await run(v.webContents, `curtainShow(${JSON.stringify(shot)})`, { ms: 400, fallback: false });
    this.pane = P;
    const vl = this.veil;
    if (!ok || vl?.nav !== nav || !t.view || t.id !== this.active || this.drawerOpen) { if (vl?.nav === nav) this.veil = null; return; }
    v.setBounds(t.view.getBounds());
    this.win?.contentView.addChildView(v);                      // to the top, over the page
    this.raiseTray();                                           // but never over the open tab list
    v.setVisible(true);
    vl.up = true;
    vl.dimT = setTimeout(() => { if (P.veil?.nav === nav) void run(v.webContents, 'curtainDim()', { fallback: null }); }, VEIL_DIM_MS);
    vl.capT = setTimeout(() => { this.pane = P; if (this.veil?.nav === nav) this.veilDown(VEIL_FADE_MS); }, VEIL_MAX_MS);
  },

  veilDown(this: SamaraBrowser, fade: number): void {
    const vl = this.veil;
    this.veil = null;
    if (!vl) return;
    if (vl.dimT) clearTimeout(vl.dimT);
    if (vl.capT) clearTimeout(vl.capT);
    const v = this.curtain;
    if (!v || v.webContents.isDestroyed() || !vl.up) return;
    // A page that came at once just switches: fading it would only add a wait that was not there.
    const ms = Date.now() - vl.at < VEIL_INSTANT_MS ? 0 : fade;
    if (!ms) { v.setVisible(false); return; }
    void run(v.webContents, `curtainFade(${ms})`, { fallback: null });
    const P = this.pane;
    setTimeout(() => { if (!P.veil?.up) v.setVisible(false); }, ms + 30);
  },

  /** The tab's page has drawn its first content (from tabpreload.cjs): the curtain can go. */
  painted(this: SamaraBrowser, sender: Electron.WebContents): void {
    const t = this.tabs.find((x) => x.view?.webContents === sender);
    if (!t || !this.inTab(t)) return;
    t.drawn = true;
    if (t.phase !== 'idle') { t.prog = Math.max(t.prog ?? 0, 0.7); this.sendTabs(); }
    if (t.waking && typeof t.videoAt === 'number') { const at = t.videoAt; t.videoAt = undefined; void run(sender, VIDEO_BACK_JS(at), { fallback: null }); }
    if (!t.waking) { if (this.veil?.tab === t.id) this.veilDown(VEIL_FADE_MS); return; }
    // Woken from sleep (2026-10-23, filmed): its last picture stays until the page has stopped moving, then one soft fade.
    const P = this.pane, seq = t.wakeSeq;
    void run<boolean>(sender, SETTLED_JS, { ms: 4000, fallback: false }).then(() => {
      this.pane = P;
      if (this.veil?.tab === t.id) this.veilDown(WAKE_FADE_MS);
      setTimeout(() => this.wokeUp(t, seq), WAKE_FADE_MS + 150);
    });
  },

  wokeUp(this: SamaraBrowser, t: Tab, seq = t.wakeSeq): void {
    if (!t.waking || seq !== t.wakeSeq) return;
    t.waking = false;
    const wc = t.view?.webContents;
    if (wc && !wc.isDestroyed() && !this.wakeHush.has(t.id)) wc.setAudioMuted(t.muted);
    if (wc && !wc.isDestroyed() && this.seen(t)) { try { wc.send('tab:shown', true); } catch { /* gone */ } }   // only what he started plays
  },

  /** Give a tab a live page, at its address, then put it back where it was scrolled. */
  wake(this: SamaraBrowser, tab: Tab): void {
    if (tab.internal === 'hyrule') { this.wakeHyrule(tab); return; }
    if (tab.internal) { this.wakeSettings(tab); return; }
    // The safe preferences, but a tab in the background may sleep: unlike the pop-out it has no reason to
    // keep painting over his game. NOT lockDown(): that pins a window to one page, and a browser navigates.
    // tabpreload.cjs exposes nothing to the page; it only hides passkeys, which hang in Electron (6.22).
    // plugins: Chromium's own PDF viewer, so a PDF opens in the tab instead of downloading (6.22b item 12).
    const view = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, backgroundThrottling: true, session: tab.guest ? this.driver.guestSession() : this.ses, preload: this.o.tabPreloadPath, plugins: true } });
    const wc = view.webContents;
    // A new view paints white until its page draws; that white is the flash between pages. Paint it the
    // page area's own colour instead (or, coming back, the page's own colour: a dark site stays dark), and keep it in
    // the window, hidden, so switching to it is instant.
    view.setBackgroundColor(tab.pageBg ?? PAGE_COLOUR);
    try { view.setBorderRadius(PAGE_RADIUS); } catch { /* an older runtime: square corners */ }
    view.setVisible(false);
    this.inTab(tab);
    this.win?.contentView.addChildView(view);
    this.raiseTray();                                   // a waking tab never covers the open tab list
    tab.view = view; tab.crashed = false; tab.loading = true; tab.drawn = false;
    // Coming back from sleep (2026-10-23: a video played before the page showed, and it looked crashed): it
    // counts as loading at once, so the curtain (with its own last picture) covers it, and nothing plays until it shows.
    tab.phase = 'waiting'; tab.waking = tab.slept === true; tab.slept = false;
    // Silent while it wakes: a player that sets itself up again can start for a moment before it is paused (filmed).
    tab.wakeSeq = (tab.wakeSeq ?? 0) + 1;
    if (tab.waking) { const seq = tab.wakeSeq; wc.setAudioMuted(true); this.wakeHush.add(tab.id); setTimeout(() => this.wokeUp(tab, seq), 10_000); }
    else this.wakeHush.delete(tab.id);
    // Every event from this page is about the window the tab is in NOW (it can be dragged to another).
    const on = ((ev: string, fn: (...a: any[]) => void) => wc.on(ev as 'destroyed', (...a: any[]) => { this.inTab(tab); fn(...a); })) as unknown as Electron.WebContents['on'];
    wc.on('will-attach-webview', (e) => e.preventDefault());
    on('focus', () => this.splitFocus(tab));          // sheet 121 (4): a click into the other page of a pair makes it the one in front
    this.nameFor(wc);
    if (!tab.internal) declineCookies(wc);                                         // cookiedecline.ts: banners rejected by themselves
    // A link that opens a new window becomes a tab under the one it came from. Web pages only.
    // A middle click or Ctrl+click opens it behind, the way every browser does.
    // "Block popups" (on unless he turns it off): a page opening a new WINDOW by itself is refused; a link he
    // opens in a new tab still opens as a tab.
    // Popups (2026-10-12, Chrome's rule): one opened within a second of his click or key press is his, and
    // opens as a real small window that keeps its link to the page (Sign in with Google needs that). One a page opens
    // by itself is blocked, unless he allowed popups on that site; a chip offers that.
    on('input-event', (_e, i) => {
      if (i.type === 'mouseDown' || i.type === 'keyDown') {
        this.lastGesture.set(tab.id, Date.now());
        // His first click or key in a woken tab lets its sound back (it stayed hushed until then).
        if (this.wakeHush.delete(tab.id) && !wc.isDestroyed()) wc.setAudioMuted(tab.muted);
      }
      // (2026-10-14: a click never closes the tab list; only his mouse leaving it does.)
    });
    wc.setWindowOpenHandler(({ url: u, disposition }) => {
      this.inTab(tab);
      // Phase 1 (parity sweep): a blank page or a blob: page the site builds itself (print previews, generated PDFs,
      // some sign-ins write into window.open('')) opens as a small window that keeps its link to the page.
      const own = ownPopup(u, wc.getURL());
      if (!isWeb(u) && !own) { this.offerApp(tab, u); return { action: 'deny' }; }
      // A page on the internet never opens this computer or the home network in a new tab or window either.
      if (goesInward(u, wc.getURL())) { console.log('shell: browser: a page tried to open a home-network address'); return { action: 'deny' }; }
      if (own) disposition = 'new-window';
      // Sheet 111: in a tab Claude is driving, a new tab opens in that same tab (as Claude's pages always did); a small
      // window (a sign in popup) still opens as for his own tabs. Once he has the tab, it is his browsing.
      const cp = this.driver.pageOfTab(tab.id);
      if (cp?.borrowed?.own && !this.hands.has(cp.id) && disposition !== 'new-window') { this.driver.openHere(cp.id, u); return { action: 'deny' }; }
      if (disposition === 'new-window') {
        let site = '';
        try { site = new URL(wc.getURL()).hostname.replace(/^www\./, ''); } catch { /* none */ }
        const his = Date.now() - (this.lastGesture.get(tab.id) ?? 0) < GESTURE_MS;
        if (this.listed(u).length) return { action: 'deny' };
        if (!this.prefs.popups || (his && (own || this.fairOpen(tab, wc.getURL(), u))) || this.popOk(site)) {
          // Over Samara's own window, fully on that screen (2026-11-13: Samara's pop-ups came up in the middle
          // of his other screen, cut off, wherever Windows put a window with no place of its own).
          return { action: 'allow', overrideBrowserWindowOptions: { ...this.overWindow(520, 680), autoHideMenuBar: true, backgroundColor: PAGE_COLOUR,
            title: 'Samara', webPreferences: { ...SAFE_WEB_PREFERENCES, session: this.ses, preload: this.o.tabPreloadPath } } };
        }
        // His call (2026-10-12): no chip. The shield glows one solid blue; he clicks it to see what was blocked and
        // can open it or allow the site, so a popup he was actually waiting for is one click away.
        console.log('shell: browser: popup blocked');
        tab.blockedPopup = { url: u, site };
        this.sendTabs();
        return { action: 'deny' };
      }
      // A new TAB a page opens (window.open with no size, a link in a new tab) needs his click too (security check
      // 2026-10-24, finding 7): before, only new windows were checked, so a page could open tabs by itself.
      if (this.listed(u).length) return { action: 'deny' };
      const his = Date.now() - (this.lastGesture.get(tab.id) ?? 0) < GESTURE_MS;
      let site = '';
      try { site = new URL(wc.getURL()).hostname.replace(/^www\./, ''); } catch { /* none */ }
      if (this.prefs.popups && !(his && this.fairOpen(tab, wc.getURL(), u)) && !this.popOk(site)) {
        console.log('shell: browser: a tab the page opened by itself was blocked');
        tab.blockedPopup = { url: u, site };
        this.sendTabs();
        return { action: 'deny' };
      }
      this.newTab(u, tab.id, disposition !== 'background-tab');
      return { action: 'deny' };
    });
    on('did-create-window', (pw) => this.popupWindow(pw));
    // 6.22: a listed site never loads, whether it is a link, a redirect or anything else.
    // A page on the internet never sends him to this computer or the home network (security check 2026-10-24, finding 9:
    // a page could quietly post a form to his router's settings). He can still type such an address himself.
    const inward = (u: string) => { try { return privateHost(new URL(u).hostname) && !privateHost(new URL(wc.getURL()).hostname) && /^https?:$/.test(new URL(wc.getURL()).protocol); } catch { return false; } };
    const refuseInward = (e: Electron.Event, u: string) => { e.preventDefault(); let h = ''; try { h = new URL(u).host; } catch { /* none */ } this.note('', { kind: 'bad', from: 'shield', icon: 'wont', kick: 'Stopped', title: h || 'A home network address', rows: [{ g: 'Why', v: 'A website tried to open it on your home network. Type it in yourself if you meant to go there.' }] }); };
    on('will-navigate', (e, u) => {
      if (!isWeb(u)) { e.preventDefault(); this.offerApp(tab, u); return; }
      if (inward(u)) { refuseInward(e, u); return; }
      if (this.toPaid(u)) { e.preventDefault(); return; }
      const l = this.stopFor(u);
      if (l.length) { e.preventDefault(); this.block(tab, u, l); return; }
      const up = upgrade(u, this.httpOk);
      if (up) { e.preventDefault(); tab.upgraded = u; setTimeout(() => { if (!wc.isDestroyed()) void wc.loadURL(up).catch(() => {}); }, 0); }
    });
    on('will-redirect', (e, u, _inPage, isMain) => {
      if (!isMain) return;
      if (isWeb(u) && inward(u)) { refuseInward(e, u); return; }
      if (isWeb(u) && this.toPaid(u)) { e.preventDefault(); return; }
      if (!isWeb(u) && appOf(u)) { e.preventDefault(); this.offerApp(tab, u); return; }
      // A link for something that is not a web page and that no app here opens: stopped quietly, never shown as a fake
      // site (2026-10-25: that red plate told him shadow.tech's sign-in was a fake login page).
      if (!isWeb(u)) { e.preventDefault(); let sc = ''; try { sc = new URL(u).protocol; } catch { /* odd */ } this.note('', { kind: 'bad', from: 'shield', small: true, icon: 'wont', kick: 'No app opens', title: `${sc.replace(/:$/, '') || 'Those'} links` }); return; }
      const l = this.stopFor(u);
      if (l.length) { e.preventDefault(); this.block(tab, u, l); return; }
      const up = upgrade(u, this.httpOk);
      if (!up) return;
      e.preventDefault();
      // The secure version sent us straight back to the plain one: it has no secure version.
      let back = false;
      try { back = tab.upgraded !== null && new URL(tab.upgraded).hostname === new URL(u).hostname; } catch { /* no */ }
      if (back) { this.fail(tab, { kind: 'insecure', url: u, title: "This site isn't secure", text: '', retry: false }); return; }
      tab.upgraded = u;
      setTimeout(() => { if (!wc.isDestroyed()) void wc.loadURL(up).catch(() => {}); }, 0);
    });
    // A new page clears the last failure; a different site forgets the upgrade.
    on('did-start-navigation', (d) => {
      const x = d as unknown as { url: string; isMainFrame: boolean; isSameDocument: boolean };
      if (!x.isMainFrame || x.isSameDocument) return;
      if (tab.failed) { tab.failed = null; this.place(); this.changed(); }
      if (tab.blockedPopup) { tab.blockedPopup = null; this.sendTabs(); }   // a new page: the old popup is old news
      try { if (tab.upgraded && new URL(tab.upgraded).hostname !== new URL(x.url).hostname) tab.upgraded = null; } catch { tab.upgraded = null; }
    });
    // The page did not load: the companion's own plate instead of Chromium's grey page. Cancelled loads (-3) are not failures.
    on('did-fail-load', (_e, code, _desc, url, isMain) => {
      if (isMain) { tab.pending = null; if (this.veil?.tab === tab.id) this.veilDown(0); }
      if (!isMain || code === -3 || !isWeb(url)) return;
      let host = '';
      try { host = new URL(url).hostname; } catch { /* keep */ }
      let wasUp = false;
      try { wasUp = tab.upgraded !== null && url.startsWith('https:') && new URL(tab.upgraded).hostname === host; } catch { /* no */ }
      if (wasUp && code !== -106 && code !== -105) this.fail(tab, { kind: 'insecure', url: tab.upgraded!, title: "This site isn't secure", text: '', retry: false });
      else this.fail(tab, { kind: 'error', url, ...failureWords(code, host) });
    });
    on('did-start-navigation', (d) => {
      const x = d as unknown as { url: string; isMainFrame: boolean };
      if (!x.isMainFrame || !isWeb(x.url)) return;
      const l = this.stopFor(x.url);
      if (l.length) { this.block(tab, x.url, l); return; }
      // Safe Browsing (private mode): its fingerprint is on Google's kept list and not answered yet. Hold the page,
      // ask Google about the 4-byte prefix only, then block it or load it again (the answer is kept, so no loop).
      const sb = this.sb;
      if (sb?.suspect(x.url)) {
        // Stopped just after this event, never inside it: stopping from inside did-start-navigation crashed Electron.
        setImmediate(() => { try { if (!wc.isDestroyed()) wc.stop(); } catch { /* gone */ } });
        void sb.verdict(x.url).then((threats) => {
          if (wc.isDestroyed()) return;
          if (threats.length) this.block(tab, x.url, [SB_NAME]);
          else void wc.loadURL(x.url).catch(() => { /* the page's own error shows */ });
        });
      }
    });
    // A mockup keeps the name Claude gave it ("46 · One cockpit"), and never goes into his History.
    on('page-title-updated', (_e, title) => { if (tab.mock) return; tab.title = title; this.visits.name(wc.getURL(), title); this.changed(); });
    on('page-favicon-updated', (_e, icons) => {
      tab.favicon = icons.find((i) => /^https?:|^data:image\//.test(i)) ?? '';
      this.sendTabs();
      // Keep it for the site's bookmark, so the shelf shows it even before he visits again.
      try { const u = new URL(wc.getURL()); if (tab.favicon && !this.icons.has(u.hostname)) void this.keepIcon(u.hostname, [...icons, u.origin + '/favicon.ico']); } catch { /* none */ }
    });
    on('did-start-loading', () => { tab.loading = true; if (tab.crashed) { tab.crashed = false; this.place(); } this.sendTabs(); });
    on('did-stop-loading', () => {
      tab.loading = false; tab.phase = 'idle'; tab.prog = 1; tab.pending = null; tab.drawn = true;
      // A woken page "finishes" while it is still rearranging itself (YouTube, filmed 2026-10-23): its picture stays until
      // it has held still (painted()).
      if (this.veil?.tab === tab.id && !tab.waking) this.veilDown(VEIL_FADE_MS);
      this.sendTabs();
      // Sheet 121 (3): its hover picture, once it has settled (only the page in front can be pictured).
      setTimeout(() => { if (tab.id === this.active) void this.cardOf(tab); }, 1200);
      void this.googleCheck(wc, () => { const h = wc.navigationHistory, i = h.getActiveIndex(); return i > 0 ? h.getEntryAtIndex(i - 1)?.url ?? '' : ''; });
    });
    // The loading steps (2026-10-12): the click, the site answering, the page read, the page drawn (painted()).
    on('did-start-navigation', (d) => {
      const x = d as unknown as { url: string; isMainFrame: boolean; isSameDocument: boolean };
      if (!x.isMainFrame || x.isSameDocument) return;
      tab.phase = 'waiting'; tab.prog = 0.08;
      if (this.af?.tab === tab.id) { this.af = null; this.lightHide(); }
      if (isWeb(x.url)) void this.veilUp(tab);
      this.sendTabs();
    });
    on('dom-ready', () => {
      this.paintDark(tab);
      // Watch mode's look (watchmode.ts): the tab's own script turns it on with the site's theater mode.
      try { if (WATCH_HOSTS.test(new URL(wc.getURL()).hostname)) void wc.insertCSS(WATCH_CSS).catch(() => {}); } catch { /* not a page */ }
      if (tab.phase !== 'idle') { tab.prog = Math.max(tab.prog ?? 0, 0.55); this.sendTabs(); }
    });
    on('did-navigate', (_e, u, status) => {
      if (/^https:\/\/(www\.)?netflix\.com(:\d+)?\/watch\//i.test(u)) this.watchPlays(tab, u);
      if (STREMIO_WEB.test(u)) { void startStremio(); this.stremioMoved(tab, u); }
      tab.url = u; tab.scrollY = 0; if (status > 0) tab.upgraded = null; if (status < 400 && !tab.mock) this.visits.add(u, '');
      tab.pending = null;
      if (tab.phase !== 'idle') { tab.phase = 'loading'; tab.prog = Math.max(tab.prog ?? 0, 0.35); }
      this.changed();
    });
    on('did-navigate-in-page', (_e, u, main) => {
      if (main && STREMIO_WEB.test(u)) this.stremioMoved(tab, u);
      // A show started inside the page (Netflix changes page without loading one, 2026-10-14): where paid
      // video plays in its own window, the show goes there and this tab steps back to where it was.
      if (main && /^https:\/\/(www\.)?netflix\.com(:\d+)?\/watch\//i.test(u)) { if (this.toPaid(u)) { if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return; } this.watchPlays(tab, u); }
      // Only the page's own move changes its address (2026-10-30: Gmail's compose showed contacts.google.com, a
      // frame inside it).
      if (!main) return;
      tab.url = u; if (!tab.mock) this.visits.add(u, wc.getTitle()); this.changed();
      void this.googleCheck(wc, () => '');
    });
    // Find on page: how many matches, and which one is lit. Only the tab he is looking at reports.
    on('found-in-page', (_e, r) => { if (tab.id === this.active) this.win?.webContents.send('browser:found', { at: r.activeMatchOrdinal, of: r.matches }); });
    // 6.22b bug 1: a page's own fullscreen (a video's button) fills the whole screen, band and drawer gone; it
    // comes back exactly as it was when the page leaves fullscreen (its button, or Esc).
    on('enter-html-full-screen', () => { if (!tab.lent) this.pageFullOn(tab, view); });
    on('leave-html-full-screen', () => this.pageFullOff(tab, view));
    // 6.22b bug 2: right-click on the page opens the companion's own wood menu.
    on('context-menu', (_e, p) => this.pageMenu(tab, p));
    // Link preview (6.22b item 8): the real address of the link he points at, shown in the wood under the page.
    on('update-target-url', (_e, u) => { if (tab.id === this.active) this.win?.webContents.send('browser:hover', isWeb(u) ? u.slice(0, 600) : ''); });
    // One video at a time (2026-10-13): when this tab starts making sound, every other one stops, here and on
    // the other machine. Sound, not just playing: a silent hover preview (YouTube's front page) stops nothing.
    // The pop-out is made ready the moment something plays here (2026-10-22): the first Popout is then as quick as any.
    on('media-started-playing', () => { if (!tab.internal) { try { this.onPlaying?.(); } catch { /* the video plays on */ } } });
    on('audio-state-changed', (e) => {
      const was = tab.audible;
      tab.audible = (e as unknown as { audible: boolean }).audible;
      if (tab.audible && !was && !tab.call) this.onePlaying(tab);
      this.sendTabs();
    });
    // A crashed page goes blank and anything that pokes it hangs (tested 2026-10-04): mark it, never touch it.
    // Nothing it was doing carries on (2026-10-30): a tab that crashed while playing no longer counts as playing.
    // 2026-11-18 (a black full screen he could not close): a page that dies in full screen gives the screen back.
    on('render-process-gone', () => { tab.crashed = true; tab.loading = false; tab.audible = false; tab.frozen = false; tab.freezing = false; tab.waking = false; if (this.fullTab === tab.id) this.pageFullOff(tab, view); this.place(); this.sendTabs(); });
    // The keys work wherever the keyboard is, page or frame.
    // Not while it is lent to the popout: Ctrl+W there must not close a tab in here.
    on('before-input-event', (e, input) => { if (this.afKey(tab, input)) { e.preventDefault(); return; } if (!tab.lent && this.key(input)) e.preventDefault(); });
    // Back where it was: the zoom at once. The scroll (2026-10-22, measured on his Mac: it waited for every picture on
    // the page, so a busy page sat at the top for up to ~15 s and then jumped): Chromium's own saved state when there is
    // one, so the page draws where he left it, as Chrome does after a restart; otherwise as soon as the page can scroll,
    // and once more when it has loaded, unless he has scrolled it himself in between.
    if (tab.zoom) wc.setZoomLevel(tab.zoom);
    if (tab.muted) wc.setAudioMuted(true);
    const back = Math.round(tab.scrollY), state = tab.pageState;
    tab.pageState = undefined;                          // used once: a later wake loads the page afresh
    // A mockup from an earlier run: the page server has a new port each run, the commit and path stay the same.
    // (A live page, 2026-10-22, has no commit and keeps its own address.)
    if (tab.mock?.commit && this.mockServer) tab.url = this.mockServer.rebase(tab.url);
    const l = this.stopFor(tab.url);
    if (l.length) { this.block(tab, tab.url, l); return; }
    tab.blocked = null;
    const to = this.secured(tab, tab.url);
    if (state && to === tab.url && !tab.mock) {
      wc.navigationHistory.restore({ index: 0, entries: [{ url: tab.url, title: tab.title, pageState: state }] }).catch(() => { if (!wc.isDestroyed()) void wc.loadURL(to).catch(() => {}); });
      return;
    }
    if (back > 0) {
      // The page engine's main-world run does not wait for the page to finish loading (page.ts).
      let placed = -1;
      wc.once('dom-ready', () => { void run(wc, `(scrollTo(0, ${back}), scrollY)`, { fallback: null }).then((y) => { if (y !== null) placed = Number(y); }); });
      wc.once('did-finish-load', () => { void run(wc, `(scrollY === ${placed} || scrollY === 0) && scrollTo(0, ${back})`, { fallback: null }); });
    }
    void wc.loadURL(to).catch(() => {});
  },

  /**
   * The Settings tab (2026-10-12): the browser's own page in a tab. It has its own small preload with
   * only the settings doors, lives in the companion's own session (never his browsing one), and is pinned to its page:
   * nothing can navigate it anywhere, and typing an address while on it opens a new tab instead.
   */
  wakeSettings(this: SamaraBrowser, tab: Tab): void {
    const things = tab.internal === 'things', log = tab.internal === 'mocklog';
    const view = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, preload: log ? path.join(path.dirname(this.o.thingsPreloadPath), 'mocklogpreload.cjs') : things ? this.o.thingsPreloadPath : this.o.settingsPreloadPath } });
    const wc = view.webContents;
    lockDown(wc);
    view.setBackgroundColor('#24160D');
    try { view.setBorderRadius(PAGE_RADIUS); } catch { /* square */ }
    view.setVisible(false);
    this.inTab(tab);
    this.win?.contentView.addChildView(view);
    this.raiseTray();
    tab.view = view; tab.crashed = false; tab.loading = false; tab.title = log ? 'Mockups' : things ? 'Your things' : 'Settings';
    wc.on('before-input-event', (e, input) => {
      this.inTab(tab);
      // Sheet 107 v4: Esc leaves Mockups, from the sheet's frame too; the page decides (Esc first closes the mark's menu).
      if (log && input.type === 'keyDown' && input.key === 'Escape' && !input.isAutoRepeat) { e.preventDefault(); wc.send('mocklog:esc'); return; }
      if (this.key(input)) e.preventDefault();
    });
    wc.on('render-process-gone', () => { this.inTab(tab); tab.crashed = true; this.place(); this.sendTabs(); });
    if (log) wc.once('did-finish-load', () => { this.mockLogSig = ''; this.pushMockLog(); });
    void wc.loadURL(`${this.o.origin}/${log ? 'mocklog' : things ? 'things' : 'settings'}.html`).catch(() => {});
  },

  // The page is made at once, like every tab's (the window lays the tab out as soon as it is picked: a page that came
  // later left it null and threw, 2026-11-03); it loads the map once its server is up.
  wakeHyrule(this: SamaraBrowser, tab: Tab): void {
    const dir = this.o.hyruleDir;
    if (!dir) return;
    // BG10: the pages hear a rewritten live file (state.json, pos.json...) on GET /live/events, watched through live/.
    this.hyrulePages ??= servePages(dir, '/index.html', { live: path.join(dir, 'live') });
    // BG5: its own small preload (hyrulepreload.cjs), only the notes' doors.
    const view = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, preload: path.join(path.dirname(this.o.thingsPreloadPath), 'hyrulepreload.cjs') } });
    const wc = view.webContents;
    view.setBackgroundColor('#06121c');
    try { view.setBorderRadius(PAGE_RADIUS); } catch { /* square */ }
    view.setVisible(false);
    this.inTab(tab);
    this.win?.contentView.addChildView(view);
    this.raiseTray();
    tab.view = view; tab.crashed = false; tab.loading = true; tab.title = 'Hyrule';
    wc.on('before-input-event', (e, input) => { this.inTab(tab); if (this.key(input)) e.preventDefault(); });
    wc.on('render-process-gone', () => { this.inTab(tab); tab.crashed = true; if (this.fullTab === tab.id) this.pageFullOff(tab, view); this.place(); this.sendTabs(); });
    wc.on('did-finish-load', () => { tab.loading = false; this.sendTabs(); this.routeDeliver(); });
    wc.on('enter-html-full-screen', () => { this.inTab(tab); this.pageFullOn(tab, view); });
    wc.on('leave-html-full-screen', () => { this.inTab(tab); this.pageFullOff(tab, view); });
    this.hyrulePages.then((pages) => {
      if (wc.isDestroyed()) return;
      lockDown(wc, { sameOrigin: pages.origin });
      void wc.loadURL(`${pages.origin}/index.html`).catch(() => {});
    }, (e: Error) => { this.hyrulePages = null; console.error('hyrule: the map could not be served: ' + e.message); });
  },

  /**
   * The Hyrule key (2026-11-03: "this was behaviour I cut out with the mockups"): like Mockups, never a tab in
   * his list. The key takes the page area over and lights up; the key again (or any of his tabs) puts him back on the
   * tab he was on, and the map stays where he left it for next time. Nothing happens on a machine without the map's folder.
   */
  openHyrule(this: SamaraBrowser): boolean {
    if (!this.o.hyruleDir) return false;
    if (!this.win || this.win.isDestroyed()) { this.whenOpen.push(() => this.openHyrule()); if (!this.lastPane()) this.createPane(); return true; }
    let t = this.tabs.find((x) => x.internal === 'hyrule');
    const was = this.cur();
    if (t && was === t) { this.hyruleLeave(); return true; }
    if (was && was.internal !== 'hyrule') this.hyruleFrom = was.id;
    if (!t) {
      t = { id: ++this.seq, internal: 'hyrule', view: null, opener: null, title: 'Hyrule', url: 'samara:hyrule', favicon: '', loading: false, audible: false, muted: false, crashed: false,
        scrollY: 0, zoom: 0, lastSeen: Date.now(), blocked: null, trail: null, done: false, lent: false, upgraded: null, failed: null, blockedPopup: null, pane: this.pane.id };
      this.tabs.push(t);
    }
    this.activate(t.id);
    this.win?.focus();
    return true;
  },

  /** Back from Hyrule to the tab he was on (the newest of his own if that one is gone, else a new one). */
  hyruleLeave(this: SamaraBrowser): void {
    const h = this.tabs.find((x) => x.internal === 'hyrule');
    if (!h) return;
    const mine = (x: Tab) => x !== h && !x.done && x.pane === h.pane;
    const back = this.tabs.find((x) => x.id === this.hyruleFrom && mine(x)) ?? [...this.tabs].filter((x) => mine(x) && !x.internal).sort((a, b) => b.lastSeen - a.lastSeen)[0];
    this.hyruleFrom = null;
    if (back) this.activate(back.id); else this.newTab(this.HOME);
  },

  isSettings(this: SamaraBrowser, sender: Electron.WebContents): boolean { const t = this.tabs.find((x) => x.internal === 'settings' && x.view?.webContents === sender); if (t) this.inTab(t); return Boolean(t); },

  /** Open Settings (or bring its tab forward), at a section. */
  openSettings(this: SamaraBrowser, section = 'general'): void {
    if (!this.win || this.win.isDestroyed()) return;
    let t = this.tabs.find((x) => x.internal === 'settings');
    if (!t) {
      t = { id: ++this.seq, internal: 'settings', view: null, opener: null, title: 'Settings', url: 'samara:settings', favicon: '', loading: false, audible: false, muted: false, crashed: false,
        scrollY: 0, zoom: 0, lastSeen: Date.now(), blocked: null, trail: null, done: false, lent: false, upgraded: null, failed: null, blockedPopup: null, pane: this.pane.id };
      this.tabs.push(t);
    }
    this.activate(t.id);
    this.win?.focus();
    const wc = t.view?.webContents;
    if (wc) { const go = () => wc.send('settings:section', String(section).slice(0, 20)); if (wc.isLoading()) wc.once('did-finish-load', go); else go(); }
  },

  /** Everything Settings shows. Plain data only. */
  async settingsData(this: SamaraBrowser): Promise<Record<string, unknown>> {
    // The Bitwarden check takes over 2 seconds (it starts a whole program), so Settings draws with the last
    // known answer and is updated when the fresh one comes in.
    const vault = this.vault.known;
    if (!this.vaultChecking) {
      this.vaultChecking = true;
      void this.vault.state().then((v) => { this.vaultChecking = false; if (v !== vault) this.pushSettings(); }, () => { this.vaultChecking = false; });
    }
    return {
      home: this.prefs.home !== DEFAULT_HOME ? this.prefs.home : '', homeNow: this.HOME,
      search: this.prefs.search, aiBox: this.prefs.aiBox, startup: this.prefs.startup,
      ads: this.prefs.ads, popups: this.prefs.popups, sounds: this.sounds, dark: this.prefs.dark, tabSize: this.tabSize,
      popupOk: [...this.popupOk].sort(), trusted: [...this.trusted].sort(), httpOk: [...this.httpOk].sort(), sites: this.yourSites(),
      marks: this.marks.slice(0, 400).map((m) => ({ title: m.title, url: m.url, favicon: this.iconOf(m.url) })), markCount: this.marks.length,
      vault, phish: this.phish.count(),
      // -1: no key yet (off); otherwise how many of Google's fingerprints are kept on this PC.
      safeBrowsing: this.sb ? (this.sb.key() ? this.sb.count() : -1) : -2,
      afSounds: this.prefs.afSounds, lockAfter: this.prefs.lockAfter,
      autofill: { details: this.details.get(), pin: this.pinSeal.has(), pinLen: this.pinSeal.has() ? this.pinSeal.length() : 0, sounds: this.prefs.afSounds },
      versions: { electron: process.versions.electron, chrome: process.versions.chrome }, mac: process.platform === 'darwin' || Boolean(this.o.tvAt),
      // Sheet 99: his TV (kept on this Mac only, tv-remote.json; the PC has no TV link)
      ...(() => { const c = this.tvCfg(); return { tv: { name: c.name, linked: c.linked }, tvAnswer: c.answer, tvPause: c.pause }; })(),
      // N0: his notes, as Settings › Notes shows them (null until they have started).
      notes: this.notesHub?.status() ?? null,
    };
  },

  pushSettings(this: SamaraBrowser): void {
    const wc = this.tabs.find((x) => x.internal === 'settings')?.view?.webContents;
    if (wc && !wc.isDestroyed()) void this.settingsData().then((d) => { if (!wc.isDestroyed()) wc.send('settings:data', d); });
  },

  /** A change made in Settings. Only these keys; anything else is ignored. */
  setSetting(this: SamaraBrowser, key: string, value: unknown): void {
    switch (key) {
      case 'home': this.setHome(String(value ?? '')); break;
      case 'search': this.prefs.search = value === 'ddg' || value === 'google' ? value : 'brave'; setSearch(this.prefs.search, this.prefs.aiBox); this.savePrefs(); break;
      case 'aiBox': this.prefs.aiBox = value === true; setSearch(this.prefs.search, this.prefs.aiBox); this.savePrefs(); break;
      case 'startup': this.prefs.startup = value === 'home' ? 'home' : 'tabs'; this.savePrefs(); break;
      case 'ads': case 'popups': case 'sounds': case 'dark': this.setPref(key, value === true); break;
      // Autofill (sheet 77): his details, the sound switch, and his PIN (set while Bitwarden is open).
      case 'afDetails': this.details.set(cleanDetails(value)); this.sync?.changed('prefs'); break;
      case 'afSounds': this.prefs.afSounds = value === true; this.savePrefs(); break;
      case 'afPin': void this.afSetPin(value); return;
      case 'tvAnswer': this.saveTvCfg({ ...this.tvCfg(), answer: value === true }); break;
      case 'tvPause': this.saveTvCfg({ ...this.tvCfg(), pause: value === true }); break;
      case 'lockAfter': this.prefs.lockAfter = lockPick(value); this.vault.setLockAfter(LOCK_AFTER[this.prefs.lockAfter]); this.savePrefs(); break;
      case 'tabSize': {
        this.tabSize = value === 's' || value === 'm' ? value : 'l';
        try { writeFileAtomic(this.localFile, JSON.stringify({ tabSize: this.tabSize })); } catch { /* this run only */ }
        // The list layer hears it at once, open or not, so its next slide starts at the new width.
        for (const p of this.panes) {
          // ...and is drawn again out of sight at the new size, so the first open after the change is smooth too.
          if (p.trayV && !p.trayV.webContents.isDestroyed()) { p.trayV.webContents.send('browser:tray', { size: this.tabSize }); if (!p.trayOn) { const v = p.trayV; setTimeout(() => this.warmTray(p, v), 150); } }
          if (p.trayOn) { const was = this.pane; this.pane = p; this.placeTray(); this.pane = was; }
        }
        break;
      }
      default: return;
    }
    this.sendTabs();
    this.pushSettings();
  },

  /** Take one entry off a list he made (sites allowed popups, trusted for downloads, opened without https, bookmarks). */
  removeEntry(this: SamaraBrowser, list: string, value: string): void {
    const v = String(value ?? '').slice(0, 2000);
    const save = (f: string, s: Set<string>) => { try { writeFileAtomic(f, JSON.stringify([...s])); } catch { /* best effort */ } };
    if (list === 'popupOk' && this.popupOk.delete(v)) save(this.popupOkFile, this.popupOk);
    else if (list === 'trusted' && this.trusted.delete(v)) save(this.trustedFile, this.trusted);
    else if (list === 'httpOk' && this.httpOk.delete(v)) save(this.httpOkFile, this.httpOk);
    else if (list === 'marks') { const i = this.marks.findIndex((m) => m.url === v); if (i >= 0) { this.marks.splice(i, 1); this.saveMarks(); } }
    else if (list !== 'trusted' && list !== 'httpOk') return;
    if (list === 'trusted' && this.peerTrusted.delete(v)) save(this.trustedFile.replace(/[.]json$/, '-other.json'), this.peerTrusted);
    if (list === 'httpOk' && this.peerHttp.delete(v)) save(this.httpOkFile.replace(/[.]json$/, '-other.json'), this.peerHttp);
    if (list !== 'marks') this.sync?.changed('prefs');
    this.sendTabs();
    this.pushSettings();
  },

  /**
   * Sheet 83 (2026-10-23): the address he is typing in Settings, looked up with OpenStreetMap (Photon), so he
   * picks it and the rest fills in. Only what he typed in that box goes out, and only from Settings; answers are plain text.
   */
  async addressLookup(this: SamaraBrowser, text: string): Promise<{ line: string; street: string; city: string; region: string; postal: string; country: string }[]> {
    const q = String(text ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    if (q.length < 4) return [];
    const clip = (v: unknown, n = 120) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
    try {
      const r = await within(net.fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en`, { credentials: 'omit', redirect: 'error' }).then((x) => (x.ok ? x.json() : null)), 6000, null);
      const out: { line: string; street: string; city: string; region: string; postal: string; country: string }[] = [];
      for (const f of (r as { features?: { properties?: Record<string, unknown> }[] } | null)?.features ?? []) {
        const p = f.properties ?? {};
        const road = clip(p.street ?? (p.type === 'street' ? p.name : ''));
        if (!road) continue;
        const street = [clip(p.housenumber, 20), road].filter(Boolean).join(' ');
        const city = clip(p.city ?? p.town ?? p.village ?? p.district ?? p.county), region = clip(p.state), postal = clip(p.postcode, 20).toUpperCase(), country = clip(p.country, 80);
        const line = [street, city, region].filter(Boolean).join(', ');
        if (!out.some((o) => o.line === line)) out.push({ line, street, city, region, postal, country });
        if (out.length === 5) break;
      }
      return out;
    } catch { return []; }
  },

  settingsAct(this: SamaraBrowser, act: string): void {
    if (act === 'import') void this.importMarks().then(() => this.pushSettings());
    else if (act === 'import-chrome' || act === 'import-safari') void this.importFrom(act === 'import-chrome' ? 'chrome' : 'safari').then(() => this.pushSettings());
    else if (act === 'lockvault') { this.vault.lock(); this.pushSettings(); }
    else if (act === 'afforgetpin') { this.pinSeal.wipe(); this.pushSettings(); }
    else if (act === 'tvunlink') { this.saveTvCfg({ ...this.tvCfg(), linked: false }); console.log('shell: TV: unlinked'); this.pushSettings(); }
    else if (act === 'notesbackup' || act === 'notesexport') this.notesHub?.act(act);
    else if (act === 'signout') { this.pinSeal.wipe(); void this.vault.signOut().then(() => this.pushSettings()); }
  },

  // ------------------------------------------------------------------ 6.22b: side buttons, the window's place, the right-click menu
  sideNav(this: SamaraBrowser, dir: 'back' | 'forward'): void {
    const now = Date.now();
    if (now - this.lastNav < 250) return;
    this.lastNav = now;
    this.act(dir);
  },

  /** The square key's menu (2026-10-23): fill, halves, his other screens, full screen. */
  windowMenu(this: SamaraBrowser): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    const here = screen.getDisplayMatching(w.getBounds()), a = here.workArea, half = Math.floor(a.width / 2);
    const put = (r: Electron.Rectangle) => { if (w.isFullScreen()) w.setFullScreen(false); if (w.isMaximized()) w.unmaximize(); w.setBounds(r, true); };
    const others = screen.getAllDisplays().filter((d) => d.id !== here.id);
    const moveTo = (d: Electron.Display) => {
      const b = w.isMaximized() ? null : w.getBounds(), t = d.workArea;
      if (!b) { w.unmaximize(); w.setBounds({ ...t }, true); w.maximize(); return; }
      const width = Math.min(b.width, t.width), height = Math.min(b.height, t.height);
      put({ x: t.x + Math.min(Math.max(0, b.x - a.x), t.width - width), y: t.y + Math.min(Math.max(0, b.y - a.y), t.height - height), width, height });
    };
    Menu.buildFromTemplate([
      { label: w.isMaximized() ? 'Back to its size' : 'Fill the screen', click: () => { if (w.isMaximized()) w.unmaximize(); else w.maximize(); } },
      { label: 'Left half', click: () => put({ x: a.x, y: a.y, width: half, height: a.height }) },
      { label: 'Right half', click: () => put({ x: a.x + half, y: a.y, width: a.width - half, height: a.height }) },
      ...(others.length ? [{ type: 'separator' as const }, ...others.map((d, i) => ({ label: `Move to ${d.label || (others.length > 1 ? `screen ${i + 2}` : 'the other screen')}`, click: () => moveTo(d) }))] : []),
      { type: 'separator' },
      { label: w.isFullScreen() ? 'Leave full screen' : 'Full screen', click: () => toggleFull(w) },
    ]).popup({ window: w });
  },

  winDrag(this: SamaraBrowser, sender: Electron.WebContents, phase: string, x: number, y: number): void {
    const w = BrowserWindow.fromWebContents(sender);
    if (!w || w.isDestroyed() || w.isFullScreen()) return;
    if (phase === 'start') { if (w.isMaximized()) return; const [wx, wy] = w.getPosition(); this.dragFrom = { x, y, wx: wx!, wy: wy! }; return; }
    const d = this.dragFrom;
    if (!d) return;
    if (phase === 'move') w.setPosition(d.wx + x - d.x, d.wy + y - d.y);
    else this.dragFrom = null;
  },

  backToSetupSpot(this: SamaraBrowser): void {
    const w = this.panes[0]?.win;
    if (!w || w.isDestroyed() || w.isFullScreen()) return;
    let p: { x: number; y: number; width: number; height: number; maximized?: boolean } | undefined;
    p = readJson<any>(this.placeFile, null)?.setups?.[this.screensNow()];
    if (!p || ![p.x, p.y, p.width, p.height].every(Number.isFinite)) return;
    if (w.isMaximized()) w.unmaximize();
    w.setBounds({ x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) });
    if (p.maximized) w.maximize();
  },

  /** Which screens are plugged in, as a name for this setup: the laptop alone, or with the monitor (2026-10-23). */
  screensNow(this: SamaraBrowser): string { return screen.getAllDisplays().map((d) => `${d.id}:${d.bounds.width}x${d.bounds.height}`).sort().join('|'); },

  /** Where the window was last time, if that spot is still on a screen he has. */
  savedPlace(this: SamaraBrowser): { x: number; y: number; width: number; height: number; maximized: boolean } | null {
    try {
      const all = readJson<any>(this.placeFile, null);
      // Each screen setup keeps its own spot (2026-10-23); a setup never seen yet uses the last one.
      const p = all?.setups?.[this.screensNow()] ?? all;
      const r = { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) };
      if (!Object.values(r).every(Number.isFinite) || r.width < 720 || r.height < 480) return null;
      // At least a good piece of the band must land on a screen, or it opens where it opens by default.
      const ok = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        const w = Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x);
        return w >= 200 && r.y >= a.y - 8 && r.y + 40 <= a.y + a.height;
      });
      return ok ? { ...r, maximized: p.maximized === true } : null;
    } catch { return null; }
  },

  keepPlace(this: SamaraBrowser): void {
    const w = this.win;
    if (!w || w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return;
    const b = w.getNormalBounds();
    const spot = { ...b, maximized: w.isMaximized() };
    let setups: Record<string, unknown> = {};
    setups = readJson<any>(this.placeFile, null)?.setups ?? {};   // first time: none
    try { writeFileAtomic(this.placeFile, JSON.stringify({ ...spot, setups: { ...setups, [this.screensNow()]: spot } })); } catch { /* best effort */ }
  },

  /** Build the right-click menu for what was clicked: a link, a picture, selected words, a text box, or the page. */
  pageMenu(this: SamaraBrowser, tab: Tab, p: Electron.ContextMenuParams): void {
    const w = this.win;
    const wc = tab.view?.webContents;
    if (!w || w.isDestroyed() || !wc || tab.lent) return;
    // Sheet 62 (2026-10-22): the items are built in pagemenu.ts, with "Send to companion" first in every menu.
    const items = pageMenuItems(p, {
      ask: Boolean(this.onAskClaude) && !tab.internal && isWeb(tab.url), send: Boolean(this.onSendToCompanion) && !tab.internal, other: this.onOpenOther ? OTHER_OPEN : null, popout: Boolean(this.onPlayInPopout),
      popVideo: Boolean(this.popTab) && !tab.internal, canBack: wc.navigationHistory.canGoBack(), pageIsWeb: isWeb(tab.url),
    });
    this.menuFor = { tab: tab.id, p };
    this.menuItems = items;
    this.menuAt = null;
    this.menuChats = [];
    const m = this.ensureMenu();
    if (!m.webContents.isLoading()) m.webContents.send('pagemenu:items', items);
    // Sheet 109: the chats are asked for as the menu opens, so the list is there by the time he points at Ask Claude.
    if (items.some((x) => 'id' in x && x.id === 'askclaude')) {
      const at = this.menuFor;
      void (this.claudeChats?.() ?? Promise.resolve([])).catch(() => [] as Chat[]).then((list) => {
        if (this.menuFor !== at || !this.menu || this.menu.isDestroyed()) return;
        this.menuChats = list.slice(0, 4);
        this.menu.webContents.send('pagemenu:chats', this.menuChats.map((c) => ({ name: c.name })));
      });
    }
  },

  ensureMenu(this: SamaraBrowser): BrowserWindow {
    if (this.menu && !this.menu.isDestroyed()) return this.menu;
    const m = new BrowserWindow({
      frame: false, show: false, alwaysOnTop: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      // See-through (sheet 109): Ask Claude's list hangs beside the menu, outside its own wood.
      fullscreenable: false, skipTaskbar: true, width: 220, height: 120, transparent: true, backgroundColor: '#00000000', hasShadow: false, title: 'Menu',
      webPreferences: { ...SAFE_WEB_PREFERENCES, preload: this.o.preloadPath },
    });
    lockDown(m.webContents);
    m.on('blur', () => this.hideMenu());
    m.webContents.once('did-finish-load', () => {
      if (this.menuItems) m.webContents.send('pagemenu:items', this.menuItems);
      if (this.menuItems && this.menuChats.length) m.webContents.send('pagemenu:chats', this.menuChats.map((c) => ({ name: c.name })));
    });
    void m.loadURL(`${this.o.origin}/pagemenu.html`);
    this.menu = m;
    return m;
  },

  hideMenu(this: SamaraBrowser): void { this.menuItems = null; if (this.menu && !this.menu.isDestroyed() && this.menu.isVisible()) this.menu.hide(); },

  isMenu(this: SamaraBrowser, sender: Electron.WebContents): boolean { return Boolean(this.menu && !this.menu.isDestroyed() && sender === this.menu.webContents); },

  /** The menu measured itself: put it at the pointer, flipped so it never leaves the screen. */
  menuSize(this: SamaraBrowser, width: number, height: number, sub = 0): void {
    const m = this.menu;
    if (!m || m.isDestroyed() || !this.menuItems) return;
    const h = Math.min(600, Math.max(30, Math.round(height)));
    // Sheet 109: Claude's list opened beside the menu. The menu stays where it is; the list goes right, or left of it
    // when the screen ends there.
    if (this.menuAt && sub > 0) {
      const at = this.menuAt, side = Math.min(360, Math.round(sub));
      const a = screen.getDisplayNearestPoint({ x: at.x, y: at.y }).workArea;
      const flip = at.x + at.w + side > a.x + a.width;
      m.setBounds({ x: flip ? at.x - side : at.x, y: at.y, width: at.w + side, height: Math.min(h, a.y + a.height - at.y) });
      m.webContents.send('pagemenu:flip', flip);
      return;
    }
    if (this.menuAt) { m.setBounds({ x: this.menuAt.x, y: this.menuAt.y, width: this.menuAt.w, height: h }); return; }
    const w = Math.min(340, Math.max(160, Math.round(width)));
    const pt = screen.getCursorScreenPoint();
    const a = screen.getDisplayNearestPoint(pt).workArea;
    const x = pt.x + w > a.x + a.width ? Math.max(a.x, pt.x - w) : pt.x;
    const y = pt.y + h > a.y + a.height ? Math.max(a.y, pt.y - h) : pt.y;
    this.menuAt = { x, y, w };
    m.setBounds({ x, y, width: w, height: h });
    m.show();
    m.focus();
  },

  /** He picked something (or '' for nothing). Everything happens to the tab he right-clicked. */
  menuPick(this: SamaraBrowser, id: string): void {
    const f = this.menuFor;
    this.menuFor = null;
    this.hideMenu();
    const t = f ? this.tabs.find((x) => x.id === f.tab) : undefined;
    const wc = t?.view?.webContents;
    if (!f || !t || !wc || wc.isDestroyed() || !this.inTab(t)) return;
    const p = f.p;
    // His report (2026-10-20): picking a spelling did nothing. The menu is its own window, so while it was open the tab's
    // window lost the keyboard, and the word was replaced in a page that was not focused. Give Samara's window the
    // keyboard back, then the tab, then replace once that has landed.
    const pw = this.panes.find((x) => x.id === t.pane)?.win;
    if (pw && !pw.isDestroyed()) pw.focus();
    wc.focus();
    const spell = /^spell([0-4])$/.exec(id);
    if (spell) { const s = p.dictionarySuggestions[Number(spell[1])]; if (s) setTimeout(() => { if (!wc.isDestroyed()) wc.replaceMisspelling(s); }, 40); return; }
    switch (id) {
      case 'linktab': if (isWeb(p.linkURL)) this.newTab(p.linkURL, t.id, false); break;
      case 'linkcopy': if (isWeb(p.linkURL)) clipboard.writeText(p.linkURL); break;
      case 'linksave': if (isWeb(p.linkURL)) wc.downloadURL(p.linkURL); break;
      case 'linkpop': if (isWeb(p.linkURL)) this.onPlayInPopout?.(p.linkURL); break;
      case 'vidpop': this.popTab?.(t.id); break;
      case 'tocompanion': void this.sendToCompanion(t, p); break;
      case 'ask0': case 'ask1': case 'ask2': case 'ask3': case 'asknew': void this.askClaude(t, p, id === 'asknew' ? null : this.menuChats[Number(id.slice(3))] ?? null, id === 'asknew'); break;
      case 'linkother': if (isWeb(p.linkURL)) this.onOpenOther?.(p.linkURL); break;
      case 'openother': if (isWeb(t.url)) { this.onOpenOther?.(t.url); this.pauseMedia(t.id); } break;
      case 'imgsave': if (p.srcURL) wc.downloadURL(p.srcURL); break;
      case 'imgcopy': wc.copyImageAt(p.x, p.y); break;
      case 'cut': wc.cut(); break;
      case 'copy': wc.copy(); break;
      case 'paste': wc.paste(); break;
      case 'selectall': wc.selectAll(); break;
      case 'search': { const q = p.selectionText.replace(/\s+/g, ' ').trim().slice(0, 400); if (q) this.newTab(searchFor(q), t.id, true); break; }
      case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
      case 'reload': wc.reload(); break;
      case 'learn': if (p.misspelledWord) wc.session.addWordToSpellCheckerDictionary(p.misspelledWord); break;
    }
  },

  /**
   * Sheet 109: Ask Claude. Only the bit he picked, the tab's name and its address go, fenced as the page's own words
   * (askclaude.ts pickText), with a pass for that tab: the chat that gets it may read the tab without asking him again.
   * Into one of his chats through the companion (the companion link slips it in, or starts a turn), or a new chat in the Claude app
   * with it typed in, for him to send.
   */
  async askClaude(this: SamaraBrowser, t: Tab, p: Electron.ContextMenuParams, chat: Chat | null, fresh: boolean): Promise<void> {
    const words = p.selectionText.replace(/\r\n?/g, '\n').trim();
    if (!words || !isWeb(t.url)) return;
    const pass = newPass();
    const now = Date.now();
    for (const [k, v] of this.tabPasses) if (v.until < now) this.tabPasses.delete(k);
    this.tabPasses.set(pass, { tab: t.id, until: now + PASS_MS });
    if (fresh) {
      const home = path.join(os.homedir(), 'Handoff', 'samara');
      void shell.openExternal(newChatLink(pickText({ words, title: t.title, url: t.url, tab: t.id, pass }, NEW_CHAT_MAX - 1200), existsSync(home) ? home : null));
      return;
    }
    if (!chat || !this.onAskClaude) return;
    const why = await this.onAskClaude(chat.id, pickText({ words, title: t.title, url: t.url, tab: t.id, pass })).catch((e) => (e as Error).message);
    if (why) this.note('', { kind: 'bad', from: 'menu', small: true, claude: true, kick: 'Not sent', title: why.slice(0, 60) });
  },

  /** A pass from a pick, still good, for this tab. */
  passOk(this: SamaraBrowser, pass: unknown, tab?: number): boolean {
    const v = typeof pass === 'string' ? this.tabPasses.get(pass) : undefined;
    return Boolean(v && v.until > Date.now() && (tab === undefined || v.tab === tab));
  },

  /**
   * Sheet 62: "Send to companion" on whatever he right-clicked: the words, the picture, the link, or the page (empty space).
   * The page is someone else's: its title, words and picture are data for the companion, quoted and never obeyed (pagemenu.ts).
   * A picture is fetched by the tab's own session (his sign-ins, the same rules), 8 MB at most, and handed over as an
   * image, never as anything to run; the page's text is read with a deadline and cut short.
   */
  async sendToCompanion(this: SamaraBrowser, t: Tab, p: Electron.ContextMenuParams): Promise<void> {
    const wc = t.view?.webContents;
    const kind = sendKindFor(p, isWeb(t.url));
    if (!kind || !wc || wc.isDestroyed()) return;
    const site = hostOf(t.url) || 'a page';
    const base = { kind, site, url: isWeb(t.url) ? t.url : '', samara: true, icon: this.faviconFor(t.url) };
    if (kind === 'words') { this.onSendToCompanion?.({ ...base, text: p.selectionText, title: t.title }); return; }
    if (kind === 'link') { this.onSendToCompanion?.({ ...base, url: p.linkURL, title: p.linkText || '', site: hostOf(p.linkURL) || site, icon: this.faviconFor(p.linkURL) || base.icon }); return; }
    if (kind === 'page') {
      const text = await run<string>(wc, 'String(document.body ? document.body.innerText : "").slice(0, 6000)', { ms: 1500, fallback: '' });
      this.onSendToCompanion?.({ ...base, title: wc.getTitle() || t.title, text: typeof text === 'string' ? text : '' });
      return;
    }
    // A picture: fetched with the tab's own session, 8 MB at most, and only if it really is a picture.
    let img: Electron.NativeImage | undefined;
    try {
      if (/^data:image\//.test(p.srcURL)) img = nativeImage.createFromDataURL(p.srcURL.slice(0, 12_000_000));
      else if (isWeb(p.srcURL)) {
        const r = await within<Response | null>(wc.session.fetch(p.srcURL), 8000, null);
        if (r && r.ok && /^image\//.test(r.headers.get('content-type') ?? '') && Number(r.headers.get('content-length') ?? 0) <= 8_000_000) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length <= 8_000_000) img = nativeImage.createFromBuffer(buf);
        }
      }
    } catch { img = undefined; }
    this.onSendToCompanion?.({ ...base, title: p.altText || p.titleText || '' }, img && !img.isEmpty() ? img : undefined);
  }
};
