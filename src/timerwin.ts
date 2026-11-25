// Timers in Samara (T1, 2026-11-25): each running timer is a small hourglass window of its own, so he can put it
// anywhere, and "Set a timer" is a small window with the kitchen dial. Ported from the companion's timerwin.ts (sheet 67
// v2) without its window family: a timer is dragged by its plate and stays where he leaves it.
//
// A timer never takes the keyboard (focusable: false), so a game keeps it; only while he renames it does it take the
// keys, and they go back on Enter, Esc or a click away. It takes the mouse only over its plate and keys; everywhere else
// the clicks go through to whatever is behind. Windows and Linux learn that from the page (the mouse is forwarded to it);
// the Mac sends no mouse moves to a window that lets clicks through, so there Samara follows the pointer instead.
//
// Its right-click is the system's own menu (New timer, Rename, Colour, Restart, Stop): it looks right on both machines
// and needs no window of its own. Every pick and every key is checked here before the store sees it (timerswire.ts).
import { BrowserWindow, Menu, screen } from 'electron';
import { SAFE_WEB_PREFERENCES, denyPermissions, lockDown } from './safety.ts';
import { writeFileAtomic } from './atomic.ts';
import { readJson } from './store.ts';
import { COLOURS, cleanAreas, type Area, type Colour, type Timer } from './timers.ts';

interface Spot { x: number; y: number }
export interface TimerWinHooks {
  origin: string;
  preloadPath: string;
  /** Where he last left a timer (the next one opens there). */
  spotFile: string;
  /** A key on the hourglass, or a pick in its menu (already checked to be this timer's). */
  act(id: string, action: string, extra?: Record<string, unknown>): void;
  /** "New timer" from a timer's menu: the time is checked by the caller. */
  start(ms: number): void;
  /** "Custom..." from the menu: the dial. */
  setup(): void;
  /** Tests: the platform (the Mac follows the pointer). */
  platform?: NodeJS.Platform;
}

// The plate sits at (10, 16); the rest is room for the keys under it, the +1:00 chip over it and the hop. The empty room
// lets the mouse through.
export const TIMER_W = 300, TIMER_H = 170;
const NAMES: Record<Colour, string> = { blue: 'Blue', gold: 'Gold', rose: 'Rose', jade: 'Jade', violet: 'Violet' };

type Entry = { w: BrowserWindow; t: Timer; hot: boolean; areas?: Area[] };


export class TimerWindows {
  private readonly wins = new Map<string, Entry>();
  private dragFrom: { id: string; x: number; y: number } | null = null;
  private follow: NodeJS.Timeout | null = null;
  private readonly o: TimerWinHooks;
  constructor(o: TimerWinHooks) { this.o = o; }

  /** The store's list is the truth: open what is new, update what is there, close what is gone. */
  sync(list: Timer[]): void {
    const keep = new Set(list.map((t) => t.id));
    for (const [id, v] of this.wins) if (!keep.has(id)) { if (!v.w.isDestroyed()) v.w.destroy(); this.wins.delete(id); }
    let fresh = 0;
    for (const t of list) {
      let v = this.wins.get(t.id);
      if (!v || v.w.isDestroyed()) { v = { w: this.make(this.wins.size + fresh++), t, hot: false }; this.wins.set(t.id, v); }
      v.t = t;
      this.send(v.w, 'timer:data', t);
    }
    this.followPointer();
  }
  /** Time's up on this one: its three wood knocks (unless he is on a call) and the hop. */
  ring(id: string, sound: boolean): void { const v = this.wins.get(id); if (v) this.send(v.w, 'timer:do', sound ? 'ring' : 'ring-quiet'); }

  private send(w: BrowserWindow, ch: string, data: unknown): void {
    if (w.isDestroyed()) return;
    const go = () => { if (!w.isDestroyed()) w.webContents.send(ch, data); };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', go); else go();
  }

  private make(index: number): BrowserWindow {
    const at = this.startSpot(index);
    const w = new BrowserWindow({
      x: at.x, y: at.y, width: TIMER_W, height: TIMER_H,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: true,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
      focusable: false, show: false, title: 'Timer',
      webPreferences: { ...SAFE_WEB_PREFERENCES, preload: this.o.preloadPath, backgroundThrottling: false },
    });
    // Above a full-screen game, the level the pop-out and the notes use.
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    lockDown(w.webContents);
    denyPermissions(w.webContents.session);
    w.setIgnoreMouseEvents(true, { forward: true });
    // Rename lost the keyboard (he clicked away): the page keeps what he typed.
    w.on('blur', () => { if (!w.isDestroyed() && w.isFocusable()) w.setFocusable(false); });
    void w.loadURL(`${this.o.origin}/timer.html`);
    w.once('ready-to-show', () => { if (!w.isDestroyed()) w.showInactive(); });
    return w;
  }

