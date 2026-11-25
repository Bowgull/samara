// Notes in Samara (N0, 2026-11-25): the preload of a note stuck on his screen and of the quick note. Its only doors:
// the note it shows, and what that one note may ask for. It only ever speaks for itself (main checks the sender).
// Plain CommonJS, like the other preloads.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('samara', {
  onNoteData(fn) { const h = (_e, n) => fn(n); ipcRenderer.on('note:data', h); return () => ipcRenderer.removeListener('note:data', h); },
  noteSave: (n) => ipcRenderer.send('note:save', n),
  noteMove: (a) => ipcRenderer.send('note:move', a),
  noteMenu: (open) => ipcRenderer.send('note:menu', open),
  noteOpacity: (n) => ipcRenderer.send('note:opacity', n),
  notePin: (on) => ipcRenderer.send('note:pin', on),
  noteThrough: () => ipcRenderer.send('note:through'),
  noteBack: () => ipcRenderer.send('note:back'),
  noteDelete: () => ipcRenderer.send('note:delete'),
  /** The quick note, while he types: kept as a draft until he keeps it. */
  noteDraft: (n) => ipcRenderer.send('note:draft', n),
  /** The quick note is done (Enter or Esc): its note to keep, or null when it was left empty. */
  noteQuickDone: (n) => ipcRenderer.send('note:quickdone', n),
  /** "+ Category" on a note's own picker. */
  noteCat: (name) => ipcRenderer.send('note:cat', name),
});
