// Notes in Samara (N0, 2026-11-25, his "build it"): the sticky notes that lived in the companion now belong to Samara. This
// file is the note itself, with nothing about disks or windows: what a note is, the one HTML cleaner every save passes
// through, and the checks on everything a note can carry. notestore.ts keeps them; noteswire.ts puts them on screen.
//
// Ported from the companion's notes.ts (sheets 17, 60, 62 and BG5) so every note he made there comes across exactly:
// the same fields, the same cleaner, the same categories and colours. What is new is only what Samara needs to keep
// notes on two machines without losing one: when and where a note was made, a clock stamp for sync, the stamps it
// grew from, a deletion mark (Trash), and an anchor for a note pinned to words on a page.

export const BUILTIN_CATS = ['To-do', 'Idea', 'Reference', 'For Claude'] as const;
export const MAX_OWN_CATS = 12;
export const FONTS = ['figtree', 'caveat', 'patrick', 'cinzel', 'fell', 'elite', 'silk', 'vt', 'arcade'] as const;
export const SIZES = ['s', 'm', 'l'] as const;
export const MAX_HTML = 20_000;
/** How many of a note's past stamps it carries, so the other machine can tell an edit on top from an edit beside. */
export const HIST = 24;
export const ID_RE = /^n[a-z0-9]{1,24}$/;

export type Dev = 'pc' | 'mac';
export interface NoteOut { x: number; y: number; w: number; h: number; opacity: number; pinned: boolean }
export interface NotePlace { game: 'botw'; x: number; z: number }
export interface NoteSrc { url: string; site: string }
/** Words on a page a note is pinned to: the W3C text-quote selector (exact words, a little before and after). */
export interface NoteAnchor { url: string; exact: string; prefix: string; suffix: string }
export interface NoteRemind { at: number; done?: true }

/** A note as it is kept and as it travels between his machines. Where it sits on his screen (`out`) never travels. */
export interface Note {
  id: string; title: string; html: string; font: string; size: string;
  cat?: string; tfont?: string; tsize?: string;
  src?: NoteSrc; place?: NotePlace; anchor?: NoteAnchor; remind?: NoteRemind;
  /** "Can be brought up" (the companion's notice switch). Kept so nothing he set is lost; stored only as false. */
  notice?: false;
  created: number; updated: number;
  /** The machine of the last change. */
  dev: Dev;
  /** The clock stamp of this version (hlc.ts style: time, counter, machine), and the stamps it grew from, newest first. */
  stamp: string; hist: string[];
  /** In the Trash since (ms). A note in the Trash still travels, so a delete reaches the other machine. */
  deleted?: number;
  /** A copy kept because the same note was changed on both machines while they were apart: the note it came from. */
  conflictOf?: string;
}
/** A note as a window or page sees it: the note, and where it sits on this machine's screen. */
export type NoteView = Note & { out?: NoteOut };

// ------------------------------------------------------------------ the checks

/** A category name as kept: plain words, no markup, at most 24 characters. Empty = a plain note. */
export function cleanCat(raw: unknown): string {
  return String(raw ?? '').replace(/[<>#\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

/** A note's source link: http(s) only, not absurdly long, and its site (short). Anything else is no source. */
export function cleanSrc(raw: unknown): NoteSrc | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const u = String(r.url ?? '').trim();
  if (!u || u.length > 2048) return undefined;
  let host = '';
  try { const x = new URL(u); if (x.protocol !== 'http:' && x.protocol !== 'https:') return undefined; host = x.hostname.replace(/^www\./, ''); } catch { return undefined; }
  const site = String(r.site ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || host;
  return { url: u, site };
}

/** BotW's world runs about -5000..5000 east-west and -4000..4000 north-south; a little slack, then refused. */
const BOTW_SPAN = 6000;
export function cleanPlace(raw: unknown): NotePlace | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (r.game !== 'botw') return undefined;
  const num = (v: unknown) => typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  const x = num(r.x), z = num(r.z);
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > BOTW_SPAN || Math.abs(z) > BOTW_SPAN) return undefined;
  return { game: 'botw', x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
}

/** Words on a page: plain text, short, from an http(s) page. Anything else is no anchor. */
export function cleanAnchor(raw: unknown): NoteAnchor | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const src = cleanSrc({ url: r.url });
  const words = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').slice(0, n);
  const exact = words(r.exact, 1000).trim();
  if (!src || exact.length < 2) return undefined;
  return { url: src.url, exact, prefix: words(r.prefix, 64), suffix: words(r.suffix, 64) };
}

export function cleanRemind(raw: unknown): NoteRemind | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const at = Number(r.at);
  if (!Number.isFinite(at) || at < 946_684_800_000 || at > 4_102_444_800_000) return undefined;   // 2000..2100
  return { at: Math.round(at), ...(r.done === true ? { done: true as const } : {}) };
}