  /** Where he last left a timer; the first time, the lower right of the screen he is on. A second and third stack below. */
  private startSpot(index: number): Spot {
    const saved = readJson<Spot | null>(this.o.spotFile, null, (r) => { const p = r as Spot; return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null; });
    const s = saved ?? (() => { const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; return { x: a.x + a.width - TIMER_W - 40, y: a.y + a.height - TIMER_H - 220 }; })();
    const area = screen.getDisplayNearestPoint(s).workArea;
    const x = Math.min(Math.max(s.x, area.x), area.x + area.width - TIMER_W);
    const y = Math.min(Math.max(s.y + index * 100, area.y), area.y + area.height - 110);
    return { x: Math.round(x), y: Math.round(y) };
  }
  private keepSpot(w: BrowserWindow): void {
    if (w.isDestroyed()) return;
    const [x, y] = w.getPosition();
    try { writeFileAtomic(this.o.spotFile, JSON.stringify({ x, y })); } catch { /* not worth failing over */ }
  }

  /** Which timer a page message came from, by its window. */
  idOf(sender: Electron.WebContents): string | null {
    for (const [id, v] of this.wins) if (!v.w.isDestroyed() && v.w.webContents === sender) return id;
    return null;
  }
  /** Tests: a timer's window. */
  windowOf(id: string): BrowserWindow | null { const v = this.wins.get(id); return v && !v.w.isDestroyed() ? v.w : null; }
  get count(): number { return this.wins.size; }

  /** The page says where its plate and keys are (the Mac's pointer check uses them). */
  areas(sender: Electron.WebContents, a: unknown): void {
    const id = this.idOf(sender); const v = id ? this.wins.get(id) : null;
    if (v) v.areas = cleanAreas(a, TIMER_W, TIMER_H) ?? undefined;
  }
  /** The page says the mouse is (or is not) over its plate: only then does the window take clicks. */
  clickable(sender: Electron.WebContents, on: boolean): void {
    const id = this.idOf(sender); const v = id ? this.wins.get(id) : null;
    if (!v) return;
    v.hot = on;
    v.w.setIgnoreMouseEvents(!on, { forward: true });
  }
  /**
   * The Mac: no mouse moves reach a window that lets clicks through, so the page cannot say it is under the pointer.
   * While a timer is up, Samara looks where the pointer is ten times a second and a timer takes the mouse while the
   * pointer is over it. Stops by itself when the last timer goes.
   */
  private followPointer(): void {
    if ((this.o.platform ?? process.platform) !== 'darwin') return;
    if (!this.wins.size) { if (this.follow) { clearInterval(this.follow); this.follow = null; } return; }
    if (this.follow) return;
    this.follow = setInterval(() => this.pointerAt(screen.getCursorScreenPoint()), 100);
    this.follow.unref?.();
  }
  pointerAt(p: Spot): void {
    for (const v of this.wins.values()) {
      if (v.w.isDestroyed()) continue;
      const b = v.w.getBounds();
      // only over the plate and its keys (the page says where they are); the empty room round them lets clicks through
      const inside = (a: Area) => p.x >= b.x + a.x && p.x < b.x + a.x + a.w && p.y >= b.y + a.y && p.y < b.y + a.y + a.h;
      const on = v.areas ? v.areas.some(inside) : p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
      if (on !== v.hot) { v.hot = on; v.w.setIgnoreMouseEvents(!on, { forward: true }); }
    }
  }

  /** Dragging the plate: the page says how far, this moves the window. */
  drag(sender: Electron.WebContents, phase: string, dx = 0, dy = 0): void {
    const id = this.idOf(sender); const v = id ? this.wins.get(id) : null;
    if (!id || !v) return;
    if (phase === 'start') { const [x, y] = v.w.getPosition(); this.dragFrom = { id, x, y }; return; }
    if (!this.dragFrom || this.dragFrom.id !== id) return;
    if (phase === 'move' && Number.isFinite(dx) && Number.isFinite(dy)) { v.w.setPosition(Math.round(this.dragFrom.x + dx), Math.round(this.dragFrom.y + dy)); return; }
    if (phase === 'end') { this.dragFrom = null; this.keepSpot(v.w); }
  }

