// Notes in Samara (N3, 2026-11-25): a note pinned to words on a page. "Note this" on a selection keeps the words with a
// little of what comes before and after (the W3C text-quote selector: exact, prefix, suffix), so the same words are found
// again on the next visit even when the page has moved around them. Found again, the words are marked with the CSS
// Custom Highlight API (nothing is added to the page's own markup) and a small ribbon in the margin opens the note.
//
// Everything that touches the page runs in the tab preload's own isolated world (999): the page's scripts cannot see
// it, change it or forge its clicks. The code is built here, from functions that are unit tested on plain strings.

/** One note pinned on this page, as the page side needs it. */
export interface PagePin { id: string; title: string; exact: string; prefix: string; suffix: string; deep: string }

const ws = (s: string) => s.replace(/\s+/g, ' ');

/**
 * Where `exact` is in `text` (both with their spaces as on the page): the occurrence whose surroundings match `prefix`
 * and `suffix` best, so the same three words elsewhere on the page are not taken. Whitespace differences are forgiven.
 * Returns [start, end) in `text`, or null. Pure; also shipped to the page as source (findQuote.toString()).
 */
export function findQuote(text: string, exact: string, prefix: string, suffix: string): [number, number] | null {
  // Fold runs of whitespace to one space, keeping where each folded character came from.
  const map: number[] = [];
  let flat = '';
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (/\s/.test(c)) { if (!space) { flat += ' '; map.push(i); space = true; } continue; }
    space = false; flat += c; map.push(i);
  }
  map.push(text.length);
  const fold = (s: string) => s.replace(/\s+/g, ' ');
  const want = fold(exact).trim();
  if (want.length < 2) return null;
  const pre = fold(prefix), suf = fold(suffix);
  let best = -1, bestScore = -1;
  for (let at = flat.indexOf(want); at >= 0; at = flat.indexOf(want, at + 1)) {
    let score = 0;
    const before = flat.slice(Math.max(0, at - pre.length - 2), at).trimEnd(), after = flat.slice(at + want.length, at + want.length + suf.length + 2).trimStart();
    const p = pre.trim(), s = suf.trim();
    for (let k = Math.min(p.length, before.length); k > 0; k--) if (before.endsWith(p.slice(-k))) { score += k; break; }
    for (let k = Math.min(s.length, after.length); k > 0; k--) if (after.startsWith(s.slice(0, k))) { score += k; break; }
    if (score > bestScore) { best = at; bestScore = score; }
  }
  if (best < 0) return null;
  return [map[best]!, map[best + want.length - 1]! + 1];
}

/** The words before and after a selection kept with it (32 characters each way, spaces folded). */
export function quoteAround(before: string, exact: string, after: string): { exact: string; prefix: string; suffix: string } {
  return { exact: ws(exact).trim().slice(0, 1000), prefix: ws(before).slice(-32), suffix: ws(after).slice(0, 32) };
}

/** Page code (world 999): the selection as a quote, or null. */
export const SELECTION_CODE = `(() => {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0), exact = sel.toString();
  if (!exact.trim()) return null;
  const root = document.body || document.documentElement;
  const b = document.createRange(); b.setStart(root, 0); b.setEnd(r.startContainer, r.startOffset);
  const a = document.createRange(); a.setStart(r.endContainer, r.endOffset); a.setEnd(root, root.childNodes.length);
  return { before: b.toString().slice(-200), exact: exact.slice(0, 4000), after: a.toString().slice(0, 200), title: document.title.slice(0, 200) };
})()`;

/**
 * Page code (world 999): mark these pins (replacing any marked before), each word found by findQuote, a ribbon in the
 * margin beside each, in a closed shadow root. A click on a ribbon (a real one: isTrusted) opens its note. With `jump`,
 * that pin is scrolled to the middle of the window and flashes once. Answers which pins were found.
 */
