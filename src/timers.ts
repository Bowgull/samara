// Timers in Samara (T1, 2026-11-25, his "build it": the old companion is retired, its tools are Samara's). The store of a
// timer and nothing else: what a timer is, how long one may run, and what each of its keys does to it. timerswire.ts rings
// them and timerwin.ts puts each one on the screen as its own little hourglass.
//
// Ported from the companion's timers.ts (sheet 17, sheet 67 v2 + 67b) so a timer behaves exactly as he knows it: five at
// most, each in its own sand colour, +1 / +5 / scroll, pause, turn it over, rename, and a finished one stays until he
// answers it (or ten minutes). Kept on disk, so quitting Samara or restarting the computer mid-timer does not lose it; one
// that ran out while Samara was closed goes off as soon as it is back.
import { writeFileAtomic } from './atomic.ts';
import { readJson } from './store.ts';

/** Each timer has its own sand colour. Blue first; new timers take the next one free. */
export const COLOURS = ['blue', 'gold', 'rose', 'jade', 'violet'] as const;
export type Colour = typeof COLOURS[number];
export const isColour = (c: unknown): c is Colour => typeof c === 'string' && (COLOURS as readonly string[]).includes(c);

/** `done`: when it ran out. A finished timer stays on the list so its hourglass shows the end until he answers it. */
export interface Timer { id: string; label: string; total: number; end: number; paused: number; colour?: Colour; done?: number }

/** At most this many at once: each one is a little hourglass on his screen (one per sand colour). */
export const MAX_TIMERS = 5;
/** A finished timer waits this long for Again / +5 / close, then goes by itself. */
export const DONE_KEEP_MS = 10 * 60_000;
/** Scrolling or -1 never takes a timer below this. */
export const MIN_LEFT_MS = 10_000;
/** Shortest and longest timer (longer than a day is a reminder: a note's reminder does that). */
export const MIN_MS = 1000;
export const MAX_MS = 24 * 3_600_000;

export type TimerAction = 'add' | 'pause' | 'stop' | 'again' | 'rename' | 'colour';
export const TIMER_ACTIONS: readonly TimerAction[] = ['add', 'pause', 'stop', 'again', 'rename', 'colour'];
export const isTimerAction = (a: unknown): a is TimerAction => typeof a === 'string' && (TIMER_ACTIONS as readonly string[]).includes(a);

/** A name as it is kept: one line, 40 characters at most. */
export const tidyLabel = (s: unknown): string => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

/**
 * A time typed in the Custom box: "25" = minutes, "1:30" = minutes and seconds, "1h 20m", "90s". Null unless it is
 * 10 seconds to 24 hours.
 */
export function parseCustom(raw: unknown): number | null {
  const s = String(raw ?? '').trim().toLowerCase();
  let ms: number | null = null, m: RegExpExecArray | null;
  if ((m = /^(\d{1,3}):(\d{1,2})$/.exec(s))) ms = (Number(m[1]) * 60 + Number(m[2])) * 1000;
  else if (/^\d+(\.\d+)?$/.test(s)) ms = Number(s) * 60_000;
  else if (/^(\d+(\.\d+)?\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\s*)+$/.test(s)) {
    ms = 0; for (const x of s.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/g)) ms += Number(x[1]) * (x[2] === 'h' ? 3_600_000 : x[2] === 'm' ? 60_000 : 1000);
  }
  return ms !== null && ms >= MIN_LEFT_MS && ms <= MAX_MS ? Math.round(ms) : null;
}

/** "25 minutes", "1 hour 5 minutes", "90 seconds": how a duration is said back to him. */
export function sayDuration(ms: number): string {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  const part = (n: number, w: string) => n ? `${n} ${w}${n === 1 ? '' : 's'}` : '';
  return [part(h, 'hour'), part(m, 'minute'), h ? '' : part(sec, 'second')].filter(Boolean).join(' ') || '0 seconds';
}

const valid = (x: unknown): x is Timer => {
  const t = x as Timer;
  return !!t && typeof t === 'object' && typeof t.id === 'string' && /^t[a-z0-9]{1,24}$/.test(t.id) && typeof t.label === 'string'
    && Number.isFinite(t.end) && Number.isFinite(t.total) && t.total >= MIN_MS && t.total <= MAX_MS && Number.isFinite(t.paused) && t.paused >= 0
    && (t.done === undefined || Number.isFinite(t.done)) && (t.colour === undefined || isColour(t.colour));
};

