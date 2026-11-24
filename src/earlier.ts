// Phase R (2026-11-24): Earlier, the tabs the overnight tidy put away (and the trails, done shelf and Stash of before).
// One file, browser-earlier.json, owned here. Nothing in it is ever thrown away unless he removes it himself; the list
// is capped only far past anything a person keeps (the oldest go past MAX), so the file stays small.
import { existsSync } from 'node:fs';
import { writeFileAtomic } from './atomic.ts';
import { osKeeper, readSealed, sealText, Unreadable, type Keeper } from './sealedfile.ts';
import { joinEarlier, type EarlierEntry } from './rail.ts';

/** Far past what a person keeps; only the very oldest go past it. */
export const EARLIER_MAX = 2000;

interface EarlierFile { v: 1; entries: EarlierEntry[]; gone: Record<string, number>; lastTidy: number; migrated?: boolean }

const clean = (e: Partial<EarlierEntry>): EarlierEntry | null => {
  if (typeof e?.key !== 'string' || typeof e.url !== 'string' || !/^https?:/i.test(e.url) || !Number.isFinite(e.at)) return null;
  return { key: e.key.slice(0, 40), url: e.url.slice(0, 4000), title: String(e.title ?? e.url).slice(0, 300), at: Number(e.at),
    ...(typeof e.favicon === 'string' && /^(https:|data:image\/)/.test(e.favicon) && e.favicon.length < 4000 ? { favicon: e.favicon } : {}),
    ...(Number(e.scrollY) > 0 ? { scrollY: Math.round(Number(e.scrollY)) } : {}),
    ...(Number.isFinite(e.zoom) && e.zoom ? { zoom: Number(e.zoom) } : {}),
    ...(typeof e.from === 'string' && e.from ? { from: e.from.slice(0, 80) } : {}) };
};

export class EarlierStore {
  private d: EarlierFile = { v: 1, entries: [], gone: {}, lastTidy: 0 };
  readonly file: string;
  private readonly onChange: () => void;
  private readonly keeper: Keeper;
  /** Phase 1: sealed, and this computer's key would not open it: nothing is written over it this run. */
  locked = false;
  constructor(file: string, onChange: () => void = () => {}, keeper: Keeper = osKeeper) {
    this.file = file; this.onChange = onChange; this.keeper = keeper;
    try {
      if (!existsSync(file)) return;
      let s: Partial<EarlierFile> | null;
      try { s = readSealed<Partial<EarlierFile>>(file, keeper); } catch (e) { if (e instanceof Unreadable) { this.locked = true; this.d.migrated = true; console.error('shell: Earlier is ' + e.message + '; it is left as it is'); return; } throw e; }
      if (!s || typeof s !== 'object') return;
      this.d.entries = (Array.isArray(s.entries) ? s.entries : []).map(clean).filter((x): x is EarlierEntry => x !== null);
      this.d.gone = s.gone && typeof s.gone === 'object' ? Object.fromEntries(Object.entries(s.gone).filter(([, v]) => Number.isFinite(v))) : {};
      this.d.lastTidy = Number(s.lastTidy) || 0;
      this.d.migrated = s.migrated === true;
    } catch { /* a broken file starts empty; the tabs file is untouched */ }
  }

  get entries(): readonly EarlierEntry[] { return this.d.entries; }
  get lastTidy(): number { return this.d.lastTidy; }
  get migrated(): boolean { return this.d.migrated === true; }
  get gone(): Readonly<Record<string, number>> { return this.d.gone; }

  /** Put entries away (newest first). The same key twice is kept once. */
  add(list: readonly EarlierEntry[]): void {
    if (!list.length) return;
    this.d.entries = joinEarlier(list.map(clean).filter((x): x is EarlierEntry => x !== null), this.d.entries).slice(0, EARLIER_MAX);
    for (const e of list) delete this.d.gone[e.key];
    this.save();
  }
  /** Take one out (he opened it, or removed it): it is gone on every machine. */
  take(key: string): EarlierEntry | null {
    const i = this.d.entries.findIndex((e) => e.key === key);
    if (i < 0) return null;
    const [e] = this.d.entries.splice(i, 1);
    this.d.gone[key] = Date.now();
    this.save();
    return e!;
  }
  tidied(at: number): void { this.d.lastTidy = at; this.save(); }
  markMigrated(): void { this.d.migrated = true; this.save(); }
  /** The other machine's list (sync): joined by key, deletions on either side kept. */
  join(entries: readonly EarlierEntry[], gone: Readonly<Record<string, number>>): boolean {
    const g = { ...this.d.gone };
    for (const [k, v] of Object.entries(gone ?? {})) if (Number.isFinite(v) && v > (g[k] ?? 0)) g[k] = v;
    const next = joinEarlier(this.d.entries, entries.map(clean).filter((x): x is EarlierEntry => x !== null), g).slice(0, EARLIER_MAX);
    if (JSON.stringify(next) === JSON.stringify(this.d.entries) && JSON.stringify(g) === JSON.stringify(this.d.gone)) return false;
    this.d.entries = next; this.d.gone = g;
    this.save(false);
    return true;
  }
  private save(tell = true): void {
    // Tombstones older than 60 days have reached every machine by now.
    const old = Date.now() - 60 * 86_400_000;
    for (const [k, v] of Object.entries(this.d.gone)) if (v < old) delete this.d.gone[k];
    if (this.locked) { if (tell) this.onChange(); return; }
    try { writeFileAtomic(this.file, sealText(JSON.stringify(this.d), this.keeper)); } catch { /* best effort; kept in memory */ }
    if (tell) this.onChange();
  }
}
