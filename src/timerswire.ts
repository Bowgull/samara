// Timers in Samara (T1, 2026-11-25, his "build it"): the timer is Samara's now, on each machine, with nothing else
// running. This file plugs the store (timers.ts) into everything that shows or starts a timer: the hourglass windows and
// the dial (timerwin.ts), the ☰ menu's Timer, the taskbar list's and the Dock's Timer, and the ring itself.
//
// A timer rings on the dot: one wait armed for the earliest end (the scheduler wakes at least once a minute, so a sleep
// or a clock change never makes it late), re-armed on every change. Time's up: the hourglass hops and knocks three times
// (quietly, with no knocks, during a call), a notice in Samara's window with Again / 5 more / Got it, and the system's
// own notice so he sees it with Samara behind other windows. Answering either one answers both.
import { ipcMain, Notification } from 'electron';
import path from 'node:path';
import { Timers, MAX_TIMERS, MIN_MS, MAX_MS, isTimerAction, parseCustom, sayDuration, tidyLabel, type Timer } from './timers.ts';
import { TimerSetup, TimerWindows } from './timerwin.ts';
import { sched } from './sched.ts';
import type { SamaraBrowser } from './browser.ts';

export interface TimersHub {
  /** "Set a timer": the dial. */
  setup(): void;
  /** A new timer. Returns null, or why it could not start (five already running). */
  start(ms: number, label?: string): string | null;
  list(): Timer[];
  /** Quitting: the windows go (the timers stay on disk and come back with Samara). */
  close(): void;
}

export interface TimersOpts {
  browser: SamaraBrowser;
  here: string;
  stateDir: string;
  origin: string;
  log(s: string): void;
  /** Tests: the system notice (default: Electron's). */
  notify?: (title: string, body: string, click: () => void) => void;
  platform?: NodeJS.Platform;
}

const MORE_MS = 5 * 60_000;

