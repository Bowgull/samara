// The boot engine (2026-10-30, engine 4 of the engines report): ONE startup for Samara on the Mac (mac.ts) and the PC
// (main.ts). Before this each wired Samara by hand and they drifted: the Mac had no ad blocking on the pop-out's session,
// started the Claude door without plans, and had no line from Samara's plan cards to the companion's bubble. Everything of
// Samara's is started here, the same way on both machines: the flight log, the permission wall, the page server, the
// pop-out and paid video, ad blocking, the browser, the Claude door with its plans, the
// mockup door and drops, the update engine's key, the sync. Only what belongs to one machine stays in its own file: the
// Mac's Dock, menu and default-browser ask; the PC's pet, bubble, taskbar and jump list. Those come in as hooks.
//
// No Electron import here (only types), so the wiring can be checked by plain unit tests (test/boot.test.ts): what
// touches Electron comes in through BootDeps (bootdeps.ts builds the real ones).
import path from 'node:path';
import type { SamaraBrowser, BrowserOptions, PlanAnswer, PlanCard } from './browser.ts';
import type { Popout } from './popout.ts';
import type { DrmRuntime } from './drmrunner.ts';
import type { PageServer } from './pageserver.ts';
import type { PopoutSettings } from './settings.ts';
import type { SkipSettings } from './skip/settings.ts';
import type { AdBlock } from './skip/ads.ts';
import type { PlanMemory } from './claudeplan.ts';
import type { Chat } from './claudehand.ts';
import type { DoorUpdates, PlanStarted } from './claudedoor.ts';
import type { EngineOptions, Offer, Source, UpdateEngine } from './updateengine.ts';
import type { SyncMsg } from './bsync.ts';
import type { NotesHub, NotesOpts } from './noteswire.ts';
import type { TimersHub, TimersOpts } from './timerswire.ts';
import type { MusicHub, MusicOpts } from './musicwire.ts';
import type { SnipHub, SnipOpts } from './snipwire.ts';
import { serviceFor } from './services.ts';
import { sched } from './sched.ts';
import { describeJobs } from './scheduler.ts';
import { mockHomeDir } from './mockhome.ts';
import { hyruleHomeDir } from './hyrulehome.ts';
import { Canary, helperCrashed, ownPage } from './canary.ts';

type Box = { x: number; y: number; width: number; height: number };
type MockDrop = NonNullable<ReturnType<BootDeps['takeMockupFile']>>;
type MockMark = NonNullable<ReturnType<BootDeps['takeMarkFile']>>;
type Sender = { send(channel: string, ...a: unknown[]): void };
type WebContentsLike = Parameters<SamaraBrowser['isFrame']>[0];

