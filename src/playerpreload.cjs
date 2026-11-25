// The music player (sheet 59, 2026-10-22; in Samara since M1, 2026-11-25): this page's only doors. It hears what is
// playing and its own settings; it can press the seven keys (checked again in miniplayer.ts),
// choose its picture or the bars, open its own menu, fold, pin, fade, be dragged, or close. It never names an app, a song or a link. Plain
// CommonJS, like the other preloads.
const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (fn) => { const h = (_e, v) => fn(v); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };
contextBridge.exposeInMainWorld('player', {
  onMedia: on('player:media'),
  onUi: on('player:ui'),
  onAwake: on('player:awake'),
  // Spotify Connect (2026-10-22): one plain line when Spotify cannot be reached (null when all is well again).
  onNote: on('player:note'),
  // Sheet 117 (2026-11-01): the song's timed lyrics from LRCLIB, asked by the main process only while lyrics are on.
  onLyrics: on('player:lyrics'),
  ready: () => ipcRenderer.send('player:ready'),
  cmd: (op, value) => ipcRenderer.send('player:cmd', typeof value === 'number' ? { op: String(op), value } : { op: String(op) }),
  // 2026-10-22: the player's own menu (the ··· key). `menu` opens it under the key (its box in page pixels); the menu
  // window (playermenu.html, this same preload) hears what is chosen now, says its size, and sends back his choice.
  menu: (r) => ipcRenderer.send('player:menu', r && typeof r === 'object' ? { x: Number(r.x) || 0, y: Number(r.y) || 0, width: Number(r.width) || 0, height: Number(r.height) || 0 } : null),
  onMenu: on('player:menushow'),
  menuSize: (w, h) => ipcRenderer.send('player:menusize', { w: Number(w) || 0, h: Number(h) || 0 }),
  menuPick: (kind, value) => ipcRenderer.send('player:menupick', { kind: String(kind), value: typeof value === 'boolean' ? value : String(value ?? '') }),
  shade: () => ipcRenderer.send('player:shade'),
  pin: () => ipcRenderer.send('player:pin'),
  opacity: (n) => ipcRenderer.send('player:opacity', Number(n)),
  drag: (a) => ipcRenderer.send('player:drag', a && typeof a === 'object' ? { phase: String(a.phase), dx: Number(a.dx) || 0, dy: Number(a.dy) || 0 } : null),
  close: () => ipcRenderer.send('player:close'),
});
