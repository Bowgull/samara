// Phase 4 (2026-11-24): canary releases. A new Samara goes to the PC first and to the Mac after a quiet day there.
// For its first day on a machine, a new version is watched by the flight recorder:
//   - Samara itself closed unexpectedly while on it,
//   - Samara's own pages (the band, the rail, its panels) crashed or stopped answering twice,
//   - a helper process (the GPU, the network, audio) crashed three times.
// Any of those and it is turned back: the version before comes back at the next start, this one is not offered again,
// and the other machine is told, so the Mac never takes it. A day with none of them, and it is good: the Mac may take it
// straight away instead of waiting out its day. Websites crashing are not counted: sites crash for their own reasons.
import { readJson, saveJson } from './store.ts';

export const WATCH_MS = 24 * 60 * 60_000;
/** How long the Mac waits after a release before it takes it, unless the PC said good sooner. */
export const MAC_WAIT_MS = 24 * 60 * 60_000;

export type Verdict = 'watching' | 'good' | 'bad';
export interface Watch { version: string; since: number; unclean: number; own: number; helpers: number; verdict?: 'good' | 'bad'; why?: string }

/** The rule, pure. */
export function verdictOf(w: Watch, now: number): { v: Verdict; why?: string } {
  if (w.verdict) return { v: w.verdict, ...(w.why ? { why: w.why } : {}) };
  if (w.unclean >= 1) return { v: 'bad', why: 'Samara closed unexpectedly on it' };
  if (w.own >= 2) return { v: 'bad', why: "Samara's own pages crashed or stopped answering twice" };
  if (w.helpers >= 3) return { v: 'bad', why: 'a helper process crashed three times' };
  if (now - w.since >= WATCH_MS) return { v: 'good' };
  return { v: 'watching' };
}

/** Is a page Samara's own (its band, rail and panels are files or its page server), not a website? */
export function ownPage(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'file:' || u.hostname === '127.0.0.1' || u.hostname === 'localhost'; } catch { return true; }
}
/** A helper process that died badly (not one closed on purpose). */
export const helperCrashed = (reason: string): boolean => /crashed|oom|launch-failed|abnormal-exit|integrity-failure/.test(reason);

export class Canary {
  private w: Watch | null;
  private readonly file: string;
  private readonly now: () => number;
  /**
   * `version`: the version running, '' when this is not an installed release (then nothing is watched).
   * `unclean`: the flight recorder found the last run did not close cleanly. It counts only when that last run was this
   * same version under watch.
   */
  constructor(o: { file: string; version: string; unclean: boolean; now?: () => number }) {
    this.file = o.file; this.now = o.now ?? Date.now;
    if (!o.version) { this.w = null; return; }
    const had = readJson<Watch | null>(o.file, null);
    if (had && had.version === o.version) {
      this.w = had;
      if (o.unclean && !had.verdict) { this.w.unclean++; this.save(); }
    } else {
      this.w = { version: o.version, since: this.now(), unclean: 0, own: 0, helpers: 0 };
      this.save();
    }
  }
  get version(): string { return this.w?.version ?? ''; }
  /** The verdict already reached on this version (from an earlier run), to tell the other machine again. */
  given(): 'good' | 'bad' | null { return this.w?.verdict ?? null; }
  private save(): void { if (this.w) saveJson(this.file, this.w); }
  /** Every verdict this machine reached, kept apart from the watch (which a turned-back version's predecessor replaces
   *  at the next start), so the other machine can always be told again, the bad ones above all. */
  private get historyFile(): string { return this.file.replace(/\.json$/, '') + '-verdicts.json'; }
  history(): Record<string, 'good' | 'bad'> {
    const h = readJson<Record<string, string>>(this.historyFile, {}) ?? {};
    return Object.fromEntries(Object.entries(h).filter((e): e is [string, 'good' | 'bad'] => e[1] === 'good' || e[1] === 'bad'));
  }
  private remember(v: string, verdict: 'good' | 'bad'): void {
    const h = this.history();
    if (h[v] === 'bad') return;
    h[v] = verdict;
    saveJson(this.historyFile, Object.fromEntries(Object.entries(h).slice(-50)));
  }
  /** Something went wrong; counted only while the version is still being watched. */
  record(kind: 'own' | 'helper'): void {
    if (!this.w || this.w.verdict || this.now() - this.w.since >= WATCH_MS) return;
    if (kind === 'own') this.w.own++; else this.w.helpers++;
    this.save();
  }
  /** The verdict, once, when it is reached (then kept); null while watching or when it was already given. */
  settle(): { v: 'good' | 'bad'; version: string; why?: string } | null {
    if (!this.w || this.w.verdict) return null;
    const r = verdictOf(this.w, this.now());
    if (r.v === 'watching') return null;
    this.w.verdict = r.v; if (r.why) this.w.why = r.why;
    this.save();
    this.remember(this.w.version, r.v);
    return { v: r.v, version: this.w.version, ...(r.why ? { why: r.why } : {}) };
  }
}

/** What the other machine said about versions it ran first: { "1.31.0": "good" }. */
export class PeerVerdicts {
  private readonly file: string;
  constructor(file: string) { this.file = file; }
  get(v: string): 'good' | 'bad' | null { const m = readJson<Record<string, string>>(this.file, {}) ?? {}; return m[v] === 'good' || m[v] === 'bad' ? m[v] : null; }
  set(v: string, verdict: 'good' | 'bad'): void {
    if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v)) return;
    const m = readJson<Record<string, string>>(this.file, {}) ?? {};
    if (m[v] === 'bad') return;   // bad stays bad
    m[v] = verdict;
    const keep = Object.entries(m).slice(-50);
    saveJson(this.file, Object.fromEntries(keep));
  }
}

/** Should the Mac take release `v`, published at `at` (ms)? Never when the PC said bad; at once when it said good; else
 *  after its day. His own "Check for updates" skips the wait, never the bad. */
export function macMayTake(peer: 'good' | 'bad' | null, at: number, now: number, byHand: boolean): boolean {
  if (peer === 'bad') return false;
  if (peer === 'good' || byHand) return true;
  return !Number.isFinite(at) || now - at >= MAC_WAIT_MS;
}
