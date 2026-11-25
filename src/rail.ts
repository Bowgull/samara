// Phase R (2026-11-24, his pick: "A · Tabs + auto-tidy"): the rail's rules, kept pure so they are tested without
// Electron. Trails are retired. The rail is a pinned row, then today's tabs (newest first), then Claude's tabs (their own
// box, as before), then Earlier: tabs he has not touched in a while, moved out of the way overnight, searchable, never
// thrown away unless he does it.
//
// What lives here: when a tab fades, when the overnight move happens, which tabs move, the order of the rail, where the
// focus goes when a tab closes, Earlier's day groups and search, and the one-time move of trails, the done shelf and the
// Stash into Earlier.

/** A tab untouched this long fades and is marked TONIGHT (his default, 2026-11-24: 12 hours, Arc's number). */
export const IDLE_MS = 12 * 60 * 60_000;
/** The overnight move happens at this local hour (3 AM: he is asleep, and both machines are usually on). */
export const TIDY_HOUR = 3;

/** What the rules need of a tab. */
export interface RailTab {
  id: number;
  /** When he last had it in front (ms). */
  lastSeen: number;
  pinned?: boolean;
  /** Playing sound, or in a call: never moved. */
  audible?: boolean;
  call?: boolean;
  /** Held by a Claude job: in Claude's box, never moved by the tidy. */
  claudeJob?: number | null;
  /** The browser's own pages (Settings, Your things, the quest log, Hyrule): never moved. */
  internal?: string;
  /** The tab it was opened from (null for one he opened himself). */
  opener: number | null;
}

/** One tab put away in Earlier: enough to bring it back where it was. */
export interface EarlierEntry {
  /** Stable across machines (sync keys on it). */
  key: string;
  url: string;
  title: string;
  favicon?: string;
  scrollY?: number;
  zoom?: number;
  /** When it went to Earlier (ms): the day it is grouped under. */
  at: number;
  /** Where it came from, for the one line under its title ('trail: Zora armor', 'done shelf', 'stash'). */
  from?: string;
}

/** Never moved by the tidy: pinned, playing, in a call, a Claude job's, or one of the browser's own pages. */
export function staysPut(t: RailTab, activeId: number | null): boolean {
  return Boolean(t.pinned || t.audible || t.call || t.claudeJob != null || t.internal) || t.id === activeId;
}

/** Faded: untouched for IDLE_MS and not one that stays put. It shows TONIGHT and goes at the next tidy. */
export function fading(t: RailTab, now: number, activeId: number | null): boolean {
  return !staysPut(t, activeId) && now - t.lastSeen >= IDLE_MS;
}

