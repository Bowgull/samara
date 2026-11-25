// Samara on the PC as its own program (Phase 2, 2026-11-12; his words: "i want samara as its own standalone browser that i
// use forever", and the companion and Samara "can see each other"). The same browser as main.ts runs today and as mac.ts runs
// on the Mac, through the same boot engine (boot.ts), but in a process of its own: nothing the companion's windows do (the bubble,
// notes, timers, the family, the taskbar pop-outs) can take it down, and it never waits on them to start.
//
// the companion and Samara see each other through the companion (companion.ts, hello role 'samara'): the browser's own news (sync with
// the Mac, Claude driving, notes, Claude's jobs, Hyrule routes) comes here; what is the companion's goes to the companion's windows; and
// either side can hand the other a message (`relay`). Claude's plan cards go to the companion's bubble through the plan door
// (plandoor.ts), as on the Mac.
//
// P1 (2026-11-17): the default on the PC (samara-mode.json, samaramode.ts); it runs with the companion off and stays open when
// he quits the companion. Run: electron src/pc.ts
import { app, Menu, nativeImage, net, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { samaraBase, samaraBrowser, type Platform, type SamaraBooted } from './boot.ts';
import { secureDns } from './privacy.ts';
import { checkIntegrity, sayIntegrity } from './integrity.ts';
import { bootDeps } from './bootdeps.ts';
import { CompanionLink } from './companion.ts';
import { catchStrays, openLog } from './log.ts';
import { localStamp } from './clock.ts';
import { planDoorClient } from './plandoor.ts';
import { claudeOpenTarget, type ClaudeOpen } from './claudewire.ts';
import { EngineUpdates, onCastlabs } from './engineupdate.ts';
import { pcEngine, pcSamara } from './pcsource.ts';
import { SamaraUpdates, samaraRoot } from './pcupdate.ts';
import { readSettings } from './settings.ts';
import { DEFAULT_SKIPS, withDefaults, type SkipSettings } from './skip/settings.ts';
import { readJson } from './store.ts';
import { notReadyBecause, serviceFor } from './services.ts';
import { samaraShortcutsLit } from './shortcuticon.ts';
import { SAMARA_JUMP_ICON, taskFromArgv, taskFromLockData, writeSamaraJumpList, type SamaraTask } from './jumplist.ts';
import { jumpIcons } from './jumpicons.ts';
import { NEEDS_COMPANION, isPopoutTask, type PopoutTask } from './jumplist.ts';
import { launcherEnv, samaraLauncher, writeExitMark } from './samaraexit.ts';
import { Answers, mockRelay, pictureName, sendRelay } from './sendrelay.ts';
import { DirectHost } from './directsync.ts';

const PORT = Number(process.env.SAMARA_PORT ?? 47831);
const STATE_DIR = process.env.SAMARA_STATE_DIR ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Samara');
const DATA_DIR = process.env.SAMARA_DATA_DIR ?? path.join(os.homedir(), 'Documents', 'Samara');
const HERE = import.meta.dirname;
const SHELL_HOME = process.env.SAMARA_SHELL_HOME && existsSync(process.env.SAMARA_SHELL_HOME) ? process.env.SAMARA_SHELL_HOME : path.join(HERE, '..');
const SAMARA_ICON = path.join(HERE, '..', 'pages', 'art', 'samara', 'samara.ico');
/** The exit code for a planned restart (an update), the same as main.ts's and the pet's (CoreSupervisor.cs). */
const UPDATE_RESTART = 75;
// Tests run a copy of their own: its own profile, never his (his cookies and logins live in the default one).
if (process.env.SAMARA_USER_DATA) app.setPath('userData', process.env.SAMARA_USER_DATA);

// The same engine switches as main.ts (one engine, paid video in the tabs; see main.ts for the measurements).
if (onCastlabs()) {
  app.commandLine.appendSwitch('disable_direct_composition_video_overlays');
  app.commandLine.appendSwitch('disable-features', 'HardwareSecureDecryption,HardwareSecureDecryptionExperiment,HardwareSecureDecryptionFallback');
}
app.commandLine.appendSwitch('enable-features', 'ParallelDownloading');

// Its own log, beside the Shell's.
{
  const log = openLog('samara', path.join(STATE_DIR, 'samara.log'), { maxBytes: 1024 * 1024, checkEvery: 200 });
  const write = (a: unknown[]) => { try { log.line(`${localStamp()} ${a.map((x) => (typeof x === 'string' ? x : x instanceof Error ? x.stack ?? x.message : JSON.stringify(x))).join(' ')}`); } catch { /* never stops Samara */ } };
  for (const s of [process.stdout, process.stderr]) s?.on?.('error', () => { /* nobody reading */ });
  if (!process.env.SAMARA_TEST) { console.log = (...a: unknown[]) => write(a); console.error = (...a: unknown[]) => write(a); console.warn = (...a: unknown[]) => write(a); }
}
catchStrays('samara');

/** Send to the companion's and Send mockup to the companion's answers from the companion's windows (sendrelay.ts). */
const sends = new Answers<boolean>('s');
/** the companion is running (body.pid names a live process from this boot; see main.ts bodyAlive). */
function samaraUp(): boolean {
  try {
    const f = path.join(STATE_DIR, 'body.pid');
    if (statSync(f).mtimeMs < Date.now() - os.uptime() * 1000 - 5_000) return false;
    const pid = Number(readFileSync(f, 'utf8').trim()); if (!pid) return false; process.kill(pid, 0); return true;
  } catch { return false; }
}
/** Start the companion (the pet, then the brain), once however many asks. */
let wokeAt = 0;
function wakeCompanion(tool?: PopoutTask): void {
  if (process.env.SAMARA_TEST) return;
  if (!tool && Date.now() - wokeAt < 30_000) return;
  wokeAt = Date.now();
  try {
    const exe = readFileSync(path.join(STATE_DIR, 'body-exe.txt'), 'utf8').trim();
    // A tool (2026-11-18): `the companion app's launcher with --open <tool>` opens it straight in the companion's windows, starting him if he is off.
    if (exe && existsSync(exe)) { spawn(exe, tool ? ['--open', tool] : [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe), env: launcherEnv() }).unref(); console.log('samara: starting the companion' + (tool ? ' for ' + tool : '')); }
  } catch (e) { console.error('samara: could not start the companion: ' + (e as Error).message); }
}

