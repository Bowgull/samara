// Notes in Samara (N0, 2026-11-25): his notes are Samara's now. The companion is retired as a place to see them (its
// sprite no longer shows); this file plugs Samara's own notes store (notestore.ts) into everything that shows or makes a
// note: the notes stuck on his screen and the quick note (notewin.ts), the notes rail beside a page, the Hyrule map's
// pins, the taskbar's and the Dock's New note, the quick-note key, and the other machine (bsync.notes).
//
// The first time (and at every start after, harmlessly) the companion's notes.json on this machine is brought in, read
// only, every field kept, with a report in Settings › Notes. A quick note that was being typed when Samara or the
// computer went down comes back at the next start as a note, and he is told.
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, shell } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NotesStore, findCompanionNotes, type ImportReport, type StoreStatus } from './notestore.ts';
import { NoteWindows, freshOut } from './notewin.ts';
import { newId, plainOf, searchNotes, titleFrom, toMarkdown, type Dev, type Note, type NoteView } from './notes.ts';
import { lockNotes, unlockNotes, MIN_PASS } from './notelock.ts';
import { writeFileAtomic } from './atomic.ts';
import { PIN_CSS, deepOf, pageKey, paintCode, quoteAround, type PagePin } from './anchorpaint.ts';
import { run } from './page.ts';
import { remindAt, askNotes, askClaudeText, htmlFromText, type AskHit, type RemindPick } from './notes.ts';
import { newChatLink } from './claudehand.ts';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { Notification } from 'electron';
import { writeHyruleNotes, type NotePlaceMsg } from './hyrulenotes.ts';
import { sched } from './sched.ts';
import type { SamaraBrowser } from './browser.ts';

/** One note on the board (Your things › Notes): what the page draws, nothing more. */
export interface BoardCard { id: string; title: string; html: string; cat?: string; site?: string; url?: string; updated: number; created: number; out: boolean; copyOf?: string; deleted?: number; versions: number;
  /** N3: pinned to words on a page (Jump to it), and a reminder not yet gone off. */
  quote?: string; remind?: number }
export interface Board { view: 'notes' | 'trash'; cards: BoardCard[]; cats: { builtin: string[]; own: string[] }; counts: { all: number; trash: number; cats: Record<string, number> }; total: number }

/** What the browser asks of the notes (browser.ts notesHub): the sync, Settings › Notes, the board. */
export interface NotesLink {
  forSync(): unknown[]; own(): string[]; take(list: unknown[], own: string[]): number;
  status(): Record<string, unknown>; act(a: string): void;
  board(q: string, cat: string, view: string, limit?: number): Board;
  /** A board action on one note; versions answer with the list. */
  boardAct(act: string, id: string, extra?: string): unknown;
  /** A copy locked with his passphrase (Documents › Samara notes), or one brought back. A sentence for him either way. */
  lockedExport(pass: string, win: BrowserWindow | null): string;
  lockedImport(pass: string, win: BrowserWindow | null): Promise<string>;
  /** N4: his question answered from his notes, each answer with the note it came from. */
  ask(q: string): AskHit[];
  /** N4: the same question in a new Claude chat, the notes it found handed over to cite (he presses send). */
  askClaude(q: string): string;
  /** N4: the samara connector's notes tools (claudedoor.ts), after his OK for that chat. */
  forClaude(op: string, a: Record<string, unknown>): Record<string, unknown>;
}

/** Cards drawn at a time on the board; "Show more" asks for the next lot (every note is reachable, none hidden). */
export const BOARD_PAGE = 300;

/** The quick-note key the companion used (Ctrl + number pad *), kept so his hands need not learn a new one. */
export const QUICK_KEY = 'Control+nummult';

export interface NotesHub {
  store: NotesStore;
  /** The quick note (the key, New note in the taskbar list or the Dock). */
  quick(): void;
  /** A note out on the screen (or brought to the front when it already is). */
  open(id: string): boolean;
  status(): StoreStatus & { quickKey: string | null; companion: ImportReport | null };
  /** Every note as Markdown in a folder. Returns how many. */
  exportMarkdown(dir: string): number;
  flush(): void;
}

