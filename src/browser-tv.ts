// Phase 4 (2026-11-24): SamaraBrowser's tv methods, moved out of browser.ts unchanged. They run as the browser's own
// methods (browser.ts puts them on SamaraBrowser.prototype), so `this` is the browser.
import { BrowserWindow, app, nativeImage, screen, shell } from 'electron';
import path from 'node:path';
import { SAFE_WEB_PREFERENCES, lockDown } from './safety.ts';
import { run } from './page.ts';
import { CastSession, DEFAULT_PLAYER, airplayNames, findRemoteTvs, findTvs } from './tv.ts';
import { KEY, ensureCert, remote, startPairing } from './tvremote.ts';
import type { TvTarget } from './tvremote.ts';
import { PAGE_VIDEO_JS, PAUSE_PAGE_JS, YOUTUBE_APP, YOUTUBE_NS, copyProtected, plainMedia, seekPageJs, tvAppLink, tvSteps, twitchMedia, twitchOf, youTubeId, youTubeOnTv } from './tvmedia.ts';
import type { TvAppLink } from './tvmedia.ts';
import { writeFileAtomic } from './atomic.ts';
import { SPLIT_EDGE } from './splitview.ts';
import { readJson } from './store.ts';
import { softEdge } from './winedge.ts';
import { FORM_EVERY_MS } from './claudekeep.ts';
import { keep } from './mockhome.ts';
import { sched } from './sched.ts';
import type { SamaraBrowser, Tab, Pane } from './browser.ts';
import { SAMARA_ICON, TV_VIDEO_SITE, newPane, isWeb, liveView, FLOAT_CHANNELS, bringFront, hostOf, TRAY_W } from './browser.ts';