export function cleanOut(raw: unknown): NoteOut | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
  return { x: num(o.x, -20000, 20000, 100), y: num(o.y, -20000, 20000, 100), w: num(o.w, 170, 900, 220), h: num(o.h, 120, 900, 170),
    opacity: Math.max(0.25, Math.min(1, Number(o.opacity) || 1)), pinned: o.pinned === true };
}

const STAMP_RE = /^\d{13}:\d{4}:(pc|mac)$/;
export const isStamp = (s: unknown): s is string => typeof s === 'string' && STAMP_RE.test(s);

// ------------------------------------------------------------------ keeping the HTML to what the editor makes

const TAGS = new Set(['div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'h3', 'ul', 'ol', 'li', 'span']);
const FONT_CSS: Record<string, string> = {
  figtree: 'Figtree', caveat: 'Caveat', patrick: 'Patrick Hand', cinzel: 'Cinzel', fell: 'IM Fell English',
  elite: 'Special Elite', silk: 'Silkscreen', vt: 'VT323', arcade: 'Press Start 2P',
};
const FAMILIES = new Set(Object.values(FONT_CSS).map(f => f.toLowerCase()));
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The style a span may carry: one of the note fonts, and a size between 10 and 28 px. Nothing else. */
function cleanStyle(style: string): string {
  const out: string[] = [];
  const fam = /font-family\s*:\s*["']?([a-z0-9 ]+)/i.exec(style);
  if (fam && FAMILIES.has(fam[1]!.trim().toLowerCase())) out.push(`font-family:'${fam[1]!.trim()}'`);
  const size = /font-size\s*:\s*(\d{1,2})px/i.exec(style);
  if (size) { const n = Number(size[1]); if (n >= 10 && n <= 28) out.push(`font-size:${n}px`); }
  return out.join(';');
}

/**
 * Rebuild a note's HTML from scratch: only the editor's own tags, only `class="cl"`/`"cl done"` on a line and a
 * font or size on a span, every other attribute dropped, all text escaped, and every tag closed. Anything else
 * (a script, an image, a link, an event handler, a comment) simply is not copied across.
 */
export function cleanHtml(html: unknown): string {
  const src = String(html ?? '').slice(0, MAX_HTML * 2);
  let out = '';
  const open: string[] = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|</g;
  let m: RegExpExecArray | null;
  let skip = 0;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[4] !== undefined || m[0] === '<') { if (!skip) out += esc(unesc(m[4] ?? '<')); continue; }
    const closing = m[1] === '/', tag = m[2]!.toLowerCase(), attrs = m[3] ?? '';
    if (tag === 'script' || tag === 'style') { skip += closing ? -1 : 1; if (skip < 0) skip = 0; continue; }
    if (skip || !TAGS.has(tag)) continue;
    if (tag === 'br') { out += '<br>'; continue; }
    const t = tag === 'strong' ? 'b' : tag === 'em' ? 'i' : tag === 'strike' ? 's' : tag;
    if (closing) {
      const at = open.lastIndexOf(t);
      if (at < 0) continue;
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }
    let a = '';
    if (t === 'div') { const c = /class\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? ''; if (/\bcl\b/.test(c)) a = /\bdone\b/.test(c) ? ' class="cl done"' : ' class="cl"'; }
    if (t === 'span') { const sm = /style\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs); const st = cleanStyle(sm?.[1] ?? sm?.[2] ?? ''); if (st) a = ` style="${st}"`; }
    out += `<${t}${a}>`;
    open.push(t);
  }
  while (open.length) out += `</${open.pop()}>`;
  return out.slice(0, MAX_HTML);
}

