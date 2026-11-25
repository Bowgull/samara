// Snip in Samara (S1, 2026-11-25, his "build it"): the snip is Samara's now, on each machine, with nothing else running.
// This file plugs the snip (snip.ts) and the pinned snips (pinsnip.ts) into the rest: ☰ › Snip, the taskbar list and
// the Dock, Ask Claude, and the Claude door.
//
// A snip is saved in Pictures/Samara snips and copied, so he can paste it anywhere at once. Then a notice in Samara's
// window: Ask Claude, Pin it, Show it, Got it. With no Samara window open the snip is pinned instead (its bar has Ask
// Claude too), so a snip taken from the taskbar or the Dock is never lost behind nothing.
//
// Ask Claude opens a new chat in the Claude app with a line typed in for him to finish and send: the snip's name for the
// browser_snip tool (Samara's Claude door hands that chat the picture), and its file as a fallback. Only snips Samara
// took are ever handed over, by a name made fresh for each (unguessable), never by a path a chat chose.
//
// The Mac: the picture of the screen needs Screen Recording. Without it macOS gives the desktop picture only, so Samara
// asks first: a notice that says so and opens the right page of System Settings.
import { ClipboardItem, app, clipboard, desktopCapturer, ipcMain, nativeImage, shell, systemPreferences, type NativeImage } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Snipper, cleanBox } from './snip.ts';
import { PinSnips } from './pinsnip.ts';
import { newChatLink } from './claudehand.ts';
import { writeFileAtomic } from './atomic.ts';
import { SNIP_ID, askText } from './snipplan.ts';
export { SNIP_ID, askText } from './snipplan.ts';
import { readJson } from './store.ts';
import type { SamaraBrowser } from './browser.ts';

export interface SnipHub {
  /** ☰ › Snip, the taskbar list's and the Dock's Snip: freeze the screen and drag a box. */
  start(): Promise<void>;
  /** Pin a snip Samara saved. */
  pin(file: string): boolean;
  /** Ask Claude about a snip Samara saved: a new chat with its name typed in. */
  ask(file: string): void;
  /** The Claude door's browser_snip: the picture of one of his snips, by its name. */
  forClaude(id: unknown): { ok: true; png: string; width: number; height: number; file: string } | { ok: false; error: string };
  close(): void;
}

export interface SnipOpts {
  browser: SamaraBrowser;
  here: string;
  stateDir: string;
  origin: string;
  log(s: string): void;
  /** Where snips go (default: Pictures/Samara snips). */
  dir?: string;
  platform?: NodeJS.Platform;
  /** Tests: the picture of a screen, opening a link, and Screen Recording on the Mac. */
  grab?: ConstructorParameters<typeof Snipper>[0]['grab'];
  openUrl?: (u: string) => void;
  screenOk?: () => boolean;
}

const KEEP = 60;
/** Widest picture handed to Claude (what it reads text in well; capture.ts's own rule). */
const CLAUDE_W = 1280;
const SCREEN_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

interface Kept { id: string; file: string; at: number }

