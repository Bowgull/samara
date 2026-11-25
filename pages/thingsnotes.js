// @ts-nocheck  (a page module, like the other pages: checked by its tests, not by tsc)
// Your things › Notes (N1, 2026-11-25): every note he keeps, on the paper of its category, searched as he types.
// A click puts the note on his screen (where he edits it). On each card: its versions, copy as Markdown, to the Trash.
// The Trash lists what was deleted in the last 30 days, each with Restore. The footer locks a copy with his passphrase
// (or brings one back). Everything is drawn with textContent; the only doors are window.things.
import { paintCat, catColour, ribbon, setOwnCats, allCats } from './notecats.js';
import { previewLines } from './notepaper.js';

const T = window.things;
const $ = (s, r = document) => r.querySelector(s);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const day = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();

let view = 'notes', cat = '*', board = null, qTimer = 0, on = false;

async function load() {
  if (!T?.notes) return;
  const b = await T.notes($('#nq').value, cat, view);
  if (!b) return;
  board = b;
  setOwnCats(b.cats.own);
  paint();
}
window.addEventListener('notes:show', () => { on = true; load(); $('#nq').focus(); });
window.addEventListener('notes:changed', () => { if (on) load(); });
$('#nq').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(load, 120); });
$('#nq').addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#nq').value) { e.preventDefault(); $('#nq').value = ''; load(); } });
for (const a of document.querySelectorAll('.side a[data-sec]')) a.addEventListener('click', () => { on = a.dataset.sec === 'notes'; });