/** The note as plain lines, for search, previews, Markdown and Claude. Ticked lines say so. */
export function plainOf(html: string): string[] {
  const clean = cleanHtml(html);
  const lines: string[] = [];
  for (const block of clean.split(/<\/?(?:div|li|h3|br|ul|ol)[^>]*>/)) {
    const text = unesc(block.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (text) lines.push(text);
  }
  const done = new Set<string>();
  for (const m of clean.matchAll(/<div class="cl done">([\s\S]*?)<\/div>/g)) done.add(unesc(m[1]!.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
  return lines.map(l => done.has(l) ? `${l} (done)` : l);
}

/** Lines as the editor's HTML: a list becomes ticks, one sentence stays plain text. */
export function linesHtml(lines: string[]): string {
  const cls = lines.length > 1 ? ' class="cl"' : '';
  return lines.map(l => `<div${cls}>${esc(l)}</div>`).join('');
}

/** The note's own words are empty: no title of its own and nothing in it. */
export function isEmpty(n: { title?: unknown; html?: unknown }): boolean {
  const t = String(n.title ?? '').trim();
  return (!t || t === 'Note') && plainOf(String(n.html ?? '')).length === 0;
}

/** What a person would call the note's content: compared to tell a real change from a stamp. */
export const contentKey = (n: Pick<Note, 'title' | 'html' | 'cat' | 'deleted'>) => JSON.stringify([n.title, n.html, n.cat ?? '', n.deleted ? 1 : 0]);

/**
 * Any note-shaped thing as a Note (the companion's file, a page, the other machine), every field checked: the old
 * colour dropped, sizes from S/M/L or 10..28 px, the source, place, anchor and reminder each checked again. Null for
 * something that is not a note (no id of the right shape).
 */
export function tidyNote(raw: unknown, fallback: { dev: Dev; now: number }): Note | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== 'string' || !ID_RE.test(n.id)) return null;
  const cat = cleanCat(n.cat);
  const font = (FONTS as readonly string[]).includes(String(n.font)) ? String(n.font) : 'figtree';
  const px = Number(n.size);
  const size = (SIZES as readonly string[]).includes(String(n.size)) ? String(n.size) : Number.isInteger(px) && px >= 10 && px <= 28 ? String(px) : 'm';
  const updated = Number.isFinite(Number(n.updated)) && Number(n.updated) > 0 ? Number(n.updated) : fallback.now;
  const created = Number.isFinite(Number(n.created)) && Number(n.created) > 0 ? Math.min(Number(n.created), updated) : updated;
  const tsize = Number(n.tsize);
  const src = cleanSrc(n.src), place = cleanPlace(n.place), anchor = cleanAnchor(n.anchor), remind = cleanRemind(n.remind);
  const deleted = Number(n.deleted);
  return {
    id: n.id, title: String(n.title ?? '').replace(/[<>]/g, '').slice(0, 60) || 'Note', html: cleanHtml(n.html), font, size,
    ...(cat ? { cat } : {}),
    ...((FONTS as readonly string[]).includes(String(n.tfont)) ? { tfont: String(n.tfont) } : {}),
    ...(Number.isInteger(tsize) && tsize >= 10 && tsize <= 28 ? { tsize: String(tsize) } : {}),
    ...(src ? { src } : {}), ...(place ? { place } : {}), ...(anchor ? { anchor } : {}), ...(remind ? { remind } : {}),
    ...(n.notice === false ? { notice: false as const } : {}),
    created, updated,
    dev: n.dev === 'mac' || n.dev === 'pc' ? n.dev : fallback.dev,
    stamp: isStamp(n.stamp) ? n.stamp : '',
    hist: Array.isArray(n.hist) ? n.hist.filter(isStamp).slice(0, HIST) : [],
    ...(Number.isFinite(deleted) && deleted > 0 ? { deleted } : {}),
    ...(typeof n.conflictOf === 'string' && ID_RE.test(n.conflictOf) ? { conflictOf: n.conflictOf } : {}),
  };
}

/** A fresh id: `n`, the time, a little chance. The same shape the companion used, so its ids stay valid. */
export function newId(now = Date.now(), rand: () => number = Math.random): string {
  return `n${now.toString(36)}${Math.floor(rand() * 46656).toString(36)}`;
}

/** The first few words, for a title when he gave none (a quick note, a note made from the rail). */
export function titleFrom(html: string, words = 4): string {
  const first = plainOf(html).join(' ').replace(/ \(done\)/g, '');
  return first.split(' ').slice(0, words).join(' ').slice(0, 60) || 'Note';
}

/** A note as Markdown with a little front matter: for Export, and for Claude. */
export function toMarkdown(n: Note): string {
  const fm = [`title: ${JSON.stringify(n.title)}`, ...(n.cat ? [`category: ${JSON.stringify(n.cat)}`] : []), `created: ${new Date(n.created).toISOString()}`,
    `updated: ${new Date(n.updated).toISOString()}`, ...(n.src ? [`source: ${n.src.url}`] : []), ...(n.anchor ? [`quote: ${JSON.stringify(n.anchor.exact)}`] : [])];
  const clean = cleanHtml(n.html);
  const body: string[] = [];
  for (const m of clean.matchAll(/<(div|li|h3)(?: class="(cl(?: done)?)")?>([\s\S]*?)<\/\1>|<br>/g)) {
    if (m[0] === '<br>') { body.push(''); continue; }
    const text = unesc(m[3]!.replace(/<b>|<\/b>/g, '**').replace(/<i>|<\/i>/g, '_').replace(/<[^>]+>/g, '')).trim();
    if (!text) continue;
    body.push(m[1] === 'h3' ? `### ${text}` : m[2] === 'cl done' ? `- [x] ${text}` : m[2] === 'cl' ? `- [ ] ${text}` : m[1] === 'li' ? `- ${text}` : text);
  }
  if (!body.length) body.push(...plainOf(n.html));
  return `---\n${fm.join('\n')}\n---\n\n# ${n.title}\n\n${body.join('\n')}\n`;
}

// ------------------------------------------------------------------ N1: finding a note

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * His notes for what he typed (the board's search): every word he typed must start a word in the note (its title, its
 * words, its category or the site it came from), so "oat mi" finds "buy oat milk". A title hit counts more than one in
 * the words. Best first, then newest. With nothing typed: newest first. Small and local on purpose: a few thousand notes
 * at most, searched in a millisecond, and nothing new to install.
 */
export function searchNotes<T extends Pick<Note, 'title' | 'html' | 'cat' | 'src' | 'updated'>>(notes: T[], q: string): T[] {
  const want = words(String(q ?? '').slice(0, 200)).slice(0, 12);
  if (!want.length) return [...notes].sort((a, b) => b.updated - a.updated);
  const scored: { n: T; s: number }[] = [];
  for (const n of notes) {
    const title = words(n.title === 'Note' ? '' : n.title), body = words(plainOf(n.html).join(' ')), more = words(`${n.cat ?? ''} ${n.src?.site ?? ''}`);
    let s = 0;
    for (const w of want) {
      const t = title.some((x) => x.startsWith(w)) ? 3 : 0;
      const b = body.some((x) => x.startsWith(w)) ? 1 : 0;
      const m = more.some((x) => x.startsWith(w)) ? 1 : 0;
      if (!t && !b && !m) { s = -1; break; }
      s += t + b + m + (title.includes(w) || body.includes(w) ? 0.5 : 0);
    }
    if (s > 0) scored.push({ n, s });
  }
  return scored.sort((a, b) => b.s - a.s || b.n.updated - a.n.updated).map((x) => x.n);
}
