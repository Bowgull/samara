// Samara's tools in one place (U1, 2026-11-25, his "build it"): Timer, Music player, Snip and New note, the tools that
// used to be the companion's. In the ☰ menu they are the TOOLS group; anywhere else (a game, another app, no Samara
// window at all) one key brings them up by the pointer: Control + Option + T on the Mac, Ctrl + Num / on the PC.
//
// The key's menu is the system's own (it looks right on both machines). A menu needs a window to hang from, so it hangs
// from a tiny see-through one at the pointer, made for that moment and gone when the menu closes. On the Mac Samara
// may open it without taking the keyboard from the app in front; on the PC the little window takes it for the moment the
// menu is up, which is how every menu there works.
import { BrowserWindow, Menu, globalShortcut, screen } from 'electron';
import { SAFE_WEB_PREFERENCES } from './safety.ts';
import { sayKey } from './notes.ts';

import { toolsMenu, toolsKeyFor, type ToolHubs } from './tools.ts';
export { toolsMenu, toolsKeyFor, type ToolHubs } from './tools.ts';

export interface ToolsHub {
  /** The key's menu, by the pointer. */
  open(): void;
  /** The key as he reads it, or null when another program holds it. */
  readonly key: string | null;
  close(): void;
}

export function startTools(o: { hubs: ToolHubs; noteKey: string | null; log(s: string): void; platform?: NodeJS.Platform; register?: boolean }): ToolsHub {
  const platform = o.platform ?? process.platform;
  const mac = platform === 'darwin';
  let anchor: BrowserWindow | null = null;

  const open = () => {
    if (anchor && !anchor.isDestroyed()) return;
    const pt = screen.getCursorScreenPoint();
    const w = new BrowserWindow({ x: pt.x, y: pt.y, width: 1, height: 1, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      skipTaskbar: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true, show: false, title: 'Samara tools',
      webPreferences: { ...SAFE_WEB_PREFERENCES } });
    w.setAlwaysOnTop(true, 'screen-saver');
    anchor = w;
    w.on('closed', () => { if (anchor === w) anchor = null; });
    if (mac) w.showInactive(); else w.show();
    const menu = Menu.buildFromTemplate(toolsMenu(o.hubs, o.noteKey));
    menu.popup({ window: w, x: 0, y: 0, callback: () => { if (!w.isDestroyed()) w.destroy(); } });
  };

  const k = toolsKeyFor(platform);
  let held: string | null = null;
  if (o.register !== false) {
    try { if (globalShortcut.register(k, open)) held = k; else o.log(`tools: the tools key ${sayKey(k, mac)} is taken by another program`); }
    catch (e) { o.log('tools: no tools key: ' + (e as Error).message); }
  }

  return {
    open,
    get key() { return held ? sayKey(held, mac) : null; },
    close: () => { if (held) { try { globalShortcut.unregister(held); } catch { /* going */ } held = null; } if (anchor && !anchor.isDestroyed()) anchor.destroy(); },
  };
}