// One Samara at a time. A second copy hands over its task or link and leaves.
const startTask = taskFromArgv(process.argv);
const solo = app.requestSingleInstanceLock(startTask ? { samaraTask: startTask } : undefined);
if (!solo) { console.log('samara: another one is already running'); app.exit(0); }
// Quit Samara from the taskbar list when no Samara runs: nothing to close, so nothing starts (no samara.pid written).
else if (startTask === 'quit') { console.log('samara: quit asked, and none was running'); app.exit(0); }
// One of the companion's tools picked from Samara's list while Samara is closed (2026-11-18): it is not Samara's, so Samara does
// not open for it. the companion's door opens it in his windows, and this copy leaves.
else if (startTask && isPopoutTask(startTask) && NEEDS_COMPANION.has(startTask)) { console.log(`samara: ${startTask} is the companion's; handed to him`); wakeCompanion(startTask); app.exit(0); }
else {
  // So the pet and a link from Windows join this one instead of starting a second (CoreSupervisor.RunningSamara).
  try { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(path.join(STATE_DIR, 'samara.pid'), String(process.pid)); } catch (e) { console.error('samara: could not write samara.pid: ' + (e as Error).message); }
  // A quit on purpose leaves its mark first, so the companion knows it was not a crash (samaramode.ts).
  app.on('will-quit', () => { writeExitMark(STATE_DIR, process.pid, 'quit'); try { if (readFileSync(path.join(STATE_DIR, 'samara.pid'), 'utf8').trim() === String(process.pid)) unlinkSync(path.join(STATE_DIR, 'samara.pid')); } catch { /* gone */ } });
}

