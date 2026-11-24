// Phase 4 (2026-11-24): SamaraBrowser's rail methods, moved out of browser.ts unchanged. They run as the browser's own
// methods (browser.ts puts them on SamaraBrowser.prototype), so `this` is the browser.
import { WebContentsView, screen, shell } from 'electron';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { SAFE_WEB_PREFERENCES, lockDown } from './safety.ts';
import { run } from './page.ts';
import { capture } from './capture.ts';
import { writeFileAtomic } from './atomic.ts';
import type { SessionData } from './sessionstore.ts';
import { keep } from './mockhome.ts';
import { entryKey, migrateV1, tidyDue as railTidyDue, toPutAway } from './rail.ts';
import type { EarlierEntry, RailTab, V1File } from './rail.ts';
import type { SamaraBrowser, Tab, Pane } from './browser.ts';
import { MOCK_TRAIL, isWeb, liveView, TRAY_SLIDE_MS, TRAY_W } from './browser.ts';

export const RailPart = {
  // ------------------------------------------------------------------ the tab list, floating over the live page
  /**
   * His ask (2026-10-13): Twitch froze under the drawer (it showed a picture of the page), and the page must not get
   * smaller either. So the list is drawn in its own see-through layer ABOVE the live page: the video stays full size
   * and keeps playing under its edge. The layer is the frame's own page (?tray), so it is the same list, the same
   * clicks, the same drag and drop.
   */
  trayView(this: SamaraBrowser): WebContentsView | null {
    const w = this.win;
    if (!w || w.isDestroyed()) return null;
    if (this.trayV && !this.trayV.webContents.isDestroyed()) return this.trayV;
    // Never slowed while hidden: its slide must start the moment it shows (2026-10-20). It does nothing at rest.
    const v = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, preload: this.o.preloadPath, backgroundThrottling: false } });
    lockDown(v.webContents);
    v.setBackgroundColor('#00000000');
    v.setVisible(false);
    const P = this.pane;
    P.trayReady = false; P.trayNext = null;
    // Phase R (2026-11-24): an open before its page has loaded is ignored (see tray()), so it never slides out late.
    v.webContents.on('did-finish-load', () => { this.pane = P; P.trayReady = true; P.trayNext = null; this.sendTabs(); this.trayFlush(P); v.webContents.send('browser:tray', { size: this.tabSize }); this.warmTray(P, v); });
    v.webContents.on('before-input-event', (e, input) => { this.pane = P; if (this.key(input)) e.preventDefault(); });
    void v.webContents.loadURL(`${this.o.origin}/browser.html?tray=1`).catch(() => { /* its window closed while it loaded */ });
    this.trayV = v;
    return v;
  },

  /**
   * Drawn once, out of sight, before he first opens it (2026-10-22, measured on his Mac: the very first open stalled the
   * screen 130-400 ms while the graphics card drew the list's layer for the first time; every later open was smooth).
   * The layer is shown for a moment at almost no opacity with the list out, then put away. Only while his mouse is
   * not where it lies, so it never takes a click meant for the page.
   */
  warmTray(this: SamaraBrowser, P: Pane, v: WebContentsView, tries = 0): void {
    const w = P.win;
    if (P.trayOn || !w || w.isDestroyed() || v.webContents.isDestroyed() || tries > 10) return;
    const [cw, ch] = w.getContentSize(), wb = w.getContentBounds(), at = P.trayAt;
    const box = { x: at.x, y: at.y, width: Math.max(0, Math.min(TRAY_W[this.tabSize], cw - at.x)), height: Math.max(0, ch - at.y) };
    const m = screen.getCursorScreenPoint();
    if (m.x >= wb.x + box.x && m.x < wb.x + box.x + box.width && m.y >= wb.y + box.y && m.y < wb.y + box.y + box.height) { setTimeout(() => this.warmTray(P, v, tries + 1), 2000); return; }
    v.setBounds(box);
    w.contentView.addChildView(v);
    v.setVisible(true);
    v.webContents.send('browser:tray', { warm: true });
    setTimeout(() => { if (!P.trayOn && !v.webContents.isDestroyed()) v.setVisible(false); }, 300);
  },

  /** Open the list where the frame says (beside its handle, under the band), or put it away. */
  tray(this: SamaraBrowser, open: boolean, at?: { x?: unknown; y?: unknown }): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    if (!open) {
      // The rail slides back in with its handle (2026-10-20), then goes; the band's own handle shows again
      // only once the rail's copy is back on top of it, so there is never a second arrow.
      const v = this.trayV && !this.trayV.webContents.isDestroyed() ? this.trayV : null;
      void this.tabPeek(null);
      if (!this.trayOn) { v?.setVisible(false); return; }
      this.trayOn = false;
      this.pane.traySeq = (this.pane.traySeq ?? 0) + 1; this.pane.trayShutAt = Date.now();
      v?.webContents.send('browser:tray', { open: false });
      setTimeout(() => {
        if (this.trayOn || w.isDestroyed()) return;
        v?.setVisible(false);
        w.webContents.send('browser:tray', { open: false }); w.webContents.focus();
      }, TRAY_SLIDE_MS + 20);
      return;
    }
    const v = this.trayView();
    if (!v) return;
    // Not drawn yet (his hover in the first moment after start): stay shut rather than slide out late. The band's
    // handle is told, so the next hover opens it normally.
    if (!this.pane.trayReady) { w.webContents.send('browser:tray', { open: false }); return; }
    this.newSince = 0;
    // Phase R (2026-11-24, measured): nothing but the slide runs while the rail moves. The page picture for the hover
    // card (a capture and a JPEG, ~9 ms) waits until the slide is over; the hover layer was built at start.
    const P0 = this.pane, seq = P0.traySeq = (P0.traySeq ?? 0) + 1;
    setTimeout(() => { if (P0.trayOn && P0.traySeq === seq) { const was = this.pane; this.pane = P0; void this.cardOf(this.cur()); this.pane = was; } }, TRAY_SLIDE_MS + 40);
    const n = (x: unknown, d: number) => (Number.isFinite(Number(x)) ? Math.max(0, Math.round(Number(x))) : d);
    this.trayAt = { x: n(at?.x, this.trayAt.x), y: n(at?.y, this.trayAt.y), hy: n((at as { hy?: unknown })?.hy, this.trayAt.hy ?? 80) };
    this.trayOn = true;
    this.placeTray();
    w.contentView.addChildView(v);             // to the top, over the page
    // The rail starts folded, its handle exactly over the band's, then slides out carrying it (2026-10-20).
    v.setVisible(true);
    // The list is already current (sent while it was shut); only a change still waiting goes first.
    this.trayFlush(this.pane);
    v.webContents.send('browser:tray', { open: true, hy: this.trayAt.hy, size: this.tabSize });
    v.webContents.focus();
    w.webContents.send('browser:tray', { open: true });
  },

  /** Send the shut list its newest state now (a change waiting for the quiet moment). */
  trayFlush(this: SamaraBrowser, P: Pane): void {
    if (P.trayNextT) { clearTimeout(P.trayNextT); P.trayNextT = null; }
    const d = P.trayNext; P.trayNext = null;
    if (d && P.trayV && !P.trayV.webContents.isDestroyed() && P.trayReady) P.trayV.webContents.send('browser:tabs', d);
  },

  /** A small picture of the page in front, for the tab list's hover picture. */
  async cardOf(this: SamaraBrowser, t: Tab | undefined): Promise<void> {
    if (!t?.view || t.crashed || t.blocked || t.failed || t.lent || t.internal || !t.view.getVisible() || t.id !== this.active) return;
    try { const s = await capture(t.view, { ms: 500, maxWidth: 640, quality: 72 }); if (s) { t.card = s.dataUrl(); t.cardUrl = t.url; } } catch { /* none this time */ }
  },

  tabPeekView(this: SamaraBrowser): WebContentsView | null {
    const w = this.win;
    if (!w || w.isDestroyed()) return null;
    if (liveView(this.tabPeekV) && this.tabPeekV) {
      // The layer belongs to one window at a time: moved to the one he is in.
      if (!w.contentView.children.includes(this.tabPeekV)) { this.tabPeekV.setVisible(false); this.tabPeekOn = false; }
      return this.tabPeekV;
    }
    const v = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, backgroundThrottling: false } });
    lockDown(v.webContents);
    v.setBackgroundColor('#00000000');
    v.setVisible(false);
    this.tabPeekReady = false;
    v.webContents.on('did-finish-load', () => { this.tabPeekReady = true; });
    void v.webContents.loadURL(`${this.o.origin}/tabpeek.html`).catch(() => { /* gone */ });
    this.tabPeekV = v;
    return v;
  },

  /** The list: the mouse rests on a tab (its row's top and bottom in the list's own layer), or it left the rows. */
  async tabPeek(this: SamaraBrowser, a: { id?: unknown; top?: unknown; bottom?: unknown } | null): Promise<void> {
    const seq = ++this.tabPeekSeq;
    const w = this.win, P = this.pane;
    const hide = () => { if (this.tabPeekOn) { this.tabPeekOn = false; this.tabPeekV?.setVisible(false); } };
    if (!a || !w || w.isDestroyed() || !P.trayOn) { hide(); return; }
    const t = this.tabs.find((x) => x.id === Number(a.id) && x.pane === P.id);
    const top = Number(a.top), bottom = Number(a.bottom);
    if (!t || !Number.isFinite(top) || !Number.isFinite(bottom)) { hide(); return; }
    const v = this.tabPeekView();
    if (!v) return;
    if (t.id === this.active) await this.cardOf(t);
    if (seq !== this.tabPeekSeq || !P.trayOn || w.isDestroyed()) return;
    const shot = t.card ?? t.leftShot ?? null;
    let host = '', rest = '';
    try { const u = new URL(t.url); host = u.hostname.replace(/^www\./, ''); rest = (u.pathname === '/' ? '' : u.pathname) + u.search; } catch { host = t.url.startsWith('samara:') ? 'Samara' : t.url; }
    const W = 356, H = shot ? 278 : 92;
    const [cw, ch] = w.getContentSize();
    const x = Math.min(cw - W - 4, P.trayAt.x + TRAY_W[this.tabSize] + 6);
    const mid = P.trayAt.y + (top + bottom) / 2;
    const y = Math.max(P.trayAt.y + 4, Math.min(ch - H - 4, Math.round(mid - H / 2)));
    if (x < P.trayAt.x + 40) { hide(); return; }       // no room beside the list in a narrow window
    const data = { shot, title: t.title || host, host, rest, playing: t.audible === true && !t.muted };
    // The page has no doors of its own: it is handed the picture and the words (drawn with textContent there).
    const paint = () => { if (seq === this.tabPeekSeq && !v.webContents.isDestroyed()) void v.webContents.executeJavaScript(`show(${JSON.stringify(data)})`, true).catch(() => { /* gone */ }); };
    if (this.tabPeekReady) paint(); else v.webContents.once('did-finish-load', paint);
    v.setBounds({ x: Math.max(0, x), y, width: W, height: H });
    if (!this.tabPeekOn || !w.contentView.children.includes(v)) w.contentView.addChildView(v);   // over the page, beside the list
    this.tabPeekOn = true;
    v.setVisible(true);
  },

  // ------------------------------------------------------------------ trails and the done shelf (sheet 3 section 3)
  /** "+ New trail": the next tab he opens starts it. */
  // ------------------------------------------------------------------ Phase R (2026-11-24): the rail
  /** What the rail's rules (rail.ts) need of a tab. A tab in front of any window, in a split or lent stays put. */
  railTab(this: SamaraBrowser, t: Tab): RailTab {
    const front = this.panes.some((p) => p.active === t.id || p.split?.left === t.id || p.split?.right === t.id);
    const job = (() => { const p = this.driver.pageOfTab(t.id); return p && this.driver.job(p.job)?.kind === 'claude' ? p.job : null; })();
    return { id: t.id, lastSeen: t.lastSeen, opener: t.opener, pinned: t.pinned || front || t.lent, audible: t.audible, call: t.call,
      claudeJob: job ?? (t.claude ? -1 : null), internal: t.internal ?? (t.mock || !isWeb(t.url) ? 'own' : undefined) };
  },

  /** One tab as Earlier keeps it. */
  entryOf(this: SamaraBrowser, t: Tab, at: number, from?: string): EarlierEntry {
    return { key: entryKey(t.url, at), url: t.url, title: t.title || t.url, at,
      ...(t.favicon && /^(https:|data:image\/)/.test(t.favicon) && t.favicon.length < 4000 ? { favicon: t.favicon } : {}),
      ...(t.scrollY > 0 ? { scrollY: Math.round(t.scrollY) } : {}), ...(t.zoom ? { zoom: t.zoom } : {}), ...(from ? { from } : {}) };
  },

  /**
   * The one-time move (Phase R): trails, the done shelf and the Stash go to Earlier, so nothing he had is lost when trails
   * go. The files as they were are copied aside first (browser-tabs.v1.json, browser-stash.v1.json) and never touched
   * again. It runs once (Earlier remembers), and running it twice changes nothing: Earlier keys repeat, so they merge.
   */
  railMove(this: SamaraBrowser, dir: string): void {
    if (this.earlier.migrated) return;
    try {
      const s = this.session.peek() as (Partial<SessionData> & { tabs?: any[] }) | null;
      const tabs = Array.isArray(s?.tabs) ? s!.tabs : [];
      const trails = (Array.isArray(s?.trails) ? s!.trails : []) as V1File['trails'];
      const own = (trails ?? []).filter((x) => x?.id !== MOCK_TRAIL);
      const needs = own.length > 0 || tabs.some((t) => t?.done === true) || this.stash.length > 0;
      if (!needs) { this.earlier.markMigrated(); return; }
      const aside = (from: string, to: string) => { const a = path.join(dir, from), b = path.join(dir, to); if (existsSync(a) && !existsSync(b)) copyFileSync(a, b); };
      aside('browser-tabs.json', 'browser-tabs.v1.json');
      aside('browser-stash.json', 'browser-stash.v1.json');
      const v1: V1File = { tabs: tabs.filter((t) => typeof t?.url === 'string'), trails, stash: this.stash.map((x) => ({ name: x.name, at: x.at, tabs: x.tabs })) };
      const { keep, earlier } = migrateV1(v1, Date.now());
      this.earlier.add(earlier);
      if (s && tabs.length) {
        // Indexes in the file (opener, the tab in front, splits) point at the old list: they follow the tabs that stay.
        const kept = v1.tabs;
        const map = new Map<number, number>(); keep.forEach((old, i) => map.set(tabs.indexOf(kept[old]), i));
        const at = (n: unknown) => (Number.isInteger(n) ? map.get(n as number) : undefined);
        const next: SessionData = { v: 1, closed: Array.isArray(s.closed) ? s.closed : [], trails: [],
          active: at(s.active) ?? 0,
          fronts: (Array.isArray(s.fronts) ? s.fronts : []).map((n) => at(n) ?? -1),
          tabs: keep.map((i) => { const t = { ...kept[i] } as Record<string, unknown>; t.opener = at(t.opener) ?? null; delete t.trail; delete t.done; return t as SessionData['tabs'][number]; }),
          splits: (Array.isArray(s.splits) ? s.splits : []).flatMap((x: any) => { const l = at(x?.left), r = at(x?.right); return l !== undefined && r !== undefined ? [{ ...x, left: l, right: r }] : []; }) };
        this.session.write(next, { now: true, force: true, why: 'rail-move' });
      }
      this.stash = [];
      try { writeFileAtomic(this.stashFile, '[]'); } catch { /* the copy aside holds it */ }
      this.earlier.markMigrated();
      console.log(`shell: browser: trails retired: ${earlier.length} page${earlier.length === 1 ? '' : 's'} moved to Earlier, ${keep.length} tab${keep.length === 1 ? '' : 's'} stay open`);
    } catch (e) { console.error('shell: browser: the move to Earlier did not run (nothing changed): ' + (e as Error).message); }
  },

  /** The overnight tidy, when it is due (at 3 AM, or on the next start after a night Samara was shut). */
  railTidy(this: SamaraBrowser, now = Date.now()): number {
    if (!this.restored || !railTidyDue(this.earlier.lastTidy, now)) return 0;
    const ids = toPutAway(this.tabs.map((t) => this.railTab(t)), now, null);
    this.earlier.tidied(now);
    if (!ids.length) return 0;
    const put = this.putAway(ids, now);
    if (put.length) {
      this.note('', { from: 'tabs', icon: 'tabs', kick: 'Overnight', title: `${put.length} tab${put.length === 1 ? '' : 's'} moved to Earlier`,
        rows: [{ g: 'Why', v: 'Not opened in 12 hours. Nothing was closed for good.' }], keys: [{ label: 'Bring them back', act: 'back' }, { label: 'Got it', act: 'ok' }] },
      (act) => { if (act === 'back') this.earlierBack(put.map((e) => e.key)); });
    }
    return put.length;
  },

  /** Close these tabs into Earlier (their address, scroll and zoom kept). The tab in front of a window never goes. */
  putAway(this: SamaraBrowser, ids: number[], at: number): EarlierEntry[] {
    const out: EarlierEntry[] = [];
    for (const id of ids) {
      const t = this.tabs.find((x) => x.id === id);
      if (!t || !isWeb(t.url) || this.panes.some((p) => p.active === id)) continue;
      out.push(this.entryOf(t, at + out.length));
      this.closeView(t);
      this.tabs.splice(this.tabs.indexOf(t), 1);
    }
    this.earlier.add(out);
    this.changed();
    return out;
  },

  /** Bring entries back from Earlier as tabs, asleep (each loads when he opens it), where they were. */
  earlierBack(this: SamaraBrowser, keys: string[], show = false): void {
    let last: Tab | null = null;
    for (const k of keys) {
      const e = this.earlier.take(k);
      if (!e || !isWeb(e.url)) continue;
      last = { id: ++this.seq, view: null, opener: null, title: e.title, url: e.url, favicon: e.favicon ?? '', loading: false, audible: false, muted: false, crashed: false,
        scrollY: e.scrollY ?? 0, zoom: e.zoom ?? 0, lastSeen: Date.now(), blocked: null, trail: null, done: false, lent: false, upgraded: null, failed: null, blockedPopup: null, pane: this.pane.id };
      this.tabs.push(last);
    }
    if (show && last) this.activate(last.id); else this.changed();
  },

  /** Earlier, from the rail: the list (to the tray that asked), open one, or remove one for good. */
  earlierAct(this: SamaraBrowser, a: { act: string; key?: string }, reply?: (data: unknown) => void): void {
    if (a.act === 'list') { reply?.({ entries: this.earlier.entries, now: Date.now() }); return; }
    if (!a.key) return;
    if (a.act === 'open') this.earlierBack([a.key], true);
    else if (a.act === 'remove') { this.earlier.take(a.key); this.sendTabs(); }
    reply?.({ entries: this.earlier.entries, now: Date.now() });
  },

  /** A trail with nothing left in it goes. */
  tidyTrails(this: SamaraBrowser): void {
    // Sheet 107 (2026-10-30): no MOCKUPS trail any more; Mockups is its one plaque in the tray.
    this.trails = this.trails.filter((tr) => !tr.mock && (tr.id === this.pendingTrail || this.tabs.some((t) => t.trail === tr.id && !t.done)));
  },

  /**
   * Drag one tab or several (2026-10-21): into a trail (or loose, null), in their order, before another tab (or
   * at the end of that group), and under a parent tab when he dropped it on a row or slid it right. A tab sits under the
   * one it came from (its opener), one level deep, as the drawer draws it. Every id must be a real tab; the parent must
   * be a top tab of that same trail; a tab never goes under itself or under its own child (no loops). False: refused,
   * nothing moved. A tab under one of the others moving with it keeps its place under it (a parent carries its children).
   */
  placeTabs(this: SamaraBrowser, ids: number[], trail: number | null, before: number | null, parent: number | null): boolean {
    this.takeFromClaude(ids);
    const set = new Set(ids);
    if (!ids.length || set.size !== ids.length) return false;
    const moving = ids.map((id) => this.tabs.find((x) => x.id === id));
    if (moving.some((t) => !t)) return false;
    if (trail !== null && !this.trails.some((x) => x.id === trail)) return false;
    const mock = trail === MOCK_TRAIL;
    // Sheet 47's rule, unchanged: the MOCKUPS trail holds Claude's mockups only, and a mockup stays in it.
    if (moving.some((t) => Boolean(t!.mock) !== mock)) return false;
    if (before !== null && (set.has(before) || !this.tabs.some((x) => x.id === before))) return false;
    if (parent !== null) {
      const p = this.tabs.find((x) => x.id === parent);
      // A mockup's parent is kept in the mockups' own tree (mockAct), never here; loose tabs are a flat list.
      if (!p || trail === null || mock || set.has(parent) || p.trail !== trail || p.done) return false;
      // One level only: the parent must itself be a top tab of that trail.
      if (p.opener !== null && this.tabs.some((x) => x.id === p.opener && x.trail === trail && !x.done)) return false;
      // No loops: walking up from the parent must never meet a tab that is moving.
      const seen = new Set<number>();
      for (let at: Tab | undefined = p; at && !seen.has(at.id); at = at.opener === null ? undefined : this.tabs.find((x) => x.id === at!.opener)) {
        if (set.has(at.id)) return false;
        seen.add(at.id);
      }
    }
    for (const t of moving as Tab[]) {
      // Phase R: moving a tab in the rail keeps where it came from (closing it still goes back there).
      if (!mock && (trail !== null || parent !== null)) t.opener = parent === null && trail !== null && t.opener !== null && set.has(t.opener) ? t.opener : parent;
      t.trail = trail;
      t.done = false;
    }
    // Tabs that were under a tab that is now a child themselves move up beside it: never two levels deep.
    if (parent !== null) for (const x of this.tabs) if (!set.has(x.id) && x.opener !== null && set.has(x.opener) && x.trail === trail) x.opener = parent;
    this.tabs = this.tabs.filter((x) => !set.has(x.id));
    const j = before !== null ? this.tabs.findIndex((x) => x.id === before) : -1;
    if (j >= 0) this.tabs.splice(j, 0, ...(moving as Tab[]));
    else {
      let k = -1;
      this.tabs.forEach((x, n) => { if (x.trail === trail) k = n; });
      this.tabs.splice(k + 1, 0, ...(moving as Tab[]));
    }
    this.tidyTrails();
    this.changed();
    return true;
  }
};
