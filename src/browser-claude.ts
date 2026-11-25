// Phase 4 (2026-11-24): SamaraBrowser's claude methods, moved out of browser.ts unchanged. They run as the browser's own
// methods (browser.ts puts them on SamaraBrowser.prototype), so `this` is the browser.
import { BrowserWindow, WebContentsView, app, screen, shell } from 'electron';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SAFE_WEB_PREFERENCES, lockDown } from './safety.ts';
import { askText, hyruleNotesFile, notePlaceMsg, writeGuide } from './hyrulenotes.ts';
import { routeAsk, routeReport } from './hyruleroute.ts';
import { run, within } from './page.ts';
import { SIZES } from './capture.ts';
import { writeFileAtomic } from './atomic.ts';
import { readJson } from './store.ts';
import { carriesData, keyWeigh, personal, siteOf, JOB_SITES, jobTask } from './driverrules.ts';
import { siteKey } from './siterules.ts';
import { claudeMessage, claudeOpenTarget } from './claudewire.ts';
import { forCompanion, neverKeep } from './visits.ts';
import type { Job } from './driver.ts';
import { LOOP_STOP, LOOP_WARN } from './loopcatch.ts';
import { FORM_GRAB_JS, GONE_MS, cleanForm, formFillJs, hasTyping, placeName, readKept, sameName, writeKept } from './claudekeep.ts';
import type { KeptField, KeptForm, KeptJob } from './claudekeep.ts';
import { HELD_OPS, cardRows, cleanWhy, noteDid, reportLines, reportOf } from './claudehand.ts';
import type { Hand, HandReport } from './claudehand.ts';
import { keep } from './mockhome.ts';
import type { SamaraBrowser, Pane, RailNote, PlanCard, PlanAnswer } from './browser.ts';
import { isWeb, YOUR_TURN_MS, hyruleSaveClean } from './browser.ts';

