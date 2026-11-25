// Notes in Samara (N0, 2026-11-25): where his notes are kept, on each machine, so none is ever lost.
//
// One writer: Samara's main process. Windows and pages ask it through noteswire.ts; nothing else writes here.
//
// On disk (stateDir/notes/), every file sealed with the computer's own key (sealedfile.ts: DPAPI, the Keychain):
//   journal.log    every change, one sealed line each, flushed to the disk BEFORE the save is answered. A power cut
//                  mid-line loses only that half line; the lines before it are whole.
//   snapshot.json  everything, rewritten every COMPACT_EVERY changes and on quit; the journal is emptied only after
//                  the new snapshot is safely in place (a crash between the two replays the journal again: harmless).
//   drafts/        what is being typed in a quick note, every half second, until it is kept or let go.
//   backups/       a copy a day, the last 14.
//   imports/       a sealed copy of each companion file brought in, exactly as it was.
// A file this computer's key will not open is NEVER written over (sealedfile.ts's rule): the store says it is locked,
// keeps new notes in the journal only (an append never touches what is there), and tries again at the next start.
//
// Two machines (sync, bsync.ts carries them): each note carries a clock stamp and the stamps it grew from. A note from
// the other machine that grew from ours replaces ours; one ours grew from is old news; two that grew apart are both
// kept: the newer wins and the other is saved beside it as a copy (the same copy, made the same way on both machines,
// so it is never doubled). A delete and an edit made apart: the edit wins. Where a note sits on the screen never travels.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { writeFileAtomic } from './atomic.ts';
import { osKeeper, readSealed, sealText, Unreadable, type Keeper } from './sealedfile.ts';
import {
  BUILTIN_CATS, HIST, ID_RE, MAX_OWN_CATS, cleanCat, cleanHtml, cleanOut, cleanPlace, contentKey, isEmpty,
  newId, tidyNote, type Dev, type Note, type NoteOut, type NoteView,
} from './notes.ts';

const DAY = 86_400_000;
export const COMPACT_EVERY = 200;
export const TRASH_DAYS = 30;
/** A deleted note's mark is kept this long after its words are gone, so a machine away that long still hears of it. */
export const TOMBSTONE_DAYS = 120;
export const VERSIONS = 20;
/** A new version is kept at most this often while he types (the note saves a little after each pause). */
export const VERSION_GAP_MS = 10 * 60_000;
export const BACKUPS = 14;

export interface Version { stamp: string; updated: number; title: string; html: string; cat?: string }
export interface Draft { id: string; title: string; html: string; cat?: string; at: number }
export interface ImportReport { found: number; added: number; updated: number; same: number; kept: number; skipped: { id: string; why: string }[]; file: string }
export interface StoreStatus { notes: number; trash: number; locked: boolean; lastBackup: number; dev: Dev; dir: string; sealed: boolean; imported: Record<string, ImportReport> }

type Op =
  | { op: 'put'; note: Note }
  | { op: 'out'; id: string; out: NoteOut | null }
  | { op: 'cats'; own: string[] }
  | { op: 'ver'; id: string; v: Version }
  | { op: 'drop'; id: string }
  | { op: 'imp'; key: string; hash: string }
  | { op: 'report'; tag: string; r: ImportReport };

interface Snapshot {
  v: 2; dev: Dev; clock: string;
  notes: Note[]; outs: Record<string, NoteOut>; own: string[];
  versions: Record<string, Version[]>; imported: Record<string, string>; reports: Record<string, ImportReport>; lastBackup: number;
}

export interface StoreOpts {
  dir: string;
  dev: Dev;
  keeper?: Keeper;
  now?: () => number;
  log?: (s: string) => void;
  /** Anything changed (here or from the other machine): windows, the rail and the map redraw. */
  onChange?: (why: 'local' | 'remote') => void;
  /** Notes changed HERE, for the other machine (never called for a change that came from it). */
  onLocal?: (notes: Note[], own: string[]) => void;
}

// ------------------------------------------------------------------ the clock

