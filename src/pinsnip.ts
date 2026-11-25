// Snip in Samara (S1, 2026-11-25): a snip pinned on his screen. Ported from the companion's pinsnip.ts (sheet 62: the
// video pop-out's frame, the wooden bar, the pin key, the see-through slider beside it) without its window family: a
// pinned snip is dragged by its bar and stays where he leaves it.
//
// It is just a picture: no page, no link, nothing to click through to. It never takes the keyboard (focusable: false,
// shown with showInactive), so pinning a snip over a game never pulls the game out of focus. The page only speaks for its
// own window and never names a file: the picture is read here, from a snip Samara itself saved, and sent as an image.
// Its bar has Ask Claude too, so a snip pinned with no Samara window open can still go to Claude.
import { BrowserWindow, nativeImage, screen } from 'electron';
import { SAFE_WEB_PREFERENCES, denyPermissions, lockDown } from './safety.ts';

import { pinSize } from './snipplan.ts';
export { BAR, ROOM_R, MAX_W, MAX_H, MIN_W, MIN_OPACITY, pinSize } from './snipplan.ts';
import { MIN_OPACITY } from './snipplan.ts';

export interface PinSnipOptions {
  origin: string;
  /** snippreload.cjs: the page's few named doors. */
  preloadPath: string;
  /** Ask Claude about this pinned snip (its file). */
  ask(file: string): void;
  /** Tests: the platform (the Mac follows the pointer). */
  platform?: NodeJS.Platform;
}

interface Pin { w: BrowserWindow; file: string; title: string; pic: string; pinned: boolean; opacity: number; drag: { x: number; y: number } | null; hot: boolean }

export class PinSnips {
  private readonly pins = new Set<Pin>();
  private follow: NodeJS.Timeout | null = null;
  private readonly o: PinSnipOptions;
  constructor(o: PinSnipOptions) { this.o = o; }

  /** Pin one snip: a PNG Samara saved. Null when it cannot be read. */
  open(file: string, title: string): BrowserWindow | null {
    let img: Electron.NativeImage;
    try { img = nativeImage.createFromPath(file); } catch { return null; }
    if (img.isEmpty()) return null;
    const { width: iw, height: ih } = img.getSize();
    const sz = pinSize(iw, ih);
    const spot = this.spot(sz.width, sz.height);
    const w = new BrowserWindow({
      ...spot, width: sz.width, height: sz.height, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: true, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
      focusable: false, show: false, title: 'Pinned snip',
      webPreferences: { ...SAFE_WEB_PREFERENCES, preload: this.o.preloadPath },
    });
    lockDown(w.webContents);
    denyPermissions(w.webContents.session);
    w.setIgnoreMouseEvents(true, { forward: true });
    void w.loadURL(`${this.o.origin}/pinsnip.html`);
    w.once('ready-to-show', () => { if (!w.isDestroyed()) w.showInactive(); });
    const pic = (iw > sz.picW * 2 ? img.resize({ width: sz.picW * 2, quality: 'good' }) : img).toDataURL();
    const p: Pin = { w, file, title: String(title).replace(/\s+/g, ' ').slice(0, 60) || 'Snip', pic, pinned: true, opacity: 1, drag: null, hot: false };
    this.pins.add(p);
    this.applyPin(p);
    w.on('closed', () => { this.pins.delete(p); this.followPointer(); });
    this.push(p);
    this.followPointer();
    return w;
  }
  windows(): BrowserWindow[] { return [...this.pins].map((p) => p.w).filter((w) => !w.isDestroyed()); }
  closeAll(): void {
    for (const p of [...this.pins]) if (!p.w.isDestroyed()) p.w.destroy();
    this.pins.clear();
    if (this.follow) { clearInterval(this.follow); this.follow = null; }
  }

  private push(p: Pin): void {
    const data = { title: p.title, pic: p.pic, pinned: p.pinned, opacity: p.opacity };
    const send = () => { if (!p.w.isDestroyed()) p.w.webContents.send('pinsnip:data', data); };
    if (p.w.webContents.isLoading()) p.w.webContents.once('did-finish-load', send); else send();
  }
  private applyPin(p: Pin): void {
    if (p.w.isDestroyed()) return;
    // Pinned: stays on top, above a full-screen game too. Unpinned: an ordinary window other windows can cover.
    if (p.pinned) { p.w.setAlwaysOnTop(true, 'screen-saver'); p.w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); }
    else { p.w.setAlwaysOnTop(false); p.w.setVisibleOnAllWorkspaces(false); }
  }
  /** Near the pointer (where he just snipped), kept on the screen. */
  private spot(width: number, height: number): { x: number; y: number } {
    const pt = screen.getCursorScreenPoint();
    const a = screen.getDisplayNearestPoint(pt).workArea;
    return { x: Math.round(Math.min(Math.max(a.x, pt.x - width / 2), a.x + a.width - width)), y: Math.round(Math.min(Math.max(a.y, pt.y - height / 2), a.y + a.height - height)) };
  }

  /** The pinned snip a page belongs to (its main frame only), or null. */
  of(sender: Electron.WebContents, frame?: Electron.WebFrameMain | null): Pin | null {
    if (frame && frame.parent !== null) return null;
    for (const p of this.pins) if (!p.w.isDestroyed() && p.w.webContents === sender) return p;
    return null;
  }

  /**
   * The Mac: no mouse moves reach a window that lets clicks through, so the page cannot say it is under the pointer.
   * While a snip is pinned, Samara looks where the pointer is ten times a second (as for timers). Stops with the last one.
   */
  private followPointer(): void {
    if ((this.o.platform ?? process.platform) !== 'darwin') return;
    if (!this.pins.size) { if (this.follow) { clearInterval(this.follow); this.follow = null; } return; }
    if (this.follow) return;
    this.follow = setInterval(() => this.pointerAt(screen.getCursorScreenPoint()), 100);
    this.follow.unref?.();
  }
  pointerAt(pt: { x: number; y: number }): void {
    for (const p of this.pins) {
      if (p.w.isDestroyed() || p.drag) continue;
      const b = p.w.getBounds();
      // the frame only: the see-through room on the right lets clicks through unless the slider is out (the page says)
      const on = pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height;
      if (on !== p.hot) { p.hot = on; p.w.setIgnoreMouseEvents(!on, { forward: true }); }
    }
  }

  /* ---- what the page may ask, each only for its own window (snipwire.ts finds the window first) */
  clickable(p: Pin, on: boolean): void { if (!p.w.isDestroyed()) { p.hot = on; p.w.setIgnoreMouseEvents(!(on || p.drag), { forward: true }); } }
  drag(p: Pin, phase: unknown, dx: number, dy: number): void {
    if (p.w.isDestroyed()) return;
    if (phase === 'start') { const [x, y] = p.w.getPosition(); p.drag = { x: x!, y: y! }; p.w.setIgnoreMouseEvents(false); return; }
    if (!p.drag || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (phase === 'move') { p.w.setPosition(Math.round(p.drag.x + dx), Math.round(p.drag.y + dy)); return; }
    if (phase === 'end') p.drag = null;
  }
  pin(p: Pin): void { p.pinned = !p.pinned; this.applyPin(p); this.push(p); }
  opacity(p: Pin, n: number): void { if (Number.isFinite(n)) p.opacity = Math.round(Math.max(MIN_OPACITY, Math.min(1, n)) * 100) / 100; }
  ask(p: Pin): void { this.o.ask(p.file); }
  close(p: Pin): void { this.pins.delete(p); if (!p.w.isDestroyed()) p.w.destroy(); this.followPointer(); }
}