export const ClaudePart = {
  frontNow(this: SamaraBrowser): void {
    const f = BrowserWindow.getFocusedWindow();
    const on = Boolean(f && this.panes.some((p) => p.win === f));
    if (on === this.frontWas) return;
    this.frontWas = on;
    try { this.onFront?.(on); } catch { /* the key is the companion's business */ }
  },

  /** His notes changed (Samara's own store since N0): the ones that came from a page (src) go to every window with its rail open. */
  notesNews(this: SamaraBrowser, notes: unknown, cats: unknown): void {
    // N1: every note goes (the rail's tabs: This page, Site, All); the rail filters by the page in front.
    this.railNotes = (Array.isArray(notes) ? notes : []).filter((n): n is RailNote => !!n && typeof n === 'object' && typeof (n as RailNote).id === 'string')
      .slice(0, 500).map((n) => ({ id: n.id, title: String(n.title ?? ''), html: String(n.html ?? ''), cat: typeof n.cat === 'string' ? n.cat : undefined, src: n.src, updated: Number(n.updated) || 0 }));
    this.railCats = Array.isArray(cats) ? cats.map(String).slice(0, 12) : [];
    for (const p of this.panes) if (p.railOpen) this.sendNotes(p);
  },

  sendNotes(this: SamaraBrowser, p: Pane): void {
    if (!this.alive(p)) return;
    p.win!.webContents.send('browser:notes', { notes: this.railNotes, cats: this.railCats });
  },

  /** "+ note for this site": his words, kept as a note with this page as where it came from. */
  noteSave(this: SamaraBrowser, raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as Record<string, unknown>;
    const id = String(r.id ?? '');
    if (!/^n[a-z0-9]{1,20}$/.test(id)) return;
    // Where it came from is the page in front of THIS window, never what the frame says.
    const url = this.cur()?.url ?? '';
    let site = '';
    try { const u = new URL(url); if (u.protocol !== 'http:' && u.protocol !== 'https:') return; site = u.hostname.replace(/^www\./, ''); } catch { return; }
    const was = this.railNotes.find((n) => n.id === id);
    this.onNoteSave?.({ id, title: String(r.title ?? '').slice(0, 60) || 'Note', html: String(r.html ?? '').slice(0, 20_000), cat: typeof r.cat === 'string' ? r.cat.slice(0, 24) : undefined,
      src: was?.src ?? { url, site }, updated: Date.now() });
  },

  noteOpen(this: SamaraBrowser, id: unknown): void { if (typeof id === 'string' && /^n[a-z0-9]{1,20}$/.test(id)) this.onNoteOpen?.(id); },

  isHyrule(this: SamaraBrowser, sender: Electron.WebContents): boolean { return this.tabs.some((x) => x.internal === 'hyrule' && x.view?.webContents === sender); },

  hyruleNotes(this: SamaraBrowser): string | null { return hyruleNotesFile(); },

  hyruleNotePlace(this: SamaraBrowser, raw: unknown): void { const m = notePlaceMsg(raw); if (m) this.onNotePlace?.(m); },

  /** Sheet 25 "Note here": a new Zelda note at the spot, opened on his board to type, like his other notes. */
  hyruleNewNote(this: SamaraBrowser, raw: unknown): void {
    const at = (raw as { at?: unknown } | null)?.at;
    const m = Array.isArray(at) && at.length === 2 ? notePlaceMsg({ x: at[0], z: at[1], title: '', text: '' }) : null;
    if (m && m.id === undefined) this.onNotePlace?.({ ...m, open: true });
  },

  hyruleAsk(this: SamaraBrowser, raw: unknown): void {
    const text = askText(raw);
    if (text) this.onAsk?.(text);
  },

  /** Settings › Spoilers › Puzzle help, for the guide tools (guide-settings.json beside his save's state). */
  hyruleGuide(this: SamaraBrowser, raw: unknown): void { writeGuide(raw); },

  hyruleRoute(this: SamaraBrowser, raw: unknown): void { const a = routeAsk(raw); if (!a) return; this.routeQueue.add(a); this.routeDeliver(); },

  routeDeliver(this: SamaraBrowser): void {
    if (!this.routeQ && !this.routeQueue.size) return;
    const t = this.tabs.find((x) => x.internal === 'hyrule'), wc = t?.view?.webContents;
    if (!t || !wc || wc.isDestroyed() || t.loading) { for (const a of this.routeQueue.untold()) this.onRouteDone?.({ id: a.id, state: 'queued' }); return; }
    for (const a of this.routeQueue.take()) wc.send('hyrule:route', { id: a.id, ...(a.goal ? { goal: a.goal } : { remove: a.remove }) });
  },

  /** The preload put it in the map's queue. A hidden map plans it when he opens it; a map on screen reports the route. */
  hyruleRouteTook(this: SamaraBrowser, raw: unknown): void {
    const r = raw as { id?: unknown; hidden?: unknown } | null, id = typeof r?.id === 'string' ? r.id : '';
    if (!/^route\d{1,9}$/.test(id)) return;
    if (r!.hidden !== false) { this.onRouteDone?.({ id, state: 'queued' }); return; }
    const w = { id, t: setTimeout(() => { this.routeWaiting = this.routeWaiting.filter((x) => x !== w); this.onRouteDone?.({ id, state: 'planned' }); }, 6000) };
    this.routeWaiting.push(w);
  },

  hyruleRouteReport(this: SamaraBrowser, raw: unknown): void {
    const r = routeReport(raw), w = r && this.routeWaiting.shift();
    if (!r || !w) return;
    clearTimeout(w.t); this.onRouteDone?.({ id: w.id, state: 'planned', ...r });
  },

  hyruleSaveLoad(this: SamaraBrowser): Record<string, string> {
    try { return hyruleSaveClean(JSON.parse(readFileSync(this.hyruleSaveFile, 'utf8'))) ?? {}; } catch { return {}; }
  },

  hyruleSave(this: SamaraBrowser, raw: unknown): void {
    if (typeof raw !== 'string' || raw.length > 4_000_000) return;
    let o: Record<string, string> | null = null;
    try { o = hyruleSaveClean(JSON.parse(raw)); } catch { return; }
    if (!o) return;
    try { const tmp = this.hyruleSaveFile + '.tmp'; writeFileSync(tmp, JSON.stringify(o)); renameSync(tmp, this.hyruleSaveFile); }
    catch (e) { console.error('hyrule: the map save could not be written: ' + (e as Error).message); }
  },

  claudeNews(this: SamaraBrowser, m: { t?: unknown; jobs?: unknown; items?: unknown } | null): void {
    if (!m) this.claudeLast = null;
    else {
      const c = this.claudeLast ?? { jobs: [], waits: [] };
      if (m.t === 'claude.jobs' && Array.isArray(m.jobs)) c.jobs = m.jobs.slice(0, 50);
      else if (m.t === 'claude.wait' && Array.isArray(m.items)) c.waits = m.items.slice(0, 50).filter((w) => w && typeof w === 'object')
        .map((w: Record<string, unknown>) => ({ session: String(w.session ?? '').slice(0, 100), kind: String(w.kind ?? '').slice(0, 20) }));
      else return;
      this.claudeLast = c;
    }
    for (const p of this.panes) {
      if (!this.alive(p)) continue;
      p.win!.webContents.send('browser:claudenews', this.claudeLast);
      // The rune's layer keeps the same list all along (made with the window), so it opens at once and in step.
      if (p.runeV && !p.runeV.webContents.isDestroyed()) p.runeV.webContents.send('browser:claudenews', this.claudeLast);
    }
  },

  /** A band that just loaded asks for what it missed. */
  claudeHello(this: SamaraBrowser, sender: Electron.WebContents): void { sender.send('browser:claudenews', this.claudeLast); },

  /** 2026-10-21 (rule): Open in Claude pressed anywhere folds every rune panel away at once (main.ts openInClaude). */
  claudeFold(this: SamaraBrowser): void { const was = this.pane; for (const p of this.panes) if (this.alive(p) && p.runeOn) { this.pane = p; this.rune(false); } this.pane = was; },

  // ------------------------------------------------------------------ the rune's panel, floating over the live page
  /**
   * 2026-10-21 . The panel used to freeze the page: the live view was hidden and a still picture of it shown
   * (drawer(true)), which stalled a playing video and swapped views. Now it is drawn the way the tab list is: in its
   * own see-through layer ABOVE the live page, sized to the panel. The page is never hidden, frozen or captured.
   */
  runeView(this: SamaraBrowser): WebContentsView | null {
    const w = this.win, P = this.pane;
    if (!w || w.isDestroyed()) return null;
    if (P.runeV && !P.runeV.webContents.isDestroyed()) return P.runeV;
    // Never slowed while hidden: its slide must start the moment it shows. It does nothing at rest.
    const v = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, preload: this.o.preloadPath, backgroundThrottling: false } });
    lockDown(v.webContents);
    v.setBackgroundColor('#00000000');
    v.setVisible(false);
    // A press anywhere else takes the keyboard from it: it folds (the band's rune knows not to reopen on that press).
    v.webContents.on('blur', () => { this.pane = P; if (P.runeOn) { P.runeShutAt = Date.now(); this.rune(false); } });
    v.webContents.on('before-input-event', (e, input) => {
      this.pane = P;
      if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); this.rune(false); }
    });
    // Opened before its page had loaded (a click right after start): open once it has.
    v.webContents.on('did-finish-load', () => { this.pane = P; if (P.runeOn) this.placeRune(); });
    void v.webContents.loadURL(`${this.o.origin}/runelayer.html`).catch(() => { /* its window closed while it loaded */ });
    P.runeV = v;
    return v;
  },

  isRune(this: SamaraBrowser, sender: Electron.WebContents): boolean {
    const p = this.panes.find((x) => this.alive(x) && x.runeV && !x.runeV.webContents.isDestroyed() && sender === x.runeV.webContents);
    if (p) this.pane = p;
    return Boolean(p);
  },

  /** The band: open the panel under its rune, or fold it. */
  runeFromBand(this: SamaraBrowser, a: Record<string, unknown>): void {
    if (a.open !== true) { this.rune(false); return; }
    const n = (x: unknown) => (Number.isFinite(Number(x)) ? Math.round(Number(x)) : NaN);
    const at = { x: n(a.x), y: n(a.y), left: n(a.left), right: n(a.right) };
    if (Object.values(at).some((v) => !Number.isFinite(v))) return;
    this.rune(true, at);
  },

  /** The layer: it folded itself (Esc, a press on its edge, Open in Claude), or its panel changed size. */
  runeFromLayer(this: SamaraBrowser, a: Record<string, unknown>): void {
    const sz = a.size as { w?: unknown; h?: unknown } | undefined;
    if (sz && typeof sz === 'object') {
      const w = Number(sz.w), h = Number(sz.h);
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) { this.pane.runeSize = { w: Math.min(800, Math.round(w)), h: Math.min(4000, Math.round(h)) }; this.placeRune(); }
      return;
    }
    if (a.open === false) this.rune(false);
  },

  /** Open the layer where the band says, or fold it: it slides out (~180 ms), then the layer goes. */
  rune(this: SamaraBrowser, open: boolean, at?: { x: number; y: number; left: number; right: number }): void {
    const w = this.win, P = this.pane;
    if (!w || w.isDestroyed()) return;
    if (!open) {
      if (!P.runeOn) return;
      P.runeOn = false;
      const v = P.runeV && !P.runeV.webContents.isDestroyed() ? P.runeV : null;
      v?.webContents.send('browser:rune', { open: false });
      w.webContents.send('browser:rune', { open: false });
      if (P.runeHideT) clearTimeout(P.runeHideT);
      P.runeHideT = setTimeout(() => { P.runeHideT = null; if (!P.runeOn) v?.setVisible(false); }, 200);
      return;
    }
    if (P.runeOn) return;
    // The press on the rune that took the keyboard from the open layer has just folded it: that press means "close".
    if (Date.now() - (P.runeShutAt ?? 0) < 300) return;
    const v = this.runeView();
    if (!v) return;
    if (at) P.runeAt = at;
    if (P.runeHideT) { clearTimeout(P.runeHideT); P.runeHideT = null; }
    P.runeOn = true;
    w.contentView.addChildView(v);             // to the top, over the page (and over the tab list)
    v.setVisible(true);
    this.placeRune();                          // shown first, so its slide starts on a page that is drawing
    v.webContents.focus();
    w.webContents.send('browser:rune', { open: true });
  },

  /** Sheet 50's sums, in window pixels: the panel's right edge a little past the rune, kept inside the band. */
  placeRune(this: SamaraBrowser): void {
    const w = this.win, P = this.pane, v = P.runeV, at = P.runeAt;
    if (!w || w.isDestroyed() || !v || v.webContents.isDestroyed() || !P.runeOn || !at) return;
    const [cw, ch] = w.getContentSize();
    const PANEL = 384, M = 24;
    const left = Math.max(at.left + 8, Math.min(at.right - PANEL - 8, at.x - PANEL + 70));
    const x = Math.max(0, left - M), y = at.y;
    const width = Math.min(cw - x, P.runeSize?.w ?? PANEL + 2 * M);
    const maxH = Math.max(120, ch - y - 8 - M - 20);
    const height = Math.max(40, Math.min(ch - y, P.runeSize?.h ?? ch - y));   // until the panel says its size
    v.setBounds({ x, y, width: Math.max(0, width), height });
    v.webContents.send('browser:rune', { open: true, tip: at.x - x, maxH });
  },

  /** From the rune's panel: only pause, play and a message, each rebuilt and checked (claudewire.ts) like the cockpit's. */
  claudeAct(this: SamaraBrowser, raw: unknown): void {
    const m = claudeMessage(raw);
    if (!m || !['claude.pause', 'claude.play', 'claude.send'].includes(String(m.t))) { console.error('browser: refused a Claude message from the band that did not check out'); return; }
    this.onClaude?.(m);
  },

  claudeOpen(this: SamaraBrowser, raw: unknown): void {
    // 2026-10-21: a job with no app link (or on the Mac) still brings Claude forward, never nothing (claudeOpenTarget).
    const target = claudeOpenTarget(raw);
    if (!target) { console.error('browser: refused an Open in Claude link that was not a Claude session'); return; }
    this.onClaudeOpen?.(target);
  },

  // ------------------------------------------------------------------ 6.25a: what the companion asks of the driver
  /**
   * One driving step, asked by the companion. The rules are checked HERE, on the browser side, whatever the companion says:
   * a "never" control is refused outright; a "lever" one comes back as needs:'lever' until the companion has his held
   * yes and asks again with allowed. Every answer is plain data; page text is marked as the page's own words.
   */
  async drive(this: SamaraBrowser, op: string, a: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Sheet 109: nothing acts on his tab while he has it (never under him).
    const pg = Number(a?.page);
    if (HELD_OPS.has(op) && Number.isInteger(pg) && this.hands.has(pg)) {
      return { ok: false, error: `The user has the tab (page ${pg}): he took it over. Nothing is done there until he hands it back. Call browser_your_turn with page ${pg} to wait for him, or browser_take_back if he tells you in the chat that you can have it back.` };
    }
    let out: Record<string, unknown>;
    if (op === 'yourturn' || op === 'takeback') {
      if (!Number.isInteger(pg)) return { ok: false, error: 'page must be a number' };
      if (op === 'yourturn') out = await this.yourTurn(pg, String(a?.why ?? ''));
      else { const r = this.handEnd(pg, ''); out = r ? { ok: true, report: r } : { ok: true, none: true }; }
      if (out.report) out = { ...out, report: reportLines(out.report as HandReport) };
    } else {
      // The loop catcher (loopcatch.ts): a step stopped for looping is refused before it runs.
      const was = Number.isInteger(Number(a?.job)) && a?.job !== undefined ? Number(a.job) : this.driver.page(pg)?.job;
      const stopped = this.loops.before(was, op, a);
      out = stopped ? { ok: false, error: stopped } : await this.driveStep(op, a);
      const loop = stopped ? null : this.loops.after(was, op, a, out);
      const n = Number.isInteger(Number(a?.n)) && a?.n !== undefined ? Number(a.n) : undefined;
      if (loop === 'warn') {
        const why = this.driver.page(pg) ? await this.driver.stuck(pg, n).catch(() => [] as string[]) : [];
        out = { ...out, loop: `${LOOP_WARN}${why.length ? `\nWhat Samara sees:\n- ${why.join('\n- ')}` : ''}` };
      }
      if (loop === 'ask') out = { ...out, loop: await this.stuckAsk(pg, n) };
      if (loop === 'stop') { out = { ...out, ok: false, error: LOOP_STOP }; console.log(`shell: driver: job ${was} kept looping on ${op} after he was asked; that step is refused now`); }
      if (op === 'finish' && was !== undefined) this.loops.end(was);
    }
    // He handed back while nobody waited: the session hears it with its next step.
    const job = Number.isInteger(Number(a?.job)) && a?.job !== undefined ? Number(a.job) : this.driver.page(pg)?.job;
    for (const [page, t] of this.handTold) {
      if (t.job !== job) continue;
      this.handTold.delete(page);
      out = { ...out, handback: { page, ...reportLines(t.report) } };
      break;
    }
    const n = Number.isInteger(job) ? this.news.get(job!) : undefined;
    if (n?.length) { this.news.delete(job!); out = { ...out, news: n }; }
    return out;
  },

  async driveStep(this: SamaraBrowser, op: string, a: Record<string, unknown>): Promise<Record<string, unknown>> {
    const num = (k: string) => { const v = Number(a?.[k]); if (!Number.isInteger(v)) throw new Error(`${k} must be a number`); return v; };
    const d = this.driver;
    try {
      // His tab lent for reading only: nothing that acts on it (2026-10-14).
      if (['key', 'select', 'back', 'forward', 'upload', 'hover', 'drag'].includes(op) && Number.isInteger(Number(a?.page)) && d.readOnly(Number(a?.page))) return { ok: false, error: 'that is his tab, lent for reading only. To act in it, ask with browser_drive_tab (he is asked)' };
      switch (op) {
        // His browsing history, for the companion, only when he asks (2026-10-13): titles and addresses, never a money site.
        case 'history': {
          const days = Number(a?.days); const q = String(a?.q ?? '').slice(0, 200);
          return { ok: true, items: forCompanion(this.visits.list, q, Number.isFinite(days) ? days : 14, 15, Date.now()) };
        }
        case 'start': {
          const pl = a?.plan as { login?: unknown; denied?: unknown; steps?: unknown; allowed?: unknown } | undefined;
          const plan = pl ? { login: Array.isArray(pl.login) ? pl.login.map(String) : [], denied: Array.isArray(pl.denied) ? pl.denied.map(String) : [], steps: Array.isArray(pl.steps) ? pl.steps.map(String) : [], allowed: Array.isArray(pl.allowed) ? pl.allowed.map(String) : [] } : undefined;
          const j = d.startJob(a?.kind === 'claude' ? 'claude' : 'companion', String(a?.name ?? ''), plan);
          return { ok: true, job: j.id };
        }
        case 'finish': d.finish(num('job')); return { ok: true };
        // Sheet 111: the connector asks before a new plan whether its job can still take one.
        case 'jobstate': { const j = d.job(num('job')); return { ok: true, live: Boolean(j && !j.stopped), planned: Boolean(j?.planned), pages: j?.pages.length ?? 0 }; }
        case 'planstep': return this.planStep(num('job'), a?.done === true ? null : num('at'));
        case 'rename': d.rename(num('job'), String(a?.name ?? '').slice(0, 40)); return { ok: true };
        case 'open': {
          const job = num('job'), url = String(a?.url ?? '').slice(0, 2000);
          // AI lockdown G1/G2 (2026-10-14): using his login outside the job's sites, or sending what looks like private
          // details to a site in the address, waits for his OK.
          const login = a?.signedIn === true ? d.needsLogin(job, url) : '';
          if (login && a?.allowed !== true) return { ok: false, needs: 'lever', what: `use your login on ${login} for this job` };
          if (login) d.allowSite(job, url);
          const leak = carriesData(url);
          if (leak && a?.allowed !== true) { let s = ''; try { s = new URL(url).hostname; } catch { /* none */ } return { ok: false, needs: 'lever', what: `open ${s} with ${leak} in the address` }; }
          const r = await d.open(job, url); const note = this.siteNote(r.url); return { ok: true, ...r, ...(note ? { note } : {}) };
        }
        // Per-site notes (driver v2 part 3): what worked on a site, written by Claude for its next session there.
        case 'note': {
          const host = this.noteHost(String(a?.site ?? ''));
          if (!host) return { ok: false, error: 'say which site (an address or a name like linkedin.com)' };
          if (a?.text === undefined) return { ok: true, site: host, note: this.siteNote('https://' + host) };
          this.setSiteNote(host, String(a.text));
          return { ok: true, site: host, saved: true };
        }
        case 'read': return { ok: true, ...(await d.read(num('page'), { ...(Number.isInteger(Number(a?.within)) && a?.within !== undefined ? { within: Number(a.within) } : {}), changes: a?.changes === true, full: a?.full === true })) };
        case 'find': return { ok: true, ...(await d.find(num('page'), String(a?.q ?? '').slice(0, 200), a?.more === true)) };
        case 'waitfor': return { ok: true, ...(await d.waitFor(num('page'), String(a?.text ?? '').slice(0, 200), a?.gone === true, Number(a?.ms) || 8000)) };
        case 'jobs': return { ok: true, ...(await d.jobCards(num('page'))) };
        case 'sweep': return { ok: true, ...d.startSweep(num('page'), { keywords: Array.isArray(a?.keywords) ? (a.keywords as unknown[]).map(String) : [], ...(a?.path ? { path: String(a.path) } : {}), ...(a?.card ? { card: String(a.card) } : {}), ...(Number(a?.spacing) ? { spacing: Number(a.spacing) } : {}) }) };
        case 'sweep_status': return { ok: true, ...d.sweepStatus(num('id')) };
        case 'form': return { ok: true, ...(await d.form(num('page'), a?.within === undefined ? undefined : num('within'))) };
        // The fixed page readers, hover and drag, and the developer views (2026-10-14: the Chrome extension's tools).
        case 'extract': return { ok: true, ...(await d.extract(num('page'), String(a?.kind ?? ''))) };
        case 'hover': return { ok: true, ...(await d.hover(num('page'), num('n'))) };
        case 'drag': {
          if (d.readOnly(num('page'))) return { ok: false, error: 'that is his tab, lent for reading only. To act in it, ask with browser_drive_tab (he is asked)' };
          return { ok: true, ...(await d.drag(num('page'), num('n'), { ...(a?.to !== undefined ? { n: num('to') } : {}), dx: Number(a?.dx) || 0, dy: Number(a?.dy) || 0 })) };
        }
        case 'resize': return { ok: true, ...d.resize(num('page'), Number(a?.width), Number(a?.height)) };
        case 'console': return { ok: true, ...d.console(num('page'), { ...(a?.pattern ? { pattern: String(a.pattern) } : {}), errors: a?.errors === true, limit: Number(a?.limit) || 30 }) };
        case 'network': {
          if (d.readOnly(num('page')) || d.isLent(num('page'))) return { ok: false, error: "his own tabs' network is never watched; open the page in your own tab" };
          return { ok: true, ...(await d.network(num('page'), { ...(a?.pattern ? { pattern: String(a.pattern) } : {}), limit: Number(a?.limit) || 30 })) };
        }
        case 'record': {
          if (a?.stop === true) { const r = await d.stopRecording(num('page')); return r ? { ok: true, ...r } : { ok: false, error: 'that page is not being recorded' }; }
          return { ok: true, started: true, ...(await d.startRecording(num('page'))) };
        }
        case 'upload': {
          const page = num('page'), n = num('n'), file = String(a?.file ?? '');
          // Checked before he is asked (code audit M7): he is never asked about a file that would be refused, and the
          // question names the real file, its folder and its size.
          const up = d.checkUpload(file);
          if (a?.allowed !== true) return { ok: false, needs: 'lever', what: `upload ${up.label} to ${d.describe(page, n).replace(/^.* on /, '')}` };
          return { ok: true, ...(await d.upload(page, n, file)) };
        }
        case 'collect': return { ok: true, ...(await d.collectJobs(num('page'), Math.max(1, Math.min(120, Number(a?.max) || 60)))) };
        case 'back': case 'forward': return { ok: true, ...(await d.history(num('page'), op === 'back')) };
        case 'select': return { ok: true, ...(await d.choose(num('page'), num('n'), String(a?.option ?? '').slice(0, 200))) };
        case 'key': {
          // Space and Enter are judged by what they would do where the cursor is (2026-10-31): moving through
          // a page and picking are free; anything that would send asks him; buying and passwords never. The other keys
          // are free.
          const page = num('page');
          let key = String(a?.key ?? '').toLowerCase().replace(/\s+/g, '');
          let swapped = false;
          if (key === 'enter' || key === 'space') {
            const t = await d.keyTarget(page);
            const w = keyWeigh(key, t);
            const where = t ? `"${t.label || t.kind}"` : 'the page';
            if (w === 'never') return { ok: false, error: `that would act on ${where}, and buying, passwords and card details are never done for him` };
            if (w === 'lever' && a?.allowed !== true) return { ok: false, needs: 'lever', what: `press ${key === 'enter' ? 'Enter' : 'Space'} on ${where} (it could send the form)` };
            if (w === 'pick') { key = 'space'; swapped = true; }
          }
          // Phase 1: a key that looks free is pressed with the effect guard, unless he already allowed it.
          const r = await d.key(page, key, a?.allowed !== true);
          if ('needs' in r) return { ok: false, needs: r.needs, what: r.what };
          return { ok: true, ...(swapped ? { ...r, changed: ['Enter there would have sent the form, so Space was pressed instead: it only picks', ...r.changed] } : r) };
        }
        case 'click': case 'type': {
          const page = num('page'), n = num('n');
          if (d.readOnly(page)) return { ok: false, error: 'that is his tab, lent for reading only. To act in it, ask with browser_drive_tab (he is asked)' };
          const w = op === 'click' ? d.weightOf(page, n, 'click') : d.weightOf(page, n, 'type');
          const we = op === 'type' && a?.enter === true ? d.weightOf(page, n, 'enter') : 'free';
          const worst = w === 'never' || we === 'never' ? 'never' : w === 'lever' || we === 'lever' ? 'lever' : 'free';
          if (worst === 'never') return { ok: false, error: `that is ${d.describe(page, n)}, and buying, passwords and card details are never done for him. He has to do it himself` };
          if (worst === 'lever' && a?.allowed !== true) return { ok: false, needs: 'lever', what: `${op === 'click' ? 'press' : 'fill in and send'} ${d.describe(page, n)}` };
          // His details typed on a site outside the job's sites (a fake "quick apply" sees every key): asks him (G3).
          if (op === 'type' && a?.allowed !== true && d.offFence(page)) { const what = personal(String(a?.text ?? ''), this.privateWords()); if (what) return { ok: false, needs: 'lever', what: `type ${what} into ${d.describe(page, n)}` }; }
          const r = op === 'click' ? await d.click(page, n, a?.allowed === true) : await d.type(page, n, String(a?.text ?? ''), a?.enter === true);
          if ('needs' in r) return { ok: false, needs: r.needs, what: r.what };
          return { ok: true, ...r };
        }
        case 'scroll': await d.scroll(num('page'), a?.down !== false); return { ok: true };
        // ---- his own tabs (2026-10-14): "look at what I'm looking at", "fill this in for me". Each asks him first.
        case 'tabs': {
          // One OK is enough (2026-10-20): a plan he allowed covers seeing his tab list for that session.
          const pj = d.job(num('job'));
          if (a?.allowed !== true && !pj?.planned) return { ok: false, needs: 'lever', what: 'see the list of your open tabs' };
          const cur = this.cur();
          return { ok: true, tabs: this.tabs.filter((t) => isWeb(t.url) && !t.internal).map((t) => ({ tab: t.id, title: neverKeep(t.url) ? '(a bank or money site: hidden)' : t.title.slice(0, 120), url: neverKeep(t.url) ? '' : t.url.slice(0, 300), active: t.id === cur?.id, asleep: !t.view })) };
        }
        case 'look': case 'drivetab': {
          const t = a?.tab === undefined ? this.cur() : this.tabs.find((x) => x.id === num('tab'));
          if (!t || !isWeb(t.url) || t.internal) return { ok: false, error: 'there is no web page in that tab' };
          if (neverKeep(t.url)) return { ok: false, error: 'that tab is a bank or money site: never read or driven for a session' };
          let site = ''; try { site = new URL(t.url).hostname.replace(/^www\./, ''); } catch { /* none */ }
          // ...and reading or driving his tab on a site that plan named: he already said yes to that site this session.
          const pj = d.job(num('job'));
          const inPlan = Boolean(pj?.allowed && [...pj.allowed].some((s) => site === s || site.endsWith('.' + s)));
          // ...or reading the tab he pointed Claude at (sheet 109: Ask Claude hands that chat a pass for it).
          const passed = op === 'look' && this.passOk(a?.pass, t.id);
          if (a?.allowed !== true && !inPlan && !passed) return { ok: false, needs: 'lever', what: op === 'look' ? `read your tab on ${site}` : `drive your tab on ${site} while you watch (STOP ends it)` };
          if (!t.view) this.wake(t); else this.thaw(t);
          const wc = t.view?.webContents;
          if (!wc) return { ok: false, error: 'that tab could not be woken' };
          // A tab that was asleep has no address until its page starts loading again: borrowing it in the same instant
          // read a blank address and refused (2026-10-30, the borrow-a-tab check broke once idle tabs slept sooner).
          if (!wc.getURL()) await new Promise<void>((res) => { const done = () => { clearTimeout(to); wc.off('did-navigate', done); wc.off('did-fail-load', done); res(); }; const to = setTimeout(done, 10_000); wc.once('did-navigate', done); wc.once('did-fail-load', done); });
          if (wc.isDestroyed() || !wc.getURL()) return { ok: false, error: 'that tab was asleep and did not wake in time: ask again in a moment' };
          const r = d.borrow(num('job'), wc, t.id, op === 'drivetab');
          this.sendTabs();
          return { ok: true, ...r, yours: true };
        }
        case 'picture': {
          const what = a?.what === 'view' || a?.what === 'marks' ? a.what as 'view' | 'marks' : Number.isInteger(Number(a?.what)) ? Number(a?.what) : 'best';
          const r = await d.picture(num('page'), what);
          const p = d.page(num('page'));
          return { ok: true, png: r.png.toString('base64'), video: r.video, width: r.width, height: r.height, url: p?.url ?? '', title: p?.title ?? '' };
        }
        // His pick (2026-10-30): Samara's whole window as he sees it, for Claude and companion. His own tabs are in it, so the
        // first look in a session asks him; after his OK that session may look again.
        case 'window': {
          const j = d.job(num('job'));
          if (!j) return { ok: false, error: 'no such session' };
          if (!j.windowOk && a?.allowed !== true) return { ok: false, needs: 'lever', what: 'see your Samara window (a picture of it as you see it, kept on this computer)' };
          j.windowOk = true;
          const r = await this.seeWindow({ maxWidth: SIZES.claude, quality: 75, ms: 2500 });
          if (!r.window && !r.popout) return { ok: false, error: r.size === 'no Samara window is open' ? 'no Samara window is open' : 'the window gave no picture' };
          return { ok: true, size: r.size, window: r.window?.base64() ?? null, popout: r.popout?.base64() ?? null, missing: [...(r.window?.missing ?? []), ...(r.popout?.missing ?? [])].length };
        }
        case 'close': d.close(num('page')); return { ok: true };
        default: return { ok: false, error: 'unknown step' };
      }
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  },

  /** His own words a driving session must not type outside its job's sites without asking (private-words.json, optional:
   *  his name, street, and the like; emails and phone numbers are caught anyway). */
  privateWords(this: SamaraBrowser): string[] { const j = readJson<unknown>(path.join(this.o.stateDir, 'private-words.json'), null); return Array.isArray(j) ? j.map(String).slice(0, 50) : []; },

  noteHost(this: SamaraBrowser, site: string): string {
    const t = site.trim().toLowerCase();
    // The site's own name, so one site can never write the note another reads (AI lockdown G8: "*.github.io" shared one).
    try { return siteOf(new URL(/^https?:/.test(t) ? t : 'https://' + t).hostname); } catch { return ''; }
  },

  siteNote(this: SamaraBrowser, url: string): string { const h = this.noteHost(url); return h ? this.siteNotes[h] ?? '' : ''; },

  setSiteNote(this: SamaraBrowser, host: string, text: string): void {
    const n = this.siteNotes;
    const t = text.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 1500);
    if (t) n[host] = t; else delete n[host];
    try { writeFileAtomic(path.join(this.o.stateDir, 'driver-notes.json'), JSON.stringify(n)); } catch { /* best effort */ }
  },

  /** A driven page's site, for naming its job list. */
  pageHost(this: SamaraBrowser, id: number): string { try { return new URL(this.driver.page(id)?.url ?? '').hostname.replace(/^www\./, ''); } catch { return 'page'; } },

  /** The page a sweep runs on, or null. */
  sweepPage(this: SamaraBrowser, id: number): number | null { return this.driver.sweepPage(id); },

  /** The job a driven page belongs to, or null. */
  pageJob(this: SamaraBrowser, id: number): number | null { return this.driver.page(id)?.job ?? null; },

  /**
   * The held lever for a Claude session (the Claude door): asked in the band of the window he last used, every time.
   * Null when no browser window is open to ask in; the door then says so instead of acting.
   */
  /**
   * Show a plan and wait for his answer: in the companion's bubble when the PC has one, else dropped from Samara's band (opened
   * if needed). Null when nothing could show it, or nobody answered in five minutes.
   */
  async askPlan(this: SamaraBrowser, card: Omit<PlanCard, 'id'>): Promise<PlanAnswer | null> {
    const c: PlanCard = { ...card, id: 'samara:' + ++this.planSeq };
    // His rule (2026-11-13: "if samara needs permissions it should come from samara so i havent been able to approve the
    // smaara plan for gemini"): a plan is always asked here, in Samara's own band, never only in the companion's bubble. Before, it
    // went to the bubble first and waited there up to five minutes; a bubble he could not see (the companion just started, no
    // place yet, centred on his other screen and cut off) meant he never got to say yes.
    if (!this.lastPane()) { this.open(); await new Promise((r) => setTimeout(r, 1500)); }
    const p = this.lastPane();
    if (!p || !this.win || this.win.isDestroyed()) return null;
    this.pane = p;
    if (this.win.isMinimized()) this.win.restore();
    const answer = new Promise<PlanAnswer | null>((done) => {
      this.planWait.set(c.id, done);
      setTimeout(() => { if (this.planWait.delete(c.id)) { done(null); this.win?.webContents.send('browser:plan', null); } }, 5 * 60_000);
    });
    this.win.webContents.send('browser:plan', c);
    this.win.show();
    const a = await answer;
    return a ? this.planClean(c, a) : null;
  },

  /** His answer from the band's plan tray. Only a card that is waiting can be answered. */
  planReply(this: SamaraBrowser, id: string, a: { go?: unknown; change?: unknown; keep?: unknown; note?: unknown }): void {
    const done = this.planWait.get(id);
    if (!done) return;
    this.planWait.delete(id);
    this.win?.webContents.send('browser:plan', null);
    done({ go: a.go === true, change: a.change === true, keep: Array.isArray(a.keep) ? a.keep.map(String) : [], note: String(a.note ?? '') });
  },

  /** Whatever came back, only the card's own sites can be kept, and the note is plain words, short. */
  planClean(this: SamaraBrowser, c: PlanCard, a: PlanAnswer): PlanAnswer {
    const ours = new Set(c.sites.map((x) => x.site));
    return { card: c.id, go: a.go === true && a.change !== true, change: a.change === true, keep: a.keep.filter((x) => ours.has(x)).slice(0, 20), note: String(a.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 500) };
  },

  /** The live checklist: Claude says which step it is on (or that it is done). */
  planStep(this: SamaraBrowser, jobId: number, at: number | null): { ok: boolean; step?: string } {
    const j = this.driver.job(jobId);
    if (!j?.planned || !j.steps) return { ok: false };
    const card = this.planOfJob.get(jobId);
    // Done (2026-10-20: "if you're done driving something close it and close the session title header"): his
    // tabs go back to him, the session's own pages close, and its group goes.
    if (at === null) { if (card) this.onPlanStep?.(card, null); try { this.onPlanDone?.(jobId); } catch { /* a record only */ } this.driver.endJob(jobId); this.sendTabs(); return { ok: true }; }
    j.step = Math.max(0, Math.min(j.steps.length - 1, Math.round(at)));
    if (card) this.onPlanStep?.(card, j.step);
    this.sendTabs();
    return { ok: true, step: j.steps[j.step] };
  },

  /** Remember which card a planned job came from. */
  planJob(this: SamaraBrowser, jobId: number, card: string): void { this.planOfJob.set(jobId, card); },

  /** Would this plan site use his login? Only where his rules say so: the job sites for a job scan, or "use my login". */
  planLogin(this: SamaraBrowser, task: string, site: string): boolean {
    const r = this.rules.login(site);
    return r === true || (r === undefined && jobTask(task) && JOB_SITES.includes(siteOf(siteKey(site))));
  },

  /** The site's own icon for the card, if Samara has seen it. */
  planIcon(this: SamaraBrowser, site: string): string { return this.iconOf('https://' + siteKey(site) + '/'); },

  askForClaude(this: SamaraBrowser, what: string): Promise<boolean | null> {
    const p = this.lastPane();
    if (!p) return Promise.resolve(null);
    this.pane = p;
    // Sheet 106 scene 7: from Claude's rune, Claude's own spark on a white gem.
    const w = what.slice(0, 120).trim(), title = w.charAt(0).toUpperCase() + w.slice(1) + '?';
    return new Promise((done) => this.ask({ host: 'Claude', what: title, kick: 'Claude \u00b7 the companion', from: 'rune', claude: true,
      text: `${title.length > 30 ? `Let Claude ${w}? ` : ''}In its own tab in your browser. Only if you say yes, and only this once.`, yes: 'Allow once', no: 'No' }, done));
  },

  /** Sheet 115 B: a chat's "update the companion now" while Claude works: asked first, in the same notice as Claude's other asks. */
  askUpdate(this: SamaraBrowser, version: string, text: string): Promise<boolean | null> {
    const p = this.lastPane();
    if (!p) return Promise.resolve(null);
    this.pane = p;
    return new Promise((done) => this.ask({ host: 'Claude', what: `Restart Samara for ${version.slice(0, 20)}?`, kick: 'Claude \u00b7 the companion', from: 'rune', claude: true,
      text: text.slice(0, 200), yes: 'Restart now', no: 'Not now' }, done));
  },

  /** He pressed Take over on the band, on the tab in front. Only that key takes over; his clicks in the page never do. */
  takeOver(this: SamaraBrowser, job: number): void {
    const wc = this.cur()?.view?.webContents;
    const d = wc ? this.driver.drivingTab(wc) : null;
    if (!d || d.job !== job || !d.working || this.hands.has(d.page)) return;
    if (!this.handStart(d.page, 'you', '')) return;
    const p = this.driver.page(d.page);
    this.tell(job, `The user took over page ${d.page}: it is his until he hands it back. Leave it alone. Your other pages keep going. You will be told when he hands it back.`, p?.title ?? '');
  },

  handStart(this: SamaraBrowser, page: number, mode: 'you' | 'turn', why: string): Hand | null {
    const p = this.driver.page(page);
    if (!p?.borrowed) return null;
    const h: Hand = { page, job: p.job, tab: p.borrowed.tab, mode, why, filled: [], clicked: [], at: Date.now() };
    this.hands.set(page, h);
    this.handTold.delete(page);
    try { p.wc.send('tab:watchhim', true); } catch { /* gone */ }
    this.sendTabs();
    return h;
  },

  /** He handed back (the card's key, or Claude took it back when he said so in the chat). */
  handEnd(this: SamaraBrowser, page: number, note: string): HandReport | null {
    const h = this.hands.get(page);
    if (!h) return null;
    this.hands.delete(page);
    const p = this.driver.page(page);
    if (p) { try { p.wc.send('tab:watchhim', false); } catch { /* gone */ } }
    const r = reportOf(h, p?.wc.getTitle() || p?.title || '', p?.wc.getURL() || p?.url || '', note);
    const w = this.handWait.get(page);
    if (w) { this.handWait.delete(page); w(r); } else this.handTold.set(page, { job: h.job, report: r });
    // Frame F: what Claude is told, on the card for a few seconds.
    this.handAfter = { tab: h.tab, rows: cardRows(r), until: Date.now() + 6000 };
    if (this.handAfterT) clearTimeout(this.handAfterT);
    this.handAfterT = setTimeout(() => { this.handAfter = null; this.handPaint(); }, 6100);
    this.sendTabs();
    return r;
  },

  /** The card's Hand back, from the layer it is on: the hand on that window's tab in front. */
  handBack(this: SamaraBrowser, sender: Electron.WebContents, note: unknown): void {
    const P = this.panes.find((x) => x.handV && !x.handV.webContents.isDestroyed() && x.handV.webContents === sender);
    if (!P) return;
    const t = this.tabs.find((x) => x.id === P.active);
    const h = t ? [...this.hands.values()].find((x) => x.tab === t.id) : undefined;
    if (h) this.handEnd(h.page, String(note ?? '').slice(0, 300));
  },

  handSize(this: SamaraBrowser, sender: Electron.WebContents, h: number): void {
    const P = this.panes.find((x) => x.handV && !x.handV.webContents.isDestroyed() && x.handV.webContents === sender);
    if (!P || !Number.isFinite(h) || h <= 0 || P.handH === Math.round(h)) return;
    P.handH = Math.round(h);
    this.handPlace(P);
  },

  /** The band says where its address bar ends. */
  setHandSpot(this: SamaraBrowser, x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (this.handSpot?.x === x && this.handSpot?.y === y) return;
    this.handSpot = { x, y };
    this.handPaint();
  },

  /** A tab's page asks whether he has it (it then names what he fills and clicks; never values). */
  handWatching(this: SamaraBrowser, wc: Electron.WebContents): boolean { return [...this.hands.values()].some((h) => this.driver.page(h.page)?.wc === wc); },

  handDid(this: SamaraBrowser, wc: Electron.WebContents, m: unknown): void {
    const h = [...this.hands.values()].find((x) => this.driver.page(x.page)?.wc === wc);
    if (h && m && typeof m === 'object') noteDid(h, m as { kind?: unknown; name?: unknown });
  },

  handView(this: SamaraBrowser, P: Pane): WebContentsView | null {
    const w = P.win;
    if (!w || w.isDestroyed()) return null;
    if (P.handV && !P.handV.webContents.isDestroyed()) return P.handV;
    const v = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, preload: path.join(path.dirname(this.o.preloadPath), 'handpreload.cjs'), backgroundThrottling: false } });
    lockDown(v.webContents);
    v.setBackgroundColor('#00000000');
    v.setVisible(false);
    v.webContents.on('did-finish-load', () => { P.handReady = true; P.handLast = ''; this.handPaint(); });
    void v.webContents.loadURL(`${this.o.origin}/handcard.html`).catch(() => { /* its window closed while it loaded */ });
    P.handV = v;
    return v;
  },

  /** Card width plus the layer's room for the frame's caps and shadow (handcard.css). */
  handPlace(this: SamaraBrowser, P: Pane): void {
    const v = P.handV, w = P.win, s = this.handSpot;
    if (!v || v.webContents.isDestroyed() || !w || w.isDestroyed() || !s) return;
    const [cw, ch] = w.getContentSize();
    const W = 330 + 24, H = (P.handH ?? 200) + 12 + 34;
    // Hung under the address bar's end, 18 px down, its right edge 4 px in (the sheet's frames D to F).
    const x = Math.max(0, Math.min(cw - W, Math.round(s.x - 4 - 330 - 12))), y = Math.round(s.y + 18 - 12);
    v.setBounds({ x, y, width: W, height: Math.max(0, Math.min(H, ch - y)) });
  },

  /** Show the card for the tab in front of each window, or hide it. Cheap: only a change is sent. */
  handPaint(this: SamaraBrowser): void {
    // A job that ended (STOP, done) takes its hands with it, and Claude's wait is answered.
    for (const [page, h] of [...this.hands]) {
      const j = this.driver.job(h.job);
      if (this.driver.page(page) && j?.working) continue;
      this.hands.delete(page);
      const p = this.driver.page(page);
      if (p) { try { p.wc.send('tab:watchhim', false); } catch { /* gone */ } }
      const w = this.handWait.get(page); if (w) { this.handWait.delete(page); w(null); }
      if (this.handAfter?.tab === h.tab) this.handAfter = null;
    }
    for (const P of this.panes) {
      if (!P.win || P.win.isDestroyed()) continue;
      const h = [...this.hands.values()].find((x) => x.tab === P.active);
      const after = !h && this.handAfter && this.handAfter.tab === P.active && this.handAfter.until > Date.now() ? this.handAfter : null;
      const show = !this.handSpot || P.drawerOpen || P.watching !== null ? null
        : h ? { kick: h.mode === 'turn' ? 'YOUR TURN' : 'YOU HAVE IT', title: h.mode === 'turn' ? h.why || 'Your turn' : this.driver.job(h.job)?.name || 'Your tab', hand: true }
        : after ? { kick: 'CLAUDE IS TOLD', title: 'What changed', rows: after.rows } : null;
      const key = JSON.stringify(show);
      if (key === P.handLast) continue;
      P.handLast = key;
      if (!show) { if (P.handV && !P.handV.webContents.isDestroyed()) { P.handV.webContents.send('hand:show', null); P.handV.setVisible(false); } continue; }
      const v = this.handView(P);
      if (!v) continue;
      if (!P.handReady) { P.handLast = ''; continue; }   // drawn once it has loaded
      this.handPlace(P);
      P.win.contentView.addChildView(v);                                    // on top of the page
      v.setVisible(true);
      v.webContents.send('hand:show', show);
    }
  },

  /** Claude gave him the turn: the card says why, and this waits (up to ~3 minutes) for him to hand back. */
  /**
   * The second loop (loopcatch.ts): he is asked to take over, on the tab, the way browser_your_turn asks ("Stuck on
   * "Apply". Take over?"), and the session waits for him. A page he cannot take (the companion's hidden pages) or a session that
   * cannot wait gets words to tell him itself.
   */
  async stuckAsk(this: SamaraBrowser, page: number, n: number | undefined): Promise<string> {
    const p = this.driver.page(page);
    if (!p?.borrowed?.drive || !this.driver.job(p.job)?.working) return 'LOOP AGAIN: this step is still not working. Stop repeating it, and tell the user in one line what is stuck and what you tried.';
    const label = n !== undefined ? (this.driver.describe(page, n).match(/^"([^"]*)"/)?.[1] ?? '') : '';
    console.log(`shell: driver: job ${p.job} looped twice on page ${page}; asking him to take over`);
    // Two minutes, not the full wait: the step itself already took some of the door's three (claude-door-mcp.mjs post).
    const r = await this.yourTurn(page, label ? `Stuck on "${label}". Take over?` : 'Stuck here. Take over?', 120_000);
    if (r.still) return `LOOP AGAIN: Samara asked the user to take over page ${page} (he has not answered yet). Do not repeat the step: call browser_your_turn with page ${page} to keep waiting for him.`;
    if (!r.ok) return String(r.error ?? 'The user was asked to take over, and the job has ended');
    const said = reportLines(r.report as HandReport);
    return `LOOP AGAIN, so Samara asked the user to take over page ${page}. He has handed it back.\n${said.his}\n${said.seen}\nRead the page again before the next step.`;
  },

  async yourTurn(this: SamaraBrowser, page: number, why: string, ms = YOUR_TURN_MS): Promise<Record<string, unknown>> {
    const p = this.driver.page(page);
    if (!p?.borrowed?.drive) return { ok: false, error: 'browser_your_turn is for a tab you are driving (your own, or his with browser_drive_tab). This page is not one: tell him in the chat instead.' };
    if (!this.driver.job(p.job)?.working) return { ok: false, error: 'this job has ended' };
    const h = this.hands.get(page);
    if (!h) this.handStart(page, 'turn', cleanWhy(why) || 'Your turn');
    else if (why && h.mode === 'turn') { h.why = cleanWhy(why); this.handPaint(); }
    const prev = this.handWait.get(page);
    if (prev) prev(null);
    const r = await new Promise<HandReport | null | 'wait'>((done) => {
      const t = setTimeout(() => { if (this.handWait.get(page) === f) { this.handWait.delete(page); done('wait'); } }, ms);
      const f = (x: HandReport | null) => { clearTimeout(t); done(x); };
      this.handWait.set(page, f);
    });
    if (r === 'wait') return { ok: true, still: true };
    if (!r) return { ok: false, error: 'The user pressed STOP (or the tab closed), so this job has ended' };
    return { ok: true, report: r };
  },

  /**
   * Sheet 111 (2026-10-31): he dragged tabs out of Claude's group into his own. Each is his now, a plain tab
   * (close, sleep, trails, tabs under it): the job lets go of it, and the session is told with its next step.
   */
  takeFromClaude(this: SamaraBrowser, ids: number[]): void {
    for (const id of ids) {
      const p = this.driver.pageOfTab(id);
      const j = p ? this.driver.job(p.job) : undefined;
      if (!p || j?.kind !== 'claude') continue;
      this.handOff(p.id);
      const r = this.driver.release(p.id);
      const t = this.tabs.find((x) => x.id === id);
      if (t) { t.claude = false; t.muted = false; try { t.view?.webContents.setAudioMuted(false); } catch { /* gone */ } }
      if (r) this.tell(r.job, `The user took page ${p.id} for himself: he dragged it out of your group into his own tabs. It is not yours any more: nothing more is done there. Your other pages keep going.`, r.title);
    }
  },

  /** Something he did that the session hears with its next step (sheet 111). The page's own title is marked as data. */
  tell(this: SamaraBrowser, job: number, line: string, title = ''): void {
    const l = this.news.get(job) ?? [];
    l.push(title ? `${line}\nThat page's title, the website's own words: ${JSON.stringify(title.slice(0, 120))}` : line);
    this.news.set(job, l.slice(-8));
  },

  /** The door: this chat's token now owns this job. */
  claudeBind(this: SamaraBrowser, job: number, token: string): void { if (token) this.keepTokens.set(job, token); this.keepSeen.set(job, Date.now()); this.saveClaudeSoon(); },

  /** The door: this job's chat called in. */
  claudeSeen(this: SamaraBrowser, job: number): void { if (this.driver.job(job)) this.keepSeen.set(job, Date.now()); },

  /** The door: this job's chat ended. */
  claudeGone(this: SamaraBrowser, job: number): void { if (this.driver.job(job)) { this.keepSeen.set(job, 0); this.saveClaudeSoon(); } },

  /** A job kept from before a restart (or carried on), still here. */
  claudeKept(this: SamaraBrowser, job: number): boolean { return this.keptJobs.has(job) && !!this.driver.job(job); },

  /** May this chat use this job? Another chat's token never; an old connector (no token) as before. */
  claudeOwner(this: SamaraBrowser, job: number, token: string): boolean { const t = this.keepTokens.get(job); return !t || !token || t === token; },

  claudeTokenOf(this: SamaraBrowser, job: number): string { return this.keepTokens.get(job) ?? ''; },

  /** A typed form was sent (an allowed send or apply): its kept copy goes (until sent). */
  formSent(this: SamaraBrowser, page: number): void { if (this.forms.delete(page)) this.saveClaudeSoon(); },

  keptOf(this: SamaraBrowser, j: Job): KeptJob {
    const pages = this.driver.pagesOf(j).filter((p) => !p.borrowed || p.borrowed.own).map((p) => {
      const form = this.forms.get(p.id);
      return { id: p.id, url: p.url, title: p.title, ...(form ? { form } : {}) };
    });
    const plan = j.sites ? { login: [...j.sites], denied: [...(j.denied ?? [])], allowed: [...(j.allowed ?? [])], steps: j.steps ?? [], planned: j.planned === true, step: j.step ?? 0 } : null;
    return { id: j.id, token: this.keepTokens.get(j.id) ?? '', name: j.name, at: j.at, seen: this.keepSeen.get(j.id) || Date.now(), working: j.working, stopped: j.stopped, plan, pages };
  },

  saveClaude(this: SamaraBrowser): void {
    if (!this.keepLoaded || this.keepFrozen) return;
    const jobs = this.driver.jobs.filter((j) => j.kind === 'claude').map((j) => this.keptOf(j)).filter((k) => k.pages.length);
    try { writeKept(this.keepFile, { v: 1, version: app.getVersion(), at: Date.now(), jobs }); } catch (e) { console.error('shell: claude keep: ' + (e as Error).message); }
  },

  saveClaudeSoon(this: SamaraBrowser): void {
    if (this.keepT) return;
    this.keepT = setTimeout(() => { this.keepT = null; this.saveClaude(); this.workChanged(); }, 1000);
  },

  /** Every 15 seconds: the typing in Claude's pages (his own tabs Claude drives too, for the update's wait). */
  async grabForms(this: SamaraBrowser): Promise<void> {
    let changed = false;
    const now = Date.now();
    for (const p of [...this.driver.pages]) {
      const j = this.driver.job(p.job);
      if (j?.kind !== 'claude' || (p.borrowed && !p.borrowed.own && !p.borrowed.drive) || this.refilling.has(p.id) || p.wc.isDestroyed()) continue;
      const got = await run<{ url: string; fields: KeptField[] } | null>(p.wc, FORM_GRAB_JS, { ms: 1500, fallback: null });
      if (!got || !Array.isArray(got.fields)) continue;
      const had = this.forms.get(p.id), f = cleanForm({ at: now, url: String(got.url), fields: got.fields }, now);
      if (!f) { if (had) { this.forms.delete(p.id); changed = true; } continue; }
      if (had && had.url === f.url && JSON.stringify(had.fields) === JSON.stringify(f.fields)) continue;
      this.forms.set(p.id, f); changed = true;
    }
    for (const id of [...this.forms.keys()]) if (!this.driver.page(id) || now - this.forms.get(id)!.at > 24 * 3_600_000) { this.forms.delete(id); changed = true; }
    if (changed) { this.saveClaude(); this.workChanged(); }
  },

  /** Right away, for one page (after Claude typed or picked, and before a restart). */
  async grabForm(this: SamaraBrowser, page: number): Promise<void> {
    const p = this.driver.page(page);
    if (!p || this.refilling.has(page)) return;
    const got = await run<{ url: string; fields: KeptField[] } | null>(p.wc, FORM_GRAB_JS, { ms: 1500, fallback: null });
    if (!got || !Array.isArray(got.fields)) return;
    const f = cleanForm({ at: Date.now(), url: String(got.url), fields: got.fields }, Date.now());
    if (f) this.forms.set(page, f); else this.forms.delete(page);
    this.saveClaudeSoon();
  },

  /** Before a restart (the update's Restart now): every form looked at once more, then everything written. */
  async saveClaudeNow(this: SamaraBrowser): Promise<void> {
    await Promise.race([this.grabForms(), new Promise((r) => setTimeout(r, 3000))]);
    this.saveClaude();
  },

  /** Put the kept typing back in a page that came back, as the page draws its fields (up to 12 seconds). */
  async refill(this: SamaraBrowser, page: number, form: KeptForm): Promise<{ put: number; missing: number }> {
    let r = { put: 0, missing: form.fields.length };
    for (let i = 0; i < 12; i++) {
      const p = this.driver.page(page);
      if (!p) break;
      const got = await run<{ put: number; missing: number } | null>(p.wc, formFillJs(form.fields), { ms: 2000, fallback: null });
      if (got && got.put >= r.put) r = got;
      if (got && got.missing === 0) break;
      await new Promise((x) => setTimeout(x, 1000));
    }
    return r;
  },

  /** On start: Claude's jobs from before come back, each tab under its own number, with the typing put back. */
  async restoreClaude(this: SamaraBrowser): Promise<void> {
    if (this.keepLoaded) return;
    const k = readKept(this.keepFile, Date.now());
    this.keepLoaded = true;
    if (!k.jobs.length) { this.saveClaude(); return; }
    const ver = app.getVersion(), updated = !!k.version && k.version !== ver;
    const when = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    this.driver.reserve(Math.max(...k.jobs.map((j) => j.id)), Math.max(0, ...k.jobs.flatMap((j) => j.pages.map((p) => p.id))));
    let back = 0;
    for (const kj of k.jobs) {
      let j: Job;
      try { j = this.driver.startJob('claude', kj.name, undefined, kj.id); } catch { continue; }
      if (kj.plan) { j.sites = new Set(kj.plan.login); j.denied = new Set(kj.plan.denied); j.allowed = new Set([...kj.plan.allowed, ...kj.plan.login]); j.steps = kj.plan.steps; j.step = kj.plan.step; j.planned = kj.plan.planned; }
      j.working = false; j.stopped = kj.stopped === true;
      this.keptJobs.add(j.id);
      if (kj.token) this.keepTokens.set(j.id, kj.token);
      // Not heard from yet: a gone chat until its connector calls in (then a new chat may carry it on).
      this.keepSeen.set(j.id, 0);
      const said: string[] = [], typed: string[] = [];
      for (const kp of kj.pages) {
        if (kp.form) this.refilling.add(kp.id);
        try {
          const r = await this.driver.open(j.id, kp.url, { id: kp.id });
          const p = this.driver.page(r.page), where = placeName(p?.title || kp.title, r.url);
          said.push(`page ${r.page} ${where}`); back++;
          if (kp.form) {
            const f = await this.refill(r.page, kp.form);
            this.forms.set(r.page, kp.form);
            typed.push(f.missing ? `Page ${r.page} (${where}) had typing: Samara put ${f.put} answers back, and ${f.missing} could not be found. Fill those again.`
              : `Page ${r.page} (${where}) had typing, and Samara put it back.`);
          }
        } catch (e) { said.push(`page ${kp.id} did not come back (${(e as Error).message})`); }
        finally { this.refilling.delete(kp.id); }
      }
      this.tell(j.id, [`Samara restarted at ${when}${updated ? ` (update ${ver})` : ''}. Your ${said.length} tab${said.length === 1 ? ' is' : 's are'} back, with the same page numbers: ${said.join(', ')}.`,
        ...typed, typed.length ? 'Check it with browser_check_form, and attach any files again.' : '', j.stopped ? 'This job was stopped (STOP ALL) before the restart: send a new plan to start again.' : ''].filter(Boolean).join(' '));
    }
    this.saveClaude();
    this.sendTabs();
    if (back) this.note('', { title: "Claude's tabs are back", kick: updated ? `Restarted for ${ver}` : 'Samara restarted', from: 'rune', claude: true, small: true,
      rows: [{ g: '', v: this.forms.size ? 'Your typing is back in place. Claude checks it before anything is sent.' : 'Claude carries on where it was.' }] });
  },

  /**
   * His pick (sheet 115, "It just takes them"): a new chat that carries on an old chat's job takes its group, with no
   * ask, but only when that chat is gone (not heard from in three minutes). A chat that is still going keeps its own.
   */
  carryOn(this: SamaraBrowser, token: string, name: string): { job: number; name: string; pages: { id: number; title: string }[] } | { live: string } | null {
    const now = Date.now();
    const same = this.driver.jobs.filter((j) => j.kind === 'claude' && !j.stopped && sameName(j.name, name) && this.driver.pagesOf(j).length && (!token || this.keepTokens.get(j.id) !== token));
    const gone = same.filter((j) => now - (this.keepSeen.get(j.id) ?? 0) > GONE_MS).sort((a, b) => (this.keepSeen.get(b.id) ?? 0) - (this.keepSeen.get(a.id) ?? 0));
    const j = gone[0];
    if (!j) return same.length ? { live: same[0]!.name } : null;
    if (token) this.keepTokens.set(j.id, token); else this.keepTokens.delete(j.id);
    this.keepSeen.set(j.id, now); this.keptJobs.add(j.id); j.working = true;
    this.saveClaudeSoon(); this.sendTabs();
    return { job: j.id, name: j.name, pages: this.driver.pagesOf(j).map((p) => ({ id: p.id, title: p.title })) };
  },

  /** Groups left by chats that are gone, for a new chat's plan to know it can carry one on. */
  earlierGroups(this: SamaraBrowser, token: string): string[] {
    const now = Date.now();
    return this.driver.jobs.filter((j) => j.kind === 'claude' && !j.stopped && this.driver.pagesOf(j).length && now - (this.keepSeen.get(j.id) ?? 0) > GONE_MS && (!token || this.keepTokens.get(j.id) !== token))
      .map((j) => `"${j.name}" (${this.driver.pagesOf(j).length} tab${this.driver.pagesOf(j).length === 1 ? '' : 's'})`);
  },

  /** What Claude is doing, for the update to wait on (sheet 115): filling a form beats working; null when neither. */
  claudeWork(this: SamaraBrowser): { doing: 'filling an application' | 'working'; where: string; tabs: number } | null {
    let work: { doing: 'filling an application' | 'working'; where: string; tabs: number } | null = null;
    for (const j of this.driver.jobs) {
      if (j.kind !== 'claude') continue;
      const pages = this.driver.pagesOf(j);
      const typed = pages.find((p) => hasTyping(this.forms.get(p.id)));
      if (typed) return { doing: 'filling an application', where: placeName(typed.title, typed.url), tabs: pages.length };
      if (j.working && !j.stopped && pages.length && !work) work = { doing: 'working', where: placeName(pages[0]!.title, pages[0]!.url), tabs: pages.length };
    }
    return work;
  },

  workChanged(this: SamaraBrowser): void {
    const w = this.claudeWork(), k = w ? `${w.doing}|${w.where}` : '';
    if (k !== this.lastWork) { this.lastWork = k; this.onClaudeWork?.(); }
  },

  /** A hand on a page ends without a report (the page left the job). */
  handOff(this: SamaraBrowser, page: number): void {
    if (!this.hands.delete(page)) return;
    const w = this.handWait.get(page); if (w) { this.handWait.delete(page); w(null); }
    this.handTold.delete(page);
  },

  driverAct(this: SamaraBrowser, act: string, id: number): void {
    if (act === 'stop') this.driver.stop(id);   // only after he confirms it in the page (browser.js stopKey)
    else if (act === 'close') { if (this.watching !== null && this.driver.page(this.watching)?.job === id) this.unwatch(); this.driver.closeJob(id); }
    else if (act === 'watch') this.watch(id);
    else if (act === 'unwatch') this.unwatch();
    else if (act === 'open') { const p = this.driver.page(id); if (p && isWeb(p.url)) { this.unwatch(false); this.newTab(p.url); } }
    else if (act === 'takeover') this.takeOver(id);
    // Sheet 111: a row in Claude's group is a real tab: a click goes into it.
    else if (act === 'show') { const p = this.driver.page(id); if (p?.borrowed) { this.unwatch(false); this.activate(p.borrowed.tab); } }
    this.sendTabs();
  },

  /** A live picture of one of the companion's pages in the page area: his own tab steps aside, nothing is handed over. */
  watch(this: SamaraBrowser, pageId: number): void {
    const w = this.win;
    if (!w || w.isDestroyed() || !this.driver.page(pageId)) return;
    if (this.watching !== null && this.watching !== pageId) this.driver.watched(this.watching, null);
    this.watching = pageId;
    const [cw, ch] = w.getContentSize();
    this.driver.watched(pageId, { width: cw - this.inset.left - this.inset.right, height: ch - this.inset.top - this.inset.bottom });
    const t = this.cur();
    if (t?.view && !t.lent) t.view.setVisible(false);
    this.veilDown(0);
    const P = this.pane;
    const tick = async () => {
      if (P.watching !== pageId) return;
      const src = await this.driver.glance(pageId);
      this.pane = P;
      if (this.watching !== pageId || !this.win || this.win.isDestroyed()) return;
      this.win.webContents.send('browser:watch', src);
      this.watchTimer = setTimeout(() => void tick(), 700);
    };
    if (this.watchTimer) clearTimeout(this.watchTimer);
    void tick();
    this.sendTabs();
  },

  unwatch(this: SamaraBrowser, show = true): void {
    if (this.watching === null) return;
    this.driver.watched(this.watching, null);
    this.watching = null;
    if (this.watchTimer) { clearTimeout(this.watchTimer); this.watchTimer = null; }
    this.win?.webContents.send('browser:watch', null);
    const t = this.cur();
    if (show && t?.view && !t.lent && !this.drawerOpen) { this.place(); t.view.setVisible(true); }
    this.sendTabs();
  }
};
