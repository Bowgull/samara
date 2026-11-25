// Notes in Samara (N0, 2026-11-25): a note stuck on his screen is a small window of Samara's own, as it was the
// companion's (sheet 17, sheet 60). He drags it by its top, resizes it from the corner, types on it, right-clicks it,
// pins it so the mouse goes through to the game, or sends it back to his notes.
//
// It CAN take the keyboard, because he types on it; it is only ever shown without taking it (showInactive), so a note
// appearing never steals his game's keys. Clicking into it is him choosing to type. The quick note is the one exception:
// he pressed its key to type, so it takes the keyboard at once.
//
// Ported from the companion's notewin.ts, without the companion's window family and with no "drop it on the companion".
// Every save goes through the store (noteswire.ts): this file only moves windows and says what changed.
import { BrowserWindow, screen } from 'electron';
import { SAFE_WEB_PREFERENCES, denyPermissions, lockDown } from './safety.ts';
import type { NoteOut, NoteView } from './notes.ts';

/** The quick note's size (sheet 60 B-capture): small, the same note. */
export const QUICK_W = 300, QUICK_H = 196;
const PAD = 14;                    // room around the paper for its pin and shadow
const MENU_W = 280, MENU_H = 520;  // the room the right-click menu needs while it is open

export interface NoteWinHooks {
  origin: string;
  preloadPath: string;
  /** Where it sits on this screen changed (dragged, resized, see-through, pinned), or it came off the screen (null). */
  place(id: string, out: NoteOut | null): void;
  /** His own categories, so each window colours them the same. */
  cats(): string[];
}

type Entry = { w: BrowserWindow; note: NoteView; menu: boolean; through: boolean };

export class NoteWindows {
  private readonly wins = new Map<string, Entry>();
  private drag: { id: string; x: number; y: number; w: number; h: number } | null = null;
  private quickWin: BrowserWindow | null = null;
  private quickId = '';
  private readonly o: NoteWinHooks;
  constructor(o: NoteWinHooks) { this.o = o; }