/**
 * A hybrid clock: the wall time, a counter when two changes share a millisecond, and the machine. It never goes
 * backwards, and it moves past any stamp seen from the other machine, so a PC whose clock runs behind still writes
 * stamps newer than the Mac's last one. Stamps sort as plain strings.
 */
export class Hlc {
  private ms = 0; private c = 0;
  private readonly dev: Dev;
  constructor(dev: Dev, last = '') { this.dev = dev; this.see(last); }
  next(now: number): string {
    if (now > this.ms) { this.ms = now; this.c = 0; } else if (++this.c > 9999) { this.ms++; this.c = 0; }
    return Hlc.fmt(this.ms, this.c, this.dev);
  }
  see(stamp: string): void {
    const m = /^(\d{13}):(\d{4}):/.exec(stamp ?? '');
    if (!m) return;
    const ms = Number(m[1]), c = Number(m[2]);
    if (ms > this.ms || (ms === this.ms && c > this.c)) { this.ms = ms; this.c = c; }
  }
  get last(): string { return Hlc.fmt(this.ms, this.c, this.dev); }
  static fmt(ms: number, c: number, dev: Dev): string { return `${String(ms).padStart(13, '0')}:${String(c).padStart(4, '0')}:${dev}`; }
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------ the store

export class NotesStore {
  private notes = new Map<string, Note>();
  private outs = new Map<string, NoteOut>();
  private own: string[] = [];
  private versions = new Map<string, Version[]>();
  private imported = new Map<string, string>();
  private reports: Record<string, ImportReport> = {};
  private lastBackup = 0;
  private ops = 0;
  /** The journal ends mid-line (a power cut): the next line starts on a fresh one. */
  private torn = false;
  private readonly clock: Hlc;
  private readonly keeper: Keeper;
  readonly dir: string;
  readonly dev: Dev;
  /** The key would not open what is on disk: nothing is written over; new notes go to the journal only. */
  locked = false;
  private readonly o: StoreOpts;

  constructor(o: StoreOpts) {
    this.o = o;
    this.dir = o.dir;
    this.dev = o.dev;
    this.keeper = o.keeper ?? osKeeper;
    mkdirSync(this.dir, { recursive: true });
    let snap: Partial<Snapshot> | null = null;
    try { snap = readSealed<Partial<Snapshot>>(this.file('snapshot.json'), this.keeper); }
    catch (e) { if (e instanceof Unreadable) { this.locked = true; this.log('notes: the snapshot is ' + e.message + '; it is left as it is'); } else this.log('notes: snapshot unreadable: ' + (e as Error).message); }
    this.clock = new Hlc(this.dev, typeof snap?.clock === 'string' ? snap.clock : '');
    if (snap) this.load(snap);
    this.replay();
    this.gc();
  }

  private now(): number { return (this.o.now ?? Date.now)(); }
  private log(s: string): void { (this.o.log ?? console.log)(s); }
  private file(name: string): string { return path.join(this.dir, name); }

  private load(s: Partial<Snapshot>): void {
    for (const raw of Array.isArray(s.notes) ? s.notes : []) { const n = tidyNote(raw, { dev: this.dev, now: this.now() }); if (n && n.stamp) this.notes.set(n.id, n); }
    for (const [id, o] of Object.entries(s.outs ?? {})) { const c = cleanOut(o); if (c && ID_RE.test(id)) this.outs.set(id, c); }
    this.own = this.cleanOwn(Array.isArray(s.own) ? s.own : []);
    for (const [id, list] of Object.entries(s.versions ?? {})) if (ID_RE.test(id) && Array.isArray(list)) this.versions.set(id, list.filter((v) => v && typeof v.stamp === 'string').slice(0, VERSIONS));
    for (const [k, v] of Object.entries(s.imported ?? {})) if (typeof v === 'string') this.imported.set(k, v);
    if (s.reports && typeof s.reports === 'object') this.reports = s.reports;
    this.lastBackup = Number(s.lastBackup) || 0;
  }