  /** Rename: the window takes the keyboard only while the nameplate is being edited. */
  beginRename(id: string): void {
    const v = this.wins.get(id);
    if (!v || v.w.isDestroyed()) return;
    v.w.setIgnoreMouseEvents(false);
    v.w.setFocusable(true);
    v.w.focus(); v.w.webContents.focus();
    this.send(v.w, 'timer:do', 'rename');
  }
  /** Rename finished on the page: the keys go back. */
  typingDone(sender: Electron.WebContents): void {
    const id = this.idOf(sender); const v = id ? this.wins.get(id) : null;
    if (!v) return;
    v.w.setFocusable(false);
    v.w.setIgnoreMouseEvents(!v.hot, { forward: true });
  }

  /** Right-click on a plate: the system's menu, at the mouse. */
  openMenu(sender: Electron.WebContents): void {
    const id = this.idOf(sender); const v = id ? this.wins.get(id) : null;
    if (!id || !v) return;
    const t = v.t;
    const menu = Menu.buildFromTemplate(timerMenu(t, {
      start: (ms) => this.o.start(ms),
      custom: () => this.o.setup(),
      rename: () => this.beginRename(id),
      colour: (c) => this.o.act(id, 'colour', { colour: c }),
      restart: () => this.send(v.w, 'timer:do', 'restart'),
      stop: () => this.o.act(id, 'stop'),
    }));
    menu.popup({ window: v.w });
  }

  closeAll(): void { for (const v of this.wins.values()) if (!v.w.isDestroyed()) v.w.destroy(); this.wins.clear(); this.followPointer(); }
}

/** A timer's menu, as rows (tests read it without a window). */
export function timerMenu(t: Timer, on: { start(ms: number): void; custom(): void; rename(): void; colour(c: Colour): void; restart(): void; stop(): void }): Electron.MenuItemConstructorOptions[] {
  return [
    { label: 'New timer', submenu: [
      ...[5, 10, 25, 45].map((n) => ({ label: `${n} minutes`, click: () => on.start(n * 60_000) })),
      { type: 'separator' as const },
      { label: 'Custom...', click: () => on.custom() },
    ] },
    { label: 'Rename', click: () => on.rename() },
    { label: 'Colour', submenu: COLOURS.map((c) => ({ label: NAMES[c], type: 'radio' as const, checked: (t.colour ?? 'blue') === c, click: () => on.colour(c) })) },
    { label: t.done ? 'Again' : 'Restart', click: () => on.restart() },
    { type: 'separator' },
    { label: t.done ? 'Close' : 'Stop', click: () => on.stop() },
  ];
}

// ---------------------------------------------------------------------------------------------------- "Set a timer"

export const SETUP_W = 300, SETUP_H = 452;

/**
 * The dial (sheet 17): his kitchen dial, presets, the name, Start. One small window in the middle of the screen he is
 * on; it takes the keyboard (he may type a name) and goes on Start, Esc, or a click away.
 */
export class TimerSetup {
  private w: BrowserWindow | null = null;
  private readonly o: { origin: string; preloadPath: string };
  constructor(o: { origin: string; preloadPath: string }) { this.o = o; }
  open(): BrowserWindow {
    if (this.w && !this.w.isDestroyed()) { this.w.show(); this.w.focus(); return this.w; }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const w = new BrowserWindow({
      x: Math.round(area.x + (area.width - SETUP_W) / 2), y: Math.round(area.y + Math.max(0, (area.height - SETUP_H) / 2)), width: SETUP_W, height: SETUP_H,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: true,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, show: false, title: 'Set a timer',
      webPreferences: { ...SAFE_WEB_PREFERENCES, preload: this.o.preloadPath },
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    lockDown(w.webContents);
    denyPermissions(w.webContents.session);
    let shownAt = 0;
    w.on('blur', () => { if (Date.now() - shownAt > 300) this.close(); });
    w.on('closed', () => { if (this.w === w) this.w = null; });
    void w.loadURL(`${this.o.origin}/timerset.html`);
    w.once('ready-to-show', () => { if (w.isDestroyed()) return; shownAt = Date.now(); w.show(); w.focus(); });
    this.w = w;
    return w;
  }
  /** The message came from the dial itself. */
  isDial(sender: Electron.WebContents): boolean { return !!this.w && !this.w.isDestroyed() && this.w.webContents === sender; }
  get window(): BrowserWindow | null { return this.w && !this.w.isDestroyed() ? this.w : null; }
  close(): void { const w = this.w; this.w = null; if (w && !w.isDestroyed()) w.destroy(); }
}