export class Timers {
  private all: Timer[] = [];
  private seq = 0;
  private readonly file: string;
  constructor(file: string) {
    this.file = file;
    this.all = readJson<Timer[]>(file, [], (raw) => Array.isArray(raw) ? raw.filter(valid).slice(0, MAX_TIMERS).map((t) => ({ ...t, label: tidyLabel(t.label) })) : null);
  }
  list(): Timer[] { return this.all.map((t) => ({ ...t })); }
  get(id: string): Timer | null { const t = this.all.find((x) => x.id === id); return t ? { ...t } : null; }
  private running(): Timer[] { return this.all.filter((t) => !t.done); }
  /** The next colour: blue, then whichever of the five no other timer on screen has, in order. */
  private nextColour(): Colour {
    const used = new Set(this.all.map((t) => t.colour));
    return COLOURS.find((c) => !used.has(c)) ?? COLOURS[this.all.length % COLOURS.length]!;
  }
  /** A new timer, or null when five are already running (or the time is out of range). */
  start(ms: number, label: unknown, now = Date.now(), colour?: unknown): Timer | null {
    if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_MS) return null;
    if (this.running().length >= MAX_TIMERS) return null;
    // finished ones make room for a new one (oldest first), so a finished plate never blocks a new timer
    while (this.all.length >= MAX_TIMERS) { const i = this.all.findIndex((t) => t.done); if (i < 0) break; this.all.splice(i, 1); }
    const t: Timer = { id: `t${now.toString(36)}${(++this.seq).toString(36)}`, label: tidyLabel(label), total: Math.round(ms), end: now + Math.round(ms), paused: 0,
      colour: isColour(colour) ? colour : this.nextColour() };
    this.all.push(t); this.save(); return { ...t };
  }
  /**
   * The hourglass's keys: add (ms, default +1 min; minus too, never under 10 s), pause / go on, stop, again (turned over:
   * the same time, or `ms`), rename, colour. A finished timer only takes again / stop / rename / colour.
   * Returns the timer as it now is, or null when it is gone (stopped, or never was).
   */
  act(id: string, action: TimerAction, now = Date.now(), arg: { ms?: unknown; label?: unknown; colour?: unknown } = {}): Timer | null {
    const t = this.all.find((x) => x.id === id);
    if (!t) return null;
    if (action === 'stop') { this.all = this.all.filter((x) => x !== t); this.save(); return null; }
    if (action === 'again') {
      const ms = Number(arg.ms);
      const total = Number.isFinite(ms) && ms >= MIN_MS && ms <= MAX_MS ? Math.round(ms) : t.total;
      t.total = total; t.end = now + total; t.paused = 0; delete t.done;
    } else if (action === 'rename') {
      t.label = tidyLabel(arg.label);
    } else if (action === 'colour') {
      if (!isColour(arg.colour)) return { ...t };
      t.colour = arg.colour;
    } else if (t.done) {
      return { ...t };
    } else if (action === 'add') {
      const raw = arg.ms === undefined ? 60_000 : Number(arg.ms);
      if (!Number.isFinite(raw) || Math.abs(raw) > MAX_MS) return { ...t };
      const left = t.paused || Math.max(0, t.end - now);
      const next = Math.min(MAX_MS, Math.max(MIN_LEFT_MS, left + Math.round(raw)));
      const d = next - left;
      if (!d) return { ...t };
      t.total = Math.min(MAX_MS, Math.max(next, t.total + d));
      if (t.paused) t.paused = next; else t.end = now + next;
    } else if (action === 'pause') {
      if (t.paused) { t.end = now + t.paused; t.paused = 0; } else { t.paused = Math.max(1, t.end - now); }
    }
    this.save(); return { ...t };
  }
  /** The ones that have just run out: marked done (kept on the list), returned once. */
  due(now = Date.now()): Timer[] {
    const out = this.all.filter((t) => !t.done && !t.paused && t.end <= now);
    // One that ran out long ago (Samara was closed) counts as done now, so it rings and can still be answered (Again,
    // 5 more) for DONE_KEEP_MS, instead of being expired the moment it rings.
    if (out.length) { for (const t of out) t.done = now - t.end >= DONE_KEEP_MS ? now : t.end; this.save(); }
    return out.map((t) => ({ ...t }));
  }
  /** Finished timers nobody answered within DONE_KEEP_MS go. Returns the ids that went. */
  expire(now = Date.now()): string[] {
    const gone = this.all.filter((t) => t.done && now - t.done >= DONE_KEEP_MS).map((t) => t.id);
    if (gone.length) { this.all = this.all.filter((t) => !gone.includes(t.id)); this.save(); }
    return gone;
  }
  /** When to look next: the earliest running end, or the earliest finished one's going. Null = nothing to wait for. */
  nextAt(): number | null {
    let n: number | null = null;
    for (const t of this.all) {
      const at = t.done ? t.done + DONE_KEEP_MS : t.paused ? null : t.end;
      if (at !== null && (n === null || at < n)) n = at;
    }
    return n;
  }
  private save(): void { try { writeFileAtomic(this.file, JSON.stringify(this.all)); } catch { /* kept in memory; the next change tries again */ } }
}

/** A part of the window that takes the mouse (the plate, the keys), in the window's own CSS pixels. */
export interface Area { x: number; y: number; w: number; h: number }

/** The parts the page says take the mouse, checked: at most 4, numbers, inside the window. Null when none make sense. */
export function cleanAreas(a: unknown, width: number, height: number): Area[] | null {
  if (!Array.isArray(a)) return null;
  const out: Area[] = [];
  for (const r of a.slice(0, 4)) {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const [x, y, w, h] = [o.x, o.y, o.w, o.h].map(Number) as [number, number, number, number];
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || x < -1 || y < -1 || x + w > width + 1 || y + h > height + 1) continue;
    out.push({ x, y, w, h });
  }
  return out.length ? out : null;
}