  /** The journal, line by line, over the snapshot. A line that will not parse (a half line from a power cut) is skipped. */
  private replay(): void {
    const f = this.file('journal.log');
    if (!existsSync(f)) return;
    let text = '';
    try { text = readFileSync(f, 'utf8'); } catch (e) { this.log('notes: journal unreadable: ' + (e as Error).message); return; }
    this.torn = text.length > 0 && !text.endsWith('\n');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let j: unknown;
      try { j = JSON.parse(line); } catch { continue; }
      let op: Op | null = null;
      if (j && typeof j === 'object' && (j as { sealed?: unknown }).sealed === 1) {
        try { op = JSON.parse(this.keeper.open(String((j as { data: unknown }).data))) as Op; }
        catch { this.locked = true; continue; }
      } else op = j as Op;
      if (op) { this.apply(op); this.ops++; }
    }
  }

  /** One change, as the journal has it. Applying the same line twice changes nothing. */
  private apply(op: Op): void {
    switch (op?.op) {
      case 'put': { const n = tidyNote(op.note, { dev: this.dev, now: this.now() }); if (n && n.stamp) { this.notes.set(n.id, n); this.clock.see(n.stamp); } break; }
      case 'out': if (ID_RE.test(op.id)) { const c = op.out ? cleanOut(op.out) : undefined; if (c) this.outs.set(op.id, c); else this.outs.delete(op.id); } break;
      case 'cats': this.own = this.cleanOwn([...this.own, ...(Array.isArray(op.own) ? op.own : [])]); break;
      case 'ver': if (ID_RE.test(op.id) && op.v && typeof op.v.stamp === 'string') {
        const list = (this.versions.get(op.id) ?? []).filter((v) => v.stamp !== op.v.stamp);
        this.versions.set(op.id, [op.v, ...list].slice(0, VERSIONS));
      } break;
      case 'drop': this.notes.delete(op.id); this.outs.delete(op.id); this.versions.delete(op.id); break;
      case 'imp': if (typeof op.key === 'string' && typeof op.hash === 'string') this.imported.set(op.key, op.hash); break;
      case 'report': if (typeof op.tag === 'string' && op.r) this.reports[op.tag] = op.r; break;
    }
  }

  /** Written to the disk and flushed before this returns: once a save is answered, a power cut cannot take it. */
  private write(op: Op): void {
    this.apply(op);
    const line = (this.torn ? '\n' : '') + sealText(JSON.stringify(op), this.keeper).replace(/\n/g, ' ') + '\n';
    const fd = openSync(this.file('journal.log'), 'a');
    try { writeSync(fd, line); fsyncSync(fd); this.torn = false; } finally { closeSync(fd); }
    if (++this.ops >= COMPACT_EVERY) this.compact();
  }

  /** Everything into the snapshot, then the journal emptied. Never while locked. */
  compact(): void {
    if (this.locked) return;
    try {
      writeFileAtomic(this.file('snapshot.json'), sealText(JSON.stringify(this.snapshot()), this.keeper));
      writeFileAtomic(this.file('journal.log'), '');
      this.ops = 0; this.torn = false;
    } catch (e) { this.log('notes: could not compact: ' + (e as Error).message); }
  }
  private snapshot(): Snapshot {
    return { v: 2, dev: this.dev, clock: this.clock.last, notes: [...this.notes.values()], outs: Object.fromEntries(this.outs), own: [...this.own],
      versions: Object.fromEntries(this.versions), imported: Object.fromEntries(this.imported), reports: this.reports, lastBackup: this.lastBackup };
  }
  /** On quit. */
  flush(): void { if (this.ops) this.compact(); }

  // ------------------------------------------------------------------ reading