export function startSnip(o: SnipOpts): SnipHub {
  const b = o.browser;
  const mac = (o.platform ?? process.platform) === 'darwin';
  const preloadPath = path.join(o.here, 'snippreload.cjs');
  const dir = o.dir ?? path.join(app.getPath('pictures'), 'Samara snips');
  const keptFile = path.join(o.stateDir, 'snips.json');
  let kept = readJson<Kept[]>(keptFile, [], (x) => (Array.isArray(x) ? x as Kept[] : null)).filter((k) => k && SNIP_ID.test(String(k.id)) && typeof k.file === 'string');
  const open = o.openUrl ?? ((u: string) => { void shell.openExternal(u); });

  /** The name Claude knows a snip by (made the first time it is asked about, kept for the last 60). */
  const idFor = (file: string): string => {
    const had = kept.find((k) => k.file === file);
    if (had) return had.id;
    const k = { id: 'sn' + randomBytes(8).toString('hex'), file, at: Date.now() };
    kept = [...kept, k].slice(-KEEP);
    try { writeFileAtomic(keptFile, JSON.stringify(kept)); } catch (e) { o.log('snip: could not keep its name: ' + (e as Error).message); }
    return k.id;
  };

  const ask = (file: string) => {
    if (!existsSync(file)) { say('That snip is not there any more.'); return; }
    const home = path.join(os.homedir(), 'Handoff', 'samara');
    open(newChatLink(askText(idFor(file), file), existsSync(home) ? home : null));
  };
  const say = (why: string) => { if (b.hasWindow()) b.note('', { kind: 'bad', from: 'menu', small: true, kick: 'Snip', title: why }); };

  const pins = new PinSnips({ origin: o.origin, preloadPath, ask, ...(o.platform ? { platform: o.platform } : {}) });
  const pin = (file: string): boolean => Boolean(pins.open(file, 'Snip'));

  const snipped = (file: string, img: NativeImage) => {
    o.log('snip: saved ' + path.basename(file));
    // copied too (Electron 44's clipboard takes a PNG as a blob); a busy clipboard only means the file is the copy
    try { void clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })]).catch(() => {}); } catch { /* as above */ }
    idFor(file);
    if (!b.hasWindow()) { pin(file); return; }
    const sz = img.getSize();
    b.note('', { kind: 'done', from: 'menu', kick: 'Snip saved', title: 'Copied: paste it anywhere',
      rows: [{ g: 'Size', v: `${sz.width} × ${sz.height}` }, { g: 'In', v: 'Pictures › Samara snips' }],
      keys: [{ label: 'Ask Claude', act: 'ask' }, { label: 'Pin it', act: 'pin' }, { label: 'Show', act: 'show', plain: true }, { label: 'Got it', act: 'ok', plain: true }] },
    (a) => { if (a === 'ask') ask(file); else if (a === 'pin') pin(file); else if (a === 'show') shell.showItemInFolder(file); });
  };
  const snipper = new Snipper({ origin: o.origin, preloadPath, dir, onSnip: snipped, log: o.log, ...(o.grab ? { grab: o.grab } : {}) });

  /** The Mac: Screen Recording for Samara. Asking for the screen once puts Samara in that list (and macOS may ask him). */
  const screenOk = o.screenOk ?? (() => {
    if (!mac) return true;
    try { return systemPreferences.getMediaAccessStatus('screen') === 'granted'; } catch { return true; }
  });
  const askScreen = () => {
    if (!o.screenOk) void desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});
    const keys = [{ label: 'Open settings', act: 'open' }, { label: 'Not now', act: 'ok', plain: true }];
    if (b.hasWindow()) {
      b.note('', { kind: 'need', from: 'menu', kick: 'Snip', title: 'Allow Screen Recording',
        rows: [{ g: 'Where', v: 'Privacy & Security › Screen Recording' }, { g: 'Then', v: 'Turn on Samara, quit Samara and open it again' }], keys },
      (a) => { if (a === 'open') open(SCREEN_SETTINGS); });
    } else open(SCREEN_SETTINGS);
  };

  // ---- what the pages may ask (each only for itself)
  ipcMain.on('snip:done', (e, r) => { if (snipper.isOverlay(e.sender)) snipper.done(cleanBox(r)); });
  const fromPin = (e: Electron.IpcMainEvent) => pins.of(e.sender, e.senderFrame);
  ipcMain.on('pinsnip:clickable', (e, on) => { const p = fromPin(e); if (p) pins.clickable(p, on === true); });
  ipcMain.on('pinsnip:drag', (e, a) => {
    const p = fromPin(e);
    if (!p || !a || typeof a !== 'object') return;
    const v = a as Record<string, unknown>;
    pins.drag(p, v.phase, Number(v.dx ?? 0), Number(v.dy ?? 0));
  });
  ipcMain.on('pinsnip:areas', (e, a) => { const p = fromPin(e); if (p) pins.areas(p, a); });
  ipcMain.on('pinsnip:pin', (e) => { const p = fromPin(e); if (p) pins.pin(p); });
  ipcMain.on('pinsnip:opacity', (e, n) => { const p = fromPin(e); if (p) pins.opacity(p, Number(n)); });
  ipcMain.on('pinsnip:ask', (e) => { const p = fromPin(e); if (p) pins.ask(p); });
  ipcMain.on('pinsnip:close', (e) => { const p = fromPin(e); if (p) pins.close(p); });

  return {
    start: async () => {
      if (!screenOk()) { askScreen(); return; }
      if (!(await snipper.start())) say('The screen gave no picture. Try again.');
    },
    pin,
    ask,
    forClaude: (id) => {
      const k = typeof id === 'string' && SNIP_ID.test(id) ? kept.find((x) => x.id === id) : undefined;
      if (!k) return { ok: false, error: 'No snip by that name. The user takes a snip in Samara (☰ › Snip) and picks Ask Claude.' };
      let img = nativeImage.createFromPath(k.file);
      if (img.isEmpty()) return { ok: false, error: 'That snip is not on this computer any more.' };
      if (img.getSize().width > CLAUDE_W) img = img.resize({ width: CLAUDE_W, quality: 'good' });
      const sz = img.getSize();
      return { ok: true, png: img.toPNG().toString('base64'), width: sz.width, height: sz.height, file: k.file };
    },
    close: () => { snipper.close(); pins.closeAll(); },
  };
}