function chip(label, n, active, go, cls = '') {
  const c = mk('button', 'nchip' + (active ? ' on' : '') + (cls ? ' ' + cls : '')); c.type = 'button'; c.setAttribute('role', 'tab'); c.setAttribute('aria-selected', String(active));
  c.append(mk('span', '', label)); if (n != null) c.append(mk('b', '', String(n)));
  c.addEventListener('click', go);
  return c;
}
function paint() {
  const b = board;
  $('#ncount').textContent = b.counts.all ? String(b.counts.all) : '';
  // the chips: All, every category that has a note (in the pickers' order), then the Trash
  const chips = $('#nchips');
  chips.replaceChildren(chip('All', b.counts.all, view === 'notes' && cat === '*', () => { view = 'notes'; cat = '*'; load(); }));
  for (const c of allCats(b.cats.own)) {
    const n = b.counts.cats[c.cat] ?? 0;
    if (!n && cat !== c.cat) continue;
    const el = chip(c.cat || 'Just a note', n, view === 'notes' && cat === c.cat, () => { view = 'notes'; cat = c.cat; load(); }, 'cat');
    el.style.setProperty('--paper', c.paper); el.style.setProperty('--deep', c.deep);
    chips.append(el);
  }
  chips.append(mk('span', 'grow'));
  chips.append(chip('Trash', b.counts.trash, view === 'trash', () => { view = view === 'trash' ? 'notes' : 'trash'; load(); }, 'trash'));
  // the cards
  const box = $('#nboard');
  box.replaceChildren(...b.cards.map(card));
  const empty = $('#nempty');
  empty.hidden = b.cards.length > 0;
  empty.textContent = $('#nq').value.trim() ? 'No note matches that.' : view === 'trash' ? 'The Trash is empty. Deleted notes stay here for 30 days.' : cat !== '*' ? 'No notes in this category.' : 'No notes yet. Ctrl + Num * makes one anywhere.';
  $('#nnew').hidden = view === 'trash';
}
function card(n) {
  const c = mk('div', 'ncard npaper' + (n.out ? ' out' : '') + (view === 'trash' ? ' gone' : ''));
  c.tabIndex = 0;
  paintCat(c, n.cat);
  const inner = mk('div', 'np-in');
  if (n.title && n.title !== 'Note') inner.append(mk('div', 'nc-t', n.title));
  const lines = previewLines(n.html);
  const l = mk('div', 'nc-l');
  for (const x of lines.slice(0, 6)) { const r = mk('div', x.done ? 'done' : '', x.t); l.append(r); }
  if (!lines.length) l.append(mk('div', 'dim', '(empty)'));
  inner.append(l);
  const meta = [view === 'trash' ? `DELETED ${day(n.deleted)}` : day(n.updated), n.site ? n.site.toUpperCase() : '', n.out ? 'ON SCREEN' : '', n.copyOf ? 'A COPY' : ''].filter(Boolean).join(' · ');
  inner.append(mk('div', 'nc-m', meta));
  const act = mk('div', 'nc-act');
  if (view === 'trash') act.append(btn('Restore', 'Bring it back', () => T.note('restore', n.id)));
  else {
    if (n.versions) act.append(btn('Versions', `${n.versions} earlier version${n.versions === 1 ? '' : 's'}`, () => versions(n, c)));
    if (n.out) act.append(btn('Off screen', 'Take it off your screen (it stays here)', () => T.note('back', n.id)));
    act.append(btn('Copy', 'Copy it as Markdown', async () => { if (await T.note('copymd', n.id)) flash(c, 'Copied'); }));
    act.append(btn('Delete', 'To the Trash (30 days)', () => T.note('trash', n.id), 'danger'));
  }
  inner.append(act);
  c.append(mk('div', 'np-edge'), mk('div', 'np-fill'), ribbon(catColour(n.cat).deep), inner);
  if (view !== 'trash') {
    c.title = n.out ? 'On your screen: click to bring it to the front' : 'Click to put it on your screen';
    c.addEventListener('click', (e) => { if (!e.target.closest('.nc-act,.nver')) T.note('open', n.id); });
    c.addEventListener('keydown', (e) => { if (e.target === c && e.key === 'Enter') T.note('open', n.id); if (e.target === c && e.key === 'Delete') T.note('trash', n.id); });
  }
  return c;
}
function btn(label, title, fn, cls = '') { const b = mk('button', 'nb' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.title = title; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; }
function flash(c, text) { const f = mk('span', 'nflash', text); c.append(f); setTimeout(() => f.remove(), 1200); }

/** A note's earlier versions, newest first, each with Restore (the one it replaces becomes a version itself). */
async function versions(n, c) {
  const was = c.querySelector('.nver');
  if (was) { was.remove(); return; }
  const list = await T.note('versions', n.id);
  if (!Array.isArray(list)) return;
  const v = mk('div', 'nver');
  v.append(mk('div', 'nv-h', 'EARLIER VERSIONS'));
  for (const x of list) {
    const r = mk('div', 'nv-r');
    const when = new Date(x.updated);
    r.append(mk('time', '', `${day(x.updated)} ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`));
    r.append(mk('span', '', previewLines(x.html).map((l) => l.t).join(' ').slice(0, 90) || '(empty)'));
    r.append(btn('Restore', 'Make this the note again', async () => { await T.note('restorever', n.id, x.stamp); }));
    v.append(r);
  }
  c.querySelector('.np-in').append(v);
}

$('#nnew').addEventListener('click', () => T?.note('new', '', cat !== '*' ? cat : undefined));

// ---- the locked copy: a passphrase, then lock one or bring one back. The passphrase goes to Samara once, never kept.
function lockAsk(open, msg = '') {
  const box = $('#nlock');
  box.replaceChildren();
  if (!open) {
    if (msg) box.append(mk('span', 'nmsg', msg));
    const b = mk('button', 'pick', 'Locked copy…'); b.type = 'button'; b.title = 'Lock every note with a passphrase you choose, or bring a locked copy back';
    b.addEventListener('click', () => lockAsk(true));
    box.append(b);
    return;
  }
  const pass = mk('input', 'npass'); pass.type = 'password'; pass.placeholder = 'Passphrase (8 or more)'; pass.autocomplete = 'new-password'; pass.setAttribute('aria-label', 'Passphrase');
  const go = async (act) => {
    const p = pass.value;
    if (p.length < 8) { pass.focus(); pass.classList.add('bad'); return; }
    for (const x of box.querySelectorAll('button')) x.disabled = true;
    const r = await T.notesLock(act, p);
    pass.value = '';
    lockAsk(false, r || '');
  };
  const lock = mk('button', 'pick', 'Lock a copy'); lock.type = 'button'; lock.addEventListener('click', () => go('export'));
  const back = mk('button', 'pick', 'Bring one back'); back.type = 'button'; back.addEventListener('click', () => go('import'));
  const no = mk('button', 'pick', 'Cancel'); no.type = 'button'; no.addEventListener('click', () => lockAsk(false));
  pass.addEventListener('keydown', (e) => { pass.classList.remove('bad'); if (e.key === 'Enter') go('export'); if (e.key === 'Escape') lockAsk(false); });
  box.append(pass, lock, back, no);
  setTimeout(() => pass.focus(), 0);
}
lockAsk(false);
