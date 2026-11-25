// Timers in Samara (T1, 2026-11-25; sheet 17, ported from the companion's dial): drag the knob or roll the mouse wheel
// on it (one minute a notch, Up and Down keys too), or pick a preset, or type any time up to a day. Enter or Start sets
// it; Esc closes. The typed time is read by Samara itself (timers.ts parseCustom), never here.
const api = window.samara;
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const svg = $('dial'), presets = $('presets'), typed = /** @type {HTMLInputElement} */ ($('typed')), name = /** @type {HTMLInputElement} */ ($('name'));
let min = 10;

const pre = [5, 10, 15, 30, 60].map((p) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'pre'; b.textContent = p === 60 ? '1H' : p + 'M'; b.dataset.p = String(p);
  b.addEventListener('click', () => { min = p; typed.value = ''; paint(); });
  presets.append(b); return b;
});

function paint() {
  const m = min, a = m / 60 * Math.PI * 2 - Math.PI / 2, r = 62, x = 100 + r * Math.cos(a), y = 100 + r * Math.sin(a);
  let s = '<circle cx="100" cy="100" r="86" fill="#2b1b10" stroke="#120A05" stroke-width="6"/>';
  for (let i = 0; i < 60; i++) { const t = i / 60 * Math.PI * 2 - Math.PI / 2, r1 = i % 5 ? 76 : 70; s += `<line x1="${100 + r1 * Math.cos(t)}" y1="${100 + r1 * Math.sin(t)}" x2="${100 + 82 * Math.cos(t)}" y2="${100 + 82 * Math.sin(t)}" stroke="${i % 5 ? '#6b4a2a' : '#e0c48c'}" stroke-width="${i % 5 ? 1.5 : 3}"/>`; }
  for (const q of [0, 15, 30, 45]) { const t = q / 60 * Math.PI * 2 - Math.PI / 2; s += `<text x="${100 + 55 * Math.cos(t)}" y="${104 + 55 * Math.sin(t)}" text-anchor="middle" class="dn">${q || 60}</text>`; }
  s += `<path d="${m >= 60 ? 'M100 38 A62 62 0 1 1 99.9 38' : `M100 38 A62 62 0 ${m > 30 ? 1 : 0} 1 ${x} ${y}`}" fill="none" stroke="#966EC8" stroke-width="10" stroke-linecap="round"/>`;
  s += `<circle cx="${x}" cy="${y}" r="11" fill="#FFC43C" stroke="#120A05" stroke-width="4"/>`;
  s += `<text x="100" y="98" text-anchor="middle" class="dt">${m >= 60 ? '1:00:00' : m + ':00'}</text><text x="100" y="120" text-anchor="middle" class="dsub">MINUTES</text>`;
  svg.innerHTML = s;
  svg.setAttribute('aria-valuenow', String(m));
  svg.classList.toggle('off', typed.value.trim() !== '');
  pre.forEach((b) => b.classList.toggle('on', Number(b.dataset.p) === m && !typed.value.trim()));
}

let drag = false;
const at = (e) => {
  const r = svg.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
  let a = Math.atan2(y, x) + Math.PI / 2; if (a < 0) a += Math.PI * 2;
  let m = Math.round(a / (Math.PI * 2) * 60); if (m === 0 && min > 45) m = 60;
  min = Math.max(1, m); typed.value = ''; paint();
};
svg.addEventListener('pointerdown', (e) => { drag = true; svg.setPointerCapture(e.pointerId); at(e); });
svg.addEventListener('pointermove', (e) => { if (drag) at(e); });
svg.addEventListener('pointerup', () => { drag = false; });
const step = (d) => { min = Math.max(1, Math.min(60, min + d)); typed.value = ''; paint(); };
svg.addEventListener('wheel', (e) => { e.preventDefault(); step(e.deltaY < 0 ? 1 : -1); }, { passive: false });
svg.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); step(1); } if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } });
typed.addEventListener('input', () => { typed.classList.remove('bad'); paint(); });

const go = () => {
  const text = typed.value.trim();
  api?.timerStart?.(text ? { text, label: name.value } : { ms: min * 60_000, label: name.value });
};
$('go').addEventListener('click', go);
$('x').addEventListener('click', () => api?.timerSetClose?.());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); api?.timerSetClose?.(); }
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); }
});
api?.onTimerDo?.((what) => { if (what === 'bad-time') { typed.classList.add('bad'); typed.focus(); typed.select(); } });
paint();
requestAnimationFrame(() => name.focus());