export const TvPart = {
  async stremioHashes(this: SamaraBrowser): Promise<string[]> {
    try {
      const r = await fetch(`${this.stremioApi}/stats.json`, { signal: AbortSignal.timeout(2000) });
      return Object.keys(await r.json() as Record<string, unknown>).filter((h) => /^[0-9a-f]{40}$/i.test(h));
    } catch { return []; }
  },

  stremioMoved(this: SamaraBrowser, tab: Tab, url: string): void {
    const st = this.stremioMine.get(tab.id) ?? { hashes: [], seen: null, url: '' };
    if (st.url === url) return;
    st.url = url;
    this.stremioMine.set(tab.id, st);
    if (st.timer) clearTimeout(st.timer);
    const playing = /#\/player\//.test(url) && url !== 'about:closed';
    void (async () => {
      const now = await this.stremioHashes();
      // What was already running when this tab first came to Stremio is not its own (his Stremio app's, say).
      if (!st.seen) st.seen = new Set(now);
      // Leaving a video, or onto another one: what this tab started before stops now.
      const drop = st.hashes.filter((h) => now.includes(h));
      st.hashes = [];
      for (const h of drop) await fetch(`${this.stremioApi}/${h}/remove`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
      if (drop.length) console.log(`shell: Stremio: stopped ${drop.length} old download${drop.length === 1 ? '' : 's'}`);
      if (!playing) { if (url === 'about:closed') this.stremioMine.delete(tab.id); else st.seen = new Set(await this.stremioHashes()); return; }
      // A video: whatever is running that was not running before it (it may have started a moment before this) is its.
      const watch = (left: number) => {
        void this.stremioHashes().then((hs) => { if (st.url !== url) return; for (const h of hs) if (!st.seen!.has(h) && !drop.includes(h) && !st.hashes.includes(h)) st.hashes.push(h); });
        if (left > 0) st.timer = setTimeout(() => watch(left - 1), 3000);
      };
      watch(8);
    })();
  },

  tvState(this: SamaraBrowser): Record<string, unknown> | null {
    const t = this.cur();
    // Sheet 99: the TV icon sits in the bar on any page Samara can send (the Mac only: that is where his TV is)
    const can = Boolean((process.platform === 'darwin' || this.o.tvAt) && t && isWeb(t.url) && !t.internal && (tvAppLink(t.url) || TV_VIDEO_SITE.test(hostOf(t.url)) || t.audible));
    if (!this.tv && !this.tvAsk && this.tvStep === null && !can) return null;
    const app = t ? tvAppLink(t.url)?.app ?? null : null;
    return { kind: this.tv?.kind ?? null, name: this.tv?.name ?? this.tvName, title: this.tv?.title ?? '', site: this.tv?.site ?? hostOf(t?.url ?? ''), ask: this.tvAsk,
      can, step: this.tvStep, app, toTv: Boolean(app || (t && !copyProtected(t.url))), linkErr: this.tvLinkErr };
  },

  /** The linked TV and his two TV settings (answer YouTube's "Who's watching?", pause the video here). */
  tvCfg(this: SamaraBrowser): { host: string; name: string; linked: boolean; answer: boolean; pause: boolean } {
    const j = readJson<Record<string, unknown>>(this.tvFile, {});   // none yet: {}
    return { host: typeof j.host === 'string' ? j.host : '', name: typeof j.name === 'string' ? j.name : '', linked: j.linked === true, answer: j.answer !== false, pause: j.pause !== false };
  },

  saveTvCfg(this: SamaraBrowser, c: ReturnType<SamaraBrowser['tvCfg']>): void { try { writeFileAtomic(this.tvFile, JSON.stringify(c)); } catch (e) { console.log('shell: TV: could not save its link: ' + (e as Error).message); } },

  tvTarget(this: SamaraBrowser, host: string): TvTarget {
    const at = this.o.tvAt;
    return { host: at ? at.host : host, ...(at ? { port: at.port, pairPort: at.pairPort } : {}), ...ensureCert(this.o.stateDir) };
  },

  /** His TV on the network (the one named yeet if there are several), or the one he linked last time. */
  async tvFind(this: SamaraBrowser): Promise<{ host: string; name: string } | null> {
    if (this.o.tvAt) return { host: this.o.tvAt.host, name: this.o.tvAt.name };
    const c = this.tvCfg();
    const all = await findRemoteTvs().catch(() => []);
    const tv = all.find((x) => c.name && x.name === c.name) ?? all.find((x) => /yeet/i.test(x.name)) ?? all[0];
    return tv ?? (c.host ? { host: c.host, name: c.name || 'your TV' } : null);
  },

  tvRemoteRun(this: SamaraBrowser, steps: Parameters<typeof remote>[1]): Promise<void> { const c = this.tvCfg(); return remote(this.tvTarget(c.host), steps); },

  setTvStep(this: SamaraBrowser, n: number | null): void { this.tvStep = n; this.sendTabs(); },

  /**
   * Send to TV, one click on the TV icon (sheet 99): the TV's own app when the site has one, else just the video; a
   * copy-protected site with neither sends the window. The icon fills as each step is done; the video here pauses once the TV has it; nothing fails silently.
   */
  async tvSend(this: SamaraBrowser, t: Tab): Promise<void> {
    const say = (s: string) => console.log(`shell: TV: ${s}`);
    const wc = t.view?.webContents, live = Boolean(wc && !wc.isDestroyed());
    const v = live ? await run<{ at: number } | null>(wc!, PAGE_VIDEO_JS, { ms: 1500, fallback: null }) : null;
    const at = v?.at ?? 0;
    const a = tvAppLink(t.url, at);
    say(`send from ${hostOf(t.url)}: ${a ? 'the TV\'s ' + a.app : copyProtected(t.url) ? 'the whole window' : 'just the video'}`);
    // A copy-protected site with no app on the TV cannot go on its own: the click sends the window instead.
    if (!a) { if (copyProtected(t.url)) await this.tvWindow(t); else await this.tvVideo(t); return; }
    this.tvAsk = null; this.tvLinkErr = '';
    this.setTvStep(0);
    const tv = await this.tvFind();
    if (!tv) { say('no TV found'); this.tvName = 'your TV'; this.tvStep = null; this.tvAsk = 'asleep'; this.sendTabs(); return; }
    this.tvName = tv.name;
    const c = this.tvCfg();
    if (!c.linked || c.host !== tv.host) {
      // the very first send: the TV shows its code, and the ask hangs from the TV icon for it
      this.saveTvCfg({ ...c, host: tv.host, name: tv.name, linked: false });
      try { this.tvPair?.close(); this.tvPair = await startPairing(this.tvTarget(tv.host)); }
      catch (e) { say('could not start linking: ' + (e as Error).message); this.tvStep = null; this.tvAsk = 'asleep'; this.sendTabs(); return; }
      this.tvPending = { tab: t.id, a, at }; this.tvAsk = 'link'; this.sendTabs();
      return;
    }
    await this.tvOpen(t.id, a);
  },

  /** The code he typed: Samara is linked, and the send that was waiting goes on. */
  async tvCode(this: SamaraBrowser, code: string): Promise<void> {
    if (!this.tvPair || !this.tvPending) return;
    try { await this.tvPair.finish(code); }
    catch (e) { this.tvLinkErr = (e as Error).message.includes('look right') || (e as Error).message.includes('match') ? 'That code does not match. Check the TV and type it again.' : 'The TV stopped waiting. Click the TV icon to try again.'; this.sendTabs(); return; }
    this.tvPair = null; this.tvLinkErr = '';
    this.saveTvCfg({ ...this.tvCfg(), linked: true });
    console.log('shell: TV: linked to ' + this.tvName);
    const p = this.tvPending; this.tvPending = null; this.tvAsk = null;
    await this.tvOpen(p.tab, p.a);
  },

  async tvOpen(this: SamaraBrowser, tabId: number, a: TvAppLink): Promise<void> {
    const t = this.tabs.find((x) => x.id === tabId);
    const c = this.tvCfg();
    this.setTvStep(1);
    const steps = tvSteps(a, { answerYouTube: c.answer, pause: c.pause });
    const linkAt = steps.find((x) => 'link' in x)?.at ?? 0;
    const two = setTimeout(() => this.setTvStep(2), linkAt);
    try { await remote(this.tvTarget(c.host), steps); }
    catch (e) {
      clearTimeout(two);
      const why = (e as Error).message;
      console.log('shell: TV: failed: ' + why);
      // turned away: the TV forgot Samara (a reset, or unlinked on the TV), so it links again on the next click
      if (/turned Samara away/.test(why)) this.saveTvCfg({ ...c, linked: false });
      this.tvStep = null; this.tvAsk = 'asleep'; this.sendTabs(); return;
    }
    clearTimeout(two);
    console.log(`shell: TV: playing in the TV's ${a.app}`);
    const wc = t?.view?.webContents;
    if (c.pause && wc && !wc.isDestroyed()) void run(wc, PAUSE_PAGE_JS, { fallback: null });
    this.tv = { kind: 'app', tab: tabId, name: this.tvName, title: (t?.title || '').slice(0, 200), site: hostOf(t?.url ?? ''), app: a.app };
    this.tvStep = null;
    this.sendTabs();
  },

  /**
   * Just the video (Stremio, YouTube, Twitch, any plain video). The TV plays it by itself, so his TV remote
   * works and the Mac is free; the tab's own video pauses where it was. A page that plays from inside itself has nothing
   * to send on its own: Samara says so and offers the whole window.
   */
  async tvVideo(this: SamaraBrowser, t: Tab): Promise<void> {
    const wc = t.view?.webContents;
    // Every step goes in the log (2026-10-27: "nothing" happened, and nothing said why), and no way out is
    // silent any more.
    const say = (s: string) => console.log(`shell: TV: ${s}`);
    say(`just the video from ${hostOf(t.url)} (tab ${t.lent ? 'in the pop-out' : t.view ? 'live' : 'asleep'})`);
    // A YouTube video goes by its address alone, so an asleep tab (as every tab is after an update) sends too.
    const live = Boolean(wc && !wc.isDestroyed());
    if (!isWeb(t.url) || (!live && !youTubeId(t.url))) { say('no live page to send'); this.note('', { kind: 'bad', from: 'menu', icon: 'tv', kick: 'The TV', title: 'No video playing', rows: [{ g: 'Do this', v: 'Play it, then send it again.' }] }); return; }
    await this.tvOff(false);
    const tvs = await findTvs();
    say(`found ${tvs.map((x) => x.name).join(', ') || 'no TV'}`);
    const tv = tvs.find((x) => /yeet/i.test(x.name)) ?? tvs[0];
    if (!tv) { this.note('', { kind: 'bad', from: 'menu', icon: 'tv', kick: 'The TV', title: 'Didn\u2019t answer', rows: [{ g: 'Try', v: 'Turn it on, then try again. The whole window works with it asleep.' }], keys: [{ label: 'Try again', act: 'retry' }, { label: 'Close', act: 'ok', plain: true }] }, (act) => { if (act === 'retry') void this.tvAct('retry'); }); return; }
    this.tvName = tv.name;
    const v = live ? await run<{ src: string; at: number; live: boolean; paused: boolean; poster: string; title: string } | null>(wc!, PAGE_VIDEO_JS, { ms: 2000, fallback: null }) : null;
    const title = (t.title || v?.title || '').slice(0, 200), site = hostOf(t.url);
    const cast = new CastSession(tv);
    try {
      const yt = youTubeId(t.url);
      if (yt) {
        say(`YouTube video ${yt}`);
        await cast.open(YOUTUBE_APP);
        say('YouTube opened on the TV');
        // YouTube starting from cold takes longer than a few seconds to answer (the TV, 2026-10-27: it gave up at 8 s),
        // and a question asked before it is ready goes unheard: asked again every 1.5 s, for up to 25 s.
        const screen = await new Promise<string>((res, rej) => {
          const ask = setInterval(() => cast.appSend(YOUTUBE_NS, { type: 'getMdxSessionStatus' }), 1500);
          const tm = setTimeout(() => { clearInterval(ask); rej(new Error('YouTube on the TV did not answer. If the TV was off, turn it on and send it again')); }, 25_000);
          cast.on('app', (ns: string, d: Record<string, unknown>) => { const id = (d.data as Record<string, unknown> | undefined)?.screenId; if (ns === YOUTUBE_NS && typeof id === 'string') { clearTimeout(tm); clearInterval(ask); res(id); } });
          cast.appSend(YOUTUBE_NS, { type: 'getMdxSessionStatus' });
        });
        say('YouTube on the TV answered');
        const why = await youTubeOnTv(screen, yt, v?.at ?? 0);
        say(why ?? 'video sent');
        if (why) throw new Error(why);
      } else {
        const media = twitchOf(t.url) ? await twitchMedia(t.url, title, v?.at ?? 0) : plainMedia(v ? { ...v, title } : null);
        if (!media) { cast.close(); this.note('', { kind: 'bad', from: 'menu', icon: 'tv', kick: 'The TV', title: 'Only as the whole window', rows: [{ g: 'Why', v: 'This page plays its video from inside itself.' }], keys: [{ label: 'Send window', act: 'window' }, { label: 'Close', act: 'ok', plain: true }] }, (act) => { if (act === 'window') void this.tvAct('send:window'); }); return; }
        await cast.open(DEFAULT_PLAYER);
        await cast.load(media);
      }
    } catch (e) { cast.close(); say(`failed: ${(e as Error).message}`); this.note('', { kind: 'bad', from: 'menu', icon: 'tv', kick: tv.name, title: 'Could not play it', rows: [{ g: 'Why', v: (e as Error).message }] }); return; }
    if (live) void run(wc!, PAUSE_PAGE_JS, { fallback: null });
    this.tv = { kind: 'video', tab: t.id, name: tv.name, title, site, cast };
    cast.on('ended', () => { if (this.tv?.cast === cast) { this.tv = null; this.tvAsk = null; this.sendTabs(); } });
    this.sendTabs();
  },

  /**
   * The whole window (it fills the TV and the sound plays there). The Mac must use yeet as a second screen,
   * which only he can turn on, once; Samara finds that screen by the TV's AirPlay name and moves this window onto it.
   */
  async tvWindow(this: SamaraBrowser, t: Tab): Promise<void> {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    if (this.tv?.kind === 'window') return;
    const names = await airplayNames();
    if (names.length) this.tvName = names.find((n) => /yeet/i.test(n)) ?? names[0]!;
    const shown = screen.getAllDisplays().find((d) => !d.internal && names.some((n) => d.label.toLowerCase().includes(n.toLowerCase())));
    if (!shown) { this.tvAsk = 'setup'; this.sendTabs(); return; }
    await this.tvOff(false);
    if (this.active !== t.id) this.activate(t.id);
    const back = w.isFullScreen() ? null : w.getBounds();
    if (w.isFullScreen()) w.setFullScreen(false);
    w.setBounds(shown.bounds);
    setTimeout(() => { if (!w.isDestroyed()) w.setFullScreen(true); }, 300);
    this.tv = { kind: 'window', tab: t.id, name: this.tvName, title: (t.title || '').slice(0, 200), site: hostOf(t.url), ...(back ? { back } : {}), win: w };
    this.tvAsk = null;
    this.sendTabs();
  },

  /** The TV ask's keys, from the frame only (browseripc). */
  async tvAct(this: SamaraBrowser, act: string): Promise<void> {
    const t = this.cur();
    // Sheet 99 : Send to TV plays the show or video on the TV by
    // itself (the TV's own app when the site has one, else just the video); Send window shows this whole window there.
    if (act === 'send') { if (t) void this.tvSend(t); return; }
    if (act === 'send:window') { if (t) void this.tvWindow(t); return; }
    if (act === 'settings') { this.openSettings('tv'); return; }
    if (act.startsWith('code:')) { void this.tvCode(act.slice(5)); return; }
    if (act === 'retry') { this.tvAsk = null; this.sendTabs(); if (t) void this.tvSend(t); return; }
    if (act === 'nolink') { this.tvPair?.close(); this.tvPair = null; this.tvPending = null; this.tvAsk = null; this.tvStep = null; this.tvLinkErr = ''; this.sendTabs(); return; }
    if (act === 'open') { this.tvAsk = this.tv ? 'playing' : null; this.sendTabs(); }
    else if (act === 'close') { this.tvAsk = null; this.sendTabs(); }
    else if (act === 'displays') { this.tvAsk = null; this.sendTabs(); void shell.openExternal('x-apple.systempreferences:com.apple.Displays-Settings.extension'); }
    else if (act === 'back') await this.tvOff(true);
    else if (act === 'stop') await this.tvOff(false);
  },

  /** Off the TV: back into the tab where it left off (paused), or the window back to its size on the Mac. */
  async tvOff(this: SamaraBrowser, bringBack: boolean): Promise<void> {
    const tv = this.tv;
    this.tv = null; this.tvAsk = null;
    if (!tv) return;
    if (tv.kind === 'app') {
      // In the TV's own app: Samara cannot read where it got to, so Stop just takes the TV back to its home.
      if (!bringBack) void this.tvRemoteRun([{ key: KEY.HOME }]).catch(() => null);
      if (bringBack) this.activate(tv.tab);
    } else if (tv.kind === 'video' && tv.cast) {
      const at = bringBack ? await tv.cast.where() : 0;
      tv.cast.stop();
      const wc = this.tabs.find((x) => x.id === tv.tab)?.view?.webContents;
      if (bringBack && wc && !wc.isDestroyed()) { void run(wc, seekPageJs(at), { fallback: null }); this.activate(tv.tab); }
    } else if (tv.kind === 'window' && tv.win && !tv.win.isDestroyed()) {
      const w = tv.win;
      const done = () => { if (!w.isDestroyed() && tv.back) w.setBounds(tv.back, true); };
      if (w.isFullScreen()) { w.once('leave-full-screen', () => setTimeout(done, 200)); w.setFullScreen(false); } else done();
    }
    this.sendTabs();
  },

  raiseTray(this: SamaraBrowser): void {
    if (this.trayOn && this.trayV && this.win && !this.win.isDestroyed()) this.win.contentView.addChildView(this.trayV);
    // Sheet 102: the address bar's open list stays over whatever comes up under it.
    if (this.pane.sugV && !this.pane.sugV.webContents.isDestroyed() && this.pane.sugV.getVisible() && this.win && !this.win.isDestroyed()) this.win.contentView.addChildView(this.pane.sugV);
    // 2026-10-21: the rune's panel too, whatever comes up under it (a waking tab, the page back from the pop-out).
    const P = this.pane;
    if (P.runeOn && P.runeV && !P.runeV.webContents.isDestroyed() && this.win && !this.win.isDestroyed()) this.win.contentView.addChildView(P.runeV);
    // Sheet 106: a notice stays over everything under it.
    if (this.noticePane === P && P.noticeV && !P.noticeV.webContents.isDestroyed() && P.noticeV.getVisible() && this.win && !this.win.isDestroyed()) this.win.contentView.addChildView(P.noticeV);
  },

  placeTray(this: SamaraBrowser): void {
    const w = this.win, v = this.trayV;
    if (!w || w.isDestroyed() || !v || !this.trayOn) return;
    const [cw, ch] = w.getContentSize();
    v.setBounds({ x: this.trayAt.x, y: this.trayAt.y, width: Math.max(0, Math.min(TRAY_W[this.tabSize], cw - this.trayAt.x)), height: Math.max(0, ch - this.trayAt.y) });
  },

  /** Open the window (or bring it forward), optionally on an address. Coming back, every tab comes back. */
  open(this: SamaraBrowser, url?: string): void {
    const p = this.lastPane();
    if (p && !this.restored) {
      if (url) this.whenOpen.push(() => this.newTab(url));
      // 2026-11-03 (after the 1.45 update Samara stayed invisible and the dock could not open it): asked to
      // open, a hidden window always comes up, still starting or not.
      if (!p.win!.isVisible() || p.win!.isMinimized()) { console.log('shell: browser: open while still starting; the hidden window comes up'); bringFront(p.win!); }
      return;
    }
    if (p) {
      this.pane = p;
      const hidden = !p.win!.isVisible();
      bringFront(p.win!);
      // the same report: say when a hidden window was asked up, and whether it really came up, for next time
      if (hidden) setTimeout(() => { if (!p.win || p.win.isDestroyed()) return; console.log(`shell: browser: open found the window hidden; now ${p.win.isVisible() ? 'showing' : 'STILL HIDDEN'}`); if (!p.win.isVisible()) p.win.show(); }, 600);
      if (url) this.newTab(url);
      return;
    }
    this.createPane(url);
  },

  /**
   * A browser window. The first one brings his tabs back (or his home page); one made by dragging a tab out of another
   * (`bring`) opens where he let go and takes that tab, live, nothing reloaded.
   */
  createPane(this: SamaraBrowser, url?: string, bring?: Tab | Tab[], at?: { x: number; y: number; width: number; height: number }): void {
    const first = !this.panes.some((x) => this.alive(x));
    if (first && !bring) this.restored = false;     // a new first window reads his tabs back before anything saves
    const wa = screen.getPrimaryDisplay().workArea;
    const was = first ? this.savedPlace() : null;
    // A new run: the download tray starts empty (its key hidden) until something downloads.
    if (first) this.traySince = Date.now();
    const p = newPane(++this.paneSeq);
    const w = new BrowserWindow({
      width: Math.min(1440, wa.width - 80), height: Math.min(900, wa.height - 60), minWidth: 720, minHeight: 480,
      ...(was ? { x: was.x, y: was.y, width: was.width, height: was.height } : {}),
      ...(at ? { x: Math.round(at.x), y: Math.round(at.y), width: Math.max(720, Math.round(at.width)), height: Math.max(480, Math.round(at.height)) } : {}),
      show: false, backgroundColor: '#24160D', title: 'Samara',
      // The carved band IS the title bar; Windows draws its own buttons over the band's right end.
      // See-through (the research: Flow browser), so Windows' own minimise, maximise and close sit ON the wood
      // with their real hover and snap layouts, instead of on a flat block that looked stuck on.
      // 2026-10-12: Samara draws its own bold gold minimise, maximise and close on the band; Windows' were too thin.
      titleBarStyle: 'hidden',
      // Autofill's sounds (sheet 77) play in this, Samara's own page, while his keys are in the site's page.
      webPreferences: { ...SAFE_WEB_PREFERENCES, preload: this.o.preloadPath, autoplayPolicy: 'no-user-gesture-required' },
    });
    // Samara (name and icon chosen in sheet 33 L1, 2026-10-14): the browser wears its own lantern and gets its
    // own taskbar button; the companion's other windows keep its face.
    try { w.setIcon(SAMARA_ICON); w.setAppDetails({ appId: 'Samara', appIconPath: SAMARA_ICON, appIconIndex: 0, relaunchDisplayName: 'Samara' }); } catch { /* not Windows */ }
    // The lantern lights up as the window opens (2026-10-14), the same frames as the Mac's Dock.
    if (process.platform === 'win32') {
      let i = 0;
      const t = setInterval(() => {
        if (w.isDestroyed()) { clearInterval(t); return; }
        // 2026-10-20: frames made at the taskbar's own sizes from the 24 px drawing (tools/samara-icons-leaf.py). The 64 px
        // frames, shrunk to 24 by Windows, came out blurry; the Mac's Dock still uses those.
        try { w.setIcon(nativeImage.createFromPath(path.join(import.meta.dirname, '..', 'pages', 'art', 'samara', `samara-lightup-${i}.ico`))); } catch { /* the lit icon stays */ }
        if (++i > 9) { clearInterval(t); try { w.setIcon(SAMARA_ICON); } catch { /* fine */ } }
      }, 55);
    }
    p.win = w;
    this.panes.push(p);
    this.pane = p;
    this.focused = p;
    lockDown(w.webContents);
    // Sheet 120 A: what the band's panels draw from goes to their floating layer too (and is kept for when it loads).
    p.floatLast = new Map();
    const frameSend = w.webContents.send.bind(w.webContents);
    w.webContents.send = ((ch: string, ...args: unknown[]) => {
      frameSend(ch, ...args);
      if (!FLOAT_CHANNELS.has(ch)) return;
      p.floatLast!.set(ch, args);
      const v = p.floatV;
      if (p.floatReady && liveView(v)) v!.webContents.send(ch, ...args);
    }) as typeof w.webContents.send;
    softEdge(w);
    // M6: on the Mac, 'hidden' still shows the red, yellow and green buttons, floating over the band's left end (his
    // report, 2026-10-13). Samara's own gold buttons are the window's buttons on both machines.
    if (process.platform === 'darwin') w.setWindowButtonVisibility(false);
    if (was?.maximized) w.once('ready-to-show', () => w.maximize());
    let keep: NodeJS.Timeout | null = null;
    // Where the first window was is kept for next time; the others are made by dragging and open where they are dropped.
    const keepSoon = () => { if (keep) clearTimeout(keep); keep = setTimeout(() => { this.pane = p; if (this.panes[0] === p) this.keepPlace(); }, 800); };
    w.on('focus', () => { this.focused = p; this.frontNow(); });
    w.on('blur', () => setTimeout(() => this.frontNow(), 60));
    w.on('resize', () => { this.pane = p; this.place(); this.placeTray(); this.placeRune(); this.placeFloat(); if (this.lp?.pane === p) this.placePeek(); keepSoon(); });
    w.on('move', keepSoon);
    w.on('maximize', () => { this.pane = p; this.place(); keepSoon(); this.sendTabs(); });
    w.on('unmaximize', () => { this.pane = p; this.place(); keepSoon(); this.sendTabs(); });
    w.on('close', () => { this.pane = p; if (this.panes[0] === p) this.keepPlace(); if (!this.quitting) void this.snapshot(true); this.visits.flush(); this.veil = null; try { this.curtain?.webContents.close(); } catch { /* gone */ } this.curtain = null; });
    // 6.22b bug 4: the mouse's back and forward side buttons.
    w.on('app-command', (_e, cmd) => { this.pane = p; if (cmd === 'browser-backward') this.sideNav('back'); else if (cmd === 'browser-forward') this.sideNav('forward'); });
    // A page in fullscreen: leaving the window's fullscreen (F11, a snap) ends it too.
    w.on('leave-full-screen', () => { const t = this.tabs.find((x) => x.id === p.fullTab); if (t?.view) void run(t.view.webContents, 'document.fullscreenElement&&document.exitFullscreen().catch(()=>{});true', { ms: 500, fallback: null }); });
    w.on('closed', () => {
      this.pane = p;
      // Its hidden helper pages (tab list, rune layer, light, suggestions) go with it: a page in a view outlives its
      // window, and each close and reopen left four of them running (2026-10-30, stability check).
      for (const v of [p.trayV, p.runeV, p.lightV, p.sugV, p.noticeV, p.handV, p.floatV]) { try { if (liveView(v)) v!.webContents.close(); } catch { /* gone */ } }
      // The tab list's hover picture and a peek lived in this window: they go with it.
      if (this.tabPeekV && !this.panes.some((x) => x !== p && this.alive(x) && x.win!.contentView.children.includes(this.tabPeekV!))) { try { if (liveView(this.tabPeekV)) this.tabPeekV.webContents.close(); } catch { /* gone */ } this.tabPeekV = null; this.tabPeekOn = false; }
      if (this.lp?.pane === p) this.lp = null;
      p.lightV = null; p.sugV = null; p.noticeV = null; p.handV = null; p.floatV = null; p.floatOn = false; p.floatReady = false;
      // A notice it was showing moves to the window left (next time one is placed).
      if (this.noticePane === p) { this.noticePane = null; if (this.noticeNow) setTimeout(() => { if (this.noticeNow && !this.noticePane) void this.noticePlace(++this.noticeGen); }, 0); }
      const others = this.panes.filter((x) => x !== p && this.alive(x));
      // Quitting: this window's tabs stay in the snapshot already taken; nothing is dropped or saved again.
      if (others.length && this.quitting) { p.win = null; p.trayV = null; p.trayOn = false; p.runeV = null; p.runeOn = false; this.panes = others; if (this.focused === p) this.focused = null; this.pane = others[others.length - 1]!; return; }
      if (others.length) {
        // One of several windows: its tabs close (Reopen closed tab brings them back), the browser goes on.
        for (const t of this.paneTabs(p)) {
          if (t.lent) { t.pane = others[0]!.id; continue; }       // playing in the popout: it comes back to another window
          if (isWeb(t.url)) { this.closed.push(t.url); if (this.closed.length > 25) this.closed.shift(); }
          this.closeView(t);
        }
        this.tabs = this.tabs.filter((t) => t.pane !== p.id);
        if (p.watchTimer) clearTimeout(p.watchTimer);
        p.win = null; p.trayV = null; p.trayOn = false; p.runeV = null; p.runeOn = false;
        this.panes = others;
        if (this.focused === p) this.focused = null;
        this.pane = others[others.length - 1]!;
        this.tidyTrails();
        this.changed();
        return;
      }
      if (this.menu && !this.menu.isDestroyed()) this.menu.destroy();
      this.vault.lock();                          // closing the browser locks the vault
      this.mediaOk.clear();                       // and ends every call's camera and microphone
      this.shareHosts.clear();
      this.callNow(false);
      if (this.share) this.shareAnswer(this.share.id, null, false);
      this.menu = null; this.fullTab = null;
      for (const t of this.tabs) if (!t.lent) this.closeView(t);
      this.tabs = []; this.active = null; this.win = null; this.trayV = null; this.trayOn = false; this.pane.runeV = null; this.pane.runeOn = false;
      this.panes = []; this.focused = null; this.quitting = false;
      this.timers.forEach(clearInterval); this.timers = [];
      for (const j of this.jobNames) sched.cancel(j);
      try { this.onLastClosed?.(); } catch { /* the browser is closed either way */ }
    });
    w.once('ready-to-show', () => bringFront(w));
    // Anything that needs the Mac's Keychain waits until the window is up (2026-10-25: a Keychain box at start left
    // Samara with no window and a dead Dock icon until he answered it). Then the box, if any, comes up over the window.
    if (first) w.once('show', () => setTimeout(() => this.details.open(), 1200));
    // The tab list is made ready a few seconds after the window shows (measured 2026-10-20: built on his first hover it
    // took 0.2 s, and 0.5 s on a slow machine), so the first open is as quick as every other.
    w.once('ready-to-show', () => {
      // The rail first (Phase R: it must be drawn before he can reach for it), the other layers once start has settled.
      setTimeout(() => { if (w.isDestroyed() || p.win !== w) return; const was = this.pane; this.pane = p; this.trayView(); this.pane = was; }, 400);
      setTimeout(() => { if (w.isDestroyed() || p.win !== w) return; const was = this.pane; this.pane = p; this.tabPeekView(); this.runeView(); this.sugView(); this.noticeView(); this.pane = was; }, 3000);
    });
    // The panels' layer sooner: the ⋯ menu is often the first thing he clicks. Until it has loaded, the band opens its
    // panels the old way (on a picture of the page).
    w.once('ready-to-show', () => setTimeout(() => { if (w.isDestroyed() || p.win !== w) return; const was = this.pane; this.pane = p; this.floatView(); this.pane = was; }, 600));
    // Phase 5 (2026-11-24, measured in CI): his tabs start loading as soon as the band's page and its script are in,
    // not after every one of its pictures, styles and fonts has loaded too. On the Mac and Windows runners the band's
    // full load took ~1.5 s against ~0.3 s on Linux, and the front tab waited for all of it.
    w.webContents.once('dom-ready', () => {
      this.pane = p;
      // Made by dragging a tab out: that tab moves in, live.
      if (bring) {
        const list = (Array.isArray(bring) ? bring : [bring]).filter((t) => this.tabs.includes(t) && !t.lent && this.paneOfTab(t));
        for (const t of list) this.moveTo(t, p);           // the last one moved ends up in front
        if (!list.length) this.newTab(this.HOME);
        this.adoptSplits();
        return;
      }
      // Startup (Settings > General): his tabs as they were, or a fresh home page.
      if (!first) { this.newTab(url ?? this.HOME); return; }
      // His ask (2026-11-22, changing 2026-11-20's): Samara opens normally, the bar NOT opened or selected for him; he
      // can still grab it the moment it opens (early.js keeps an early click or typing, holdBarAtStart keeps it his).
      const barFirst = !url && !this.whenOpen.length;
      // A mockup that opened the window (sheet 47) is its first tab: no home page under it.
      if (this.prefs.startup === 'home' || !this.restore()) { this.restored = true; if (url || !this.whenOpen.length) this.newTab(url ?? this.HOME); }
      else if (url) this.newTab(url);                       // his tabs come back, and the link he clicked opens on top
      for (const f of this.whenOpen.splice(0)) { this.pane = p; f(); }
      // The first seconds: if he opens the bar while the tabs are still coming back, they do not take it from him.
      if (barFirst && !w.isDestroyed()) this.holdBarAtStart(p);
      // Sheet 115: Claude's tabs from before the restart come back after his own.
      setTimeout(() => { void this.restoreClaude(); }, 1500);
    });
    void w.loadURL(`${this.o.origin}/browser.html`);
    // The continuous snapshot, and putting idle tabs to sleep: once for the whole browser.
    // On the scheduler (2026-10-30), never quiet-held: the snapshot is his tabs surviving a crash.
    // The login look stays a plain 1.5 s poll: it drives what the page shows.
    if (first) {
      sched.every(this.jobNames[0]!, 8000, () => this.snapshot());
      sched.every(this.jobNames[1]!, 60_000, () => this.sleepIdle());
      sched.every(this.jobNames[2]!, FORM_EVERY_MS, () => this.grabForms());
      this.timers.push(setInterval(() => { void this.lookForLogin(); }, 1500));
      // Phase R: the overnight tidy, checked every minute (and a few seconds after start, for a night Samara was shut).
      this.timers.push(setInterval(() => { this.railTidy(); }, 60_000));
      setTimeout(() => { this.railTidy(); }, 5000);
    }
  },

  /**
   * His ask (2026-10-13): a tab dragged out of the list and let go outside its window becomes its own window there, like
   * Chrome; let go on another of Samara's windows, it joins that one. Its page goes with it, still playing,
   * nothing reloaded. The only tab in its window: the window itself moves there.
   */
  tearOut(this: SamaraBrowser, tabId: number): void {
    const t = this.tabs.find((x) => x.id === tabId);
    const src = t ? this.paneOfTab(t) : undefined;
    if (!t || t.lent || !this.alive(src)) return;
    const pt = screen.getCursorScreenPoint();
    const inside = (w: BrowserWindow) => { const b = w.getBounds(); return pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height; };
    if (inside(src.win)) {
      // Sheet 121 (4): let go at the window's right edge, the tab goes side by side with the page in front.
      const cb = src.win.getContentBounds();
      if (pt.x >= cb.x + cb.width * (1 - SPLIT_EDGE) && pt.y >= cb.y + this.inset.top) { this.pane = src; this.tray(false); this.splitOpen(t.id); }
      return;                                                  // elsewhere inside its own window: nothing happens
    }
    this.pane = src;
    this.tray(false);
    const into = this.panes.find((x) => x !== src && this.alive(x) && inside(x.win!));
    if (into) { this.moveTo(t, into); into.win!.focus(); return; }
    const b = src.win.isMaximized() ? { width: 1200, height: 800 } : src.win.getNormalBounds();
    const spot = { x: pt.x - 140, y: pt.y - 24, width: b.width, height: b.height };
    if (this.paneTabs(src).length === 1) {
      if (src.win.isMaximized()) src.win.unmaximize();
      src.win.setBounds(spot);
      src.win.focus();
      return;
    }
    this.createPane(undefined, t, spot);
  },

  /** "Move to a new window" from the tab's right-click menu: a new window a little down and right of this one. */
  newWindowFor(this: SamaraBrowser, tabId: number): void {
    const t = this.tabs.find((x) => x.id === tabId);
    const src = t ? this.paneOfTab(t) : undefined;
    if (!t || t.lent || !this.alive(src) || this.paneTabs(src).length < 2) return;
    this.pane = src;
    const b = src.win.isMaximized() ? { x: src.win.getBounds().x + 80, y: src.win.getBounds().y + 80, width: 1200, height: 800 } : src.win.getNormalBounds();
    this.createPane(undefined, t, { x: b.x + 48, y: b.y + 48, width: b.width, height: b.height });
  },

  /** A tab into another window: its live page is handed across; the window it left shows its next tab, or closes. */
  moveTo(this: SamaraBrowser, t: Tab, to: Pane): void {
    const from = this.paneOfTab(t);
    if (!from || from === to || !this.alive(to)) return;
    this.pane = from;
    if (from.veil?.tab === t.id) this.veilDown(0);
    if (from.fullTab === t.id) from.fullTab = null;
    if (from.watching !== null && from.active === t.id) this.unwatch(false);
    const at = this.paneTabs(from).indexOf(t);
    if (t.view) {
      try { if (this.alive(from)) from.win!.contentView.removeChildView(t.view); } catch { /* not shown */ }
      t.view.setVisible(false);
      to.win!.contentView.addChildView(t.view);
      if (to.trayOn && to.trayV) to.win!.contentView.addChildView(to.trayV);   // the open tab list stays on top
      if (to.runeOn && to.runeV) to.win!.contentView.addChildView(to.runeV);   // and the rune's panel (2026-10-21)
    }
    t.pane = to.id;
    t.opener = null;
    // Last in the list of its new window.
    this.tabs.splice(this.tabs.indexOf(t), 1);
    this.tabs.push(t);
    if (from.active === t.id) {
      from.active = null;
      const rest = this.paneTabs(from);
      const next = rest[Math.min(Math.max(0, at), rest.length - 1)];
      if (next) this.activate(next.id);
      else if (this.alive(from)) from.win!.close();
    }
    this.pane = to;
    this.activate(t.id);
  },

  /** 6.19: the frame says how big its rail and band are; everything else follows from the window. */
  setInsets(this: SamaraBrowser, left: number, top: number, right = 0, bottom = 0): void {
    if (![left, top, right, bottom].every(Number.isFinite)) return;
    const c = (n: number) => Math.max(0, Math.round(n));
    this.inset = { left: c(left), top: c(top), right: c(right), bottom: c(bottom) };
    this.place();
    // Sheet 106: the window changed size (or a chip came down): the notice stays under what it came from.
    if (this.noticePane === this.pane && this.noticeNow) void this.noticeFollow();
  },

  /** Put the active tab exactly in the page area. Synchronous, from the window's own content size. */
  /** Where a tab's page sits in the window. */
  pageArea(this: SamaraBrowser): { x: number; y: number; width: number; height: number } {
    const [cw, ch] = this.win && !this.win.isDestroyed() ? this.win.getContentSize() : [1280, 800];
    return { x: this.inset.left, y: this.inset.top, width: Math.max(0, cw - this.inset.left - this.inset.right), height: Math.max(0, ch - this.inset.top - this.inset.bottom) };
  },

  place(this: SamaraBrowser): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    const [cw, ch] = w.getContentSize();
    const t = this.cur();
    if (!t?.view || t.lent) return;
    // A crashed page is moved out of the way so the frame's own plate shows; it is never touched.
    if (t.crashed || t.blocked || t.failed) { t.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); this.veilDown(0); return; }
    if (this.fullTab === t.id) { t.view.setBounds({ x: 0, y: 0, width: cw, height: ch }); this.partnerOf(t.id)?.view?.setVisible(false); this.veilDown(0); this.splitSend(); return; }
    // Sheet 121 (4): two pages side by side.
    const pair = this.splitShown();
    if (pair) { this.placeSplit(pair); this.splitSend(); return; }
    t.view.setBounds({ x: this.inset.left, y: this.inset.top, width: Math.max(0, cw - this.inset.left - this.inset.right), height: Math.max(0, ch - this.inset.top - this.inset.bottom) });
    if (this.veil?.up && this.curtain) this.curtain.setBounds(t.view.getBounds());
    this.splitSend();
  }
};