  private frameless(b: { x: number; y: number; width: number; height: number }, extra: Electron.BrowserWindowConstructorOptions = {}): BrowserWindow {
    const w = new BrowserWindow({
      ...b, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: true,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
      title: 'Note', ...extra,
      webPreferences: { ...SAFE_WEB_PREFERENCES, preload: this.o.preloadPath, backgroundThrottling: false },
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    lockDown(w.webContents);
    denyPermissions(w.webContents.session);
    return w;
  }
  private send(w: BrowserWindow, n: NoteView | Record<string, unknown>): void {
    if (w.isDestroyed()) return;
    const go = () => { if (!w.isDestroyed()) w.webContents.send('note:data', { ...n, cats: this.o.cats() }); };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', go); else go();
  }

  // ---------------------------------------------------------------- the quick note (sheet 60 section 3)

  /**
   * The quick-note key, or New note: the SAME note, small, empty (or the draft he left) and ready to type, in the middle
   * of the screen he is on. It takes the keyboard. Pressed again while it is open, it comes back to the front.
   */
  quick(start: { id: string; title?: string; html?: string; cat?: string }): BrowserWindow | null {
    if (this.quickWin && !this.quickWin.isDestroyed()) { this.quickWin.show(); this.quickWin.focus(); return this.quickWin; }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const w = this.frameless({ x: Math.round(area.x + (area.width - QUICK_W) / 2) - PAD, y: Math.round(area.y + area.height * 0.32) - PAD, width: QUICK_W + PAD * 2, height: QUICK_H + PAD * 2 }, { movable: false });
    this.quickId = start.id;
    void w.loadURL(`${this.o.origin}/note.html?quick`);
    this.send(w, { title: '', html: '', font: 'figtree', size: 'm', updated: Date.now(), ...start });
    w.once('ready-to-show', () => { if (w.isDestroyed()) return; w.show(); w.focus(); w.webContents.focus(); });
    w.on('closed', () => { if (this.quickWin === w) this.quickWin = null; });
    this.quickWin = w;
    return w;
  }
  isQuick(sender: Electron.WebContents): boolean { return !!this.quickWin && !this.quickWin.isDestroyed() && this.quickWin.webContents === sender; }
  /** The quick note's id, for the sender that is the quick note (a draft or a keep may only speak for it). */
  quickIdOf(sender: Electron.WebContents): string | null { return this.isQuick(sender) ? this.quickId : null; }
  /** The quick note is done: the window goes. The caller has already kept its words. */
  closeQuick(): void {
    const w = this.quickWin;
    this.quickWin = null;
    if (w && !w.isDestroyed()) w.destroy();
  }
  private quickRoom(open: boolean, at: { x: number; y: number } | null): void {
    const w = this.quickWin;
    if (!w || w.isDestroyed()) return;
    const b = w.getBounds();
    const area = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
    if (open) w.setBounds({ x: b.x, y: b.y, width: Math.max(QUICK_W + PAD * 2, (at?.x ?? 0) + MENU_W), height: Math.min(area.y + area.height - b.y, Math.max(QUICK_H + PAD * 2, (at?.y ?? 0) + 380)) });
    else w.setBounds({ x: b.x, y: b.y, width: QUICK_W + PAD * 2, height: QUICK_H + PAD * 2 });
  }

  // ---------------------------------------------------------------- notes on the screen

  /** The store is the truth: a window for each note that is out on this screen, none for the rest. */
  sync(notes: NoteView[]): void {
    const out = new Map(notes.filter((n) => n.out).map((n) => [n.id, n]));
    for (const [id, v] of this.wins) if (!out.has(id)) { if (!v.w.isDestroyed()) v.w.destroy(); this.wins.delete(id); }
    for (const n of out.values()) this.show(n);
  }

  /** Open (or update) one note's window. A note out on a screen that is gone comes back onto the nearest one. */
  show(n: NoteView): BrowserWindow | null {
    if (!n.out) return null;
    const o = onScreen(n.out);
    let v = this.wins.get(n.id);
    if (!v || v.w.isDestroyed()) {
      const w = this.frameless({ x: o.x - PAD, y: o.y - PAD, width: o.w + PAD * 2, height: o.h + PAD * 2 });
      void w.loadURL(`${this.o.origin}/note.html`);
      w.once('ready-to-show', () => { if (!w.isDestroyed()) w.showInactive(); });
      w.on('closed', () => { if (this.wins.get(n.id)?.w === w) this.wins.delete(n.id); });
      v = { w, note: n, menu: false, through: false };
      this.wins.set(n.id, v);
    } else v.note = n;
    const w = v.w;
    if (!v.menu && this.drag?.id !== n.id) {
      const b = { x: o.x - PAD, y: o.y - PAD, width: o.w + PAD * 2, height: o.h + PAD * 2 };
      const now = w.getBounds();
      if (now.x !== b.x || now.y !== b.y || now.width !== b.width || now.height !== b.height) w.setBounds(b);
    }
    w.setOpacity(o.opacity);
    this.applyMouse(n.id);
    this.send(w, n);
    return w;
  }
  /** Brought to the front (opened from the rail or his notes while already out). */
  focus(id: string): boolean { const v = this.wins.get(id); if (!v || v.w.isDestroyed()) return false; v.w.showInactive(); v.w.moveTop(); return true; }

  /** Which note a page message came from. A page can only ever speak for its own note. */
  of(sender: Electron.WebContents): (Entry & { id: string }) | null {
    for (const [id, v] of this.wins) if (!v.w.isDestroyed() && v.w.webContents === sender) return { id, ...v };
    return null;
  }

  private applyMouse(id: string): void {
    const v = this.wins.get(id);
    if (!v || v.w.isDestroyed()) return;
    const pinned = !!v.note.out?.pinned;
    if (v.through && !pinned) v.w.setIgnoreMouseEvents(true, { forward: true }); else v.w.setIgnoreMouseEvents(pinned);
  }
  /** "Click through": clicks go to what is under it while the mouse is still seen moving (so it can be turned off on hover). */
  toggleThrough(sender: Electron.WebContents): void { const v = this.of(sender); if (!v) return; this.wins.get(v.id)!.through = !v.through; this.applyMouse(v.id); }

  private placeNow(id: string, patch: Partial<NoteOut> = {}): void {
    const v = this.wins.get(id);
    if (!v || v.w.isDestroyed() || !v.note.out || v.menu) return;
    const nb = v.w.getBounds();
    const out: NoteOut = { ...v.note.out, x: nb.x + PAD, y: nb.y + PAD, w: nb.width - PAD * 2, h: nb.height - PAD * 2, ...patch };
    v.note = { ...v.note, out };
    this.o.place(id, out);
  }

  /** Drag by the top, or resize from the corner: the page says how far, the window follows. */
  move(sender: Electron.WebContents, kind: 'drag' | 'resize', phase: string, dx: number, dy: number): void {
    const v = this.of(sender);
    if (!v || !v.note.out || v.note.out.pinned) return;
    const b = v.w.getBounds();
    if (phase === 'start') { this.drag = { id: v.id, x: b.x, y: b.y, w: b.width, h: b.height }; return; }
    const d = this.drag;
    if (!d || d.id !== v.id) return;
    if (phase === 'move') {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      if (kind === 'drag') v.w.setPosition(Math.round(d.x + dx), Math.round(d.y + dy));
      else v.w.setBounds({ x: d.x, y: d.y, width: Math.max(170 + PAD * 2, Math.round(d.w + dx)), height: Math.max(120 + PAD * 2, Math.round(d.h + dy)) });
      return;
    }
    if (phase !== 'end') return;
    this.drag = null;
    this.placeNow(v.id);
  }

  /** While the right-click menu is open the window grows to fit it, then goes back. */
  menu(sender: Electron.WebContents, open: boolean, at: { x: number; y: number } | null = null): void {
    if (this.isQuick(sender)) { this.quickRoom(open, at); return; }
    const v = this.of(sender);
    if (!v || !v.note.out) return;
    this.wins.get(v.id)!.menu = open;
    const o = v.note.out;
    const area = screen.getDisplayNearestPoint({ x: o.x, y: o.y }).workArea;
    const needW = Math.max(o.w + PAD * 2, (at?.x ?? o.w) + MENU_W), needH = Math.max(o.h + PAD * 2, (at?.y ?? 0) + MENU_H);
    if (open) v.w.setBounds({ x: o.x - PAD, y: o.y - PAD, width: Math.min(needW, area.x + area.width - (o.x - PAD)), height: Math.min(needH, area.y + area.height - (o.y - PAD)) });
    else v.w.setBounds({ x: o.x - PAD, y: o.y - PAD, width: o.w + PAD * 2, height: o.h + PAD * 2 });
  }

  setOpacity(sender: Electron.WebContents, n: number): void {
    const v = this.of(sender);
    if (!v || !v.note.out || !Number.isFinite(n)) return;
    const op = Math.max(0.25, Math.min(1, n));
    v.w.setOpacity(op);
    this.placeNow(v.id, { opacity: op });
  }
  setPinned(sender: Electron.WebContents, on: boolean): void {
    const v = this.of(sender);
    if (!v || !v.note.out) return;
    this.placeNow(v.id, { pinned: on });
    this.applyMouse(v.id);
    this.send(v.w, this.wins.get(v.id)!.note);
  }
  /** Off the screen, back in his notes. */
  back(id: string): void {
    const v = this.wins.get(id);
    if (!v) return;
    if (!v.w.isDestroyed()) v.w.destroy();
    this.wins.delete(id);
    this.o.place(id, null);
  }
  /** Gone (deleted): the window only; the store has already moved the note to the Trash. */
  drop(id: string): void { const v = this.wins.get(id); if (v && !v.w.isDestroyed()) v.w.destroy(); this.wins.delete(id); }

  /** Everything closed (quit). */
  closeAll(): void { for (const v of this.wins.values()) if (!v.w.isDestroyed()) v.w.destroy(); this.wins.clear(); this.closeQuick(); }
  get count(): number { return this.wins.size; }
}

/** A note somewhere no screen is now (a monitor unplugged, the other machine's place): brought onto the nearest one. */
export function onScreen(o: NoteOut): NoteOut {
  try {
    const area = screen.getDisplayNearestPoint({ x: o.x + Math.round(o.w / 2), y: o.y + 10 }).workArea;
    return { ...o, ...fitInto(o, area) };
  } catch { return o; }
}
/** The pure part of onScreen: at least its top bar and 80 px of it inside the work area. */
export function fitInto(o: { x: number; y: number; w: number; h: number }, a: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  const x = Math.min(Math.max(o.x, a.x - o.w + 80), a.x + a.width - 80);
  const y = Math.min(Math.max(o.y, a.y), a.y + a.height - 40);
  return { x, y };
}

/** A new note put out on the screen: near the middle of the screen the mouse is on, a little apart from the last one. */
export function freshOut(n: number): NoteOut {
  let area = { x: 0, y: 0, width: 1280, height: 800 };
  try { area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; } catch { /* the defaults */ }
  const step = (n % 6) * 28;
  return { x: Math.round(area.x + area.width / 2 - 130 + step), y: Math.round(area.y + area.height * 0.25 + step), w: 260, h: 240, opacity: 1, pinned: false };
}
