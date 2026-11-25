// Snip in Samara (S1, 2026-11-25): the snip overlay. Shows the frozen screen, lets him drag a box, and tells Samara the
// box in this page's own pixels. Samara does the cropping, so the full screen picture never leaves it.
const shot = document.getElementById('shot');
const box = document.getElementById('box');
let from = null;

window.samara?.onSnipShot?.((url) => { if (typeof url === 'string' && url.startsWith('data:image/')) shot.src = url; });

const rect = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
function draw(r) {
  box.hidden = false;
  Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
}

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  from = { x: e.clientX, y: e.clientY };
  document.body.classList.add('drawing');
  draw(rect(from, from));
});
window.addEventListener('pointermove', (e) => { if (from) draw(rect(from, { x: e.clientX, y: e.clientY })); });
window.addEventListener('pointerup', (e) => {
  if (!from) return;
  const r = rect(from, { x: e.clientX, y: e.clientY });
  from = null;
  // A click without a drag is not a snip: too small to be anything, so it cancels rather than snipping a dot.
  if (r.w < 8 || r.h < 8) { window.samara?.snipDone?.(null); return; }
  window.samara?.snipDone?.({ ...r, vw: innerWidth, vh: innerHeight });
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.samara?.snipDone?.(null); });
// Right-click cancels too, the way every snipping tool does.
window.addEventListener('contextmenu', (e) => { e.preventDefault(); window.samara?.snipDone?.(null); });