/** The next overnight move after `now`, in local time (TIDY_HOUR today if still ahead, else tomorrow). */
export function nextTidy(now: number): number {
  const d = new Date(now);
  d.setHours(TIDY_HOUR, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Whether a tidy is due: the last one ran before the most recent TIDY_HOUR that has passed. So a Samara that was shut at
 * 3 AM tidies on its next start, once, and never twice the same night.
 */
export function tidyDue(lastTidy: number, now: number): boolean {
  const d = new Date(now);
  d.setHours(TIDY_HOUR, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return lastTidy < d.getTime();
}

/** The tabs the overnight move takes: every faded one, oldest first. */
export function toPutAway(tabs: readonly RailTab[], now: number, activeId: number | null): number[] {
  return tabs.filter((t) => fading(t, now, activeId)).sort((a, b) => a.lastSeen - b.lastSeen).map((t) => t.id);
}

/**
 * The rail's order: pinned (as he arranged them), then today's tabs newest opened first; Claude's are drawn apart.
 * `tabs` is in the order they were opened (a link's tab right after its page), so newest first is that order reversed.
 * Never by when he last looked: a tab must not jump to the top because he clicked it.
 */
export function railOrder(tabs: readonly RailTab[]): { pinned: number[]; today: number[]; claude: number[] } {
  const pinned = tabs.filter((t) => t.pinned && t.claudeJob == null).map((t) => t.id);
  const claude = tabs.filter((t) => t.claudeJob != null).map((t) => t.id);
  const today = tabs.filter((t) => !t.pinned && t.claudeJob == null).map((t) => t.id).reverse();
  return { pinned, today, claude };
}

/**
 * Where the focus goes when the tab in front closes (Firefox's rule): back to the tab that opened it if that is still
 * open, else the one he used most recently, else nothing. `open` is the tabs still open after the close.
 */
export function afterClose(closed: RailTab, open: readonly RailTab[]): number | null {
  if (closed.opener != null && open.some((t) => t.id === closed.opener)) return closed.opener;
  const rest = open.filter((t) => t.id !== closed.id && !t.internal);
  if (!rest.length) return open.find((t) => t.id !== closed.id)?.id ?? null;
  return rest.reduce((a, b) => (b.lastSeen > a.lastSeen ? b : a)).id;
}

/** The words a search matches: title and address, any case, every word he typed somewhere in them. */
export function matches(e: EarlierEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${e.title} ${e.url} ${e.from ?? ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The day heading for a time: TODAY, YESTERDAY, the weekday within a week, else the date. */
export function dayLabel(at: number, now: number): string {
  const day = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff <= 0) return 'TODAY';
  if (diff === 1) return 'YESTERDAY';
  const d = new Date(at);
  if (diff < 7) return d.toLocaleDateString('en-CA', { weekday: 'long' }).toUpperCase();
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) }).toUpperCase();
}

/** Earlier as he sees it: newest first, filtered by his search, in day groups. */
export function earlierGroups(entries: readonly EarlierEntry[], now: number, query = ''): { day: string; items: EarlierEntry[] }[] {
  const out: { day: string; items: EarlierEntry[] }[] = [];
  for (const e of [...entries].filter((x) => matches(x, query)).sort((a, b) => b.at - a.at)) {
    const day = dayLabel(e.at, now);
    const g = out[out.length - 1];
    if (g && g.day === day) g.items.push(e); else out.push({ day, items: [e] });
  }
  return out;
}

/** A key for an entry: the address and when it was put away, so the same page put away twice is two entries. */
export function entryKey(url: string, at: number): string {
  let h = 2166136261;
  for (const c of `${url}|${at}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `e${(h >>> 0).toString(36)}${at.toString(36)}`;
}

/** The tab file as it was before Phase R (browser-tabs.json v1), as far as the move needs it. */
export interface V1File {
  tabs: { url: string; title?: string; favicon?: string; scrollY?: number; zoom?: number; trail?: number | null; done?: boolean; lastSeen?: number }[];
  trails?: { id: number; name?: string; at?: number; usedAt?: number }[];
  /** The Stash: trails put away, each with its pages. */
  stash?: { name?: string; at?: number; tabs: { url: string; title?: string }[] }[];
}

/**
 * The one-time move (Phase R): tabs in a trail and tabs on the done shelf go to Earlier, under the trail's name; loose
 * open tabs stay in Today; the Stash's entries go to Earlier as they are. Nothing is dropped. Returns the tabs that stay
 * open (by index into v1.tabs) and the new Earlier entries; `now` dates entries that carry no time of their own.
 */
export function migrateV1(v1: V1File, now: number): { keep: number[]; earlier: EarlierEntry[] } {
  const trailName = new Map((v1.trails ?? []).map((t) => [t.id, t.name?.trim() || 'a trail']));
  const trailAt = new Map((v1.trails ?? []).map((t) => [t.id, t.usedAt ?? t.at ?? 0]));
  const keep: number[] = [];
  const earlier: EarlierEntry[] = [];
  v1.tabs.forEach((t, i) => {
    // The MOCKUPS trail (-1, sheet 47) is the mockup sheets' own place, not his: it stays as it is.
    const inTrail = t.trail != null && t.trail !== -1 && trailName.has(t.trail);
    if (!inTrail && !t.done) { keep.push(i); return; }
    const at = t.lastSeen || (t.trail != null ? trailAt.get(t.trail) : 0) || now;
    earlier.push({ key: entryKey(t.url, at), url: t.url, title: t.title || t.url, ...(t.favicon ? { favicon: t.favicon } : {}),
      ...(t.scrollY ? { scrollY: t.scrollY } : {}), ...(t.zoom ? { zoom: t.zoom } : {}), at,
      from: t.done ? 'done shelf' : `trail: ${trailName.get(t.trail!)}` });
  });
  for (const s of v1.stash ?? []) {
    const at = s.at || now;
    for (const t of s.tabs ?? []) earlier.push({ key: entryKey(t.url, at), url: t.url, title: t.title || t.url, at, from: s.name ? `stash: ${s.name}` : 'stash' });
  }
  return { keep, earlier };
}

/**
 * Two machines' Earlier lists as one (sync): every entry either side has, by key; an entry one side deleted (a
 * tombstone: key with `gone` time) stays deleted on both, unless the other side put it away again later.
 */
export function joinEarlier(a: readonly EarlierEntry[], b: readonly EarlierEntry[], gone: Readonly<Record<string, number>> = {}): EarlierEntry[] {
  const by = new Map<string, EarlierEntry>();
  for (const e of [...a, ...b]) if (!by.has(e.key)) by.set(e.key, e);
  return [...by.values()].filter((e) => !(gone[e.key] && gone[e.key]! >= e.at)).sort((x, y) => y.at - x.at);
}