/** What the boot needs from Electron and the disk. bootdeps.ts makes the real ones; the tests make stand-ins. */
export interface BootDeps {
  /** Returns what the flight recorder said about the last run, or null when it closed cleanly. */
  startFlight(dir: string, log: (s: string) => void): string | null | void;
  /** Phase 4: trouble as the flight recorder sees it (a page gone or hung, with its address; a helper process died). */
  onTrouble?(fn: (kind: 'gone' | 'hang' | 'helper', url: string, reason?: string) => void): void;
  /** The default session (the pop-out, the companion's cards): no camera, mic, location. */
  denyPermissions(): void;
  servePages(dir: string): Promise<PageServer>;
  newPopout(o: ConstructorParameters<typeof Popout>[0]): Popout;
  newDrm(o: ConstructorParameters<typeof DrmRuntime>[0]): DrmRuntime;
  /** Ad lists on the default session, where the pop-out's embeds play. */
  blockAds(stateDir: string): Promise<AdBlock | null>;
  findSkips(stateDir: string): ConstructorParameters<typeof Popout>[0]['skips'];
  readBox(stateDir: string): Box | null;
  writeBox(stateDir: string, box: Box): void;
  newBrowser(o: BrowserOptions): SamaraBrowser;
  mkdir(dir: string): boolean;
  wireBrowser(get: () => SamaraBrowser | null): void;
  wirePopout(o: Parameters<typeof import('./popoutipc.ts').wirePopout>[0]): { popTab: (id: number) => void };
  planMemory(stateDir: string): PlanMemory;
  startClaudeDoor(get: () => SamaraBrowser | null, stateDir: string, hooks: { plans: PlanMemory; onPlan: (p: PlanStarted) => void; updates?: DoorUpdates }): unknown;
  startMockupDoor(stateDir: string, open: (d: MockDrop) => Promise<unknown>, why: () => string | null, marks: { list: () => unknown[]; set: (a: MockMark) => string | null }): () => void;
  /** A folder that is watched: `take` runs now and on every change. */
  watchFolder(dir: string, take: () => void): void;
  listFolder(dir: string): string[];
  /** A .url file's link, and the file gone; '' when it was old (ten minutes), too long or unreadable. */
  takeUrlFile(file: string): string;
  removeFile(file: string): void;
  takeMockupFile(file: string): Parameters<SamaraBrowser['openMockupDrop']>[0] | null;
  takeMarkFile(file: string): Parameters<SamaraBrowser['mockMark']>[0] | null;
  newUpdates(o: EngineOptions): UpdateEngine;
  idleSeconds(): number;
  readText(file: string): string;
  writeAtomic(file: string, text: string): void;
  /** An ipc door only the browser's own frame page may use (its update key). */
  onFrame(channel: string, isFrame: (wc: WebContentsLike) => boolean, fn: (sender: Sender, a: Record<string, unknown>) => void): void;
  /** Samara runs on castLabs' engine: paid video plays right in the tabs. */
  onCastlabs(): boolean;
  onQuit(fn: () => void): void;
  /** N0 (2026-11-25): Samara's own notes (noteswire.ts). Optional so the wiring tests need no Electron. */
  startNotes?(o: NotesOpts): NotesHub | null;
  /** T1 (2026-11-25): Samara's own timers (timerswire.ts). Optional so the wiring tests need no Electron. */
  startTimers?(o: TimersOpts): TimersHub | null;
  /** M1 (2026-11-25): Samara's own music player (musicwire.ts). Optional so the wiring tests need no Electron. */
  startMusic?(o: Omit<MusicOpts, 'appData'>): MusicHub | null;
  /** S1 (2026-11-25): Snip (snipwire.ts). Optional so the wiring tests need no Electron. */
  startSnip?(o: SnipOpts): SnipHub | null;
  /** The Mac's Dock menu (right-click Samara in the Dock): New note, Set a timer, Music player, Snip. */
  dockMenu?(rows: { label: string; click: () => void }[]): void;
}

/** The machine's own part of Samara's startup. */
export interface Platform {
  name: 'mac' | 'pc';
  /** src/ (preloads live here; pages are next to it). */
  here: string;
  stateDir: string;
  log(s: string): void;
  /** His pop-out switches and what to skip, read fresh (the PC changes them live). */
  settings(): PopoutSettings;
  skips(): SkipSettings;
  /** The paid-video runtime's own folders, and what it says when it stops. */
  drm: Omit<ConstructorParameters<typeof DrmRuntime>[0], 'stateDir'>;
  /** Paid video asked for in the pop-out (the Mac's narrow castLabs window, the PC's paid runtime): true when it plays. */
  paidPop(url: string, s: { popout: Popout; drm: DrmRuntime }): boolean;
  /** "Open on" and "Send to" the other machine. */
  other: { open(url: string): void; send(url: string): void };
  /** The pop-out's playback, for whoever listens (the PC's taskbar and brain). */
  playback?: (s: Record<string, unknown>) => void;
}

/** What Samara's browser needs from the machine: where plans go, the other machine, the update sources. */
export interface BrowserPlatform {
  /** BrowserOptions only one machine sets (the PC's repo folder, the Mac's mockups-anywhere). */
  options?: Partial<Pick<BrowserOptions, 'repoDir' | 'mockupsAnywhere'>>;
  /**
   * Sheet 37 / 41, Claude's plans, on BOTH machines: the card shown in the companion's bubble (null: nobody could, so Samara's
   * band shows it), the live step, and the scroll-back row when a plan starts and when it is done.
   */
  plans: {
    ask(card: PlanCard): Promise<PlanAnswer | null>;
    step(card: string, at: number | null): void;
    started(p: PlanStarted): void;
    done(job: number): void;
  };
  /** Sheet 109, Ask Claude: his Claude chats and a pick into one (the Mac's, through the companion's door; the PC sets its own). */
  claude?: { chats(): Promise<Chat[]>; pick(session: string, text: string): Promise<string | null> };
  /** The mockup door for Claude sessions on this machine (the Mac's; the PC's come through the brain's drops). */
  mockupDoor?: { offWhy(): string | null };
  /** Samara's changes for the other machine (bsync.ts). */
  syncSend(m: SyncMsg): void;
  updates: {
    /** The machine's update sources, told when their offers change. */
    sources(changed: () => void): Source[];
    prefsFile: string;
    changelog: string;
    inGame(): boolean;
    beforeGo?: EngineOptions['beforeGo'];
    restart: EngineOptions['restart'];
    /** Phase 4 (canary): the version running and how to turn it back, once the sources exist; null when not a release. */
    canary?(): { version: string; rollback(why: string): boolean; macWaits: boolean } | null;
    /** Go back worked: the PC restarts; the Mac's script does it itself. */
    wentBack?(): void;
    /** He saw the "what it did" note. */
    seen?(): void;
    /** The key's card, also for the companion to say in his bubble (2026-11-01: Samara is often closed while the companion is up). */
    told?(card: Offer | null): void;
  };
}

