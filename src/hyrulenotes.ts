// BG5 (the Hyrule guide docs, "notes.json"): what the Hyrule map may ask about their notes, checked before anything
// reaches the companion. The companion checks again (notes.ts cleanPlace); this side only refuses what is plainly not a pin.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { writeFileAtomic } from './atomic.ts';
import os from 'node:os';
import path from 'node:path';
import { pcLocal } from './dirs.ts';

export type NotePlaceMsg = { t: 'notes.place'; id?: string; title?: string; text?: string; x?: number; z?: number; off?: boolean; open?: boolean };
const ID = /^n[a-z0-9]{1,20}$/;
const coord = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 6000;

/** A new pin (x, z, words), a pin moved (id, x, z) or taken off (id, off). Anything else is null. */
export function notePlaceMsg(raw: unknown): NotePlaceMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && ID.test(r.id) ? r.id : undefined;
  if (r.id !== undefined && !id) return null;
  if (r.off === true) return id ? { t: 'notes.place', id, off: true } : null;
  if (!coord(r.x) || !coord(r.z)) return null;
  const words = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  if (id) return { t: 'notes.place', id, x: r.x as number, z: r.z as number };
  return { t: 'notes.place', x: r.x as number, z: r.z as number, title: words(r.title, 60), text: words(r.text, 8000) };
}

/** Sheet 26c: what the user typed in the map's "Ask the companion" bar, as plain words (no control characters, at most 2000). */
export function askText(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 2000) : '';
}

/** The BotW folder the companion reads (SAMARA_BOTW_DIR in tests). */
export function botwFolder(env: NodeJS.ProcessEnv = process.env): string {
  return env.SAMARA_BOTW_DIR || path.join(pcLocal(env), 'botw');
}

/**
 * Settings › Spoilers › Puzzle help (approved design): 'hints' (the default) or 'straight'. Kept beside
 * state.json as guide-settings.json, which the guide tools read (Core botw.ts). Anything else is ignored.
 */
export function writeGuide(raw: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const puzzle = (raw as { puzzle?: unknown } | null)?.puzzle;
  if (puzzle !== 'hints' && puzzle !== 'straight') return false;
  const dir = botwFolder(env), f = path.join(dir, 'guide-settings.json');
  let was: Record<string, unknown> = {};
  try { was = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}; } catch { was = {}; }
  if (was.puzzle === puzzle) return true;
  try { mkdirSync(dir, { recursive: true }); writeFileAtomic(f, JSON.stringify({ ...was, puzzle })); return true; } catch { return false; }
}

/** botw/notes.json as text for the map (the companion writes it after every note save), or null when there is none. */
export function hyruleNotesFile(env: NodeJS.ProcessEnv = process.env): string | null {
  const f = path.join(botwFolder(env), 'notes.json');
  try { return existsSync(f) && statSync(f).size < 2_000_000 ? readFileSync(f, 'utf8') : null; } catch { return null; }
}

/**
 * N0 (2026-11-25): Samara keeps his notes now, so Samara writes botw/notes.json for the map and the guide tools, in the
 * companion's own format (Core botwnotes.ts botwNotesFile), so nothing that reads it changes. Only on a machine that has
 * the BotW folder already; once the file exists it is kept current, so the last pin taken off empties it. True when written.
 */
export function writeHyruleNotes(notes: { id: string; title: string; html: string; cat?: string; updated: number; place?: { game: string; x: number; z: number }; deleted?: number }[],
  own: string[], plain: (html: string) => string[], env: NodeJS.ProcessEnv = process.env, now = Date.now()): boolean {
  const dir = botwFolder(env), file = path.join(dir, 'notes.json');
  if (!existsSync(dir)) return false;
  const pins = notes.filter((n) => !n.deleted && n.place?.game === 'botw');
  if (!pins.length && !existsSync(file)) return false;
  const data = {
    v: 1, writtenAt: new Date(now).toISOString(), own: [...own],
    notes: pins.map((n) => ({ id: n.id, title: n.title, cat: n.cat ?? '', lines: plain(n.html), html: n.html, x: n.place!.x, z: n.place!.z, updated: new Date(n.updated).toISOString() })),
  };
  const text = JSON.stringify(data, null, 1);
  // The same pins as last time: not written again (writtenAt alone is no change).
  try { const was = JSON.parse(readFileSync(file, 'utf8')); if (JSON.stringify({ ...was, writtenAt: '' }) === JSON.stringify({ ...data, writtenAt: '' })) return false; } catch { /* none yet */ }
  try { writeFileAtomic(file, text); return true; } catch { return false; }
}
