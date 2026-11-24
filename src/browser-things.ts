// Phase 4 (2026-11-24): SamaraBrowser's things methods, moved out of browser.ts unchanged. They run as the browser's own
// methods (browser.ts puts them on SamaraBrowser.prototype), so `this` is the browser.
import { BrowserWindow, WebContentsView, app, nativeImage, screen, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { SAFE_WEB_PREFERENCES, lockDown } from './safety.ts';
import { run, within } from './page.ts';
import { addressFor } from './address.ts';
import { writeFileAtomic } from './atomic.ts';
import { goesInward } from './driverrules.ts';
import { softEdge } from './winedge.ts';
import type { Mark } from './bookmarks.ts';
import { BW_LOGIN, fillScript } from './vault.ts';
import type { Login } from './vault.ts';
import { randomBytes } from 'node:crypto';
import { search as searchVisits } from './visits.ts';
import { Downloads, kindOf, trayOf } from './dlist.ts';
import type { Dl } from './dlist.ts';
import { cleanNotice, plainNotice } from './notices.ts';
import type { NoticeIn } from './notices.ts';
import { keep } from './mockhome.ts';
import { afterClose } from './rail.ts';
import type { SamaraBrowser, Tab } from './browser.ts';
import { lockKey, scramble, isWeb, bringFront, STREMIO_WEB, HONEST_SITES, GESTURE_MS, PLAY_MS, SLEEP_AFTER_MS, FREEZE_AFTER_MS, VIDEO_AT_JS, mbOf, SLEEP_MIN_MS, MOCK_TUCK_MS, memoryShort, PAGE_STATE_MAX, FILL_WORLD } from './browser.ts';

export const ThingsPart = {
  // ------------------------------------------------------------------ Your things: History and Downloads (2026-10-12)
  isThings(this: SamaraBrowser, sender: Electron.WebContents): boolean { const t = this.tabs.find((x) => x.internal === 'things' && x.view?.webContents === sender); if (t) this.inTab(t); return Boolean(t); },

  /** Open Your things (or bring its tab forward), at History or Downloads. */
  openThings(this: SamaraBrowser, section: 'history' | 'downloads' = 'history'): void {
    if (!this.win || this.win.isDestroyed()) return;
    let t = this.tabs.find((x) => x.internal === 'things');
    if (!t) {
      t = { id: ++this.seq, internal: 'things', view: null, opener: null, title: 'Your things', url: 'samara:things', favicon: '', loading: false, audible: false, muted: false, crashed: false,
        scrollY: 0, zoom: 0, lastSeen: Date.now(), blocked: null, trail: null, done: false, lent: false, upgraded: null, failed: null, blockedPopup: null, pane: this.pane.id };
      this.tabs.push(t);
    }
    this.activate(t.id);
    this.win?.focus();
    const wc = t.view?.webContents;
    if (wc) { const go = () => wc.send('things:section', section); if (wc.isLoading()) wc.once('did-finish-load', go); else go(); }
  },

  /** One page of History, newest first, for what he typed. Plain data. */
  historyPage(this: SamaraBrowser, q: string, offset: number): { items: { url: string; title: string; at: number; favicon: string }[]; more: boolean } {
    const r = searchVisits(this.visits.list, String(q ?? '').slice(0, 200), Math.max(0, Math.min(100_000, Math.floor(offset) || 0)), 100);
    return { items: r.items.map((v) => ({ ...v, favicon: this.iconOf(v.url) })), more: r.more };
  },

  /** His History changes: take one page off, or clear the last hour, today, or everything. */
  historyAct(this: SamaraBrowser, act: string, url?: string, at?: number): void {
    const now = Date.now();
    if (act === 'forget' && typeof url === 'string' && Number.isFinite(at)) this.visits.forget(url, Number(at));
    else if (act === 'clearhour') this.visits.clear(now - 3_600_000);
    else if (act === 'cleartoday') { const d = new Date(now); d.setHours(0, 0, 0, 0); this.visits.clear(d.getTime()); }
    else if (act === 'clearall') this.visits.clear(0);
    else return;
    this.pushThings('history');
  },

  /** Open a page from History: always a new tab, so Your things stays where it was. */
  openFromThings(this: SamaraBrowser, url: string): void { if (isWeb(url)) this.newTab(url); },

  dlView(this: SamaraBrowser, d: Dl): Record<string, unknown> {
    const g = this.got.get(d.id);
    const left = g && g.total > 0 && g.rate > 1 ? Math.round((g.total - g.got) / g.rate) : null;
    return { id: d.id, name: d.name, kind: kindOf(d.name), site: d.site, size: d.size, at: d.at, state: d.state,
      got: g?.got ?? 0, total: g?.total ?? d.size, left, gone: d.state === 'done' && !existsSync(d.file) };
  },

  /**
   * Sheet 106 v7: a finished download is a notice from the download key whose parchment holds the download tray's own
   * row, dragged out by the row. Files that finish while it is up (or waiting) join it: one notice, a row each.
   */
  dlNotice(this: SamaraBrowser, d: Dl): void {
    const row = { id: d.id, kind: kindOf(d.name), name: d.name, meta: `${mbOf(d.size)}${d.site ? ' · ' + d.site : ''} · now` };
    const was = this.notices.group('dl');
    if (was?.files) {
      const files = [...was.files.filter((f) => f.id !== d.id), row].slice(-6);
      this.notices.update(was.id, cleanNotice({ ...was, kick: `${files.length} downloads`, title: 'All ready', files }));
      return;
    }
    const mac = process.platform === 'darwin';
    this.notices.push(cleanNotice({ kind: 'done', from: 'dl', group: 'dl', kick: 'Downloaded', title: 'Ready', files: [row],
      keys: [{ label: mac ? 'Show in Finder' : 'Show in folder', act: 'show' }, { label: 'Got it', act: 'ok', plain: true }] }), (act, _v, n) => {
      // Show in Finder: the one file, or the Downloads folder when several came together
      if (act === 'show') { if (n.files?.length === 1) this.dlAct('show', n.files[0].id); else this.dlAct('folder', 0); }
    });
  },

  /** The Downloads page: every download kept (200), newest first. */
  downloadsPage(this: SamaraBrowser): Record<string, unknown>[] { return [...this.dls.list].reverse().map((d) => this.dlView(d)); },

  pushThings(this: SamaraBrowser, what: 'history' | 'downloads'): void {
    const wc = this.tabs.find((x) => x.internal === 'things')?.view?.webContents;
    if (wc && !wc.isDestroyed()) wc.send('things:changed', what);
  },

  /**
   * The tray in the band: this run's newest 5. Its key shows only while the tray has something (2026-10-12).
   * pop: a download just finished, so the tray drops open by itself for a moment. Progress goes out at most 4 times a second.
   */
  sendDownloads(this: SamaraBrowser, pop: boolean | 'pop' = false): void {
    const go = () => {
      this.dlSendTimer = null;
      const tray = trayOf(this.dls.list, this.traySince, Date.now());
      const data = { items: tray.map((d) => this.dlView(d)), pop: pop === 'pop' };
      for (const p of this.panes) if (this.alive(p)) p.win!.webContents.send('browser:dls', data);
      this.pushThings('downloads');
      // When nothing is coming in, the tray empties an hour after the newest download: look again then.
      if (this.trayTimer) { clearTimeout(this.trayTimer); this.trayTimer = null; }
      if (tray.length && !tray.some((d) => d.state === 'going')) this.trayTimer = setTimeout(() => this.sendDownloads(true), Math.max(1000, tray[0].at + 60 * 60_000 - Date.now() + 500));
    };
    if (pop) { if (this.dlSendTimer) clearTimeout(this.dlSendTimer); go(); return; }
    if (!this.dlSendTimer) this.dlSendTimer = setTimeout(go, 250);
  },

  /** The frame asks again (it just loaded). */
  resendDownloads(this: SamaraBrowser): void { this.sendDownloads(true); },

  /** His click on a download: open it, show it in its folder, stop it, take it off the list; or the tray's own two. */
  dlAct(this: SamaraBrowser, act: string, id: number): void {
    if (act === 'clear') { this.traySince = Date.now(); this.sendDownloads(true); return; }
    if (act === 'folder') { void shell.openPath(app.getPath('downloads')); return; }
    if (act === 'page') { this.openThings('downloads'); return; }
    const d = this.dls.get(id);
    if (!d) return;
    if (act === 'stop') { this.live.get(id)?.cancel(); return; }
    if (act === 'forget') { if (d.state !== 'going') { this.dls.remove(id); this.sendDownloads(true); } return; }
    // Only files this browser saved, and only once they are whole. Windows checks them (the Mark of the Web) as they open.
    if (d.state !== 'done' || !existsSync(d.file)) { this.sendDownloads(true); return; }
    if (act === 'open') void shell.openPath(d.file).then((err) => { if (err) this.note('', { kind: 'bad', from: 'dl', icon: 'wont', kick: 'Could not open', title: d.name, rows: [{ g: 'Why', v: err }] }); });
    else if (act === 'show') shell.showItemInFolder(d.file);
  },

  /**
   * Drag a finished download out of the tray or the page, into Claude, the companion, a folder or the desktop. Only a file on
   * this browser's own list: the page names a number, never a path. The picture under the mouse is its paper icon.
   */
  dlDrag(this: SamaraBrowser, sender: Electron.WebContents, id: number): void {
    const d = this.dls.get(id);
    if (!d || d.state !== 'done' || !existsSync(d.file)) return;
    let icon = nativeImage.createFromPath(path.join(path.dirname(this.o.preloadPath), '..', 'pages', 'art', 'browser', `file_${kindOf(d.name)}.png`));
    if (icon.isEmpty()) icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XqRwAAAABJRU5ErkJggg==');
    try { sender.startDrag({ file: d.file, icon }); } catch (e) { console.error('shell: drag failed: ' + (e as Error).message); }
  },

  /**
   * Freeze or thaw a tab's page through Chromium's own developer channel (Page.setWebLifecycleState, tested in this engine
   * 2026-10-23: timers stop, and stay stopped after the channel is let go; thawing picks up where it left off). Never a
   * page Claude's driver holds that channel on.
   */
  async freeze(this: SamaraBrowser, t: Tab, on: boolean): Promise<void> {
    const wc = t.view?.webContents;
    if (!wc || wc.isDestroyed() || Boolean(t.frozen) === on) return;
    const dbg = wc.debugger;
    if (dbg.isAttached()) return;
    if (on) {
      t.freezing = true;
      const at = await run<number | null>(wc, VIDEO_AT_JS, { ms: 800, fallback: null }); if (typeof at === 'number') t.videoAt = at;
      // He may have come back to it while its spot was read (2026-10-30, stability check): never freeze the tab in front.
      if (!t.freezing || !this.mayRest(t) || wc.isDestroyed() || dbg.isAttached()) { t.freezing = false; return; }
    }
    try {
      dbg.attach('1.3');
      // Marked only when Chromium answered: a slow thaw on the busy Mac used to count as done and left the page dead.
      const answered = await within(dbg.sendCommand('Page.setWebLifecycleState', { state: on ? 'frozen' : 'active' }).then(() => true), 1500, false);
      if (answered) t.frozen = on;
      // A freeze that did not answer in time may still land: it is undone, so a page never stays frozen unmarked.
      // Picked while it froze: thawed again at once, before the channel is let go.
      if (on && (!answered || !t.freezing || !this.mayRest(t))) { await within(dbg.sendCommand('Page.setWebLifecycleState', { state: 'active' }).then(() => true), 1500, false); t.frozen = false; }
    } catch { /* this page will not: it stays as it was */ }
    finally { t.freezing = false; try { if (dbg.isAttached()) dbg.detach(); } catch { /* gone */ } }
  },

  /** Out of sight and quiet: a tab that may be frozen or put to sleep right now. */
  mayRest(this: SamaraBrowser, t: Tab): boolean {
    return Boolean(t.view) && !t.lent && !t.call && !t.internal && !t.audible && !t.crashed && !this.inFront(t);
  },

  /** A freeze still under way is called off (it backs out, or thaws the page itself); a frozen page thaws. */
  thaw(this: SamaraBrowser, t: Tab): void { if (t.freezing) { t.freezing = false; return; } if (t.frozen) void this.freeze(t, false); },

  /** Before a tab sleeps: his spot in its video (a frozen page told it as it froze), and its picture if none is kept. */
  async rest(this: SamaraBrowser, t: Tab): Promise<void> {
    if (!t.view) return;
    if (!t.frozen) { const at = await run<number | null>(t.view.webContents, VIDEO_AT_JS, { ms: 800, fallback: null }); if (typeof at === 'number') t.videoAt = at; }
    if (!t.leftShot) { const shot = await this.shotOf(t); if (shot) t.leftShot = shot; }
    // He may have picked it while its spot and picture were taken: the tab in front is never put to sleep (2026-10-30).
    if (!this.mayRest(t)) return;
    this.sleep(t);
  },

  /** Put a tab to sleep: its page closes, its snapshot stays, the plaque sinks. */
  sleep(this: SamaraBrowser, tab: Tab): void {
    if (!tab.view) return;
    // Its page comes back where it was when it wakes (Chromium's own state, kept with the tab).
    try { const h = tab.view.webContents.navigationHistory; const s = h.getEntryAtIndex(h.getActiveIndex())?.pageState; if (s && s.length <= PAGE_STATE_MAX && !tab.mock) tab.pageState = s; } catch { /* the scroll is kept as before */ }
    this.closeView(tab);
    tab.loading = false; tab.audible = false; tab.frozen = false; tab.slept = true;
  },

  closeView(this: SamaraBrowser, tab: Tab): void {
    if (!tab.view) return;
    const p = this.paneOfTab(tab);
    try { if (this.alive(p)) p.win!.contentView.removeChildView(tab.view); } catch { /* not shown */ }
    try { tab.view.webContents.close(); } catch { /* gone */ }
    tab.view = null;
  },

  /**
   * Tabs sleep the way Chrome's Memory Saver and Edge's sleeping tabs do (2026-10-23: coming back to a sleeping
   * tab, a video above all, was slow and looked broken). A tab in the background already costs almost nothing (throttled,
   * its video paused), so it stays alive and comes back instantly. Only when the computer is short on memory do tabs
   * sleep, the one unseen longest first, a few at a time until it is comfortable; and any tab unseen for 8 hours.
   */
  async sleepIdle(this: SamaraBrowser): Promise<void> {
    // One round at a time (2026-10-30): a round over many tabs on the busy Mac can outlast the minute between rounds.
    if (this.idleBusy || Date.now() < this.idleQuietUntil) return;
    this.idleBusy = true;
    try { await this.sleepIdleRound(); } finally { this.idleBusy = false; }
  },

  async sleepIdleRound(this: SamaraBrowser): Promise<void> {
    const now = Date.now();
    // Sheet 100 v4 (2026-10-28: "Tuck away old ones"): a mockup tab he has not looked at in 3 days closes by
    // itself. It is still in the Mockups tab. Never the one in front, never one that arrived and was not seen yet.
    for (const t of [...this.tabs]) {
      if (!t.mock || t.mock.unseen || this.panes.some((p) => p.active === t.id)) continue;
      const seen = this.mockStore?.meta.get(t.mock.sheet)?.opened ?? t.mock.at ?? now;
      if (now - seen > MOCK_TUCK_MS) this.close(t.id, false);
    }
    // A tab a Claude or companion job has (its own, or his lent) never sleeps or freezes: its page is what the job is using.
    const jobs = (t: Tab) => Boolean(this.driver.pageOfTab(t.id));
    const can = (t: Tab) => t.view && !t.lent && !t.call && !t.internal && !jobs(t) && !this.inFront(t) && !t.audible && now - t.lastSeen > SLEEP_MIN_MS;
    let any = false;
    // Frozen first: out of sight for 5 minutes and silent; a call, the pop-out and Claude's work never.
    for (const t of this.tabs) if (t.view && !t.frozen && !t.lent && !t.call && !t.internal && !jobs(t) && !t.audible && !this.inFront(t) && now - t.lastSeen > FREEZE_AFTER_MS) await this.freeze(t, true);
    const rest = async (t: Tab) => { await this.rest(t); any = true; };
    for (const t of this.tabs) if (can(t) && now - t.lastSeen > SLEEP_AFTER_MS) await rest(t);
    if (await memoryShort()) {
      for (const t of this.tabs.filter(can).sort((a, b) => a.lastSeen - b.lastSeen).slice(0, 3)) await rest(t);
    }
    if (any) this.sendTabs();
  },

  /**
   * Sheet 111: a page for a Claude session, as a real tab in the window in front: in the background, never shown or
   * focused, never in a trail he has open, out of his list (it shows in Claude's group). Its sound is off.
   */
  claudeTab(this: SamaraBrowser, url: string, guest: boolean): { tab: number; wc: Electron.WebContents } | null {
    const w = this.win;
    if (!w || w.isDestroyed() || !isWeb(url)) return null;
    const pend = this.pendingTrail, since = this.newSince;
    this.pendingTrail = null;
    this.nextTab = { claude: true, guest };
    const id = this.newTab(url, null, false);
    this.nextTab = null;
    this.pendingTrail = pend; this.newSince = since;
    const t = id === null ? undefined : this.tabs.find((x) => x.id === id);
    const wc = t?.view?.webContents;
    if (!t || !wc) return null;
    t.muted = true; t.playOkAt = undefined;
    // A tab never shown has no size: its page would lay out at 0 by 0 (no picture, nothing to click). It gets the page
    // area's size at once, hidden.
    t.view!.setBounds(this.pageArea());
    return { tab: t.id, wc };
  },

  newTab(this: SamaraBrowser, address: string, opener: number | null = null, focus = true): number | null {
    const w = this.win;
    if (!w || w.isDestroyed()) return null;
    const url = isWeb(address) ? address : addressFor(address);
    if (!url) return null;
    if (this.toPaid(url)) return null;
    // Phase R (2026-11-24): trails are retired; a tab opened from a link remembers its opener (closing it goes back
    // there) and sits in Today like any other.
    const trail: number | null = null;
    const from = opener !== null ? this.tabs.find((x) => x.id === opener) : undefined;
    this.pendingTrail = null;
    const tab: Tab = { id: ++this.seq, view: null, opener, title: 'New tab', url, favicon: '', loading: true, audible: false, muted: false, crashed: false, scrollY: 0, zoom: 0, lastSeen: Date.now(), blocked: null, trail, done: false, lent: false, upgraded: null, failed: null, blockedPopup: null, pane: this.pane.id, ...(this.nextTab ? { claude: true, guest: this.nextTab.guest } : {}) };
    if (from) this.tabs.splice(this.tabs.indexOf(from) + 1, 0, tab); else this.tabs.push(tab);
    tab.pending = url;
    // 2026-10-25 (: a tab opened from a link while the list is
    // closed counts on the tab arrow (it breathes and shows +1) until he opens the list.
    if (opener !== null && !this.trayOn) this.newSince++;
    // His own new tab, or a link he just clicked: it may play. Tabs Samara reopens never come through here.
    if (opener === null || Date.now() - (this.lastGesture.get(opener) ?? 0) < PLAY_MS) tab.playOkAt = Date.now();
    this.wake(tab);
    if (focus) this.activate(tab.id); else { this.changed(); this.quietHidden(); }
    return tab.id;
  },

  activate(this: SamaraBrowser, id: number): void {
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return;
    // A tab in another window (picked from the address suggestions): that window comes forward.
    const other = t.pane !== this.pane.id;
    if (!this.inTab(t)) return;
    const w = this.win;
    const prev = this.cur();
    if (prev) { this.scrollDue.add(prev.id); prev.lastSeen = Date.now(); }   // its scroll is saved at the next save; leaving it counts as seen
    if (!w || w.isDestroyed()) return;
    if (other) w.focus();
    const mine = this.paneTabs();
    // Sheet 121 (4): the other page of a pair stays shown beside it.
    const partner = t.lent ? null : this.partnerOf(id);
    if (partner && !partner.view) this.wake(partner); else if (partner) this.thaw(partner);
    // Every live tab stays in the window; switching only shows one and hides the rest. Placed first, then
    // shown, so it never appears for a moment at the last tab's size.
    if (t.lent) {
      // Its page is in the popout: the frame shows "playing in the popout" where it was.
      this.active = id;
      for (const x of mine) if (x.view && !x.lent) x.view.setVisible(false);
      this.changed();
      this.quietHidden();
      return;
    }
    if (!t.view) this.wake(t);                         // an asleep tab wakes exactly where it was left
    else this.thaw(t);                                 // a frozen one thaws, instantly
    if (this.watching !== null) this.unwatch(false);
    if (this.veil && this.veil.tab !== id) this.veilDown(0);
    if (this.af && this.af.tab !== id) { this.af = null; this.afPin = null; this.lightHide(); this.afBand(); }
    this.active = id;
    t.lastSeen = Date.now();
    if (t.mock) this.mockStore?.opened(t.mock.sheet);       // sheet 100 v4: when he last looked, kept across restarts
    this.place();
    for (const x of mine) if (x.id !== id && x.view) { try { x.view.webContents.stopFindInPage('clearSelection'); } catch { /* gone */ } }
    // A tab still loading with nothing drawn yet (a new tab, a tab waking up): the page he was on stays until the
    // curtain holds its picture, then the new one fades in as it draws, never a blank frame (2026-10-13).
    const fresh = !this.drawerOpen && Boolean(t.phase) && t.phase !== 'idle' && !t.drawn;
    const hold = fresh && prev && prev.id !== id && prev !== partner && prev.view && !prev.lent && !prev.crashed && !prev.blocked && !prev.failed && prev.view.getVisible() ? prev : undefined;
    // With the drawer open the page stays hidden under it; closing the drawer shows whichever tab is current.
    if (!this.drawerOpen && !hold) t.view!.setVisible(true);
    for (const x of mine) if (x.id !== id && x !== hold && x !== partner && x.view && !x.lent) x.view.setVisible(false);
    if (partner?.view && !this.drawerOpen && !partner.crashed) partner.view.setVisible(true);
    if (fresh) void this.veilUp(t, hold);
    // His ask (2026-11-20): he grabs the address bar while Samara is still opening. Tabs coming back used to take the
    // keyboard, which closed the bar under him. While he is typing there, the page waits.
    if (!t.crashed && !this.paneOfTab(t)?.slotOpen) t.view!.webContents.focus();
    // The drawer is open: the page area is a still picture, so take a fresh one of the tab now in front. Without this
    // a closed tab stayed on screen until the drawer shut (2026-10-12).
    if (this.drawerOpen) void this.drawer(true);
    this.changed();
    this.quietHidden();
  },

  /** Close a tab. Closing his last tab closes the window, as in every browser (2026-10-12). */
  close(this: SamaraBrowser, id: number, lastClosesWindow = true): void {
    const i = this.tabs.findIndex((x) => x.id === id);
    if (i < 0) return;
    if (STREMIO_WEB.test(this.tabs[i]!.url)) this.stremioMoved(this.tabs[i]!, 'about:closed');
    this.inTab(this.tabs[i]!);
    const at = this.paneTabs().indexOf(this.tabs[i]!);
    // A tab playing in the popout comes back first, so its page is closed here and nowhere else.
    if (this.tabs[i]!.lent) this.onReclaim?.();
    // Sheet 115: he closed one of Claude's tabs himself: Claude is told with its next step, never a silent disappearance.
    if (this.tabs[i]!.claude && !this.jobClosing.delete(id)) {
      const dp = this.driver.pageOfTab(id), dj = dp ? this.driver.job(dp.job) : undefined;
      if (dp && dj?.kind === 'claude') this.tell(dj.id, `The user closed page ${dp.id}. Your other pages keep going.`, dp.title);
    }
    const [t] = this.tabs.splice(i, 1);
    if (isWeb(t!.url)) { this.closed.push(t!.url); if (this.closed.length > 25) this.closed.shift(); }
    this.closeView(t!);
    this.tidyTrails();
    if (this.active === id) {
      const rest = this.paneTabs();
      // Phase R: back to the tab that opened it, else the one he used last (Firefox's rule), never just the neighbour.
      const back = afterClose(this.railTab(t!), rest.map((x) => this.railTab(x)));
      const next = rest.find((x) => x.id === back) ?? rest[Math.min(Math.max(0, at), rest.length - 1)];
      this.active = null;
      if (next) this.activate(next.id);
      else if (lastClosesWindow && this.win && !this.win.isDestroyed()) {
        // Nothing left in the whole browser: remember an empty window (so the closed tabs do not come back next time).
        if (!this.tabs.length && this.restored) {
          this.session.keepCopy('empty');
          this.session.write({ v: 1, active: 0, tabs: [], trails: [], closed: this.closed.slice(-25) }, { now: true, force: true });
          this.sync?.changed('tabs');
        }
        this.win.close();
      } else this.newTab(this.HOME);
    } else this.changed();
  },

  /** A click on one tab's plaque: show it, close it, or mute it. */
  tabAct(this: SamaraBrowser, id: number, act: string): void {
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return;
    if (act === 'show') this.activate(id);
    // His mouse rests on a sleeping tab: it starts loading out of sight (no sound until he looks: waking holds it).
    else if (act === 'prewake') { if (!t.view && !t.lent && !t.internal && !t.mock) { this.wake(t); this.sendTabs(); } else this.thaw(t); }
    else if (act === 'close') this.close(id);
    else if (act === 'mute') { t.muted = !t.muted; t.view?.webContents.setAudioMuted(t.muted); this.changed(); }
    else if (act === 'reload') { if (t.view && !t.crashed) t.view.webContents.reload(); else if (t.id === this.active) this.act('reload'); }
    else if (act === 'newwindow') this.newWindowFor(id);
    else if (act === 'tvwindow') void this.tvWindow(t);
    else if (act === 'tvvideo') void this.tvVideo(t);
    else if (act === 'pin' || act === 'unpin') { t.pinned = act === 'pin'; t.lastSeen = Date.now(); this.changed(); }
    // TONIGHT on a faded tab: he wants it kept, so it counts as seen now.
    else if (act === 'keep') { t.lastSeen = Date.now(); this.changed(); }
  },

  reopen(this: SamaraBrowser): void { const u = this.closed.pop(); if (u) this.newTab(u); },

  /**
   * An item from Samara's taskbar right-click list (2026-10-21; jumplist.ts). Samara comes forward, or opens
   * if it was closed (his tabs come back first, as always), then does the one thing. New window opens another window
   * beside the one he has. Reopen closed tab with Samara closed simply opens it: his tabs coming back IS the reopen.
   */
  jumpTask(this: SamaraBrowser, task: 'new-tab' | 'new-window' | 'mockups' | 'hyrule' | 'settings' | 'reopen'): void {
    if (task === 'new-window') { this.createPane(); return; }
    // 2026-11-03: the Shrine dock's right-click asks for Hyrule too (openHyrule waits for a window itself)
    if (task === 'hyrule') { const p = this.lastPane(); if (p) { this.pane = p; bringFront(p.win!); } this.openHyrule(); return; }
    const go = () => {
      if (task === 'new-tab') this.act('newtab');
      else if (task === 'settings') this.openSettings();
      else if (task === 'mockups') { if (this.mockupsOn) this.reopenMockups(); }
      else if (task === 'reopen') this.reopen();
    };
    const p = this.lastPane();
    if (p) { this.pane = p; bringFront(p.win!); go(); return; }
    if (task === 'reopen' || (task === 'mockups' && !this.mockupsOn)) { this.createPane(); return; }
    this.whenOpen.push(go);
    this.createPane();
  },

  /**
   * A popup he opened (Sign in with Google and the like): the same safety as a tab. Its real address is its title,
   * so a fake sign-in window cannot hide where it is. Web pages only, fake sites refused, no popups of its own
   * except the same Chrome rule, and it closes itself when the sign-in is done.
   */
  popupWindow(this: SamaraBrowser, pw: BrowserWindow): void {
    const pwc = pw.webContents;
    softEdge(pw);
    this.nameFor(pwc);
    try { if (HONEST_SITES.test(pwc.getURL())) pwc.setUserAgent(this.honestUA); } catch { /* not yet */ }
    const name = () => { try { const u = new URL(pwc.getURL()); pw.setTitle(`${u.protocol === 'https:' ? '' : 'NOT SECURE  '}${u.hostname}  -  ${pwc.getTitle()}`.slice(0, 200)); } catch { /* not yet */ } };
    pwc.on('page-title-updated', name);
    pwc.on('did-navigate', name);
    // Phase 3: Google refusing the sign-in inside a popup: Chrome is offered the page he was signing in to.
    const opener = () => this.tabs.find((t) => t.id === this.active)?.url ?? '';
    pwc.on('did-stop-loading', () => { void this.googleCheck(pwc, opener); });
    pwc.on('did-navigate-in-page', (_e, _u, main) => { if (main) void this.googleCheck(pwc, opener); });
    const stop = (e: Electron.Event, u: string) => {
      if (!isWeb(u)) { e.preventDefault(); return; }
      if (goesInward(u, pwc.getURL())) { e.preventDefault(); return; }
      if (this.listed(u).length) { e.preventDefault(); pw.close(); this.note('', { from: 'shield', small: true, icon: 'popup', kick: 'Closed a popup', title: 'A fake site' }); }
    };
    pwc.on('will-navigate', stop);
    pwc.on('will-redirect', (e, u, _inPage, isMain) => { if (isMain) stop(e, u); });
    // What a popup opens becomes a tab only on his click in the popup (finding 7).
    let pClick = 0;
    pwc.on('input-event', (_e, i) => { if (i.type === 'mouseDown' || i.type === 'keyDown') pClick = Date.now(); });
    pwc.setWindowOpenHandler(({ url: u }) => { if (isWeb(u) && !goesInward(u, pwc.getURL()) && !this.listed(u).length &&(!this.prefs.popups || Date.now() - pClick < GESTURE_MS)) this.newTab(u, this.active, true); return { action: 'deny' }; });
    pwc.on('will-attach-webview', (e) => e.preventDefault());
  },

  // ------------------------------------------------------------------ 6.23 the vault (Bitwarden)
  /** A password box on the page he is looking at? Read-only, with a deadline. Secure pages only. */
  async lookForLogin(this: SamaraBrowser): Promise<void> {
    // Perf sweep (2026-10-22, item 10 of samara-perf-baseline.md): this asked the tab in front for a password box every
    // 1.5 s all day, behind WoW and minimised too, waking that page's process each time. The key is only for a page he is
    // looking at, so only while one of Samara's windows has the focus; back in Samara, the next look (within 1.5 s) runs.
    const focused = BrowserWindow.getFocusedWindow();
    if (!focused || !this.panes.some((p) => p.win === focused)) return;
    const lp = this.lastPane();
    if (lp) this.pane = lp;
    const t = this.cur();
    const wc = t?.view?.webContents;
    let has = false;
    if (wc && !t!.crashed && !t!.blocked && !t!.failed && !t!.lent && t!.url.startsWith('https:')) {
      has = await run<boolean>(wc, "!!document.querySelector('input[type=password]')", { ms: 800, fallback: false }) === true;
    }
    // His pick: the key shows only where Bitwarden has a login for this site. Until the vault has been opened once
    // there is no list yet, so it shows on any login page, plain, so he can open it the first time.
    let known = false;
    if (has && this.sites) { let host = ''; try { host = new URL(t!.url).hostname; } catch { /* none */ } known = this.siteKnown(host); has = known; }
    if (has !== this.hasLogin || known !== this.loginKnown) { this.hasLogin = has; this.loginKnown = known; this.sendTabs(); }
  },

  /** The site itself (with or without www), scrambled with this PC's own key, against the list. Not its parent domains:
   *  a login for example.com is not for forum.example.com (finding 3). */
  siteKnown(this: SamaraBrowser, host: string): boolean {
    if (!this.sites || !host) return false;
    const h = host.toLowerCase().replace(/^www\./, '');
    return this.sites.has(scramble(this.siteKey, h)) || this.sites.has(scramble(this.siteKey, 'www.' + h));
  },

  /** After an unlock: which sites have logins, kept only as scrambled names. */
  async learnSites(this: SamaraBrowser): Promise<void> {
    const hosts = await this.vault.loginHosts();
    if (!hosts) return;
    if (!this.siteKey) this.siteKey = randomBytes(32).toString('hex');
    this.sites = new Set(hosts.map((h) => scramble(this.siteKey, h)));
    try { const locked = lockKey(this.siteKey); writeFileAtomic(this.sitesFile, JSON.stringify({ ...(locked ? { keyLocked: locked } : { key: this.siteKey }), sites: [...this.sites] })); } catch { /* best effort */ }
    void this.lookForLogin();
  },

  /**
   * Sheet 106 v7: say something as a notice. Each of Samara's lines is sorted on the sheet's table (its kind, big or small,
   * what it drops from); a line given only as words becomes plain small news, or big with a Got it when it is long.
   */
  /** A short line from Samara's own program, said as small news from the ... menu (Send to companion that did not arrive). */
  say(this: SamaraBrowser, kick: string, title: string, kind: NoticeIn['kind'] = 'bad'): void { this.note('', { kind, from: 'menu', small: true, kick, title }); },

  note(this: SamaraBrowser, text: string, o?: Partial<NoticeIn>, on?: (act: string) => void): number {
    const n: NoticeIn = o?.title ? { kind: 'done', from: 'menu', kick: 'Samara', ...o } as NoticeIn : plainNotice(text, o);
    if (!n.small && !n.keys?.length) n.keys = [{ label: n.kind === 'bad' ? 'Close' : 'Got it', act: 'ok' }];
    return this.notices.push(cleanNotice(n), on);
  },

  /** He clicked the key. */
  async vaultKey(this: SamaraBrowser): Promise<void> {
    const t = this.cur();
    if (!t || !t.view || !t.url.startsWith('https:')) { this.note('', { kind: 'bad', from: 'shield', small: true, icon: 'key', kick: 'Not filled', title: 'Not a secure page' }); return; }
    let host = '';
    try { host = new URL(t.url).hostname; } catch { return; }
    this.vaultFor = { tab: t.id, host };
    const P = this.pane;
    const s = await this.vault.state();
    this.pane = P;
    if (s === 'missing') { this.note('', { kind: 'bad', from: 'shield', icon: 'key', kick: 'Bitwarden', title: 'Not on this computer yet', rows: [{ g: 'Why', v: "Bitwarden's tool is not installed here." }] }); return; }
    if (s === 'signed-out') { this.note('', { kind: 'need', from: 'shield', icon: 'key', kick: 'Bitwarden', title: 'Sign in once first', rows: [{ g: 'Yourself', v: BW_LOGIN }] }); return; }
    if (s === 'locked') { this.win?.webContents.send('browser:vault', { mode: 'unlock', host }); return; }
    await this.vaultList();
  },

  /** His master password, straight from the frame's box. Used once by bw, never kept, never logged. */
  async vaultUnlock(this: SamaraBrowser, password: string): Promise<void> {
    const f = this.vaultFor;
    if (!f) return;
    const P = this.pane;
    const ok = await this.vault.unlock(password);
    this.pane = P;
    if (!ok) { this.win?.webContents.send('browser:vault', { mode: 'unlock', host: f.host, wrong: true }); return; }
    void this.learnSites();
    await this.vaultList();
  },

  async vaultList(this: SamaraBrowser): Promise<void> {
    const f = this.vaultFor;
    const t = f ? this.tabs.find((x) => x.id === f.tab) : undefined;
    if (!f || !t) return;
    const logins: Login[] | null = await this.vault.loginsFor(t.url);
    if (!this.inTab(t)) return;
    if (logins === null) { this.note('', { kind: 'bad', from: 'shield', icon: 'key', kick: 'Bitwarden', title: 'Did not answer', rows: [{ g: 'Try', v: 'Press the key again.' }], keys: [{ label: 'Try again', act: 'retry' }, { label: 'Close', act: 'ok', plain: true }] }, (act) => { if (act === 'retry') void this.vaultKey(); }); return; }
    if (!logins.length) { this.win?.webContents.send('browser:vault', null); this.note('', { kind: 'bad', from: 'shield', small: true, icon: 'key', kick: 'No saved login', title: f.host }); return; }
    if (logins.length === 1) { await this.vaultPick(logins[0]!.id); return; }
    this.win?.webContents.send('browser:vault', { mode: 'pick', host: f.host, logins });
  },

  /** Fill one login into the page, if it is still the page he clicked the key on. */
  async vaultPick(this: SamaraBrowser, id: string): Promise<void> {
    const f = this.vaultFor;
    this.vaultFor = null;
    const t = f ? this.tabs.find((x) => x.id === f.tab) : undefined;
    if (t) this.inTab(t);
    this.win?.webContents.send('browser:vault', null);
    const wc = t?.view?.webContents;
    if (!f || !t || !wc || wc.isDestroyed() || t.blocked || t.failed) return;
    let host = '';
    try { host = new URL(wc.getURL()).hostname; } catch { /* none */ }
    if (host !== f.host || !wc.getURL().startsWith('https:')) { this.note('', { kind: 'bad', from: 'shield', small: true, icon: 'key', kick: 'Nothing filled', title: 'The page changed' }); return; }
    const s = await this.vault.secret(id);
    if (!s) { this.note('', { kind: 'bad', from: 'shield', icon: 'key', kick: 'Bitwarden', title: 'Did not give it back', rows: [{ g: 'Try', v: 'Press the key again.' }], keys: [{ label: 'Try again', act: 'retry' }, { label: 'Close', act: 'ok', plain: true }] }, (act) => { if (act === 'retry') void this.vaultKey(); }); return; }
    const did = await run<number>(wc, fillScript(s.username, s.password), { world: FILL_WORLD, ms: 2000, fallback: 0 });
    if (!did) this.note('', { kind: 'bad', from: 'shield', small: true, icon: 'key', kick: 'Nothing filled', title: 'No login box here' });
  },

  vaultCancel(this: SamaraBrowser): void { this.vaultFor = null; this.win?.webContents.send('browser:vault', null); },

  /** The light's layer for this window, made once and kept hidden. */
  lightView(this: SamaraBrowser): WebContentsView | null {
    const w = this.win;
    if (!w || w.isDestroyed()) return null;
    if (this.pane.lightV && !this.pane.lightV.webContents.isDestroyed()) return this.pane.lightV;
    const v = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, preload: path.join(path.dirname(this.o.preloadPath), 'lightpreload.cjs'), backgroundThrottling: false } });
    lockDown(v.webContents);
    v.setBackgroundColor('#00000000');
    v.setVisible(false);
    void v.webContents.loadURL(`${this.o.origin}/light.html`).catch(() => { /* its window closed while it loaded */ });
    this.pane.lightV = v;
    return v;
  },

  isLight(this: SamaraBrowser, sender: Electron.WebContents): boolean {
    const p = this.panes.find((x) => x.lightV && !x.lightV.webContents.isDestroyed() && x.lightV.webContents === sender);
    if (p) this.pane = p;
    return Boolean(p);
  }
};