export interface SamaraBase {
  pages: PageServer;
  popout: Popout;
  drm: DrmRuntime;
  /** The ad blocker, once its lists are in (null until then, or when YouTube ads are let through). */
  ads(): AdBlock | null;
  /** Put X on: paid video to the machine's paid window, the rest in the pop-out. True when it plays. */
  openPop(url: string): boolean;
  /** Set once the browser is up. */
  browser(): SamaraBrowser | null;
  popTab(id: number): void;
  /** Phase 4: the flight recorder found the last run did not close cleanly. */
  unclean?: boolean;
}

export interface SamaraBooted extends SamaraBase {
  browserNow: SamaraBrowser;
  /** His notes (N0), null when they could not start (the log says why). */
  notes: NotesHub | null;
  /** His timers (T1), null when they could not start (the log says why). */
  timers: TimersHub | null;
  /** The music player (M1), null when it could not start. */
  music: MusicHub | null;
  /** Snip (S1), null when it could not start. */
  snips: SnipHub | null;
  plans: PlanMemory;
  updates: UpdateEngine;
  /** The open-urls folder, read again (a test, or a drop that raced the watcher). */
  takeDrops(): void;
}

/**
 * Part one, the same on both machines: before any window of Samara's. The PC makes its pet's windows between this and
 * the browser (they share the page server), so the two parts are separate calls.
 */
export async function samaraBase(p: Platform, d: BootDeps): Promise<SamaraBase> {
  const unclean = Boolean(d.startFlight(p.stateDir, (s) => p.log(s)));
  // The scheduler engine (2026-10-30): catch-up times kept with Samara's state; idle from the system.
  sched.useFile(path.join(p.stateDir, 'scheduler.json'));
  sched.idleSeconds = () => d.idleSeconds();
  // What runs when, in the log (for diagnostics): five minutes in, then every six hours.
  sched.every('scheduler.list', 6 * 3_600_000, () => p.log('scheduler:\n  ' + describeJobs(sched.list(), Date.now()).join('\n  ')), { first: 5 * 60_000 });
  // Nothing outside the tabs (the pop-out, the companion's cards) may use the camera, mic, location or the rest (code audit,
  // 2026-10-14); the tabs keep their own ask-per-site rules.
  d.denyPermissions();
  // The pop-out's page is served over http rather than loaded from disk: a YouTube embed from a file:// page fails with
  // Error 153 (tested 2026-10-04).
  const pages = await d.servePages(path.join(p.here, '..', 'pages'));
  let browser: SamaraBrowser | null = null;
  const popout = d.newPopout({
    pages, preloadPath: path.join(p.here, 'samarapreload.cjs'),
    remembered: () => d.readBox(p.stateDir),
    // "Your size wins", unless he has switched that off (sheet 4, section 7).
    remember: (box) => { if (p.settings().rememberSize) d.writeBox(p.stateDir, box); },
    settings: () => p.settings(), skips: d.findSkips(p.stateDir), skipSettings: () => p.skips(),
    iconFor: (u) => browser?.faviconFor(u) ?? '',
  });
  const drm = d.newDrm({ ...p.drm, stateDir: p.stateDir });
  // Ads on the default session, where the pop-out's embeds play, on BOTH machines (the Mac had none before the boot
  // engine). The paid-video runtime never gets this: a request filter in front of a licence negotiation breaks playback
  // for nothing. Not awaited: fetching lists must never hold up the windows.
  let ads: AdBlock | null = null;
  if (p.skips().youtubeAds) void d.blockAds(p.stateDir).then((b) => { ads = b; if (b) p.log(`blocking ads with ${b.lists} lists`); }, (e: Error) => p.log('ad blocking did not start: ' + e.message));
  const openPop = (url: string): boolean => {
    if (serviceFor(url)) return p.paidPop(url, { popout, drm });
    drm.close();
    if (!popout.open(url)) { p.log(`nothing playable in ${String(url).slice(0, 80)}`); return false; }
    return true;
  };
  // Every button, menu and page of the browser (browseripc.ts), and the pop-out's (popoutipc.ts). Wired now, before the
  // browser exists: the pop-out also plays what the companion puts on when there is no browser (the PC without its new bubble).
  d.wireBrowser(() => browser);
  const pop = d.wirePopout({
    popout: () => popout, browser: () => browser, open: openPop, stopPaid: () => drm.close(), paidSeparately: () => !d.onCastlabs(),
    openOnOther: (url) => p.other.open(url), sendToOther: (url) => p.other.send(url), ...(p.playback ? { playback: p.playback } : {}),
  });
  const base: Inner = {
    pages, popout, drm, ads: () => ads, openPop, browser: () => browser, popTab: (id) => pop.popTab(id),
    setBrowser: (b) => { browser = b; }, unclean,
  };
  d.onQuit(() => { popout.close(); drm.close(); ads?.stop(); });
  return base;
}

