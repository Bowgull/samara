// Phase 4 (2026-11-24): SamaraBrowser's session methods, moved out of browser.ts unchanged. They run as the browser's own
// methods (browser.ts puts them on SamaraBrowser.prototype), so `this` is the browser.
import { BrowserWindow, shell } from 'electron';
import { run } from './page.ts';
import type { SessionData } from './sessionstore.ts';
import { clampSplit } from './splitview.ts';
import { grantTop } from './driverrules.ts';
import { isBar } from './bookmarks.ts';
import { keep } from './mockhome.ts';
import { fading } from './rail.ts';
import type { SamaraBrowser, Tab, Trail } from './browser.ts';
import { isWeb, hostOf, TRAY_SLIDE_MS, PAGE_STATE_MAX, PAGE_LOOK_JS, hexOf } from './browser.ts';

export const SessionPart = {
  // ---------------------------------------------------------------- 6.21 the snapshot
  /** Something worth keeping changed: redraw now, and write the snapshot shortly (one write per burst). */
  changed(this: SamaraBrowser): void {
    this.sendTabs();
    if (this.saveSoon) return;
    this.saveSoon = setTimeout(() => { this.saveSoon = null; void this.snapshot(); }, 1500);
  },

  snapshot(this: SamaraBrowser, all = false): Promise<void> {
    return this.snapshotNow(all);
  },

  async snapshotNow(this: SamaraBrowser, all = false): Promise<void> {
    if (!this.restored) return;
    if (!this.tabs.length) return;   // nothing to keep; closing the last tab already wrote the empty snapshot
    // Everything is taken NOW, before waiting on the pages (2026-10-14):
    // closing the window emptied the tab list while this waited, and an EMPTY list was written, so nothing came back.
    const keep = this.tabs.filter((t) => isWeb(t.url) && !t.claude);
    const windows = this.panes.filter((p) => this.alive(p) || p === this.pane);
    const winOf = new Map(windows.map((p, i) => [p.id, i]));
    const front = (this.lastPane() ?? this.pane).active;
    const fronts = windows.map((p) => keep.findIndex((t) => t.id === p.active));
    const trails: Trail[] = [];
    const closed = this.closed.slice(-25);
    const make = () => ({
      v: 1,
      // Every window's tabs, each knowing its window (`win`), and the tab in front in each (`fronts`).
      active: Math.max(0, keep.findIndex((x) => x.id === front)),
      fronts,
      tabs: keep.map((t) => ({
        url: t.url, title: t.title, opener: t.opener === null ? null : keep.findIndex((x) => x.id === t.opener),
        scrollY: Math.round(t.scrollY), zoom: t.zoom, muted: t.muted, win: winOf.get(t.pane) ?? 0,
        // Phase R: when he last had it in front (a tab in front counts as now), and pinned.
        lastSeen: this.panes.some((p) => p.active === t.id) ? Date.now() : t.lastSeen, ...(t.pinned ? { pinned: true } : {}),
        ...(t.mock ? { mock: { ...t.mock } } : {}),
        ...(t.pageBg ? { pageBg: t.pageBg } : {}),
        ...(t.pageState && !t.mock ? { pageState: t.pageState } : {}),
        ...(t.favicon && /^(https:|data:image\/)/.test(t.favicon) && t.favicon.length < 4000 ? { favicon: t.favicon } : {}),
      })),
      trails,
      closed,
      // Sheet 121 (4): each window's pair of pages side by side.
      splits: windows.map((p, i) => { const s = p.split; if (!s) return null; const l = keep.findIndex((t) => t.id === s.left), r = keep.findIndex((t) => t.id === s.right); return l >= 0 && r >= 0 ? { win: i, left: l, right: r, ratio: s.ratio } : null; }).filter(Boolean),
    });
    // Closing or quitting: written once at once with what is known (2026-10-28: quitting could end Samara before the
    // pages answered below, and then nothing of the last few seconds was kept), then again with their scroll spots.
    if (all) this.session.write(make() as SessionData, { now: true, force: true });
    // Taken before waiting on the pages: if a tab closes or the other machine's tabs land meanwhile, this save is stale
    // and dropped (sessionstore.ts), instead of writing the older list back over the newer one.
    const ticket = this.session.ticket();
    // Only the tabs in front, and the ones he was on since the last save (measured 2026-10-20: asking every tab every
    // 8 s woke them all, and on a slow machine ran past its deadline so nothing was saved). Closing asks them all.
    const due = this.scrollDue; this.scrollDue = new Set();
    await Promise.all(keep.map(async (t) => {
      if (!t.view || t.crashed || t.view.webContents.isDestroyed()) return;
      if (!all && !due.has(t.id) && !this.panes.some((p) => p.active === t.id)) return;
      const wc = t.view.webContents;
      const got = await run<[number, string] | null>(wc, PAGE_LOOK_JS, { ms: 800, fallback: null });
      if (Array.isArray(got) && Number.isFinite(got[0])) { t.scrollY = got[0]; t.pageBg = hexOf(got[1]) ?? t.pageBg; }
      try { const h = wc.navigationHistory; const s = h.getEntryAtIndex(h.getActiveIndex())?.pageState; t.pageState = s && s.length <= PAGE_STATE_MAX ? s : undefined; } catch { /* kept as it was */ }
    }));
    // In the background while he browses; on closing, written before anything else happens.
    if (!this.session.write(make() as SessionData, { now: all, force: all, ticket })) return;
    this.sync?.changed('tabs');
  },

  /** Bring every tab back from the last snapshot. Only the one he was on loads; the rest come back asleep. */
  restore(this: SamaraBrowser): boolean {
    this.session.keepCopy('start');
    this.restored = true;
    try {
      const s = this.session.read() as any;
      if (!s) return false;
      // Sheet 107 (2026-10-30): mockups open inside Mockups now, so the mockup tabs of before close (every sheet
      // stays in Mockups).
      const list = Array.isArray(s?.tabs) ? s.tabs.filter((t: { url?: unknown; mock?: unknown }) => typeof t?.url === 'string' && isWeb(t.url as string) && !t.mock).slice(0, 80) : [];
      if (!list.length) return false;
      const at0 = this.tabs.length;
      const ids: number[] = [];
      for (const t of list) {
        const fav = typeof t.favicon === 'string' && /^(https:|data:image\/)/.test(t.favicon) && t.favicon.length < 4000 ? t.favicon : '';
        const tab: Tab = { id: ++this.seq, view: null, opener: null, title: String(t.title ?? t.url).slice(0, 300), url: t.url, favicon: fav,
          loading: false, audible: false, muted: t.muted === true, crashed: false, scrollY: Number(t.scrollY) || 0, zoom: Number(t.zoom) || 0,
          lastSeen: Number.isFinite(t.lastSeen) && t.lastSeen > 0 && t.lastSeen <= Date.now() ? t.lastSeen : Date.now(), blocked: null,
          trail: null, done: false, ...(t.pinned === true ? { pinned: true } : {}), lent: false, upgraded: null, failed: null, blockedPopup: null, pane: this.pane.id };
        if (typeof t.pageBg === 'string' && /^#[0-9a-f]{6}$/.test(t.pageBg)) tab.pageBg = t.pageBg;
        if (typeof t.pageState === 'string' && t.pageState.length <= PAGE_STATE_MAX && /^[A-Za-z0-9+/=]+$/.test(t.pageState)) tab.pageState = t.pageState;
        ids.push(tab.id);
        this.tabs.push(tab);
      }
      list.forEach((t: { opener?: unknown }, i: number) => { const o = Number(t.opener); if (Number.isInteger(o) && o >= 0 && o < ids.length && o !== i) this.tabs[at0 + i]!.opener = ids[o]!; });
      if (Array.isArray(s.closed)) this.closed = s.closed.filter((u: unknown) => typeof u === 'string' && isWeb(u as string)).slice(-25);
      // Phase R: no trails come back (railMove already put their pages in Earlier).
      this.tidyTrails();
      // Every window he had open comes back with its own tabs (2026-10-14). The first one is this window.
      const wins = new Map<number, Tab[]>();
      list.forEach((t: { win?: unknown }, i: number) => { const w = Math.max(0, Math.min(6, Number(t.win) || 0)); if (w > 0) { const a = wins.get(w) ?? []; a.push(this.tabs[at0 + i]!); wins.set(w, a); } });
      const fronts: number[] = Array.isArray(s.fronts) ? s.fronts.map((n: unknown) => Number(n)) : [];
      const here = this.tabs.filter((t) => ![...wins.values()].some((a) => a.includes(t)));
      // Sheet 121 (4): the pairs side by side, taken up once both tabs are in their window.
      this.splitsWanted = (Array.isArray(s.splits) ? s.splits : []).flatMap((x: { left?: unknown; right?: unknown; ratio?: unknown }) => {
        const L = this.tabs[at0 + Number(x?.left)], R = this.tabs[at0 + Number(x?.right)];
        return L && R && L !== R && Number.isInteger(Number(x?.left)) && Number.isInteger(Number(x?.right)) ? [{ L, R, ratio: clampSplit(Number(x?.ratio)) }] : [];
      });
      this.adoptSplits();
      const want = this.tabs[at0 + Number(fronts[0])];
      const a = at0 + Math.min(Math.max(0, Number(s.active) || 0), list.length - 1);
      this.activate((want && here.includes(want) ? want : here[0] ?? this.tabs[a]!).id);
      const base = this.win?.getBounds();
      let n = 0;
      for (const [w, group] of wins) {
        n++;
        const front = this.tabs[at0 + Number(fronts[w])];
        const ordered = front && group.includes(front) ? [...group.filter((x) => x !== front), front] : group;
        this.createPane(undefined, ordered, base ? { x: base.x + 40 * n, y: base.y + 40 * n, width: base.width, height: base.height } : undefined);
      }
      return true;
    } catch (e) { console.error('shell: browser: the saved tabs could not be read: ' + (e as Error).message); return false; }
  },

  /** The rail and the band redraw from this. Plain data only. */
  sendTabs(this: SamaraBrowser): void {
    this.tvNoticeSync();
    this.handPaint();
    // Sheet 100: an open quest log follows along, a moment later (so a burst of changes draws it once).
    if (this.tabs.some((t) => t.internal === 'mocklog') && !this.mockLogTimer) this.mockLogTimer = setTimeout(() => { this.mockLogTimer = null; this.pushMockLog(); }, 300);
    // A site's camera and microphone end when no tab is on it any more.
    if (this.mediaOk.size || this.shareHosts.size) {
      const on = new Set(this.tabs.map((t) => hostOf(t.url)));
      for (const k of [...this.mediaOk.keys()]) if (!on.has(grantTop(k))) this.mediaOk.delete(k);
      for (const h of [...this.shareHosts]) if (!on.has(h)) this.shareHosts.delete(h);
    }
    // A tab with a live call runs at full speed even behind other tabs, and never sleeps (see sleepIdle).
    let calls = false;
    for (const t of this.tabs) {
      const h = hostOf(t.url);
      const c = Boolean(t.view) && ([...this.mediaOk.keys()].some((k) => grantTop(k) === h) || this.shareHosts.has(h));
      if (t.view && Boolean(t.call) !== c) { try { t.view.webContents.setBackgroundThrottling(!c); } catch { /* gone */ } }
      t.call = c;
      calls ||= c;
    }
    this.callNow(calls);
    const was = this.pane;
    for (const p of this.panes) { this.pane = p; this.sendPane(); }
    this.pane = was;
  },

  /** One window's frame (and its tray) redraws from this. */
  sendPane(this: SamaraBrowser): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    const mine = this.paneTabs();
    const t = this.cur();
    const wc = t?.view?.webContents;
    const tray = this.trayV && !this.trayV.webContents.isDestroyed() ? this.trayV.webContents : null;
    // The tab list only while it is open (measured 2026-10-20: every message went to it hidden too). Opening it sends
    // the current state first, so it is never stale.
    // Phase R (2026-11-24): the shut list is kept current too, at most every 150 ms (a burst of changes draws once), so
    // opening it never rebuilds the list in the middle of its slide. Open, it follows at once as before.
    const P = this.pane;
    const send = (data: Record<string, unknown>) => {
      w.webContents.send('browser:tabs', data);
      if (!tray) return;
      if (this.trayOn) { tray.send('browser:tabs', data); return; }
      P.trayNext = data;
      // Not while it is still sliding shut either: the list waits until the close is over.
      P.trayNextT ??= setTimeout(() => { P.trayNextT = null; this.trayFlush(P); }, Math.max(150, (P.trayShutAt ?? 0) + TRAY_SLIDE_MS + 20 - Date.now()));
    };
    const now = Date.now();
    send({
      active: this.active,
      // Phase R: how many pages are in Earlier (its button shows the count).
      earlierN: this.earlier.entries.length,
      update: this.update, updated: this.updated, checking: this.checking, inCall: this.inCall, canQuit: this.onQuit !== null,
      canBack: Boolean(wc?.navigationHistory.canGoBack()), canForward: Boolean(wc?.navigationHistory.canGoForward()),
      // A sleeping tab keeps its logo (2026-10-20): its last one, else the site's from bookmarks.
      tabs: mine.map((x) => ({ id: x.id, opener: x.opener, title: x.title, url: x.url, favicon: x.favicon || this.iconOf(x.url), loading: x.loading, phase: x.phase ?? (x.loading ? 'loading' : 'idle'), prog: x.prog ?? 0, pending: x.pending ?? null, audible: x.audible, muted: x.muted, crashed: x.crashed, asleep: !x.view, blocked: x.blocked, failed: x.failed, trail: x.trail, done: x.done, lent: x.lent, pinned: x.pinned === true, lastSeen: x.lastSeen, fade: fading(this.railTab(x), now, this.active), popup: x.blockedPopup?.url ?? null, mock: x.mock ? this.mockTab(x) : null, internal: x.internal ? true : undefined, mocklog: x.internal === 'mocklog' ? true : undefined, hyrule: x.internal === 'hyrule' ? true : undefined,
        // Sheet 111: a tab a Claude job has shows in Claude's group, not in his list.
        claudeJob: (() => { const p = this.driver.pageOfTab(x.id); return p && this.driver.job(p.job)?.kind === 'claude' ? p.job : undefined; })() })),
      // Sheet 47: the MOCKUPS trail's history (the whole list only while it is open), or null where mockups are off.
      mockups: this.mockView(),
      // 2026-11-03: the Hyrule key above Mockups, only on a machine with the map's folder.
      hyrule: Boolean(this.o.hyruleDir),
      // 2026-10-22: the notes rail needs the companion (its notes live in the companion). Samara alone or on the Mac: the row is hidden.
      notes: Boolean(this.onNoteSave),
      split: this.splitShown() !== null,
      // The trails with a tab in this window (or the one about to start here).
      trails: this.trails.filter((tr) => tr.id === this.pendingTrail || tr.mock || mine.some((x) => x.trail === tr.id)),
      // Sheet 111: Claude's group rows are real tabs: their name and icon are the tab's, and he may have one (YOU HAVE IT).
      drivers: this.driver.view().map((j) => ({ ...j, pages: j.pages.map((p) => { const t = p.tab === undefined ? undefined : this.tabs.find((x) => x.id === p.tab);
        return t ? { ...p, title: t.title || p.title, favicon: t.favicon || this.iconOf(t.url) || p.favicon, held: this.hands.has(p.id) } : p; }) })),
      // His own tab being driven by a session: the band says so, with STOP (2026-10-14).
      // Sheet 109: and whether he has it back for now (YOU HAVE IT): Take over and STOP make way while he does.
      driving: (() => { const w = t?.view?.webContents; const d = w ? this.driver.drivingTab(w) : null; return d ? { ...d, hand: this.hands.get(d.page)?.mode ?? null } : null; })(),
      watching: this.watching === null ? null : (() => { const p = this.driver.page(this.watching!); const j = p ? this.driver.job(p.job) : undefined; return p && j ? { page: p.id, job: j.id, kind: j.kind, working: j.working, url: p.url, title: p.title } : null; })(),
      stash: this.stash.map((s) => ({ id: s.id, name: s.name, count: s.tabs.length })),
      adsPaused: (() => { try { return this.paused.has(new URL(t?.url ?? '').hostname.replace(/^www\./, '')); } catch { return false; } })(),
      adsOn: Boolean(this.ads),
      darkHere: this.darkWanted(t?.url ?? ''), darkAll: this.prefs.dark,
      site: this.siteState(t?.url ?? ''),
      sounds: this.sounds,
      prefs: this.prefs,
      tabSize: this.tabSize,
      // The shelf: the bar ones first, as in Chrome, then the rest. Only what the shelf can show is sent.
      marks: [...this.marks.filter((m) => isBar(m.folder)), ...this.marks.filter((m) => !isBar(m.folder))].slice(0, 24).map((m) => ({ title: m.title, url: m.url, favicon: this.iconOf(m.url) })),
      markCount: this.marks.length,
      // Sheet 89: what is on his TV, and the TV ask.
      tv: this.tvState(),
      // New tabs from links since he last opened the list.
      newTabs: this.newSince,
      hasLogin: this.hasLogin,
      loginKnown: this.loginKnown,
      maximized: Boolean(w.isMaximized()),
      home: this.HOME,
      starred: Boolean(t && this.marks.some((m) => m.url === t.url)),
      markTitle: (t && this.marks.find((m) => m.url === t.url)?.title) ?? '',
      // The page's zoom as he would say it: 100%, 120%... (Chromium's level is 20% per step).
      zoomPct: wc ? Math.round(Math.pow(1.2, wc.getZoomLevel()) * 100) : 100,
      ...(t?.lent && t.lentShot && this.pane.lentSent !== t.lentShot ? { lentShot: (this.pane.lentSent = t.lentShot) } : {}),
    });
    if (t) w.setTitle(`${t.title} - Samara`);
  },

  /** A Samara window is open (what keeps the Shell running when the companion is off). */
  hasWindow(this: SamaraBrowser): boolean { return this.panes.some((p) => this.alive(p)); },

  /** The Samara window he used last (the Claude job's bar under the lantern goes on it, taskbar.ts), or null. */
  frontWindow(this: SamaraBrowser): BrowserWindow | null { const p = this.lastPane(); return p?.win && !p.win.isDestroyed() ? p.win : null; },

  closeAll(this: SamaraBrowser): void {
    void this.ses.cookies.flushStore().catch(() => {});
    // Sheet 115: Claude's jobs as they are now, then nothing written while its tabs close (they come back next start).
    this.saveClaude(); this.keepFrozen = true;
    this.driver.closeAll();
    const open = this.panes.filter((p) => this.alive(p));
    if (open.length) { this.quitting = true; void this.snapshot(true); }
    for (const p of open) p.win!.close();
  }
};