  private view(n: Note): NoteView { const out = this.outs.get(n.id); return { ...n, ...(out ? { out: { ...out } } : {}) }; }
  /** Every note not in the Trash, newest first. */
  list(): NoteView[] { return [...this.notes.values()].filter((n) => !n.deleted).sort((a, b) => b.updated - a.updated).map((n) => this.view(n)); }
  /** The Trash: deleted in the last TRASH_DAYS days, words still there, newest delete first. */
  trash(): Note[] { const cut = this.now() - TRASH_DAYS * DAY; return [...this.notes.values()].filter((n) => n.deleted && n.deleted > cut && !isEmpty(n)).sort((a, b) => b.deleted! - a.deleted!); }
  get(id: string): NoteView | null { const n = this.notes.get(id); return n && !n.deleted ? this.view(n) : null; }
  has(id: string): boolean { return this.notes.has(id); }
  cats(): { builtin: string[]; own: string[] } { return { builtin: [...BUILTIN_CATS], own: [...this.own] }; }
  history(id: string): Version[] { return [...(this.versions.get(id) ?? [])]; }
  /** Every note, Trash marks too, as it travels to the other machine. */
  forSync(): Note[] { return [...this.notes.values()]; }
  status(): StoreStatus {
    return { notes: this.list().length, trash: this.trash().length, locked: this.locked, lastBackup: this.lastBackup, dev: this.dev, dir: this.dir,
      sealed: (() => { try { return this.keeper.available(); } catch { return false; } })(), imported: { ...this.reports } };
  }

  // ------------------------------------------------------------------ categories

  private cleanOwn(raw: unknown[]): string[] {
    const out: string[] = [];
    for (const r of raw) { const c = cleanCat(r); if (c && ![...BUILTIN_CATS, ...out].some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c); }
    return out.slice(0, MAX_OWN_CATS);
  }
  /** The spelling already known (any case), else a new one of his own (up to MAX_OWN_CATS); '' = plain. */
  private canonCat(raw: unknown): string {
    const c = cleanCat(raw);
    if (!c) return '';
    const known = [...BUILTIN_CATS, ...this.own].find((x) => x.toLowerCase() === c.toLowerCase());
    if (known) return known;
    if (this.own.length >= MAX_OWN_CATS) return '';
    this.write({ op: 'cats', own: [c] });
    return c;
  }
  /** "+ Category": a new one of his own, with no note in it yet. Its name as kept, or '' when refused. */
  addCat(name: unknown): string { const before = this.own.length; const c = this.canonCat(name); if (this.own.length !== before) this.changed('local', []); return c; }

  // ------------------------------------------------------------------ writing, here