export function startTimers(o: TimersOpts): TimersHub {
  const b = o.browser;
  const store = new Timers(path.join(o.stateDir, 'timers.json'));
  const preloadPath = path.join(o.here, 'timerpreload.cjs');
  /** The notice in Samara's window for each finished timer, so answering the hourglass takes it down too. */
  const asks = new Map<string, number>();

  const changed = () => { wins.sync(store.list()); arm(); };
  const act = (id: string, action: string, extra: Record<string, unknown> = {}) => {
    if (!isTimerAction(action)) return;
    const was = store.get(id);
    if (!was) return;
    const t = store.act(id, action, Date.now(), { ms: extra.ms, label: extra.label, colour: extra.colour });
    // answered on the hourglass (or stopped): its notice goes
    if (was.done && !t?.done) dropAsk(id);
    changed();
  };
  const start = (ms: number, label = ''): string | null => {
    if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_MS) return 'That is not a time Samara can count.';
    const t = store.start(ms, label);
    if (!t) return `You already have ${MAX_TIMERS} timers going. Stop one first.`;
    o.log(`timers: ${t.label ? `"${t.label}" ` : ''}${sayDuration(ms)}`);
    changed();
    return null;
  };

  const wins = new TimerWindows({
    origin: o.origin, preloadPath, spotFile: path.join(o.stateDir, 'timer-spot.json'), ...(o.platform ? { platform: o.platform } : {}),
    act, start: (ms) => { const why = start(ms); if (why) say(why); }, setup: () => setup.open(),
  });
  const setup = new TimerSetup({ origin: o.origin, preloadPath });
  const say = (why: string) => { if (b.hasWindow()) b.note('', { kind: 'bad', from: 'menu', small: true, kick: 'Timer', title: why }); };

  // ---- ringing
  let disarm: (() => void) | null = null;
  function arm(): void {
    disarm?.(); disarm = null;
    const at = store.nextAt();
    if (at === null) return;
    // never held for quiet: a timer he set rings in a game or a call too (on a call without its knocks)
    disarm = sched.at(at, () => { disarm = null; fire(); }, { name: 'timers.ring' });
  }
  function dropAsk(id: string): void { const n = asks.get(id); if (n !== undefined) { asks.delete(id); b.notices.drop(n); } }
  function fire(): void {
    const now = Date.now();
    const due = store.due(now);
    for (const id of store.expire(now)) dropAsk(id);
    changed();
    for (const t of due) ring(t);
  }
  function ring(t: Timer): void {
    const name = t.label || 'Timer';
    o.log(`timers: ${name}, ${sayDuration(t.total)}, went off`);
    wins.ring(t.id, b.inCall !== true);
    const answer = (a: string) => {
      asks.delete(t.id);
      if (a === 'again') act(t.id, 'again');
      else if (a === 'more') act(t.id, 'again', { ms: MORE_MS });
      else act(t.id, 'stop');
    };
    if (b.hasWindow()) {
      const n = b.note('', { kind: 'done', from: 'menu', kick: "Time's up", title: name.slice(0, 60), rows: [{ g: 'Timer', v: sayDuration(t.total) }],
        keys: [{ label: 'Again', act: 'again' }, { label: '5 more', act: 'more' }, { label: 'Got it', act: 'ok', plain: true }] }, (a) => answer(a));
      asks.set(t.id, n);
    }
    const notify = o.notify ?? ((title: string, body: string, click: () => void) => {
      try { if (!Notification.isSupported()) return; const x = new Notification({ title, body, silent: true }); x.on('click', click); x.show(); } catch { /* no system notices */ }
    });
    notify("Time's up", `${name}: ${sayDuration(t.total)}`, () => { const w = b.frontWindow(); if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } });
  }

  // ---- what the pages may ask (each only for itself)
  const fromTimer = (e: Electron.IpcMainEvent) => wins.idOf(e.sender);
  ipcMain.on('timer:act', (e, a) => {
    const id = fromTimer(e);
    if (!id || !a || typeof a !== 'object') return;
    const v = a as Record<string, unknown>;
    act(id, String(v.action ?? ''), { ms: v.ms, label: v.label === undefined ? undefined : tidyLabel(v.label) });
  });
  ipcMain.on('timer:clickable', (e, on) => { if (fromTimer(e)) wins.clickable(e.sender, on === true); });
  ipcMain.on('timer:drag', (e, a) => {
    if (!fromTimer(e) || !a || typeof a !== 'object') return;
    const v = a as Record<string, unknown>;
    if (v.phase === 'start' || v.phase === 'move' || v.phase === 'end') wins.drag(e.sender, v.phase, Number(v.dx) || 0, Number(v.dy) || 0);
  });
  ipcMain.on('timer:menu', (e) => { if (fromTimer(e)) wins.openMenu(e.sender); });
  ipcMain.on('timer:typing', (e, on) => { if (fromTimer(e) && on !== true) wins.typingDone(e.sender); });
  ipcMain.on('timer:start', (e, a) => {
    if (!setup.isDial(e.sender) || !a || typeof a !== 'object') return;
    const v = a as Record<string, unknown>;
    // the dial's minutes, or a time he typed ("1:30", "2h", "90s"), read here and nowhere else
    const ms = typeof v.text === 'string' && v.text.trim() ? parseCustom(v.text) : Number(v.ms);
    if (ms === null) { e.sender.send('timer:do', 'bad-time'); return; }
    const why = start(ms, tidyLabel(v.label));
    setup.close();
    if (why) say(why);
  });
  ipcMain.on('timer:setclose', (e) => { if (setup.isDial(e.sender)) setup.close(); });

  // ---- at start: every kept timer back on the screen, and any that ran out while Samara was closed goes off now
  wins.sync(store.list());
  fire();

  return {
    setup: () => { setup.open(); },
    start,
    list: () => store.list(),
    close: () => { disarm?.(); disarm = null; setup.close(); wins.closeAll(); },
  };
}
