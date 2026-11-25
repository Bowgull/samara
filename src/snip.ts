// Snip in Samara (S1, 2026-11-25, his "build it"): freeze the screen under the pointer, drag a box, and the picture is
// his. Ported from the companion's snip.ts; what happens to the picture next (Ask Claude, Pin it) is snipwire.ts.
//
// Saved as a PNG in his own Pictures folder ("Samara snips"), not in Samara's data folder: it is his picture, he should
// be able to find it. The full screenshot never leaves this file: the overlay page gets it to show, and sends back only
// the box he drew, in its own pixels; the crop happens here.
//
// The Mac: the picture of the screen needs Screen Recording for Samara (System Settings > Privacy & Security). Without
// it macOS hands back the desktop picture only, so snipwire.ts asks first and never shows a frozen screen that is wrong.
import { BrowserWindow, desktopCapturer, globalShortcut, screen, type Display, type NativeImage } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SAFE_WEB_PREFERENCES, denyPermissions, lockDown } from './safety.ts';

import { cropFor } from './snipplan.ts';
export { cleanBox, cropFor, snipName, type SnipBox } from './snipplan.ts';
import { snipName, type SnipBox } from './snipplan.ts';

export interface SnipOptions {
  origin: string;
  preloadPath: string;
  /** Where snips are saved: Pictures/Samara snips. */
  dir: string;
  /** A box was drawn and the snip saved: its file and its picture. */
  onSnip(file: string, img: NativeImage): void;
  /** Tests: the picture of a screen (default: desktopCapturer). */
  grab?: (d: Display) => Promise<NativeImage | null>;
  log(s: string): void;
}

async function grabScreen(d: Display): Promise<NativeImage | null> {
  const sf = d.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.bounds.width * sf), height: Math.round(d.bounds.height * sf) } });
  const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[0];
  return src && !src.thumbnail.isEmpty() ? src.thumbnail : null;
}

export class Snipper {
  private overlay: BrowserWindow | null = null;
  private full: NativeImage | null = null;
  private escHeld = false;
  private starting = false;
  private readonly o: SnipOptions;
  constructor(o: SnipOptions) { this.o = o; }

  /** The overlay is up. */
  get open(): boolean { return Boolean(this.overlay && !this.overlay.isDestroyed()); }
  isOverlay(sender: Electron.WebContents): boolean { return Boolean(this.overlay && !this.overlay.isDestroyed() && sender === this.overlay.webContents); }

  /** Freeze the screen the pointer is on and let him drag a box over it. False when the screen gave no picture. */
  async start(): Promise<boolean> {
    if (this.open || this.starting) return true;
    this.starting = true;
    try {
      const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      let full: NativeImage | null = null;
      try { full = await (this.o.grab ?? grabScreen)(d); } catch (e) { this.o.log('snip: the screen could not be captured: ' + (e as Error).message); }
      if (!full || full.isEmpty()) { this.o.log('snip: nothing came back from the screen capture'); return false; }
      this.full = full;
      // The Mac (the companion's lesson, 2026-10-28): macOS keeps a window below the menu bar unless it may be larger
      // than the screen, which moved the frozen picture 25 px down. Placed again once it is up, over the menu bar too.
      const mac = process.platform === 'darwin';
      const w = new BrowserWindow({
        x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, frame: false, show: false, skipTaskbar: true,
        resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true,
        backgroundColor: '#000000', title: 'Snip', ...(mac ? { enableLargerThanScreen: true } : {}),
        webPreferences: { ...SAFE_WEB_PREFERENCES, preload: this.o.preloadPath },
      });
      lockDown(w.webContents);
      denyPermissions(w.webContents.session);
      // Over everything, a game included, for the second it takes to drag a box.
      w.setAlwaysOnTop(true, 'screen-saver');
      w.webContents.once('did-finish-load', () => {
        if (w.isDestroyed() || !this.full) return;
        w.webContents.send('snip:shot', this.full.toDataURL());
        w.show(); w.focus();
        if (mac) { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); w.setBounds(d.bounds); }
      });
      w.on('closed', () => { if (this.overlay === w) { this.overlay = null; this.full = null; } this.releaseEsc(); });
      this.overlay = w;
      // Esc is taken while the overlay is up: Windows does not hand the keyboard to a window over a game, so a plain Esc
      // would go to the game instead. Taken for this second only, given back on close.
      try { this.escHeld = globalShortcut.register('Escape', () => this.done(null)); } catch { this.escHeld = false; }
      void w.loadURL(`${this.o.origin}/snip.html`);
      return true;
    } finally { this.starting = false; }
  }

  private releaseEsc(): void { if (this.escHeld) { try { globalShortcut.unregister('Escape'); } catch { /* gone */ } this.escHeld = false; } }

  /** The box he drew (checked by the caller), or null: cancelled. */
  done(r: SnipBox | null): string | null {
    const full = this.full;
    this.full = null;
    this.releaseEsc();
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.close();
    if (!r || !full) return null;
    const img = full.crop(cropFor(r, full.getSize()));
    let file: string;
    try {
      mkdirSync(this.o.dir, { recursive: true });
      const name = snipName(new Date());
      file = path.join(this.o.dir, name);
      for (let i = 2; existsSync(file) && i < 100; i++) file = path.join(this.o.dir, name.replace(/\.png$/, ` (${i}).png`));
      writeFileSync(file, img.toPNG());
    } catch (e) { this.o.log('snip: could not save it: ' + (e as Error).message); return null; }
    this.o.onSnip(file, img);
    return file;
  }

  close(): void { this.full = null; this.releaseEsc(); if (this.overlay && !this.overlay.isDestroyed()) this.overlay.close(); }
}
