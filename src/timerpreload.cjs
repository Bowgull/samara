// Timers in Samara (T1, 2026-11-25): the preload of a timer's hourglass and of the "Set a timer" dial. Its only doors:
// the timer it shows, and what that one timer (or the dial) may ask for. Main checks every sender. Plain CommonJS, like
// the other preloads.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('samara', {
  onTimerData(fn) { const h = (_e, t) => fn(t); ipcRenderer.on('timer:data', h); return () => ipcRenderer.removeListener('timer:data', h); },
  onTimerDo(fn) { const h = (_e, w) => fn(w); ipcRenderer.on('timer:do', h); return () => ipcRenderer.removeListener('timer:do', h); },
  /** A key on the hourglass: pause, add, again, stop, rename (its own timer only). */
  timerAct: (a) => ipcRenderer.send('timer:act', a),
  timerClickable: (on) => ipcRenderer.send('timer:clickable', on === true),
  /** Where the plate and keys are (the Mac follows the pointer with these). */
  timerAreas: (a) => ipcRenderer.send('timer:areas', a),
  timerDrag: (a) => ipcRenderer.send('timer:drag', a),
  timerMenu: () => ipcRenderer.send('timer:menu'),
  /** Rename is over: the keyboard goes back. */
  timerTyping: (on) => ipcRenderer.send('timer:typing', on === true),
  /** The dial's Start, and its close (Esc). */
  timerStart: (a) => ipcRenderer.send('timer:start', a),
  timerSetClose: () => ipcRenderer.send('timer:setclose'),
});
