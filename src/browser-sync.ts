// Phase 4 (2026-11-24): SamaraBrowser's sync methods, moved out of browser.ts unchanged. They run as the browser's own
// methods (browser.ts puts them on SamaraBrowser.prototype), so `this` is the browser.
import { run } from './page.ts';
import type { SessionData } from './sessionstore.ts';
import { BrowserSync } from './bsync.ts';
import type { SyncMsg, TabSnap } from './bsync.ts';
import { serviceFor } from './services.ts';
import type { SamaraBrowser, Tab, Trail } from './browser.ts';
import { MOCK_TRAIL, isWeb, bringFront, NETFLIX_REFUSED } from './browser.ts';

export const SyncPart = {
  /** A page sent here from the other machine: a new tab, and the window comes to the front. */
  openForward(this: SamaraBrowser, url: string): void {
    if (!isWeb(url)) return;
    this.open(url);
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    // Windows only lets a window jump in front of the one he is using with a nudge: on top for a moment, then not.
    bringFront(w);
  },

  /**
   * Netflix plays in the tab now (2026-10-25); if it still answers with one of its error codes, the show goes to the
   * paid-video window by itself and the tab steps back, so he is never left on an error page.
   */
  watchPlays(this: SamaraBrowser, tab: Tab, url: string): void {
    if (!this.onPaidFallback) return;
    for (const after of [10_000, 25_000]) setTimeout(() => {
      const wc = tab.view?.webContents;
      if (!wc || wc.isDestroyed() || wc.getURL() !== url) return;
      void run<string>(wc, `(document.body && document.body.innerText || '').slice(0, 5000)`, { fallback: '' }).then((text) => {
        if (!text || !NETFLIX_REFUSED.test(text) || wc.isDestroyed() || wc.getURL() !== url) return;
        if (!this.onPaidFallback?.(url)) return;
        this.note('', { from: 'menu', icon: 'video', kick: 'Netflix', title: 'In the video window', rows: [{ g: 'Why', v: 'It would not play in this tab.' }] });
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      });
    }, after);
  },

  /**
   * Paid video (2026-10-13): this browser has no Widevine, so Netflix, Crave, Disney+, Prime and Crunchyroll
   * open in the paid-video window instead, by themselves. Caught BEFORE a load starts (a link, an address he typed,
   * a bookmark, a redirect): stopping a load from inside its own start event crashed the browser (the Mac, and the
   * PC's window closed). True when it went there, and nothing should load here.
   */
  toPaid(this: SamaraBrowser, url: string): boolean {
    const paid = serviceFor(url);
    if (!paid?.ready || !this.onPaid) return false;
    if (!this.onPaid(url)) return false;
    this.note('', { from: 'menu', icon: 'video', kick: paid.label, title: 'In the paid-video window' });
    return true;
  },

  /** M6: start syncing with the other machine's browser. `send` reaches it through the companion. */
  startSync(this: SamaraBrowser, send: (m: SyncMsg) => void, log?: (s: string) => void): BrowserSync {
    this.sync = new BrowserSync({ target: this.syncTarget, send, stateDir: this.o.stateDir, ...(log ? { log } : {}) });
    this.visits.onChange = (c) => { if (c.op === 'add') this.sync?.visited([c.v]); else if (c.op === 'forget') this.sync?.forgot(c.url, c.at); else this.sync?.cleared(c.from); };
    return this.sync;
  },

  /**
   * M6: the other machine's tabs, made the tabs here ("the same tabs on both"). The window closed: they are
   * written down and open next time. Open: tabs here that are gone there close (never one in a call or playing in
   * the popout), new ones arrive asleep, and a tab that went somewhere else there goes there here. What he is looking
   * at stays in front unless it closed.
   */
  takeTabs(this: SamaraBrowser, snap: TabSnap): void {
    const want = (snap?.tabs ?? []).filter((t) => typeof t?.url === 'string' && isWeb(t.url)).slice(0, 80);
    // Phase R: trails are retired; a machine still on an older Samara may send them, and they are ignored here.
    const trails: Trail[] = [];
    const home = this.panes.find((p) => this.alive(p));
    if (home) this.pane = home;
    if (!home) {
      let closed: string[] = [];
      // The mockup tabs written here stay (sheet 47): they are this PC's own.
      let mocks: unknown[] = [];
      try { const s = this.session.peek() as any; if (Array.isArray(s?.closed)) closed = s.closed; if (Array.isArray(s?.tabs)) mocks = s.tabs.filter((t: { mock?: unknown }) => t?.mock).map((t: object) => ({ ...t, opener: null, win: 0 })); } catch { /* none */ }
      this.session.keepCopy('other-machine');
      const keepTrails = mocks.length ? [...trails.filter((x) => x.id !== MOCK_TRAIL), { id: MOCK_TRAIL, name: 'MOCKUPS', named: true, mock: true }] : trails;
      this.session.write({ v: 1, active: 0, tabs: [...want.map((t) => ({ url: t.url, title: t.title, opener: null, scrollY: 0, zoom: 0, muted: false, trail: t.trail, done: t.done })), ...(mocks as SessionData['tabs'])], trails: keepTrails, closed }, { now: true, force: true, why: 'other-machine' });
      return;
    }
    // The mockups (sheet 47) are this PC's alone: the other machine's tabs never close or move them.
    const live = this.tabs.filter((t) => !t.internal && !t.mock);
    const fixed = (t: Tab) => t.call === true || t.lent || Boolean(t.mock);
    if (want.length === live.length) {
      want.forEach((w, i) => {
        const t = live[i]!;
        if (t.url !== w.url && !fixed(t)) {
          t.title = w.title.slice(0, 300); t.blocked = null; t.failed = null;
          if (t.view) { t.pending = w.url; void t.view.webContents.loadURL(this.secured(t, w.url)).catch(() => {}); } else t.url = w.url;
        }
      });
    } else {
      const need = want.map((w) => w.url);
      for (const t of live) {
        const k = need.indexOf(t.url);
        if (k >= 0) need.splice(k, 1);
        else if (!fixed(t)) this.close(t.id, false);
      }
      this.pane = home;
      for (const u of need) {
        const w = want.find((x) => x.url === u)!;
        this.tabs.push({ id: ++this.seq, view: null, opener: null, title: w.title.slice(0, 300) || u, url: u, favicon: '', loading: false, audible: false, muted: false, crashed: false,
          scrollY: 0, zoom: 0, lastSeen: Date.now(), blocked: null, trail: null, done: false, lent: false, upgraded: null, failed: null, blockedPopup: null, pane: this.pane.id });
      }
    }
    this.trails = [...trails.filter((x) => x.id !== MOCK_TRAIL), ...this.trails.filter((x) => x.mock)];
    this.trailSeq = Math.max(this.trailSeq, ...trails.map((x) => x.id), 0);
    const left = want.slice();
    for (const t of this.tabs) {
      if (t.internal || t.mock) continue;
      const k = left.findIndex((w) => w.url === t.url);
      if (k < 0) continue;
      const [w] = left.splice(k, 1);
      t.trail = null; t.done = false;
    }
    this.tidyTrails();
    // Any window left without a tab in front shows its first one; a window left with no tabs at all closes.
    for (const p of [...this.panes]) {
      if (!this.alive(p) || this.tabs.some((t) => t.id === p.active)) continue;
      this.pane = p;
      p.active = null;
      const n = this.paneTabs(p)[0];
      if (n) this.activate(n.id); else if (p !== home) p.win!.close();
    }
    this.pane = home;
    this.changed();
  },

  /** A site's favicon as Samara stored it (a data: picture), or ''. Read-only; nothing is fetched (cleanup 2026-10-22). */
  faviconFor(this: SamaraBrowser, url: string): string { const d = this.iconOf(url); return /^data:image\//.test(d) && d.length < 20_000 ? d : ''; },

  iconOf(this: SamaraBrowser, url: string): string {
    try { const h = new URL(url).hostname; return this.icons.get(h) ?? this.icons.get(h.replace(/^www\./, '')) ?? this.icons.get('www.' + h) ?? ''; } catch { return ''; }
  }
};