export function paintCode(pins: PagePin[], jump: string | null): string {
  return `(() => {
  const findQuote = ${findQuote.toString()};
  const pins = ${JSON.stringify(pins)}, jump = ${JSON.stringify(jump)};
  const S = globalThis.__samaraPins || (globalThis.__samaraPins = { host: null, root: null, items: [], timer: 0 });
  if (S.host) { S.host.remove(); S.host = null; }
  try { CSS.highlights.delete('samara-note'); CSS.highlights.delete('samara-note-jump'); } catch {}
  S.items = [];
  if (!pins.length || !document.body) return [];
  const nodes = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => {
    const p = n.parentElement; if (!p) return NodeFilter.FILTER_REJECT;
    const tag = p.tagName; if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT; } });
  let text = ''; const starts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push(n); starts.push(text.length); text += n.data; if (text.length > 4000000) break; }
  const at = (i) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= i) lo = m; else hi = m - 1; } return [nodes[lo], i - starts[lo]]; };
  const found = [];
  const ranges = [];
  for (const p of pins) {
    const hit = findQuote(text, p.exact, p.prefix, p.suffix);
    if (!hit) continue;
    const [sn, so] = at(hit[0]), [en, eo] = at(hit[1] - 1);
    const r = document.createRange(); r.setStart(sn, so); r.setEnd(en, eo + 1);
    ranges.push(r); S.items.push({ p, r }); found.push(p.id);
  }
  try { if (ranges.length) CSS.highlights.set('samara-note', new Highlight(...ranges)); } catch {}
  const host = document.createElement('samara-pins');
  host.style.cssText = 'all:initial;position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = '<style>b{position:absolute;width:12px;height:18px;cursor:pointer;background:var(--d);clip-path:polygon(0 0,100% 0,100% 100%,50% 75%,0 100%);box-shadow:inset 0 3px 0 #e8c45a;filter:drop-shadow(1px 1px 0 rgba(0,0,0,.45));transition:transform .12s}b:hover{transform:translateY(2px)}</style>';
  for (const it of S.items) {
    const b = document.createElement('b');
    b.title = it.p.title ? 'Your note: ' + it.p.title : 'Your note';
    b.style.setProperty('--d', it.p.deep);
    b.addEventListener('click', (e) => { if (e.isTrusted) globalThis.__samaraNoteOpen?.(it.p.id); });
    it.b = b; root.append(b);
  }
  // In the margin: left of the paragraph (or list item, heading, cell) the words are in, level with their first line.
  const BLOCK = 'p,li,dd,dt,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,figcaption,article,section,div';
  const place = () => { for (const it of S.items) { const rc = it.r.getClientRects()[0] || it.r.getBoundingClientRect(); const b = it.b;
    const blk = (it.r.startContainer.parentElement || document.body).closest(BLOCK) || document.body, br = blk.getBoundingClientRect();
    b.style.left = Math.max(2, br.left + scrollX - 22) + 'px'; b.style.top = (rc.top + scrollY + 1) + 'px'; } };
  document.documentElement.append(host);
  S.host = host; S.root = root;
  place();
  if (!S.watching) { S.watching = true; addEventListener('resize', () => { clearTimeout(S.timer); S.timer = setTimeout(() => S.host && place(), 120); }); }
  if (jump) { const it = S.items.find((x) => x.p.id === jump); if (it) {
    const el = it.r.startContainer.parentElement; el?.scrollIntoView({ block: 'center' });
    try { CSS.highlights.set('samara-note-jump', new Highlight(it.r)); setTimeout(() => { try { CSS.highlights.delete('samara-note-jump'); } catch {} }, 2400); } catch {}
    setTimeout(place, 600);
  } }
  return found;
})()`;
}

/** The marks' look, added with insertCSS (so a page's own rules cannot refuse it). */
export const PIN_CSS = '::highlight(samara-note){background-color:rgba(255,214,102,.42)}::highlight(samara-note-jump){background-color:rgba(255,170,60,.85)}';

/** A category's ribbon colour on the page (the built-ins; his own get the first own colour, mauve). */
const DEEP: Record<string, string> = { '': '#d9a83a', 'to-do': '#2f78b8', idea: '#3f8a4e', reference: '#7a6e60', 'for claude': '#c4572f' };
export const deepOf = (cat?: string) => DEEP[String(cat ?? '').toLowerCase()] ?? '#9a4478';

/** The same address, as far as a pin is concerned: no #part, no trailing slash. */
export const pageKey = (u: string) => String(u ?? '').replace(/#.*$/, '').replace(/\/$/, '');
