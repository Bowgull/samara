// Snip in Samara (S1, 2026-11-25): the preload of the snip overlay and of a pinned snip. Its only doors: the frozen
// screen (the overlay) or its own picture (a pin), and what that one window may ask for. Main checks every sender.
// Plain CommonJS, like the other preloads.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('samara', {
  /** The overlay: the frozen screen arrives; the box he drew goes back (null: cancelled). */
  onSnipShot(fn) { const h = (_e, url) => fn(url); ipcRenderer.on('snip:shot', h); return () => ipcRenderer.removeListener('snip:shot', h); },
  snipDone: (r) => ipcRenderer.send('snip:done', r ?? null),
  /** A pinned snip: its picture and state, and its keys. */
  onPinData(fn) { const h = (_e, d) => fn(d); ipcRenderer.on('pinsnip:data', h); return () => ipcRenderer.removeListener('pinsnip:data', h); },
  pinClickable: (on) => ipcRenderer.send('pinsnip:clickable', on === true),
  pinDrag: (a) => ipcRenderer.send('pinsnip:drag', a),
  pinPin: () => ipcRenderer.send('pinsnip:pin'),
  pinOpacity: (n) => ipcRenderer.send('pinsnip:opacity', Number(n)),
  pinAsk: () => ipcRenderer.send('pinsnip:ask'),
  pinClose: () => ipcRenderer.send('pinsnip:close'),
});
