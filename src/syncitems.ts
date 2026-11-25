// Phase 3 (2026-11-24): bookmarks and settings merge ITEM BY ITEM between the two machines, with deletion markers,
// instead of the newer whole list replacing the other. A bookmark added on the Mac and a setting changed on the PC
// while apart both survive; one removed on either side stays removed (it does not come back from the other).
//
// Each item (one bookmark, one setting, one site on a list) carries the time it last changed here, and a removal
// leaves a marker with its time. When the two meet, each item goes the newer way. Equal times (rare) are settled the
// same way on both machines, so both always end the same. Pure, so it is tested without the sync around it.
import { createHash } from 'node:crypto';
import type { Mark } from './bookmarks.ts';

/** What this machine knows about each item: when it last changed, a fingerprint of its value, or that it is gone. */
export type Items = Record<string, { at: number; h: string; gone?: true }>;
/** An item as it travels. */
export type WireItem = { at: number; v?: unknown; gone?: true };
export type Wire = Record<string, WireItem>;

/** Removal markers older than this are forgotten: by then both machines have long agreed. */
export const GONE_KEEP_MS = 60 * 86_400_000;

const sig = (v: unknown): string => createHash('sha256').update(JSON.stringify(v ?? null)).digest('base64').slice(0, 16);

/**
 * Brings the record up to date with what this machine has now: an item that is new or different gets `at`, one that
 * disappeared gets a removal marker at `at`. Returns true when anything changed.
 */
export function restamp(items: Items, flat: Record<string, unknown>, at: number): boolean {
  let any = false;
  for (const [k, v] of Object.entries(flat)) {
    const h = sig(v), was = items[k];
    if (!was || was.gone || was.h !== h) { items[k] = { at: Math.max(at, (was?.at ?? -1) + 1), h }; any = true; }
  }
  for (const [k, was] of Object.entries(items)) if (!was.gone && !(k in flat)) { items[k] = { at: Math.max(at, was.at + 1), h: '', gone: true }; any = true; }
  return any;
}

/** Forget removal markers older than `GONE_KEEP_MS`. */
export function prune(items: Items, now: number): void {
  for (const [k, v] of Object.entries(items)) if (v.gone && v.at < now - GONE_KEEP_MS) delete items[k];
}

/** What travels: every item this machine knows, with its value, or its removal marker. */
export function toWire(items: Items, flat: Record<string, unknown>): Wire {
  const w: Wire = {};
  for (const [k, v] of Object.entries(items)) w[k] = v.gone ? { at: v.at, gone: true } : { at: v.at, v: flat[k] };
  return w;
}

/** Does the other machine's item win over ours? Newer wins; at the same time, the same answer on both machines. */
function wins(theirs: WireItem, mine: Items[string] | undefined): boolean {
  if (!mine) return true;
  if (theirs.at !== mine.at) return theirs.at > mine.at;
  const th = theirs.gone ? '' : sig(theirs.v), mh = mine.gone ? '' : mine.h;
  return th > mh;
}

/** The other machine's items joined into ours (flat and items are changed in place). True when anything changed here. */
export function joinWire(items: Items, flat: Record<string, unknown>, theirs: Wire): boolean {
  let any = false;
  for (const [k, t] of Object.entries(theirs ?? {})) {
    if (!t || typeof t !== 'object' || !Number.isFinite(t.at)) continue;
    if (!wins(t, items[k])) continue;
    if (t.gone) {
      if (k in flat) { delete flat[k]; any = true; }
      items[k] = { at: t.at, h: '', gone: true };
    } else {
      const h = sig(t.v);
      if (!(k in flat) || sig(flat[k]) !== h) { flat[k] = t.v; any = true; }
      items[k] = { at: t.at, h };
    }
  }
  return any;
}

// ---------------------------------------------------------------- bookmarks
/** Bookmarks as items, one per address (the first of two with the same address wins, as the bookmarks bar does). */
export function flatMarks(list: Mark[]): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const m of list) if (m && typeof m.url === 'string' && !(('m.' + m.url) in f)) f['m.' + m.url] = { title: m.title, folder: m.folder };
  return f;
}
/** Back to a list: in `order` (the newer side's order of addresses), then any others in the order they come. */
export function unflatMarks(flat: Record<string, unknown>, order: string[]): Mark[] {
  const out: Mark[] = [], seen = new Set<string>();
  const put = (url: string) => {
    const v = flat['m.' + url] as { title?: unknown; folder?: unknown } | undefined;
    if (!v || seen.has(url)) return;
    seen.add(url); out.push({ title: String(v.title ?? url), url, folder: String(v.folder ?? '') });
  };
  for (const u of order) put(u);
  for (const k of Object.keys(flat)) if (k.startsWith('m.')) put(k.slice(2));
  return out;
}

// ---------------------------------------------------------------- settings
/** The lists of sites inside the settings, merged site by site. */
const SITE_LISTS = ['popupOk', 'trusted', 'httpOk', 'adsPaused'];
/**
 * Settings as items: each setting on its own; each site on a list on its own; each site's rules on their own. Earlier
 * is left out: it has its own join with its own removal markers (earlier.ts) and travels as it is.
 */
export function flatPrefs(p: Record<string, unknown>): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (k !== 'lists') { f['p.' + k] = v; continue; }
    const L = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    for (const [name, list] of Object.entries(L)) {
      if (name === 'earlier') continue;
      if (SITE_LISTS.includes(name) && Array.isArray(list)) { for (const h of list) if (typeof h === 'string') f[`l.${name}.${h}`] = true; }
      else if (name === 'siteRules' && list && typeof list === 'object' && !Array.isArray(list)) { for (const [h, r] of Object.entries(list)) f['r.' + h] = r; }
      else f['x.' + name] = list;
    }
  }
  return f;
}
/** Back to settings. `lists`: this browser keeps lists (then every site list is there, empty when its last site went,
 *  so a removal reaches the browser). `earlier` travels as it came. */
export function unflatPrefs(flat: Record<string, unknown>, o: { lists: boolean; earlier?: unknown }): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const lists: Record<string, unknown> = Object.fromEntries(SITE_LISTS.map((n) => [n, [] as string[]]));
  const rules: Record<string, unknown> = {};
  let any = o.lists;
  for (const [k, v] of Object.entries(flat)) {
    if (k.startsWith('p.')) p[k.slice(2)] = v;
    else if (k.startsWith('l.')) { const rest = k.slice(2), dot = rest.indexOf('.'); const name = rest.slice(0, dot); if (SITE_LISTS.includes(name)) { (lists[name] as string[]).push(rest.slice(dot + 1)); any = true; } }
    else if (k.startsWith('r.')) { rules[k.slice(2)] = v; any = true; }
    else if (k.startsWith('x.')) { lists[k.slice(2)] = v; any = true; }
  }
  if (any) { lists.siteRules = rules; if (o.earlier !== undefined) lists.earlier = o.earlier; p.lists = lists; }
  return p;
}