let boot: SamaraBooted | null = null;
let pending: SamaraTask | null = startTask;
const waitingUrls: string[] = [];
/** A link from Windows (the companion app's launcher with --url passes it on the command line of a second start). */
const urlsIn = (argv: string[]) => argv.filter((a) => /^https?:\/\//i.test(a)).slice(0, 5);
waitingUrls.push(...urlsIn(process.argv));

/** A taskbar task: the browser's own here, and New note, Timer, the Music player and Snip (Samara's own since 2026-11-25). */
function runTask(t: SamaraTask): void {
  // Phase 5: Quit Samara (taskbar list or its ... menu). A real quit: it leaves its mark, so the companion shows no crash card.
  if (t === 'quit') { console.log('samara: quit, on his ask'); app.quit(); return; }
  // N0 (2026-11-25): New note is Samara's own (the quick note), never the companion's.
  if (t === 'new-note') { if (boot?.notes) boot.notes.quick(); else pending = t; return; }
  // T1 (2026-11-25): Timer is Samara's own too: the dial, without a browser window.
  if (t === 'timer') { if (boot?.timers) boot.timers.setup(); else pending = t; return; }
  // M1 (2026-11-25): and the Music player.
  if (t === 'player') { if (boot?.music) boot.music.open(); else pending = t; return; }
  // S1 (2026-11-25): and Snip.
  if (t === 'snip') { if (boot?.snips) void boot.snips.start(); else pending = t; return; }
  // the companion's own tools never wait for Samara's window (they are not Samara's): straight to him.
  if (isPopoutTask(t) && NEEDS_COMPANION.has(t)) {
    if (link.connected) link.send({ t: 'relay', m: { t: 'samara.task', task: t } } as never); else wakeCompanion(t);
    return;
  }
  if (!boot) { pending = t; return; }
  if (!isPopoutTask(t)) { boot.browserNow.jumpTask(t); return; }
  if (link.connected) { link.send({ t: 'relay', m: { t: 'samara.task', task: t } } as never); return; }
  // Show, hide and gather with the companion off: there is nothing of his to show; starting him is enough.
  wakeCompanion();
}
app.on('second-instance', (_e, argv, _cwd, data) => {
  const t = taskFromLockData(data) ?? taskFromArgv(argv);
  if (t) { console.log('samara: taskbar task ' + t); runTask(t); return; }
  const urls = urlsIn(argv);
  if (!boot) { waitingUrls.push(...urls); return; }
  if (urls.length) for (const u of urls) boot.browserNow.open(u); else boot.browserNow.open();
});

/** the companion: the browser's news in, and the way to the companion's windows. */
/** N2 (2026-11-25): the Mac's Samara, straight over Tailscale once it has paired through the hub (directsync.ts). */
const direct = new DirectHost({
  stateDir: STATE_DIR, log: (s) => console.log('samara: ' + s),
  onMessage: (m) => { void boot?.browserNow.sync?.got(m as never).catch((e: Error) => console.error('samara: sync: ' + e.message)); },
  // Down (review of N2, 2026-11-25): nothing is sent as if the Mac heard it (a closed tab would move the tabs' base on
  // and come back later). The PC stops counting the Mac as there, then asks through the hub; a Mac still on the hub
  // answers hello and both send everything again. A Mac that is asleep answers nothing, and the PC waits.
  onLink: (up) => {
    const s = boot?.browserNow.sync;
    if (up) { void s?.link(true); return; }
    void s?.link(false).then(() => { if (link.connected) link.send({ t: 'bsync.ping' } as never); });
  },
});
const link = new CompanionLink({
  port: PORT, stateDir: STATE_DIR, role: 'samara',
  onMessage: (m) => {
    const b = boot?.browserNow;
    // N2: the Mac's Samara introduces itself through the hub; from then on the two talk straight (directsync.ts).
    if (m.t === 'bsync.pair') { direct.pair(m, (r) => link.send(r as never)); return; }
    if (typeof m.t === 'string' && m.t.startsWith('bsync.')) { void b?.sync?.got(m as never).catch((e: Error) => console.error('samara: sync: ' + e.message)); return; }
    if (m.t === 'claude.jobs' || m.t === 'claude.wait') { b?.claudeNews(m); return; }
    if (m.t === 'browser.open' && typeof m.url === 'string') { b?.openForward(m.url); return; }
    if (m.t === 'browser') { b?.open(); return; }
    if (m.t === 'engine.go') { void boot?.updates.go(); return; }
    if (m.t === 'popout.open' && typeof m.url === 'string') { boot?.openPop(m.url); return; }
    if (m.t === 'popout.close') { boot?.popout.close(); boot?.drm.close(); return; }
    if (m.t === 'hyrule.route') { if (b) b.hyruleRoute(m); else link.send({ t: 'hyrule.route.done', id: String(m.id ?? ''), state: 'off' }); return; }
    // N0 (2026-11-25): notes are Samara's own now; the companion's notes.state is not used (the rail reads Samara's store).
    if (m.t === 'notes.state') return;
    if (m.t === 'drive' && Number.isInteger(m.id) && typeof m.op === 'string') {
      const id = Number(m.id), a = (m.a && typeof m.a === 'object') ? m.a as Record<string, unknown> : {};
      // A card for Discord (9.D D3) is drawn by the companion's own windows (main.ts) since 2026-11-20; never answered here, so
      // the brain takes theirs.
      if (m.op === 'card') return;
      if (!b) { link.send({ t: 'drive.result', id, ok: false, error: 'the browser is not running' } as never); return; }
      void b.drive(m.op.slice(0, 12), a).then((r) => link.send({ t: 'drive.result', id, ...r } as never));
      return;
    }
    // From the companion's windows (through the brain): open the browser or a page.
    if (m.t === 'relay' && m.m && typeof m.m === 'object') {
      const r = m.m as Record<string, unknown>;
      if (r.t === 'samara.open') { if (typeof r.url === 'string' && /^https?:\/\//i.test(r.url)) b?.open(r.url); else b?.open(); return; }
      // His browser sounds switch on the companion's desk, and the companion's line about an update (the card comes up open).
      if (r.t === 'samara.sounds') { b?.setSounds(r.on === true); return; }
      if (r.t === 'samara.update') { b?.open(); b?.openUpdate(); return; }
      // the companion's windows took (or could not take) a Send to the companion or a mockup (sendrelay.ts).
      if (r.t === 'samara.sent') { sends.got(r.id, r.ok === true); return; }
      // Take it back on a Claude plan, from the companion's bubble: the plan memory is Samara's.
      if (r.t === 'samara.forgetplan' && typeof r.id === 'string' && typeof r.task === 'string') {
        const had = boot?.plans.forget(r.task.slice(0, 200)) ?? false;
        link.send({ t: 'relay', m: { t: 'samara.forgot', id: r.id.slice(0, 40), had } } as never);
        return;
      }
    }
  },
  onConnected: (up) => { if (!up) boot?.browserNow.claudeNews(null); },
});

app.setAppUserModelId('Samara');
app.on('browser-window-created', (_e, w) => {
  try { w.setIcon(SAMARA_ICON); } catch { /* the default icon */ }
  try { w.setAppDetails({ appId: 'Samara', appIconPath: SAMARA_ICON, appIconIndex: 0, relaunchDisplayName: 'Samara' }); } catch { /* not Windows */ }
});

/** Open in Claude: the link, then the companion brings the Claude window forward (see main.ts openInClaude). */
function openInClaude(t: ClaudeOpen): void {
  boot?.browserNow.claudeFold();
  if (t.kind === 'mac') { link.send({ t: 'claude.front', host: 'mac' } as never); return; }
  const front = () => link.send({ t: 'bubble.focus', focus: 'Claude' } as never);
  if (t.kind === 'front') { front(); return; }
  shell.openExternal(t.url).catch((e: Error) => console.error('samara: Open in Claude: ' + e.message));
  setTimeout(front, 700);
}

/** Restart for an update: through Samara.exe --samara, which waits for this one to finish first. */
function exitForUpdate(): void {
  try {
    const exe = samaraLauncher(STATE_DIR);
    if (exe) spawn(exe, ['--samara', '--after', String(process.pid)], { detached: true, stdio: 'ignore', env: launcherEnv() }).unref();
    else console.error('samara: no launcher known (samara-exe.txt or body-exe.txt), so the update will not reopen me');
  } catch (e) { console.error('samara: could not arrange to reopen after the update: ' + (e as Error).message); }
  writeExitMark(STATE_DIR, process.pid, 'update');
  app.exit(UPDATE_RESTART);
}

app.whenReady().then(async () => {
  if (!solo) return;
  Menu.setApplicationMenu(null);
  const log = (s: string) => console.log('samara: ' + s);
  secureDns(app, log);
  const settings = readSettings(STATE_DIR);
  let skips: SkipSettings = DEFAULT_SKIPS;
  try { const raw = readJson<unknown>(path.join(STATE_DIR, 'skips.json'), null); if (raw !== null) skips = withDefaults(raw); } catch { /* defaults */ }
  const paidOnPc: Platform['paidPop'] = (url, s) => {
    const paid = serviceFor(url);
    if (!paid) return false;
    if (!paid.ready) { console.error(`samara: ${notReadyBecause(paid.id)}`); return false; }
    s.popout.close();
    const why = s.drm.open(url);
    if (why) { console.error(`samara: ${why}`); return false; }
    return true;
  };
  const platform: Platform = {
    name: 'pc', here: HERE, stateDir: STATE_DIR, log,
    settings: () => settings, skips: () => skips,
    drm: { shellDir: SHELL_HOME, codeDir: path.join(HERE, '..'), onExit: (code) => log(`the paid-video runtime stopped (code ${code})`) },
    paidPop: paidOnPc,
    other: { open: (url) => link.send({ t: 'open.onmac', url } as never), send: (url) => link.send({ t: 'watch.tomac', url } as never) },
    playback: (s) => { link.send({ t: 'watch.state', ...s } as never); link.send({ t: 'relay', m: { t: 'watch.state', ...s } } as never); },
  };
  const deps = bootDeps(log);
  const base = await samaraBase(platform, deps);
  log(`pages on ${base.pages.origin}`);
  // Claude's plan cards and Ask Claude go to the companion's bubble through his door (plandoor.ts), as on the Mac.
  const plans = planDoorClient({ keyFile: path.join(STATE_DIR, 'plan-door.key'), log });
  let engineUpdates: EngineUpdates | null = null, samaraUpdates: SamaraUpdates | null = null;
  let engineSrc: ReturnType<typeof pcEngine> | null = null;
  boot = samaraBrowser(base, platform, {
    options: { repoDir: path.join(SHELL_HOME, '..', '..') },
    plans,
    claude: plans,
    mockupDoor: { offWhy: () => "Samara's Mockups trail is switched off. Tell the user where the file is." },
    syncSend: (m) => { if (!direct.send(m as never)) link.send(m as never); },
    updates: {
      sources: (changed) => {
        // A test copy never updates anything (2026-11-12: one unpacked a 368 MB engine into the real engines folder).
        if (process.env.SAMARA_TEST) return [];
        engineUpdates = new EngineUpdates({ shellDir: SHELL_HOME, stateDir: STATE_DIR, quietNow: () => boot?.browserNow.inCall === true, changed,
          signinNeeded: (signIn) => link.send({ t: 'engine.signin', signIn } as never) });
        const root = !process.env.SAMARA_TEST ? samaraRoot() : null;
        if (root) samaraUpdates = new SamaraUpdates({ root, codeDir: path.join(HERE, '..'), fetch: net.fetch as never, changed, changelog: path.join(DATA_DIR, 'Samara Changelog.md') });
        engineSrc = pcEngine(engineUpdates, { browserOpen: () => boot?.browserNow.showing === true });
        return [...(samaraUpdates ? [pcSamara(samaraUpdates)] : []), engineSrc];
      },
      // Phase 4: the PC takes a new Samara first and is watched for a day (canary.ts).
      canary: () => { const su = samaraUpdates as SamaraUpdates | null; return su && su.running() ? { version: su.running(), rollback: () => su.turnBack(), macWaits: false } : null; },
      prefsFile: path.join(STATE_DIR, 'update-prefs.json'), changelog: path.join(DATA_DIR, 'Samara Changelog.md'),
      inGame: () => false,
      beforeGo: (w) => { if (engineSrc) engineSrc.overnight = w.overnight ? { title: w.title, lines: w.lines } : null; },
      restart: () => { boot?.browserNow.closeAll(); setTimeout(exitForUpdate, 400); },
      wentBack: () => { boot?.browserNow.closeAll(); setTimeout(exitForUpdate, 400); },
      told: (card) => link.send({ t: 'update.ready', update: card ? { version: card.version, title: card.title ?? '', signin: card.signin === 'ask',
        lines: card.groups.flatMap((g) => g.items.map((i) => i.text)).slice(0, 3) } : null } as never),
    },
  }, deps);
  const b = boot.browserNow;
  // Phase 1 (2026-11-24): a little after start, Samara's code is checked against its release's sealed list.
  setTimeout(() => { const r = checkIntegrity(app.getAppPath()); (log)(sayIntegrity(r)); if (r.state === 'changed' || r.state === 'unsealed') b.say('Samara', sayIntegrity(r)); }, 20_000).unref?.();
  // The browser's news for the companion, as main.ts wires it. (Notes are no longer sent there: N0, noteswire.ts.)
  // Ctrl and + zooms the page while Samara is in front (his rule): the companion's talk key steps aside then (main.ts samaraInFront).
  b.onFront = (on) => { link.send({ t: 'relay', m: { t: 'samara.front', on } } as never); };
  b.onRouteDone = (r) => link.send({ t: 'hyrule.route.done', ...r } as never);
  // Send to the companion and Send mockup to the companion (2026-11-20, his "Fix it now"): over the relay to the companion's windows, which answer.
  // Pictures go as files beside this program's state; the companion's windows read them by name and delete them.
  const unsent = (why: string) => b.say('Not sent', why);
  const toCompanion = async (msg: Record<string, unknown> | null, id: string, files: string[]): Promise<void> => {
    const drop = () => { for (const f of files) try { unlinkSync(f); } catch { /* gone */ } };
    if (!msg) { drop(); unsent('Too big to send to the companion in one go'); return; }
    const ok = await sends.ask(id, () => link.send({ t: 'relay', m: msg } as never), 6000);
    if (ok === null) { drop(); unsent("The companion isn't running, so it didn't reach it"); }
    else if (!ok) unsent("The companion couldn't take that one");
  };
  const keepPicture = (folder: string, png: Buffer): string | null => {
    try { const dir = path.join(STATE_DIR, folder); mkdirSync(dir, { recursive: true }); const name = pictureName(); writeFileSync(path.join(dir, name), png); return name; } catch { return null; }
  };
  b.onSendToCompanion = (sent, picture) => {
    if (!samaraUp()) { unsent("The companion isn't running, so it didn't reach it"); return; }
    const name = picture && !picture.isEmpty() ? keepPicture('sent-pictures', picture.toPNG()) : null;
    const id = sends.newId();
    void toCompanion(sendRelay(id, sent, name), id, name ? [path.join(STATE_DIR, 'sent-pictures', name)] : []);
  };
  b.onSendMockup = (m) => {
    if (!samaraUp()) { unsent("The companion isn't running, so it didn't reach it"); return; }
    const items = m.kind === 'mockup' ? [m] : m.items;
    const names = items.map((x) => { try { return x.picture ? keepPicture('mockup-sends', nativeImage.createFromDataURL(x.picture).toPNG()) : null; } catch { return null; } });
    const id = sends.newId();
    void toCompanion(mockRelay(id, m, names), id, names.filter((n): n is string => !!n).map((n) => path.join(STATE_DIR, 'mockup-sends', n)));
  };
  b.onAsk = (text) => { if (!link.send({ t: 'relay', m: { t: 'samara.ask', text } } as never)) log('The companion is not there, so the question did not reach it'); };
  b.onClaude = (m) => { link.send(m as never); };
  b.onClaudeOpen = (target) => openInClaude(target);
  b.onDriverStop = (j) => { link.send({ t: 'drive.stopped', job: j.id } as never); };
  b.onCall = (on) => { const e = engineUpdates as EngineUpdates | null; if (!on && e && !e.ready) void e.check(); };
  if (!onCastlabs()) b.onPaid = (url) => boot?.openPop(url) ?? false;
  // Made inside sources() above, which the boot engine has already called by now.
  const eu = engineUpdates as EngineUpdates | null;
  eu?.start();
  if (samaraUpdates) { const su = samaraUpdates as SamaraUpdates; setTimeout(() => su.markGood(), 5 * 60_000); }
  {
    const done = eu?.justUpdated();
    if (done) { if (done.overnight && done.title) b.setUpdated({ title: done.title, lines: done.lines ?? [] }); if (done.browser) b.open(); }
  }
  // The Shrine Reddit feed (sheet R18) is gone (2026-11-19, his "Drop the Reddit feed": he did not use the widget
  // enough). Nothing in Samara or the companion talks to Reddit by itself any more.
  // Samara's taskbar list: written under its own app id; its pop-out items are the companion's (runTask hands them over).
  if (!process.env.SAMARA_TEST) {
    const popouts = { companion: samaraUp(), icons: jumpIcons(path.join(app.getPath('userData'), 'taskbar-icons'), SAMARA_ICON) };
    log('taskbar list: ' + writeSamaraJumpList(app, { main: path.join(HERE, 'samara.ts'), dir: path.join(HERE, '..'), icon: SAMARA_JUMP_ICON, ownId: 'Samara', popouts, quit: true }));
  }
  link.start();
  // N2: paired before, the Mac's Samara can reach this one straight away, the companion running or not.
  direct.listen();
  // Started by a link, a task or his click: the window comes up. Started quietly (--quiet, a Claude session): only the doors.
  // New note, Timer or Music player from the taskbar list with Samara closed: only that comes up, not a browser window.
  if ((!process.argv.includes('--quiet') && startTask !== 'new-note' && startTask !== 'timer' && startTask !== 'player' && startTask !== 'snip') || waitingUrls.length) {
    b.open(waitingUrls.shift());
    for (const u of waitingUrls.splice(0)) b.open(u);
  }
  // Phase 5: "Quit Samara" in the ... menu, only here, where Samara is its own program (never the companion's windows).
  b.onQuit = () => runTask('quit');
  if (pending) { const t = pending; pending = null; runTask(t); }
  // P1 (2026-11-17): Samara no longer closes when the companion is off and no window is open. It stays, like the Mac's, so
  // Claude's door, the sync and his next click are ready.
  // The lantern on his shortcuts: lit while a window is open.
  if (!process.env.SAMARA_TEST) setInterval(() => samaraShortcutsLit(b.hasWindow()), 1000).unref();
});

// Closing the last window does not end Samara: Claude's door and the sync stay up.
app.on('window-all-closed', () => { /* stay */ });
app.on('before-quit', () => { if (!process.env.SAMARA_TEST) samaraShortcutsLit(false, { quitting: true }); link.stop(); direct.close(); });
void claudeOpenTarget;
