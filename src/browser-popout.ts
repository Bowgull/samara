// Phase 4 (2026-11-24): SamaraBrowser's popout methods, moved out of browser.ts unchanged. They run as the browser's own
// methods (browser.ts puts them on SamaraBrowser.prototype), so `this` is the browser.
import { WebContentsView, net } from 'electron';
import { run, within } from './page.ts';
import { capture } from './capture.ts';
import { addressFor, guessesUrl, parseGuesses } from './address.ts';
import { pastSearches, searchQueryOf, topSites } from './recall.ts';
import type { SamaraBrowser, Tab } from './browser.ts';
import { isWeb, PLAY_MS } from './browser.ts';

export const PopoutPart = {
  /**
   * Lend a live tab to the popout: the same page, already playing, signed in, nothing reloaded. It leaves this
   * window and the frame shows a plate where it was. Null for a tab with no live page (asleep, crashed, blocked).
   */
  lend(this: SamaraBrowser, id: number): { view: WebContentsView; url: string; title: string } | null {
    const t = this.tabs.find((x) => x.id === id);
    if (!t?.view || t.internal || t.crashed || t.blocked || t.failed || t.lent || !this.inTab(t)) return null;
    this.thaw(t);                                      // the pop-out gets a running page
    t.lent = true;
    // Sent to the pop-out by him: a woken tab's hush ends there.
    if (this.wakeHush.delete(t.id) && t.view && !t.view.webContents.isDestroyed()) t.view.webContents.setAudioMuted(t.muted);
    // A still of the picture for the tab page while it plays in the pop-out (taken before the view leaves the window).
    t.lentShot = '';
    void capture(t.view, { ms: 800, quality: 78 }).then((shot) => {
      if (!shot || !t.lent) return;
      t.lentShot = shot.dataUrl();
      this.sendTabs();
    });
    try { this.win?.contentView.removeChildView(t.view); } catch { /* not shown */ }
    try { t.view.webContents.stopFindInPage('clearSelection'); } catch { /* gone */ }
    this.changed();
    return { view: t.view, url: t.url, title: t.title };
  },

  /** The popout hands the tab back: into the window, where it was. If the tab or the window is gone, the page closes. */
  giveBack(this: SamaraBrowser, id: number, view: WebContentsView): void {
    const t = this.tabs.find((x) => x.id === id);
    if (t) this.inTab(t);
    const w = t ? this.paneOfTab(t)?.win : null;
    if (!t || t.view !== view || !w || w.isDestroyed()) { try { view.webContents.close(); } catch { /* gone */ } if (t) { t.view = null; t.lent = false; } return; }
    t.lent = false;
    view.setVisible(false);
    w.contentView.addChildView(view);
    this.raiseTray();                                   // back from the popout, never over the open tab list (2026-10-14)
    // At its full size but out of sight for a moment, so the site redoes its layout (popout size to tab size)
    // where he cannot see it, then shown already settled (2026-10-12, the odd resize coming back).
    const [cw, ch] = w.getContentSize();
    view.setBounds({ x: this.inset.left, y: this.inset.top, width: Math.max(0, cw - this.inset.left - this.inset.right), height: Math.max(0, ch - this.inset.top - this.inset.bottom) });
    setTimeout(() => { if (t.view !== view || t.lent || !this.inTab(t)) return; if (t.id === this.active) this.activate(t.id); else { this.changed(); this.quietHidden(); } }, 250);
  },

  isLent(this: SamaraBrowser, id: number): boolean { return Boolean(this.tabs.find((x) => x.id === id)?.lent); },

  /**
   * Sheet 88: his search engine's guesses for what he has typed. Only the words go, from Samara's own session with no cookies; a slow or odd answer is no guesses.
   */
  async guesses(this: SamaraBrowser, text: string): Promise<string[]> {
    const url = guessesUrl(text);
    if (!url) return [];
    try {
      const r = await within(net.fetch(url, { signal: AbortSignal.timeout(1500), credentials: 'omit' }), 1600, null);
      if (!r || !r.ok) return [];
      return parseGuesses(await within(r.json() as Promise<unknown>, 800, null), text);
    } catch { return []; }
  },

  suggest(this: SamaraBrowser, text: string): { kind: string; title: string; url: string; id?: number }[] {
    const q = String(text ?? '').trim().toLowerCase().slice(0, 200);
    // Sheet 102 : a click in the bar, before a letter, shows his last searches, then the sites he uses most.
    // Sheet 123 v13 (mode A): his other open tabs first, the latest he looked at on top, then the last couple of places.
    if (!q) {
      const now = Date.now();
      const tabs = this.tabs.filter((t) => t.id !== this.active && !t.internal && isWeb(t.url))
        .sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 3);
      const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
      const open = new Set(tabs.map((t) => host(t.url)));      // a site he has open shows once, as its tab
      const places = [...pastSearches(this.visits.list, '', now, 1).map((p) => ({ kind: 'past', title: p.query, url: p.url })),
        ...topSites(this.visits.list, now, 5).filter((v) => !open.has(host(v.url))).map((v) => ({ kind: 'history', title: v.title, url: v.url }))];
      return [...tabs.map((t) => ({ kind: 'tab', title: t.title, url: t.url, id: t.id })), ...places].slice(0, 5)
        .map((x) => ({ ...x, favicon: this.iconOf(x.url) }));
    }
    const typed = addressFor(q);
    const out: { kind: string; title: string; url: string; id?: number }[] = [];
    if (typed) out.push({ kind: typed.startsWith('https://search.brave.com') || typed.includes('/search?') || typed.includes('duckduckgo.com/?q=') ? 'search' : 'go', title: String(text).trim().slice(0, 200), url: typed });
    // Sheet 102: his past searches that hold what he typed, right under his own line, as his words with a clock.
    for (const p of pastSearches(this.visits.list, q, Date.now(), 2)) out.push({ kind: 'past', title: p.query, url: p.url });
    const hit = (title: string, url: string) => title.toLowerCase().includes(q) || url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').includes(q);
    const seen = new Set(out.map((x) => x.url));
    for (const t of this.tabs) if (!t.internal && isWeb(t.url) && hit(t.title, t.url) && !seen.has(t.url)) { out.push({ kind: 'tab', title: t.title, url: t.url, id: t.id }); seen.add(t.url); }
    for (const m of this.marks) if (hit(m.title, m.url) && !seen.has(m.url)) { out.push({ kind: 'mark', title: m.title, url: m.url }); seen.add(m.url); if (out.length >= 9) break; }
    for (let i = this.visits.list.length - 1, n = 0; i >= 0 && n < 3000 && out.length < 9; i--, n++) { const v = this.visits.list[i]; if (hit(v.title, v.url) && !seen.has(v.url) && !searchQueryOf(v.url)) { out.push({ kind: 'history', title: v.title || v.url, url: v.url }); seen.add(v.url); } }
    for (const u of [...this.closed].reverse()) if (hit('', u) && !seen.has(u)) { out.push({ kind: 'closed', title: u, url: u }); seen.add(u); if (out.length >= 9) break; }
    // Start connecting to where Enter will go while he is still typing, as Chrome does: the address lookup and
    // the secure handshake are done by the time he presses it. A connection only, nothing is fetched or sent.
    const first = out[0];
    if (first?.url && isWeb(first.url)) {
      try {
        const origin = new URL(first.url).origin;
        if (origin !== this.preconnected) { this.preconnected = origin; this.ses.preconnect({ url: origin, numSockets: 1 }); }
      } catch { /* not an address */ }
    }
    return out.slice(0, 9).map((x) => ({ ...x, favicon: this.iconOf(x.url) }));
  },

  /** Everything else that plays pauses: other tabs (the pop-out's lent one too), never a call. And the other machine. */
  onePlaying(this: SamaraBrowser, tab: Tab): void {
    for (const x of this.tabs) if (x !== tab && x.view && !x.call) this.pauseMedia(x.id);
    this.onMediaStarted?.();
    this.sync?.mediaStarted();
  },

  /** The other machine started playing something: everything here pauses, never a call. */
  pauseAll(this: SamaraBrowser): void { for (const x of this.tabs) if (x.view && !x.call) this.pauseMedia(x.id); this.onMediaStarted?.(); },

  /** A tab's address, for the pop-out. */
  urlOf(this: SamaraBrowser, id: number): string | null { const t = this.tabs.find((x) => x.id === id); return t && isWeb(t.url) ? t.url : null; },

  /**
   * Nothing plays until he asks (2026-10-20). Asked by each page as it starts (tabpreload.cjs): may it start
   * sound by itself (he asked for it a moment ago: an address, a bookmark, a link he clicked), and can he see it.
   */
  mayPlay(this: SamaraBrowser, sender: Electron.WebContents): { ok: boolean; shown: boolean; hold?: boolean } {
    const t = this.tabs.find((x) => x.view?.webContents === sender);
    if (!t) return { ok: true, shown: true };            // a popup he opened: his
    const at = Math.max(t.playOkAt ?? 0, this.lastGesture.get(t.id) ?? 0);
    // A woken tab plays nothing by itself (2026-10-23): it comes back paused at his spot; his own click on play
    // in the page plays it.
    // hold: nothing on a woken page plays until he clicks in the page itself (clicking its tab does not count).
    return { ok: !t.waking && Date.now() - at < PLAY_MS, shown: this.seen(t) && !t.waking, hold: Boolean(t.waking) };
  },

  /** He can see it, or it may play out of sight: a call, the pop-out, Spotify (his only music). */
  seen(this: SamaraBrowser, t: Tab): boolean {
    let spotify = false; try { spotify = /(^|\.)spotify\.com$/i.test(new URL(t.url).hostname); } catch { /* not an address */ }
    return t.lent || t.call === true || spotify || this.inFront(t);
  },

  /** His rule (2026-10-20): a tab he leaves pauses, and a tab he is not looking at never starts playing. */
  quietHidden(this: SamaraBrowser): void {
    for (const x of this.tabs) {
      if (!x.view || x.internal) continue;
      const shown = this.seen(x);
      if (x.shown === shown) continue;
      const was = x.shown; x.shown = shown;
      try { x.view.webContents.send('tab:shown', shown); } catch { /* gone */ }
      if (!shown && was !== undefined) this.pauseMedia(x.id);
    }
  },

  /** Pause whatever the tab is playing (it went to the pop-out). With a deadline: a dead page never hangs the companion.
   *  No page check here passes "user gesture" (2026-10-23): that told the site he had clicked, so it let video start by
   *  itself, against his "nothing plays until I click". */
  pauseMedia(this: SamaraBrowser, id: number): void {
    const wc = this.tabs.find((x) => x.id === id)?.view?.webContents;
    if (wc) void run(wc, "document.querySelectorAll('video,audio').forEach(m=>{try{m.pause()}catch{}});true", { ms: 800, fallback: null });
  }
};