  /**
   * A save from a window, a page or Samara itself: only known fields, each checked, over what the note already has.
   * Where it came from (src), its place on the map and its anchor are never lost because an editor did not send them
   * back. `out` (where it sits on this screen) is kept here and never travels. Null when it is not a note.
   */
  save(raw: unknown, o: { trusted?: boolean; times?: { created: number; updated: number } } = {}): NoteView | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' && ID_RE.test(r.id) ? r.id : newId(this.now());
    const prev = this.notes.get(id);
    const now = this.now();
    const base: Record<string, unknown> = prev ? { ...prev } : { id, title: '', html: '', font: 'figtree', size: 'm', created: now };
    for (const k of ['title', 'html', 'font', 'size', 'tfont', 'tsize', 'notice'] as const) if (k in r) base[k] = r[k];
    if ('cat' in r) base.cat = this.canonCat(r.cat);
    // Where it came from, its map place, its anchor and reminder: set by Samara itself, or by a page only when new.
    for (const k of ['src', 'place', 'anchor', 'remind'] as const) if (k in r && (o.trusted || !prev || k === 'remind')) base[k] = r[k];
    if (r.notice === true) delete base.notice;
    if (prev?.deleted) delete base.deleted;   // a save of a note in the Trash brings it back
    const next = tidyNote({ ...base, updated: o.times?.updated ?? now, dev: this.dev }, { dev: this.dev, now });
    if (!next) return null;
    if (!next.cat) delete next.cat;
    if ('out' in r) this.setOut(id, r.out ?? null, false);
    if (prev && !prev.deleted && this.same(prev, next)) { this.changed('local', []); return this.view(prev); }
    next.stamp = this.clock.next(now);
    next.hist = prev ? [prev.stamp, ...prev.hist].slice(0, HIST) : [];
    next.created = prev?.created ?? o.times?.created ?? next.created;
    if (prev && !prev.deleted && (prev.html !== next.html || prev.title !== next.title)) this.keepVersion(prev);
    this.write({ op: 'put', note: next });
    this.changed('local', [next]);
    return this.view(next);
  }
  private same(a: Note, b: Note): boolean {
    const k = (n: Note) => JSON.stringify([n.title, n.html, n.cat ?? '', n.font, n.size, n.tfont ?? '', n.tsize ?? '', n.notice ?? true, n.src ?? null, n.place ?? null, n.anchor ?? null, n.remind ?? null]);
    return k(a) === k(b);
  }
  private keepVersion(prev: Note): void {
    // Still the same sitting (he saved a moment ago, and the newest kept version is from this sitting too): nothing new
    // is kept, or a version per pause would bury the rest. A sitting longer than VERSION_GAP_MS keeps one each gap.
    const newest = this.versions.get(prev.id)?.[0];
    if (newest && this.now() - prev.updated < VERSION_GAP_MS && prev.updated - newest.updated < VERSION_GAP_MS) return;
    this.write({ op: 'ver', id: prev.id, v: { stamp: prev.stamp, updated: prev.updated, title: prev.title, html: prev.html, ...(prev.cat ? { cat: prev.cat } : {}) } });
  }

  /** On this screen (or off it: null). Never travels. */
  setOut(id: string, out: unknown, tell = true): void {
    if (!ID_RE.test(id)) return;
    const c = out ? cleanOut(out) : undefined;
    const was = this.outs.get(id);
    if (JSON.stringify(was ?? null) === JSON.stringify(c ?? null)) return;
    this.write({ op: 'out', id, out: c ?? null });
    if (tell) this.changed('local', []);
  }

  /** To the Trash (kept TRASH_DAYS days, Undo brings it back). The mark travels, so the other machine binns it too. */
  remove(id: string): boolean {
    const n = this.notes.get(id);
    if (!n || n.deleted) return false;
    const now = this.now();
    const next: Note = { ...n, deleted: now, updated: now, dev: this.dev, stamp: this.clock.next(now), hist: [n.stamp, ...n.hist].slice(0, HIST) };
    this.write({ op: 'put', note: next });
    if (this.outs.has(id)) this.write({ op: 'out', id, out: null });
    this.changed('local', [next]);
    return true;
  }
  restore(id: string): NoteView | null {
    const n = this.notes.get(id);
    if (!n?.deleted) return null;
    return this.save({ id, title: n.title, html: n.html });
  }
  /** A version brought back: saved as the newest, so the one it replaces becomes a version itself. */
  restoreVersion(id: string, stamp: string): NoteView | null {
    const v = this.versions.get(id)?.find((x) => x.stamp === stamp);
    if (!v || !this.notes.has(id)) return null;
    return this.save({ id, title: v.title, html: v.html, ...(v.cat ? { cat: v.cat } : {}) });
  }

  // ------------------------------------------------------------------ the Hyrule map (BG5), as the companion had it

  /** A note pinned at a spot on his Hyrule map. With an id: that note moves there. Otherwise a new Zelda note. */
  pin(raw: { id?: unknown; title?: unknown; text?: unknown; x?: unknown; z?: unknown }): NoteView | null {
    const place = cleanPlace({ game: 'botw', x: raw.x, z: raw.z });
    if (!place) return null;
    if (typeof raw.id === 'string') return this.notes.get(raw.id) ? this.save({ id: raw.id, place }, { trusted: true }) : null;
    const lines = String(raw.text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40).map((l) => l.slice(0, 400));
    const title = String(raw.title ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || lines[0]?.slice(0, 60) || 'Hyrule note';
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return this.save({ title, html: lines.map((l) => `<div>${esc(l)}</div>`).join(''), cat: 'Zelda', place }, { trusted: true });
  }
  unpin(id: string): NoteView | null {
    const n = this.notes.get(id);
    if (!n?.place) return null;
    const next = tidyNote({ ...n }, { dev: this.dev, now: this.now() })!;
    delete next.place;
    const now = this.now();
    const put: Note = { ...next, updated: now, dev: this.dev, stamp: this.clock.next(now), hist: [n.stamp, ...n.hist].slice(0, HIST) };
    this.write({ op: 'put', note: put });
    this.changed('local', [put]);
    return this.view(put);
  }

  // ------------------------------------------------------------------ drafts (the quick note, while he types)

  private draftFile(id: string): string { return path.join(this.dir, 'drafts', `${id}.json`); }
  /** What is being typed, kept now. A quick note closed by a crash comes back from here. */
  draft(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return false;
    const d: Draft = { id: r.id, title: String(r.title ?? '').slice(0, 60), html: cleanHtml(r.html), ...(cleanCat(r.cat) ? { cat: cleanCat(r.cat) } : {}), at: this.now() };
    if (isEmpty(d)) { this.dropDraft(d.id); return true; }
    try { writeFileAtomic(this.draftFile(d.id), sealText(JSON.stringify(d), this.keeper)); return true; } catch (e) { this.log('notes: draft not kept: ' + (e as Error).message); return false; }
  }
  dropDraft(id: string): void { if (ID_RE.test(id)) try { rmSync(this.draftFile(id), { force: true }); } catch { /* gone */ } }
  /** Drafts left from before (a quick note that never got its Enter): oldest first. */
  drafts(): Draft[] {
    const dir = path.join(this.dir, 'drafts');
    if (!existsSync(dir)) return [];
    const out: Draft[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try { const d = readSealed<Draft>(path.join(dir, f), this.keeper); if (d && ID_RE.test(d.id) && !isEmpty(d)) out.push(d); } catch { /* sealed with a key not here: left as it is */ }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // ------------------------------------------------------------------ the other machine

  /**
   * Notes from the other machine. Each one: taken when it grew from ours, ignored when ours grew from it, and when the
   * two grew apart, the newer kept and the other saved beside it as a copy (never doubled: both machines make the
   * same copy). A delete and an edit made apart: the edit wins. Returns how many changed here.
   */
  take(list: unknown, own?: unknown): number {
    let n = 0;
    const changed: Note[] = [];
    const before = this.own.length;
    if (Array.isArray(own)) { const add = this.cleanOwn([...this.own, ...own]).slice(this.own.length); if (add.length) this.write({ op: 'cats', own: add }); }
    for (const raw of Array.isArray(list) ? list.slice(0, 20_000) : []) {
      const r = tidyNote(raw, { dev: this.dev === 'pc' ? 'mac' : 'pc', now: this.now() });
      if (!r || !r.stamp) continue;
      this.clock.see(r.stamp);
      const l = this.notes.get(r.id);
      if (!l) { this.write({ op: 'put', note: r }); changed.push(r); n++; continue; }
      if (l.stamp === r.stamp || l.hist.includes(r.stamp)) continue;
      if (r.hist.includes(l.stamp)) { this.write({ op: 'put', note: r }); changed.push(r); n++; continue; }
      // Grew apart.
      const lDel = !!l.deleted, rDel = !!r.deleted;
      const rWins = lDel !== rDel ? lDel : r.stamp > l.stamp;
      const win = rWins ? r : l, lose = rWins ? l : r;
      if (!lose.deleted && contentKey({ ...lose, deleted: undefined }) !== contentKey({ ...win, deleted: undefined })) {
        const copyId = 'n' + hash(`${lose.id}|${lose.stamp}`).slice(0, 16);
        if (!this.notes.has(copyId)) {
          const where = lose.dev === 'mac' ? 'Mac' : 'PC';
          const copy: Note = { ...lose, id: copyId, title: `${lose.title} (${where} copy)`.slice(0, 60), conflictOf: lose.id, hist: [] };
          this.write({ op: 'put', note: copy }); changed.push(copy);
        }
      }
      const merged: Note = { ...win, hist: [...new Set([lose.stamp, ...win.hist, ...lose.hist])].slice(0, HIST) };
      this.write({ op: 'put', note: merged });
      if (rWins) { changed.push(merged); n++; }
    }
    if (n || changed.length || this.own.length !== before) this.changed('remote', []);
    return n;
  }

  private changed(why: 'local' | 'remote', notes: Note[]): void {
    try { this.o.onChange?.(why); } catch (e) { this.log('notes: a window could not be told: ' + (e as Error).message); }
    if (why === 'local' && notes.length) { try { this.o.onLocal?.(notes, [...this.own]); } catch { /* the other machine hears at the next catch-up */ } }
  }

  // ------------------------------------------------------------------ housekeeping

  /** The Trash empties itself: words gone after TRASH_DAYS, the mark itself after TOMBSTONE_DAYS. Drafts older than a month go. */
  gc(): void {
    if (this.locked) return;
    const now = this.now();
    for (const n of [...this.notes.values()]) {
      if (!n.deleted) continue;
      if (n.deleted < now - TOMBSTONE_DAYS * DAY) { this.write({ op: 'drop', id: n.id }); continue; }
      if (n.deleted < now - TRASH_DAYS * DAY && (n.html || n.title !== 'Note')) {
        this.notes.set(n.id, { ...n, html: '', title: 'Note' });
        this.versions.delete(n.id);
      }
    }
  }

  /** A copy a day (sealed, like everything here), the last BACKUPS kept. True when one was written. */
  backup(force = false): boolean {
    if (this.locked) return false;
    const now = this.now();
    if (!force && now - this.lastBackup < 20 * 3_600_000) return false;
    const dir = path.join(this.dir, 'backups');
    try {
      mkdirSync(dir, { recursive: true });
      const name = `notes-${new Date(now).toISOString().slice(0, 10)}.json`;
      this.lastBackup = now;
      writeFileAtomic(path.join(dir, name), sealText(JSON.stringify(this.snapshot()), this.keeper));
      const all = readdirSync(dir).filter((f) => /^notes-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const old of all.slice(0, Math.max(0, all.length - BACKUPS))) rmSync(path.join(dir, old), { force: true });
      this.compact();
      return true;
    } catch (e) { this.log('notes: backup not written: ' + (e as Error).message); return false; }
  }

  // ------------------------------------------------------------------ bringing in the companion's notes

  /**
   * The companion's notes.json (and note-cats.json beside it), read and never changed. Every note comes across with every
   * field it had, its place on the screen included. Safe to run again: a note already brought in, unchanged, is
   * skipped; one changed in the companion since is brought in again, unless he has changed it here too, in which case the
   * companion's is kept beside it as a copy. `tag` names the source (the machine's companion).
   */
  importCompanion(file: string, tag: string): ImportReport {
    const report: ImportReport = { found: 0, added: 0, updated: 0, same: 0, kept: 0, skipped: [], file };
    if (!existsSync(file)) return report;
    let raw: unknown;
    let text = '';
    try { text = readFileSync(file, 'utf8'); raw = JSON.parse(text); } catch (e) { report.skipped.push({ id: '(file)', why: 'could not read it: ' + (e as Error).message }); return report; }
    if (!Array.isArray(raw)) { report.skipped.push({ id: '(file)', why: 'not a list of notes' }); return report; }
    // A sealed copy of exactly what was there, once per different content.
    try {
      const h = hash(text).slice(0, 12), dir = path.join(this.dir, 'imports');
      const name = `${tag}-${new Date(this.now()).toISOString().slice(0, 10)}-${h}.json`;
      if (!existsSync(path.join(dir, name))) writeFileAtomic(path.join(dir, name), sealText(text, this.keeper));
    } catch (e) { this.log('notes: the import copy was not kept: ' + (e as Error).message); }
    // Its own categories first, in the order he made them (their order is their colour).
    try {
      const cf = path.join(path.dirname(file), 'note-cats.json');
      if (existsSync(cf)) { const cats = JSON.parse(readFileSync(cf, 'utf8')); if (Array.isArray(cats)) { const add = this.cleanOwn([...this.own, ...cats]).slice(this.own.length); if (add.length) this.write({ op: 'cats', own: add }); } }
    } catch { /* the categories also come from the notes themselves below */ }
    report.found = raw.length;
    for (const item of raw) {
      const id = (item as { id?: unknown })?.id;
      const t = tidyNote(item, { dev: this.dev, now: this.now() });
      if (!t) { report.skipped.push({ id: typeof id === 'string' ? id.slice(0, 30) : '(no id)', why: 'not a note' }); continue; }
      const key = `${tag}:${t.id}`;
      const h = hash(contentKey(t) + JSON.stringify([t.src ?? null, t.place ?? null, t.font, t.size]));
      const was = this.imported.get(key);
      if (was === h) { report.same++; continue; }
      const here = this.notes.get(t.id);
      const out = cleanOut((item as { out?: unknown }).out);
      if (!here) {
        const n = this.save({ ...t }, { trusted: true, times: t });
        if (n) { if (out) this.setOut(n.id, out, false); this.write({ op: 'imp', key, hash: h }); report.added++; }
        else report.skipped.push({ id: t.id, why: 'could not be saved' });
        continue;
      }
      if (was && here.stamp && this.importedUntouched(here, was)) {
        this.save({ ...t }, { trusted: true }); this.write({ op: 'imp', key, hash: h }); report.updated++; continue;
      }
      if (contentKey(here) === contentKey(t)) { this.write({ op: 'imp', key, hash: h }); report.same++; continue; }
      // The same id with other words (the other machine's companion, or changed in both places): kept beside it.
      const copy = this.save({ ...t, id: 'n' + hash(key + h).slice(0, 16), title: `${t.title} (from the companion)`.slice(0, 60) }, { trusted: true, times: t });
      if (copy) { this.write({ op: 'imp', key, hash: h }); report.kept++; }
    }
    this.write({ op: 'report', tag, r: report });
    this.changed('local', []);
    return report;
  }
  private importedUntouched(here: Note, wasHash: string): boolean {
    return hash(contentKey(here) + JSON.stringify([here.src ?? null, here.place ?? null, here.font, here.size])) === wasHash;
  }

  /** Every note as Markdown files in `dir` (one each, plus an index). Returns how many. */
  exportMarkdown(dir: string, toMd: (n: Note) => string): number {
    mkdirSync(dir, { recursive: true });
    const used = new Set<string>();
    let count = 0;
    const lines: string[] = ['# Notes', ''];
    for (const n of this.list()) {
      let base = n.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Note';
      let name = `${base}.md`, i = 2;
      while (used.has(name.toLowerCase())) name = `${base} ${i++}.md`;
      used.add(name.toLowerCase());
      writeFileAtomic(path.join(dir, name), toMd(n));
      lines.push(`- [${n.title}](${encodeURI(name)})${n.cat ? ` · ${n.cat}` : ''}`);
      count++;
    }
    writeFileAtomic(path.join(dir, 'index.md'), lines.join('\n') + '\n');
    return count;
  }
}

/**
 * The companion's notes file on this machine: a notes.json in one of the folders beside Samara's own (Roaming on the PC,
 * Application Support on the Mac) that is plainly the companion's: a list of notes in its exact shape (an id like n…, the
 * note's words, its font and size). The repo is public, so the companion's folder is found, never named.
 * SAMARA_COMPANION_NOTES names the file outright (tests, or a folder somewhere else). Null when there is none.
 */
export function findCompanionNotes(appData: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.SAMARA_COMPANION_NOTES) return env.SAMARA_COMPANION_NOTES;
  let dirs: string[] = [];
  try { dirs = readdirSync(appData, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.toLowerCase() !== 'samara').map((d) => d.name); } catch { return null; }
  let best: { f: string; n: number } | null = null;
  for (const d of dirs) {
    const f = path.join(appData, d, 'notes.json');
    try {
      if (!existsSync(f) || statSync(f).size > 20_000_000) continue;
      const j = JSON.parse(readFileSync(f, 'utf8'));
      if (!Array.isArray(j)) continue;
      const shaped = j.filter((n) => n && typeof n === 'object' && typeof n.id === 'string' && ID_RE.test(n.id) && typeof n.html === 'string' && 'font' in n && 'size' in n);
      if (shaped.length && shaped.length * 10 >= j.length * 9 && (!best || shaped.length > best.n)) best = { f, n: shaped.length };
    } catch { /* not this one */ }
  }
  return best?.f ?? null;
}

/** For tests and the Settings page: the size of the journal right now (bytes). */
export function journalBytes(dir: string): number { try { return statSync(path.join(dir, 'journal.log')).size; } catch { return 0; } }