export interface NotesOpts {
  browser: SamaraBrowser;
  here: string;
  stateDir: string;
  origin: string;
  dev: Dev;
  log(s: string): void;
  /** Where the companion kept its notes on this machine (its notes.json). */
  companionFile?: string;
}


export function startNotes(o: NotesOpts): NotesHub {
  const b = o.browser;
  let wins: NoteWindows | null = null;
  const store: NotesStore = new NotesStore({
    dir: path.join(o.stateDir, 'notes'), dev: o.dev, log: o.log,
    onChange: () => redraw(),
    onLocal: (notes, own) => { b.sync?.notesOut(notes, own); },
  });
  // Declared before anything that may show them (the status is read by Settings).
  let quickKey: string | null = null;
  let companion: ImportReport | null = null;
  if (store.locked) o.log('notes: this computer\'s key will not open the notes kept here; they are left as they are, and new notes are still kept');
  const card = (n: Note & { out?: unknown }): BoardCard => ({ id: n.id, title: n.title, html: n.html, ...(n.cat ? { cat: n.cat } : {}), ...(n.src ? { site: n.src.site, url: n.src.url } : {}),
    updated: n.updated, created: n.created, out: !!n.out, ...(n.conflictOf ? { copyOf: n.conflictOf } : {}), ...(n.deleted ? { deleted: n.deleted } : {}), versions: store.history(n.id).length,
    ...(n.anchor ? { quote: n.anchor.exact.slice(0, 200), url: n.anchor.url } : {}), ...(n.remind && !n.remind.done ? { remind: n.remind.at } : {}) });
  b.notesHub = {
    forSync: () => store.forSync(), own: () => store.cats().own, take: (list, own) => store.take(list, own),
    board: (q, cat, view, limit = BOARD_PAGE) => {
      const all = store.list(), trash = store.trash();
      const counts = { all: all.length, trash: trash.length, cats: {} as Record<string, number> };
      for (const n of all) counts.cats[n.cat ?? ''] = (counts.cats[n.cat ?? ''] ?? 0) + 1;
      const v = view === 'trash' ? 'trash' : 'notes';
      let list: (Note & { out?: unknown })[] = v === 'trash' ? trash : all;
      if (v === 'notes' && cat !== '*') list = list.filter((n) => (n.cat ?? '') === cat);
      const found = searchNotes(list, q);
      return { view: v, cards: found.slice(0, Math.max(BOARD_PAGE, Math.min(100_000, Math.floor(limit) || BOARD_PAGE))).map(card), cats: store.cats(), counts, total: found.length };
    },
    boardAct: (act, id, extra) => {
      if (act === 'new') { const n = store.save({ title: '', html: '', ...(extra ? { cat: extra } : {}) }); if (n) open(n.id); return n?.id ?? null; }
      if (!/^n[a-z0-9]{1,24}$/.test(id)) return null;
      if (act === 'open') return open(id);
      if (act === 'back') { store.setOut(id, null); return true; }
      if (act === 'trash') return store.remove(id);
      if (act === 'restore') { const n = store.restore(id); return !!n; }
      if (act === 'versions') return store.history(id).map((x) => ({ stamp: x.stamp, updated: x.updated, title: x.title, html: x.html }));
      if (act === 'restorever' && typeof extra === 'string') return !!store.restoreVersion(id, extra);
      if (act === 'copymd') { const n = store.get(id); if (n) clipboard.writeText(toMarkdown(n)); return !!n; }
      if (act === 'cat' && typeof extra === 'string') return !!store.save({ id, cat: extra });
      if (act === 'jump') return jump(id);
      if (act === 'remind' && typeof extra === 'string') {
        if (extra === 'clear') return !!store.save({ id, remind: null });
        const at = remindAt(extra as RemindPick, Date.now());
        return at ? !!store.save({ id, remind: { at, dev: o.dev } }) : false;
      }
      return null;
    },
    lockedExport: (pass, win) => {
      void win;
      if (typeof pass !== 'string' || pass.length < MIN_PASS) return `The passphrase needs at least ${MIN_PASS} characters.`;
      const dir = path.join(app.getPath('documents'), 'Samara notes');
      const file = path.join(dir, `Samara notes ${new Date().toISOString().slice(0, 10)}.samaranotes`);
      try {
        const notes = store.forSync().filter((n) => !n.deleted);
        writeFileAtomic(file, lockNotes({ v: 1, own: store.cats().own, notes }, pass));
        void shell.showItemInFolder(file);
        return `${notes.length} notes locked into Documents › Samara notes. Keep the passphrase: without it, nobody can open the copy, you included.`;
      } catch (e) { return 'Not saved: ' + (e as Error).message; }
    },
    lockedImport: async (pass, win) => {
      const pick = await (win ? dialog.showOpenDialog(win, { title: 'Bring back a locked copy', defaultPath: path.join(app.getPath('documents'), 'Samara notes'), filters: [{ name: 'Samara notes', extensions: ['samaranotes'] }], properties: ['openFile'] })
        : dialog.showOpenDialog({ title: 'Bring back a locked copy', filters: [{ name: 'Samara notes', extensions: ['samaranotes'] }], properties: ['openFile'] }));
      const f = pick.filePaths[0];
      if (pick.canceled || !f) return '';
      let payload: { notes?: unknown; own?: unknown };
      try { payload = unlockNotes(readFileSync(f, 'utf8'), pass) as typeof payload; }
      catch (e) { return (e as Error).message === 'wrong' ? 'That passphrase does not open this copy.' : 'That is not a locked copy of Samara notes.'; }
      const before = store.list().length;
      // Brought back the way the other machine's notes come: nothing here is lost; an edit made since is kept beside it.
      const changed = store.take(Array.isArray(payload.notes) ? payload.notes : [], Array.isArray(payload.own) ? payload.own : []);
      const added = store.list().length - before;
      return changed ? `Brought back: ${added} new, ${changed - added > 0 ? changed - added : 0} updated. Nothing here was removed.` : 'Everything in that copy is already here.';
    },
    status: () => ({ ...store.status(), quickKey, companion }),
    act: (a) => {
      if (a === 'notesbackup') { const ok = store.backup(true); b.say('Notes', ok ? 'Backed up' : 'Not backed up: see the log', ok ? 'done' : 'bad'); }
      else if (a === 'notesexport') {
        const dir = path.join(app.getPath('documents'), 'Samara notes', new Date().toISOString().slice(0, 10));
        try { const n = store.exportMarkdown(dir, (x: Note) => toMarkdown(x)); b.say('Notes', `${n} notes exported to Documents › Samara notes`, 'done'); void shell.openPath(dir); }
        catch (e) { b.say('Notes', 'Not exported: ' + (e as Error).message); }
      }
      b.pushSettings();
    },
    ask: (q) => askNotes(store.list(), q, 8),
    askClaude: (q) => {
      const hits = askNotes(store.list(), q, 8);
      if (!hits.length) return 'None of your notes has those words, so there is nothing to hand Claude.';
      const home = path.join(os.homedir(), 'Handoff', 'samara');
      void shell.openExternal(newChatLink(askClaudeText(q, hits, 'his_notes_' + randomBytes(4).toString('hex')), existsSync(home) ? home : null));
      return '';
    },
    forClaude: (op, a) => {
      if (op === 'search') {
        const q = String(a.q ?? '').slice(0, 400);
        const hits = q.trim() ? askNotes(store.list(), q, 12)
          : store.list().slice().sort((x, y) => y.updated - x.updated).slice(0, 12).map((n) => ({ id: n.id, title: n.title, ...(n.cat ? { cat: n.cat } : {}), ...(n.src ? { site: n.src.site, url: n.src.url } : {}), updated: n.updated, lines: plainOf(n.html).slice(0, 2), score: 0 }));
        return { ok: true, total: store.list().length, hits };
      }
      if (op === 'read') {
        const id = String(a.id ?? '');
        const n = /^n[a-z0-9]{1,24}$/.test(id) ? store.get(id) : null;
        if (!n || n.deleted) return { ok: false, error: 'no note with that id (notes_search gives ids)' };
        return { ok: true, id: n.id, markdown: toMarkdown(n).slice(0, 40_000) };
      }
      if (op === 'add') {
        const text = String(a.text ?? '').trim();
        if (!text) return { ok: false, error: 'give the text of the note' };
        const known = new Set([...store.cats().builtin, ...store.cats().own]);
        const cat = typeof a.cat === 'string' && known.has(a.cat) ? a.cat : undefined;
        const html = htmlFromText(text);
        const title = String(a.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || titleFrom(html, 5);
        const n = store.save({ title, html, ...(cat ? { cat } : {}) });
        if (!n) return { ok: false, error: 'the note was not kept' };
        b.say('Notes', `Claude added a note: ${title.slice(0, 50)}`, 'done');
        return { ok: true, id: n.id, title };
      }
      return { ok: false, error: 'not a notes step' };
    },
  };

  // ---- everything that shows a note, redrawn after a change (here or from the other machine)
  let redrawSoon: NodeJS.Timeout | null = null;
  function redraw(): void {
    if (redrawSoon) return;
    // One redraw for a burst (a catch-up from the other machine is hundreds of puts at once).
    redrawSoon = setTimeout(() => {
      redrawSoon = null;
      const list = store.list(), own = store.cats().own;
      try { wins?.sync(list); } catch (e) { o.log('notes: windows: ' + (e as Error).message); }
      try { b.notesNews(list, own); } catch (e) { o.log('notes: rail: ' + (e as Error).message); }
      try { writeHyruleNotes(list, own, plainOf); } catch (e) { o.log('notes: map: ' + (e as Error).message); }
      try { b.pushThings('notes'); } catch { /* no Your things open */ }
      repaintPins();
    }, 30);
  }

  wins = new NoteWindows({
    origin: o.origin, preloadPath: path.join(o.here, 'notepreload.cjs'),
    place: (id, out) => store.setOut(id, out),
    cats: () => store.cats().own,
  });

  // ---- the companion's notes, brought in (read only; safe to run again)
  try {
    const file = o.companionFile ?? findCompanionNotes(app.getPath('appData'));
    const r = file ? store.importCompanion(file, o.dev) : null;
    if (r) {
      if (r.found || r.skipped.length) companion = r;
      if (r.added || r.updated || r.kept) o.log(`notes: brought in from the companion: ${r.added} new, ${r.updated} updated, ${r.kept} kept beside, ${r.same} already here, ${r.skipped.length} skipped`);
    }
  } catch (e) { o.log('notes: the companion\'s notes could not be brought in: ' + (e as Error).message); }

  // ---- a quick note left mid-sentence: back as a note, and he is told
  const left = store.drafts();
  for (const d of left) {
    const n = store.save({ id: store.has(d.id) ? newId() : d.id, title: d.title || titleFrom(d.html), html: d.html, ...(d.cat ? { cat: d.cat } : {}) });
    if (n) store.dropDraft(d.id);
  }
  if (left.length) {
    const words = titleFrom(left[left.length - 1]!.html, 6);
    setTimeout(() => b.say('Notes', left.length === 1 ? `A quick note you were typing came back: "${words}"` : `${left.length} quick notes you were typing came back`, 'done'), 4000);
  }

  // ---- the doors of the note windows. Each speaks only for its own note.
  const fromNote = (e: Electron.IpcMainEvent) => wins?.of(e.sender) ?? null;
  const fromQuick = (e: Electron.IpcMainEvent) => wins?.quickIdOf(e.sender) ?? null;
  ipcMain.on('note:save', (e, n) => { const v = fromNote(e); if (v && n && typeof n === 'object') store.save({ ...n, id: v.id }); });
  ipcMain.on('note:move', (e, a) => { if (fromNote(e) && a && typeof a === 'object' && (a.kind === 'drag' || a.kind === 'resize')) wins?.move(e.sender, a.kind, String(a.phase), Number(a.dx), Number(a.dy)); });
  ipcMain.on('note:menu', (e, a) => {
    if (!fromNote(e) && !fromQuick(e)) return;
    const open = a === true || (!!a && typeof a === 'object' && a.open === true);
    const at = a && typeof a === 'object' && Number.isFinite(a.x) && Number.isFinite(a.y) ? { x: Number(a.x), y: Number(a.y) } : null;
    wins?.menu(e.sender, open, at);
  });
  ipcMain.on('note:opacity', (e, n) => { if (fromNote(e)) wins?.setOpacity(e.sender, Number(n)); });
  ipcMain.on('note:pin', (e, on) => { if (fromNote(e)) wins?.setPinned(e.sender, on === true); });
  ipcMain.on('note:through', (e) => { if (fromNote(e)) wins?.toggleThrough(e.sender); });
  ipcMain.on('note:back', (e) => { const v = fromNote(e); if (v) wins?.back(v.id); });
  ipcMain.on('note:delete', (e) => {
    const v = fromNote(e);
    if (!v) return;
    wins?.drop(v.id);
    if (store.remove(v.id)) b.note('', { kind: 'done', from: 'menu', kick: 'Notes', title: 'Note moved to the Trash', rows: [{ g: 'Kept', v: '30 days, in Your things › Notes' }],
      keys: [{ label: 'Undo', act: 'undo' }, { label: 'Got it', act: 'ok' }] }, (act) => { if (act === 'undo') { store.restore(v.id); open(v.id); } });
  });
  // The quick note: a draft while he types, kept (or let go) when he presses Enter or Esc. Saved, and on the disk,
  // before its window goes.
  ipcMain.on('note:draft', (e, n) => { const id = fromQuick(e); if (id && n && typeof n === 'object') store.draft({ ...n, id }); });
  ipcMain.on('note:quickdone', (e, n) => {
    const id = fromQuick(e);
    if (!id) return;
    if (n && typeof n === 'object') {
      const kept = store.save({ title: titleFrom(String((n as { html?: unknown }).html ?? '')), ...n, id });
      if (!kept) o.log('notes: the quick note could not be kept; its draft stays for the next start');
      else store.dropDraft(id);
    } else store.dropDraft(id);
    wins?.closeQuick();
  });

  // ---- the browser's own note doors (the rail, the Hyrule map)
  b.onNoteSave = (n) => { store.save(n, { trusted: true }); };
  b.onNoteOpen = (id) => { open(id); };
  b.onNotePlace = (m: NotePlaceMsg & { open?: boolean }) => {
    let n: NoteView | null = null;
    if (m.off && m.id) n = store.unpin(m.id);
    else n = store.pin({ ...(m.id ? { id: m.id } : {}), title: m.title, text: m.text, x: m.x, z: m.z });
    if (n && m.open) open(n.id);
  };

  // ---- N3: notes pinned to words on a page
  b.onNoteThis = (q) => {
    const quote = quoteAround(q.before, q.exact, q.after);
    let site = '';
    try { site = new URL(q.url).hostname.replace(/^www\./, ''); } catch { return; }
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const n = store.save({ title: titleFrom(`<div>${esc(quote.exact)}</div>`, 5), html: `<div>“${esc(quote.exact.slice(0, 600))}”</div><div><br></div>`,
      src: { url: q.url, site }, anchor: { url: q.url, ...quote } }, { trusted: true });
    if (n) open(n.id);
  };
  const pinsFor = (url: string): PagePin[] => {
    const k = pageKey(url);
    return store.list().filter((n) => n.anchor && pageKey(n.anchor.url) === k)
      .map((n) => ({ id: n.id, title: n.title === 'Note' ? '' : n.title, exact: n.anchor!.exact, prefix: n.anchor!.prefix, suffix: n.anchor!.suffix, deep: deepOf(n.cat) }));
  };
  const cssDone = new WeakSet<Electron.WebContents>();
  async function paintPins(tab: { id: number; url: string; view: { webContents: Electron.WebContents } | null }, jumpTo: string | null = null): Promise<Set<string>> {
    const wc = tab.view?.webContents;
    if (!wc || wc.isDestroyed()) return new Set();
    const pins = pinsFor(wc.getURL());
    const had = b.pinIds.get(tab.id);
    if (!pins.length && !had?.size) return new Set();
    if (pins.length && !cssDone.has(wc)) { cssDone.add(wc); wc.once('did-navigate', () => cssDone.delete(wc)); await wc.insertCSS(PIN_CSS).catch(() => {}); }
    const found = await run<string[]>(wc, paintCode(pins, jumpTo), { world: 999, ms: 4000, fallback: [] });
    const ids = new Set(Array.isArray(found) ? found : []);
    b.pinIds.set(tab.id, ids);
    return ids;
  }
  // A pending Jump to it waits until its words are found (the page may be ready before they are drawn).
  b.onTabLoaded = (tab) => {
    const p = jumps.get(tab.id);
    if (p && p.until < Date.now()) jumps.delete(tab.id);
    const j = p && p.until >= Date.now() ? p.id : null;
    void paintPins(tab as never, j).then((ids) => { if (j && ids.has(j)) jumps.delete(tab.id); });
  };
  function repaintPins(): void { for (const t of b.tabs) if (!t.internal && t.view && (b.pinIds.get(t.id)?.size || pinsFor(t.url).length)) void paintPins(t as never); }
  /** "Jump to it": the page the words are on, in front, scrolled to them (opened if it is not). */
  const jumps = new Map<number, { id: string; until: number }>();
  function jump(id: string): boolean {
    const n = store.get(id);
    const url = n?.anchor?.url ?? n?.src?.url;
    if (!n || !url) return false;
    const k = pageKey(url);
    const there = b.tabs.find((t) => !t.internal && t.view && pageKey(t.url) === k);
    if (there) { b.activate(there.id); void paintPins(there as never, n.anchor ? id : null); return true; }
    const tid = b.newTab(url, null, true);
    if (tid != null && n.anchor) jumps.set(tid, { id, until: Date.now() + 30_000 });
    return tid != null;
  }

  // ---- N3: reminders. Rung on the machine that set them, once; Open, Snooze an hour, or Done.
  const ring = () => {
    const now = Date.now();
    for (const n of store.list()) {
      const r = n.remind;
      if (!r || r.done || r.at > now || (r.dev && r.dev !== o.dev)) continue;
      store.save({ id: n.id, remind: { ...r, done: true } });
      const title = n.title === 'Note' ? titleFrom(n.html, 6) : n.title;
      if (b.hasWindow()) {
        b.note('', { kind: 'done', from: 'menu', kick: 'Reminder', title: title.slice(0, 60), keys: [{ label: 'Open', act: 'open' }, { label: 'In an hour', act: 'snooze' }, { label: 'Done', act: 'ok', plain: true }] },
          (act) => { if (act === 'open') open(n.id); else if (act === 'snooze') store.save({ id: n.id, remind: { at: Date.now() + 3_600_000, dev: o.dev } }); });
      }
      try { if (Notification.isSupported()) { const x = new Notification({ title: 'Reminder', body: title.slice(0, 120), silent: false }); x.on('click', () => open(n.id)); x.show(); } } catch { /* no system notices */ }
    }
  };
  sched.every('notes.remind', 30_000, ring, { first: 10_000 });

  function open(id: string): boolean {
    const n = store.get(id);
    if (!n) return false;
    if (n.out) { wins?.show(n); return wins?.focus(id) ?? false; }
    store.setOut(id, freshOut(wins?.count ?? 0));
    return true;
  }
  function quick(): void {
    wins?.quick({ id: newId() });
  }

  // ---- the quick-note key, and the Dock's New note
  try { if (globalShortcut.register(QUICK_KEY, quick)) quickKey = QUICK_KEY; else o.log(`notes: the quick-note key (${QUICK_KEY}) is taken by another program (the companion's Shell, if it still runs)`); }
  catch (e) { o.log('notes: no quick-note key: ' + (e as Error).message); }
  if (process.platform === 'darwin') {
    try { app.dock?.setMenu(Menu.buildFromTemplate([{ label: 'New note', click: quick }])); } catch { /* no Dock */ }
  }

  // ---- housekeeping: a backup a day (14 kept), the Trash emptied of what is over 30 days, everything on disk at quit
  sched.every('notes.backup', 6 * 3_600_000, () => { store.gc(); if (store.backup()) o.log('notes: backed up'); }, { first: 2 * 60_000 });
  const flush = () => { try { store.flush(); } catch (e) { o.log('notes: could not write at quit: ' + (e as Error).message); } };
  app.on('will-quit', () => { try { if (quickKey) globalShortcut.unregister(quickKey); } catch { /* going */ } flush(); wins?.closeAll(); });

  redraw();
  return {
    store, quick, open,
    status: () => ({ ...store.status(), quickKey, companion }),
    exportMarkdown: (dir) => store.exportMarkdown(dir, (n: Note) => toMarkdown(n)),
    flush,
  };
}