type Inner = SamaraBase & { setBrowser(b: SamaraBrowser): void };

/** The pop-out's own buttons on the browser (the band's close, pin and pause, and "Pop out this video"). */
const POP_ACTS = { popclose: 'close', poppin: 'togglePin', poppause: 'togglePlay' } as const;

/** Part two: Samara's browser and everything that hangs off it, the same on both machines. */
export function samaraBrowser(base: SamaraBase, p: Platform, bp: BrowserPlatform, d: BootDeps): SamaraBooted {
  const b0 = base as Inner;
  const { pages, popout, drm } = base;
  const pre = (f: string) => path.join(p.here, f);
  const preloads = { preloadPath: pre('samarapreload.cjs'), tabPreloadPath: pre('tabpreload.cjs'), settingsPreloadPath: pre('settingspreload.cjs'), thingsPreloadPath: pre('thingspreload.cjs') };
  // 2026-10-31: every mockup kept in his one private repo, ~/projects/mockups on both machines (mockhome.ts).
  // 2026-11-03 (BG4): the Hyrule map's own private folder, on a machine that has it (hyrulehome.ts).
  const hyrule = hyruleHomeDir();
  const browser = d.newBrowser({ origin: pages.origin, stateDir: p.stateDir, ...preloads, mockHome: mockHomeDir(), ...(hyrule ? { hyruleDir: hyrule } : {}), ...bp.options });
  b0.setBrowser(browser);

  browser.onReclaim = () => popout.returnTab();
  browser.onPopoutAct = (what) => { const m = POP_ACTS[what as keyof typeof POP_ACTS]; if (m) popout[m](); };
  // The right-click menu (his picks, 2026-10-20): a link plays in the pop-out, and "Pop out this video".
  browser.onPlayInPopout = (url) => { base.openPop(url); };
  browser.setPopTab((id) => base.popTab(id));
  browser.onOpenOther = (url) => p.other.open(url);

  // 6.25a: Claude sessions on this machine drive the browser through its own door (claudedoor.ts). Sheet 37: a plan goes
  // to the companion's bubble (the band when nobody can show it); sheet 41: each plan that starts is a row in his scroll-back.
  const plans = d.planMemory(p.stateDir);
  browser.onPlanAsk = (card) => bp.plans.ask(card);
  browser.onPlanStep = (id, at) => bp.plans.step(id, at);
  browser.onPlanDone = (job) => bp.plans.done(job);
  if (bp.claude) { const c = bp.claude; browser.claudeChats = () => c.chats(); browser.onAskClaude = (s, t) => c.pick(s, t); }
  // Sheet 115: a chat's "update the companion now" puts Samara's ready update in too (asked first while Claude works).
  const doorUpdates: { e: UpdateEngine | null } = { e: null };
  d.startClaudeDoor(() => browser, p.stateDir, { plans, onPlan: (x) => bp.plans.started(x),
    updates: { ready: () => { const c = doorUpdates.e?.card(); return c && !c.signin ? c.version.split('+')[0]! : null; }, go: () => doorUpdates.e ? doorUpdates.e.go() : Promise.resolve({ ok: false, why: 'Updates are not running.' }) } });

  // show_mockup from this machine's Claude sessions (the companion-link mod): a signed loopback door (mockupdoor.ts).
  if (bp.mockupDoor) {
    const off = bp.mockupDoor.offWhy;
    const close = d.startMockupDoor(p.stateDir, (m) => browser.openMockupDropWhy(m), () => (browser.mockupsOn ? null : off()),
      { list: () => browser.mockStages(), set: (a) => browser.mockMark(a) });
    d.onQuit(close);
  }
  // The open-urls folder: links from the OS (the companion app's launcher --url), "open the browser", and the mockups and marks
  // Claude sessions leave (tools/open-mockup.mjs, the brain's show_mockup and mockup_mark). Each file is checked by its
  // taker and goes whatever it says.
  const dropDir = path.join(p.stateDir, 'open-urls');
  const takeDrops = () => {
    for (const n of d.listFolder(dropDir).sort()) {
      const f = path.join(dropDir, n);
      if (n === 'browser.flag') { d.removeFile(f); browser.open(); continue; }
      if (n.endsWith('.mockup')) { const m = d.takeMockupFile(f); if (m && browser.mockupsOn) void browser.openMockupDrop(m); continue; }
      if (n.endsWith('.mockmark')) { const k = d.takeMarkFile(f); if (k && browser.mockupsOn) { const why = browser.mockMark(k); if (why) p.log('mockup mark not set: ' + why); } continue; }
      if (!n.endsWith('.url')) continue;
      const u = d.takeUrlFile(f);
      try { const x = new URL(u); if (x.protocol === 'http:' || x.protocol === 'https:') browser.open(x.href); } catch { /* not an address */ }
    }
  };
  d.watchFolder(dropDir, takeDrops);

  // N0 (2026-11-25): his notes are Samara's, on both machines (the companion is retired). Started before the sync, so
  // the first catch-up with the other machine carries them.
  let notes: NotesHub | null = null;
  try { notes = d.startNotes?.({ browser, here: p.here, stateDir: p.stateDir, origin: pages.origin, dev: p.name, log: (s) => p.log(s) }) ?? null; }
  catch (e) { p.log('notes did not start: ' + (e as Error).message); }
  // T1 (2026-11-25): timers are Samara's too (the companion is retired). Any that ran out while Samara was closed go off now.
  let timers: TimersHub | null = null;
  try { timers = d.startTimers?.({ browser, here: p.here, stateDir: p.stateDir, origin: pages.origin, log: (s) => p.log(s) }) ?? null; }
  catch (e) { p.log('timers did not start: ' + (e as Error).message); }
  browser.timersHub = timers;
  // M1 (2026-11-25): the music player is Samara's too (Spotify, on this computer or whatever device his account plays on).
  let music: MusicHub | null = null;
  try { music = d.startMusic?.({ here: p.here, stateDir: p.stateDir, origin: pages.origin, log: (s) => p.log(s) }) ?? null; }
  catch (e) { p.log('the music player did not start: ' + (e as Error).message); }
  browser.musicHub = music;
  // S1 (2026-11-25): Snip is Samara's too: a box round part of the screen, then Ask Claude or Pin it.
  let snips: SnipHub | null = null;
  try { snips = d.startSnip?.({ browser, here: p.here, stateDir: p.stateDir, origin: pages.origin, log: (s) => p.log(s) }) ?? null; }
  catch (e) { p.log('snip did not start: ' + (e as Error).message); }
  browser.snipHub = snips;
  const dock: { label: string; click: () => void }[] = [];
  if (notes) { const n = notes; dock.push({ label: 'New note', click: () => n.quick() }); }
  if (timers) { const t = timers; dock.push({ label: 'Set a timer', click: () => t.setup() }); }
  if (music) { const m = music; dock.push({ label: 'Music player', click: () => m.open() }); }
  if (snips) { const s = snips; dock.push({ label: 'Snip', click: () => void s.start() }); }
  if (dock.length) d.dockMenu?.(dock);

  // M6: one browser on both machines. Changes go to the other machine's browser.
  browser.startSync((m) => bp.syncSend(m), (s) => p.log(s));

  // The update engine (2026-10-30, updateengine.ts): Samara's code from GitHub and the castLabs engine, one set of rules
  // for both machines behind his UPDATE key (sheet 35, sheet 108).
  const u = bp.updates;
  // The one "he is busy" for Samara's background jobs: a call in Samara, a game or full screen as the brain sees it (the
  // PC's gameQuiet; the Mac has no game rule), or a Samara window full screen.
  sched.quietNow = () => (browser.inCall === true ? 'call' : u.inGame() ? 'game' : browser.fullScreen === true ? 'full screen' : '');
  const overnight = (): boolean => { try { return JSON.parse(d.readText(u.prefsFile)).overnight === true; } catch { return false; } };
  let updates: UpdateEngine | null = null;
  const show = () => updates?.show();
  updates = d.newUpdates({
    sources: u.sources(show),
    moment: () => ({ now: new Date(), idleSeconds: d.idleSeconds(), inCall: browser.inCall === true, inGame: u.inGame(), work: browser.claudeWork() }),
    overnight,
    changed: (card) => { browser.setUpdate(card ? { ...card, overnight: overnight() } : null); u.told?.(card); },
    ...(u.beforeGo ? { beforeGo: u.beforeGo } : {}),
    restart: u.restart,
    // Sheet 115: Claude's jobs and its forms' typing are written down before anything goes in; they come back after.
    saveWork: () => browser.saveClaudeNow(),
    log: (t) => p.log(t),
  });
  const ue = updates;
  doorUpdates.e = ue;
  browser.onClaudeWork = () => ue.show();
  const frame = (wc: WebContentsLike) => browser.isFrame(wc);
  d.onFrame('browser:updateact', frame, (sender, a) => {
    const act = String(a?.act ?? '');
    if (act === 'changelog') { sender.send('browser:changelog', d.readText(u.changelog)); return; }
    if (act === 'overnight') { try { d.writeAtomic(u.prefsFile, JSON.stringify({ overnight: a?.on === true })); } catch { /* best effort */ } ue.show(); return; }
    if (act === 'seen') { browser.setUpdated(null); u.seen?.(); return; }
    // castlabsreset (2026-11-25): castLabs' own password reset in Terminal, for a forgotten castLabs password.
    if (act === 'castlabs' || act === 'castlabsreset') { void ue.signin(act === 'castlabsreset' ? 'reset' : 'signin').then((ok) => { if (!ok) sender.send('browser:updatewhy', 'Terminal could not be opened. Try again in a moment.'); }); return; }
    // Sheet 122 (his pick, 2026-11-22): his check is shown step by step under the ... key; 'checkdone' is him closing it.
    if (act === 'check') { void ue.checkNow((c) => browser.setChecking(c)); return; }
    if (act === 'checkdone') { browser.setChecking(null); return; }
    if (act === 'file' || act === 'skip') { ue.act(act); return; }
    if (act === 'back') { if (ue.act('back')) u.wentBack?.(); else sender.send('browser:updatewhy', 'There is no earlier version kept to go back to.'); }
  });
  d.onFrame('browser:updatego', frame, (sender) => { void ue.go().then((r) => { if (!r.ok) sender.send('browser:updatewhy', r.why ?? 'Not right now.'); }); });
  ue.show();
  ue.start();

  d.onQuit(() => { browser.closeAll(); pages.close(); sched.stop(); });
  // Phase 4: canary releases (canary.ts). A new version is watched for its first day here; bad, it is turned back and
  // the other machine is told; good, the other machine may take it at once.
  const cv = u.canary?.();
  if (cv?.version) {
    const canary = new Canary({ file: path.join(p.stateDir, 'canary.json'), version: cv.version, unclean: base.unclean === true });
    d.onTrouble?.((kind, url, reason) => { if (kind === 'helper' ? helperCrashed(reason ?? '') : ownPage(url)) canary.record(kind === 'helper' ? 'helper' : 'own'); });
    const settle = () => {
      const r = canary.settle();
      if (!r) return;
      browser.sync?.canary(r.version, r.v);
      if (r.v === 'good') { p.log(`update: Samara ${r.version} ran a quiet day here`); return; }
      p.log(`update: Samara ${r.version} is turned back: ${r.why}`);
      if (cv.rollback(r.why ?? '')) browser.say('Samara', `Samara ${r.version} is being turned back (${r.why}). The version before comes back the next time Samara starts.`);
    };
    // Every verdict reached here is told again at each start (a turned-back version is no longer the one running).
    for (const [v, verdict] of Object.entries(canary.history())) browser.sync?.canary(v, verdict);
    settle();
    sched.every('canary.settle', 10 * 60_000, settle, { first: 60_000 });
  }
  return { ...base, browserNow: browser, notes, timers, music, snips, plans, updates: ue, takeDrops };
}
