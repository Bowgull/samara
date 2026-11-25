// Sheet 17: one sticky note on their screen. Type on it; drag it by its top; resize from the corner; right-click
// for text, size, font, see-through, pin, back to board, delete. Drop it on the companion to put it back.
// Sheet 60 (2026-10-22): look B, colour from the category, the ribbon tab, and the one control row on every note.
// The QUICK NOTE (Control + Option + N on the Mac, Ctrl + Num * or Ctrl + Alt + N on the PC, or New note in Samara's taskbar list and Dock menu) is this same page opened with ?quick: the same note, just small, empty and ready to type.
// Enter keeps it (Shift + Enter is a new line), Esc closes (whatever the user typed is kept; an empty one is simply gone).
import { buildPaper, openMenu, closeMenu, paintNote } from './notepaper.js';
import { setOwnCats, closePicker } from './notecats.js';

const QUICK = new URLSearchParams(location.search).has('quick');
if (QUICK) document.body.classList.add('quick');
const paperEl = /** @type {HTMLElement} */ (document.getElementById('paper'));
/** @type {any} */ let note = null;
/** @type {any} */ let paper = null;
let typedAt = 0;

window.samara?.onNoteData?.((raw) => {
  if (!raw || typeof raw !== 'object') return;
  const { cats, ...n } = raw;
  if (Array.isArray(cats)) setOwnCats(cats);
  const first = !note;
  // While the user is typing on it, their own words win over an echo of them coming back from the companion. And when what
  // came back is what this window already shows (their own change, saved), nothing is redrawn: the caret, the
  // highlight and the scroll stay where they were (a test: every font pick reset the note).
  const busy = document.hasFocus() && Date.now() - typedAt < 4000;
  const same = !first && paper && n.html === note.html && (n.cat ?? '') === (note.cat ?? '') && n.notice === note.notice
    && (n.title === (paper.title.textContent ?? '').trim() || (n.title === 'Note' && !(paper.title.textContent ?? '').trim()));
  note = Object.assign(note ?? {}, n);
  document.body.classList.toggle('pinned', !!n.out?.pinned);
  if (!first && (busy || same)) { paintNote(paperEl, note); return; }
  paper = buildPaper(paperEl, note, (changed) => {
    typedAt = Date.now();
    // The quick note is not a note until the user keeps it (Enter or Esc). What they type is kept as a draft meanwhile
    // (N0, 2026-11-25): a quick note closed by a crash or a power cut comes back the next time Samara starts.
    if (QUICK) { window.samara?.noteDraft?.({ id: changed.id, title: changed.title ?? '', html: changed.html ?? '', cat: changed.cat ?? '' }); return; }
    if (!changed.title) changed.title = 'Note';
    window.samara?.noteSave?.(changed);
  }, { quick: QUICK, pickHost: document.body, onPicker: grow });
  if (QUICK && first) setTimeout(() => { paper.body.focus(); }, 30);
});
document.addEventListener('input', () => { typedAt = Date.now(); });

/**
 * The category list needs more room than a small note has: the window grows first (exactly as for the right-click
 * menu), the paper keeps its own size, and it shrinks back when the list goes.
 * @returns {Promise<void>|undefined}
 */
function grow(open, at) {
  if (!open) { if (!document.getElementById('nmenu')) { document.body.classList.remove('menu'); window.samara?.noteMenu?.(false); } return undefined; }
  const r = paperEl.getBoundingClientRect();
  document.body.style.setProperty('--w', r.width + 'px');
  document.body.style.setProperty('--h', r.height + 'px');
  document.body.classList.add('menu');
  window.samara?.noteMenu?.({ open: true, x: Math.round(at.x), y: Math.round(at.y) });
  return new Promise((ok) => {
    let done = false;
    const go = () => { if (done) return; done = true; removeEventListener('resize', go); ok(); };
    addEventListener('resize', go);
    setTimeout(go, 250);
  });
}

// Drag by the top strip; resize from the corner. The Shell moves the window. (Not the quick note: it is held still.)
function dragger(el, kind) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || note?.out?.pinned || QUICK) return;
    e.preventDefault();
    const sx = e.screenX, sy = e.screenY;
    el.setPointerCapture(e.pointerId);
    window.samara?.noteMove?.({ kind, phase: 'start' });
    el.onpointermove = (ev) => window.samara?.noteMove?.({ kind, phase: 'move', dx: ev.screenX - sx, dy: ev.screenY - sy });
    el.onpointerup = () => { el.onpointermove = null; window.samara?.noteMove?.({ kind, phase: 'end' }); };
  });
}
dragger(/** @type {HTMLElement} */ (document.getElementById('grab')), 'drag');
dragger(/** @type {HTMLElement} */ (document.getElementById('grip')), 'resize');

let menuPending = false;
// Right-click: the menu. The window grows to fit it while it is open, and the paper keeps its own size.
paperEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!note || !paper || note.out?.pinned || QUICK) return;
  if (menuPending || document.getElementById('nmenu')) return;     // one menu at a time
  closePicker(document.body);
  menuPending = true;
  const r = paperEl.getBoundingClientRect();
  document.body.style.setProperty('--w', r.width + 'px');
  document.body.style.setProperty('--h', r.height + 'px');
  document.body.classList.add('menu');
  // Where the user clicked. The window grows first so the whole menu fits, then it opens there.
  const at = { x: e.clientX, y: e.clientY };
  const part = /** @type {HTMLElement} */ (e.target).closest?.('.ntitle') ? 'title' : 'body';
  window.samara?.noteMenu?.({ open: true, x: at.x, y: at.y });
  let opened = false;
  const open = () => { if (opened) return; opened = true; menuPending = false; removeEventListener('resize', open); showMenu(at, part); };
  addEventListener('resize', open);
  setTimeout(open, 250);
});
function showMenu(at, part) {
  const m = openMenu(document.body, at, paper, note, 'screen', (what, v) => {
    if (what === 'opacity') window.samara?.noteOpacity?.(v);
    else if (what === 'pin') window.samara?.notePin?.(true);
    else if (what === 'through') window.samara?.noteThrough?.();
    else if (what === 'back') window.samara?.noteBack?.();
    else if (what === 'delete') window.samara?.noteDelete?.();
  }, part);
  // When the menu goes, the window shrinks back to the note.
  const watch = new MutationObserver(() => { if (!document.body.contains(m)) { watch.disconnect(); document.body.classList.remove('menu'); window.samara?.noteMenu?.(false); } });
  watch.observe(document.body, { childList: true });
}

/** The quick note goes: kept when there are words in it (Enter, or Esc), simply gone when it is empty. */
let leaving = false;
function quickDone() {
  if (!QUICK || leaving || !paper) return;
  leaving = true;
  paper.flush();
  const words = (paper.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  const keep = words ? { ...note, title: words.split(' ').slice(0, 4).join(' ').slice(0, 60) || 'Note' } : null;
  document.body.classList.add('going');
  setTimeout(() => window.samara?.noteQuickDone?.(keep), 150);
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (closePicker(document.body)) return;
    if (document.getElementById('nmenu')) { closeMenu(document.body); return; }
    if (QUICK) { e.preventDefault(); quickDone(); }
    return;
  }
  if (QUICK && e.key === 'Enter' && !e.shiftKey && !e.isComposing && !(/** @type {HTMLElement} */ (e.target)).closest?.('.np-pick')) { e.preventDefault(); quickDone(); }
});
