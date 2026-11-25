// Phase 4 (2026-11-24): SamaraBrowser's mockups methods, moved out of browser.ts unchanged. They run as the browser's own
// methods (browser.ts puts them on SamaraBrowser.prototype), so `this` is the browser.
import { BrowserWindow, screen, systemPreferences, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SAFE_WEB_PREFERENCES, lockDown } from './safety.ts';
import { run, within } from './page.ts';
import { capture } from './capture.ts';
import { addressFor } from './address.ts';
import { writeFileAtomic } from './atomic.ts';
import { readJson } from './store.ts';
import { saysDecided, sheetLabel, tidyDue, tidyLine } from './mockuptidy.ts';
import { KNOWN_PROJECTS, NO_TOPIC, branchHome, cleanTitle, isSamaraRepo, plainName, projectName, shownNum } from './mockfiling.ts';
import { HOME_NAME, artOf, diskReader, gather, homeHead, homeReady, keep, newShown, projectFolder, pullHome, pushHome, ART_DIRS } from './mockhome.ts';
import { LOGO_SPOTS, logoSlug, srcOf, cleanPath, cleanSheet, findRepo, git, liveTitle, notesFrom, resolveVersion, sheetKind, splitRepoSheet } from './mockups.ts';
import type { MockSend, MockSendItem, MockStage, MockVersion, MockupDrop } from './mockups.ts';
import type { SamaraBrowser, Tab } from './browser.ts';
import { isWeb, toggleFull, fitShot, SAMARA_SHOT } from './browser.ts';

export const MockupsPart = {
  /**
   * Claude opened a mockup (a .mockup file in open-urls, main.ts). Its version as it is now (HEAD) goes into the history,
   * and its sheet's tab shows it: a newer version of a sheet already open updates that same tab, never a new one .
   * branch: the branch Claude was told to file it in (mockups.ts fileInto has the rules).
   */
  async openMockup(this: SamaraBrowser, sheet: string, title = '', branch: string | null = null, o: { project?: string | null; icon?: string | null } = {}): Promise<MockVersion | null> {
    if (!this.mockServer || !this.mockStore) return this.mockNo("Samara's Mockups trail is not on.");
    if (cleanSheet(sheet) !== sheet) return this.mockNo(`${sheet.slice(0, 200)} is not a sheet name Samara takes.`);
    if (!(await this.mockReady)) return this.mockNo("Samara's mockup server did not start.");
    // 2026-10-22: a live page has no versions to look up: it is shown as it is, always V1.
    const where = this.mockWhere(sheet);
    const r = sheetKind(sheet) === 'live' ? { commit: '', key: 'live', title: liveTitle(sheet) } : where ? await resolveVersion(where.repo, where.rel) : null;
    if (!r) return this.mockNo(`${sheet} is not in the repo's last commit, not opened. Commit it into the private mockups repo (${this.mockHomeWant || '~/projects/mockups'}, under <project folder>/<same path>), never a public project repo, then send again.`);
    const ver = this.mockStore.add(sheet, title || r.title, r.commit, r.key, Date.now(), { project: o.project ?? null });
    // A branch Claude named (checked in cleanBranch): the same move as his Move to branch, children following.
    if (branch) this.mockStore.fileInto(ver.sheet, branch, o);
    // Sheet 107: NEW on it until he opens it, and Mockups opens right on it, in its project's tab.
    this.mockStore.setFresh(ver.sheet, true);
    this.showMockup(ver);
    this.sendTabs();
    return ver;
  },

  /**
   * A .mockup file (main.ts), any of its three kinds (2026-10-22): a sheet of this repo, a page in another session's repo
   * (registered by name in mockups.json, then @<name>/<path>), or a live page on this computer.
   */
  async openMockupDrop(this: SamaraBrowser, m: MockupDrop): Promise<MockVersion | null> {
    if (!this.mockStore) return this.mockNo("Samara's Mockups trail is not on.");
    this.mockHomeAdopt();
    const o = { project: m.project ?? null, icon: m.icon ?? null };
    if (m.url) return this.openMockup(m.url, m.title, m.branch, o);
    // 2026-10-31: a page from any project is copied into the mockups home and shown from there (mockhome.ts).
    if (this.mockHome) return this.mockKeep(m);
    if (!m.repo) return this.openMockup(m.path, m.title, m.branch, o);
    const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    // the repo Samara lives in, named by its folder: its own rules (only the mockup folders are served).
    if (this.mockRepo && same(path.resolve(m.repo), path.resolve(this.mockRepo))) return cleanPath(m.path) ? this.openMockup(m.path, m.title, m.branch, o) : this.mockNo('In this repo, mockups live under docs/, src/Shell/pages/ or assets/.');
    if (!findRepo(m.repo)) return this.mockNo('not a git repo, not opened: ' + m.repo);
    const sheet = `@${this.mockStore.repoName(path.resolve(m.repo))}/${m.path}`;
    this.mockFindLogo(path.resolve(m.repo), m.project ?? this.mockStore.projectOf(sheet));
    return this.openMockup(`@${this.mockStore.repoName(path.resolve(m.repo))}/${m.path}`, m.title, m.branch, o);
  },

  /** openMockupDrop, with why it was not opened (Samara's mockup door answers Claude with it, never a silent no). */
  async openMockupDropWhy(this: SamaraBrowser, m: MockupDrop): Promise<MockVersion | string> {
    this.mockWhy = '';
    const v = await this.openMockupDrop(m);
    return v ?? (this.mockWhy || 'Samara did not open it (see shell.log).');
  },

  mockHomeAdopt(this: SamaraBrowser): void {
    const home = this.mockHomeWant;
    if (this.mockHome || !home || !this.mockStore || !this.mockServer || !homeReady(home)) return;
    this.mockHome = home;
    this.mockStore.setHome(home);
    this.mockServer.art = (commit, rel) => this.mockArt(commit, rel);
    setTimeout(() => { void this.mockHomeWake(); }, 8000).unref?.();
    setInterval(() => { void this.mockHomeWake(); }, 20 * 60_000).unref?.();
  },

  mockNo(this: SamaraBrowser, why: string): null { this.mockWhy = why; console.log('shell: mockups: ' + why); return null; },

  /**
   * A page Claude showed, kept in the mockups home (2026-10-31): the page, its helper folder and what it links,
   * copied from its project's folder as it is now under <project>/<same path>, committed, sent to GitHub for the other
   * machine, and opened from there. Samara's own art stays out (served by mockArt). The project is never touched.
   */
  async mockKeep(this: SamaraBrowser, m: MockupDrop): Promise<MockVersion | null> {
    const root = m.repo ?? this.mockRepo;
    if (!root || !this.mockStore) return this.mockNo('The page has no project folder.');
    const samara = isSamaraRepo(path.basename(root)) || (!!this.mockRepo && path.resolve(root) === path.resolve(this.mockRepo));
    const project = projectName(m.project) ?? (m.branch ? branchHome(m.branch).project : null) ?? (samara ? 'Samara' : plainName(path.basename(root)));
    const files = await gather(diskReader(root), m.path, samara ? (rel) => ART_DIRS.some((d) => rel.startsWith(d)) : undefined);
    if (!files.has(m.path)) return this.mockNo(`${m.path} could not be read in ${root}, not kept.`);
    // Which Samara the art comes from: the repo's commit now (and the repo, remembered by name for the art).
    let art = '';
    if (samara) { this.mockStore.repoName(path.resolve(root)); art = await homeHead(root); }
    const kept = await keep(this.mockHome, projectFolder(project), files, { page: m.path, title: m.title, topic: m.branch ?? '', project, icon: m.icon ?? '', art: /^[0-9a-f]{40}$/.test(art) ? art : '' });
    if (!kept) return this.mockNo(`${m.path} could not be committed into the mockups repo ${this.mockHome} (git failed there).`);
    this.mockFindLogo(path.resolve(root), project);
    void pushHome(this.mockHome).then((ok) => { if (!ok) console.log('shell: mockups: the home could not be sent to GitHub now; the next show or start tries again'); });
    const v = await this.openMockup(`@${HOME_NAME}/${kept.sheet}`, m.title, m.branch, { project, icon: m.icon ?? null });
    if (v) this.mockSaySeen(kept.commit);
    return v;
  },

  /** The newest home commit already filed here, so a start files only what came after (Claude's own, the other machine's). */
  mockSaySeen(this: SamaraBrowser, commit: string): void {
    if (!this.mockSeenFile || !/^[0-9a-f]{40}$/.test(commit)) return;
    void homeHead(this.mockHome).then((h) => { if (h === commit) writeFileAtomic(this.mockSeenFile, JSON.stringify({ head: h })); });
  },

  /**
   * The home, when Samara starts (and every 20 minutes): the other machine's mockups pulled in, and every page a commit
   * files (Mockup: lines, his fallback rule: Claude saved it while Samara was off) put in the trail, marked NEW. Then
   * anything not yet on GitHub is sent.
   */
  async mockHomeWake(this: SamaraBrowser): Promise<number> {
    const st = this.mockStore, home = this.mockHome;
    if (!st || !home) return 0;
    await pullHome(home);
    const seen = readJson<{ head?: unknown }>(this.mockSeenFile, {}).head;
    const list = await newShown(home, typeof seen === 'string' ? seen : '');
    let n = 0;
    for (const t of list) {
      const sheet = `@${HOME_NAME}/${t.sheet}`;
      if (st.list.some((x) => (x.sheet === sheet || srcOf(x) === sheet) && x.commit === t.commit)) continue;
      const r = await resolveVersion(home, t.sheet, t.commit);
      if (!r) continue;
      const project = projectName(t.project) ?? null;
      const ver = st.add(sheet, t.title || r.title, r.commit, r.key, t.at, { project });
      if (t.topic) st.fileInto(ver.sheet, t.topic, { project, icon: t.icon || null });
      st.setFresh(ver.sheet, true);
      n++;
    }
    const head = await homeHead(home);
    if (/^[0-9a-f]{40}$/.test(head)) writeFileAtomic(this.mockSeenFile, JSON.stringify({ head }));
    if (n) { console.log(`shell: mockups: ${n} kept while Samara was off, filed now`); this.mockLogSig = ''; this.pushMockLog(); this.sendTabs(); }
    void pushHome(home);
    return n;
  },

  /**
   * Samara's own art for one of its sheets in the home (src/Shell/pages/..., assets/...): from Samara's repo at the commit
   * the sheet was shown with, else as it is in that repo now, else from this Samara's own files.
   */
  async mockArt(this: SamaraBrowser, commit: string, rel: string): Promise<Buffer | null> {
    if (!this.mockHome) return null;
    if (!this.mockArtAt.has(commit)) this.mockArtAt.set(commit, await artOf(this.mockHome, commit));
    const at = this.mockArtAt.get(commit)!;
    const repos = [this.mockRepo, ...[...(this.mockStore?.repos ?? new Map<string, string>())].filter(([n]) => isSamaraRepo(n)).map(([, d]) => d)].filter((d) => d && findRepo(d));
    for (const repo of repos) {
      const b = at ? await git(repo, ['cat-file', 'blob', `${at}:${rel}`], true) : null;
      if (Buffer.isBuffer(b)) return b;
    }
    const shell = path.join(import.meta.dirname, '..');
    const spots = [...repos.map((d) => path.join(d, ...rel.split('/'))),
      rel.startsWith('src/Shell/pages/') ? path.join(shell, 'pages', ...rel.slice('src/Shell/pages/'.length).split('/')) : path.join(shell, ...rel.split('/')),
      path.join(shell, '..', '..', ...rel.split('/'))];
    for (const f of spots) { try { if (statSync(f).isFile()) return readFileSync(f); } catch { /* not here */ } }
    return null;
  },

  /** Where a sheet's file is: its repo's folder and its path inside it. Null for a live page or an unknown repo. */
  mockWhere(this: SamaraBrowser, sheet: string): { repo: string; rel: string } | null {
    const k = sheetKind(sheet);
    if (k === 'home') return this.mockRepo ? { repo: this.mockRepo, rel: sheet } : null;
    if (k !== 'repo') return null;
    const r = splitRepoSheet(sheet), dir = r ? this.mockStore?.repoPath(r.name) : null;
    return r && dir ? { repo: dir, rel: r.rel } : null;
  },

  /**
   * One version, exactly as it was (sheet 107, 2026-10-30): Mockups opens on it, inside Mockups, at its true size.
   * No tab of its own any more. Opens Samara if it is closed.
   */
  showMockup(this: SamaraBrowser, ver: MockVersion): void {
    this.mockFocus = { n: (this.mockFocus?.n ?? 0) + 1, sheet: ver.sheet, id: ver.id };
    this.mockStore?.opened(ver.sheet);
    this.openMockLog();
    this.mockLogSig = '';
    this.pushMockLog();
  },

  /** "Mockups" in the ... menu: the trail comes back, even after he closed it, and the Mockups tab opens. */
  reopenMockups(this: SamaraBrowser): void {
    if (!this.mockStore) return;
    void this.mockTidy(false);
    if (!this.mockStore.list.length) { this.note('No mockups yet. When Claude opens one, it lands here.'); this.sendTabs(); return; }
    this.openMockLog();
  },

  /** One version as it travels: everything from mockups.json and git, the picture from its tab or a hidden page. */
  async mockItem(this: SamaraBrowser, ver: MockVersion, picture: boolean): Promise<MockSendItem> {
    const st = this.mockStore!;
    const branchId = st.placeOf(ver.sheet).branch;
    // A live page (2026-10-22) has no file to read notes from; another repo's sheet is read from its own repo.
    const where = ver.commit ? this.mockWhere(ver.sheet) : null;
    const html = where ? await git(where.repo, ['cat-file', 'blob', `${ver.commit}:${where.rel}`]) : null;
    return {
      kind: 'mockup', title: ver.title, version: 'V' + ver.v, branch: st.branches.find((b) => b.id === branchId)?.name ?? null,
      sheet: ver.sheet, commit: ver.commit, url: this.mockServer!.url(ver.commit, ver.sheet),
      notes: typeof html === 'string' ? notesFrom(html) : '', picture: picture ? await this.mockShot(ver) : null,
    };
  },

  /** Sheet 100: each project's own logo, when it has one (served as /p/<slug>.png), by project name. */
  mockLogos(this: SamaraBrowser): Record<string, string> {
    const out: Record<string, string> = {};
    if (!this.mockServer || !this.mockStore || !this.mockThumbs) return out;
    const dir = path.join(path.dirname(this.mockThumbs), 'mocklogos');
    const names = new Set([...this.mockStore.list.map((x) => this.mockStore!.projectOf(x.sheet)), ...this.mockStore.branches.map((b) => b.project ?? '')].filter(Boolean));
    for (const n of names) if (existsSync(path.join(dir, logoSlug(n) + '.png'))) out[n] = `${this.mockServer.origin}/p/${logoSlug(n)}.png`;
    return out;
  },

  /** A repo a mockup came from: its logo, found in the usual spots, kept for its project (once; his own choice is never replaced). */
  mockFindLogo(this: SamaraBrowser, repo: string, project: string): void {
    if (!this.mockThumbs) return;
    const dir = path.join(path.dirname(this.mockThumbs), 'mocklogos'), to = path.join(dir, logoSlug(project) + '.png');
    if (existsSync(to)) return;
    for (const spot of LOGO_SPOTS) {
      const f = path.join(repo, spot);
      try { const b = readFileSync(f); if (b.length < 4_000_000 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) { mkdirSync(dir, { recursive: true }); writeFileSync(to, b); return; } } catch { /* not here */ }
    }
  },

  /**
   * A picture of one version. Its own tab when that tab shows exactly this picture; otherwise a hidden window off screen,
   * in a session of its own that keeps nothing, opened on the versioned page and closed again.
   */
  async mockShot(this: SamaraBrowser, ver: MockVersion): Promise<string | null> {
    const t = this.tabs.find((x) => x.mock?.sheet === ver.sheet && x.mock.key === ver.key && x.view && !x.crashed && !x.lent && !x.loading);
    // A tab hidden under the drawer gives an empty picture: then the hidden page below takes it.
    if (t?.view) { const shot = fitShot(await capture(t.view, SAMARA_SHOT)); if (shot) return shot; }
    const w = new BrowserWindow({ show: false, width: 1280, height: 860, webPreferences: { ...SAFE_WEB_PREFERENCES, partition: 'samara-mockshot', offscreen: true } });
    try {
      lockDown(w.webContents);
      const loaded = await within(w.loadURL(this.mockServer!.url(ver.commit, ver.sheet)).then(() => true), 8000, false);
      if (!loaded) return null;
      await new Promise((r) => setTimeout(r, 500));
      return fitShot(await capture(w, SAMARA_SHOT));
    } catch { return null; }
    finally { if (!w.isDestroyed()) w.destroy(); }
  },

  /** Send to companion: one version (a tab's, or a history line's), or a whole branch. Ids only, each looked up here. */
  async mockSend(this: SamaraBrowser, what: 'tab' | 'version' | 'branch', id: number): Promise<MockSend | null> {
    const st = this.mockStore, send = this.sendMock;
    if (!st || !send || !Number.isInteger(id)) return null;
    let out: MockSend | null = null;
    if (what === 'version') { const v = st.get(id); if (v) out = await this.mockItem(v, true); }
    else if (what === 'tab') {
      const t = this.tabs.find((x) => x.id === id && x.mock);
      const v = t ? [...st.list].filter((x) => x.sheet === t.mock!.sheet && x.key === t.mock!.key).sort((a, b) => b.at - a.at)[0] : undefined;
      if (v) out = await this.mockItem(v, true);
    } else {
      const b = st.branches.find((x) => x.id === id);
      if (b) {
        // Each mockup in the branch (children too), its newest version, newest first; pictures for the first 4 only.
        const sheets = [...new Set(st.list.map((x) => x.sheet))].filter((s) => st.placeOf(s).branch === b.id);
        const newest = sheets.map((s) => st.list.filter((x) => x.sheet === s).sort((p, q) => q.at - p.at || q.id - p.id)[0]!).sort((p, q) => q.at - p.at).slice(0, 20);
        const items: MockSendItem[] = [];
        for (const [i, v] of newest.entries()) items.push(await this.mockItem(v, i < 4));
        if (items.length) out = { kind: 'mockups', branch: b.name, items };
      }
    }
    if (out && this.sendMock) this.sendMock(out);
    return out;
  },

  /**
   * The frame's clicks: a version to show, the history list opened or shut, the broom, and his moves in the family tree
   * (2026-10-21: branches > mockups > children, all by hand, kept in mockups.json with the history).
   */
  /** Sheet 79: every marked version, for Claude (and the companion): which sheet, which version, which stage, his words. */
  mockStages(this: SamaraBrowser): unknown[] { return this.mockStore?.stages() ?? []; },

  /**
   * Claude's mark on one version of a sheet in his repo (sheet 79): approved only with his words from the chat (it shows
   * as APPROVED · CHAT), built once it is in Samara, fix with a note, park, or clear. The newest version unless `v`.
   */
  mockMark(this: SamaraBrowser, a: { repo: string; sheet: string; v: number | null; stage: string; said: string; note: string }): string {
    const st = this.mockStore;
    if (!st) return "This Samara has no Mockups trail.";
    const names = a.repo ? [...st.repos.entries()].filter(([, p]) => path.resolve(p) === path.resolve(a.repo)).map(([n]) => `@${n}/${a.sheet}`) : [];
    const keys = [a.sheet, ...names];
    // 2026-10-31: a page kept in the mockups home is <project folder>/<its path in the project> there.
    for (const x of st.list) { const m = new RegExp(`^@${HOME_NAME}/[^/]+/(.+)$`).exec(x.sheet); if (m && m[1] === a.sheet && !keys.includes(x.sheet)) keys.push(x.sheet); }
    // Sheet 107: a page shown from another folder (a worktree) may have joined the sheet it already was; its address finds it.
    const found = new Set(st.list.filter((x) => keys.includes(x.sheet) || keys.includes(srcOf(x))).map((x) => x.sheet));
    const mine = st.list.filter((x) => found.has(x.sheet));
    if (!mine.length) return 'That sheet is not in the Mockups trail yet: show it first (show_mockup).';
    const v = a.v === null ? mine.reduce((m, x) => (x.v > m.v ? x : m)) : mine.find((x) => x.v === a.v);
    if (!v) return `That sheet has no version ${a.v}.`;
    const map: Record<string, MockStage | null> = { approved: 'chat', built: 'built', fix: 'fix', park: 'park', clear: null };
    if (!(a.stage in map)) return 'stage is one of: approved, built, fix, park, clear.';
    if (a.stage === 'approved' && !a.said.trim()) return "An approval needs his own words from the chat in said (what he wrote when he said yes).";
    const why = st.setStage(v.id, map[a.stage]!, { said: a.said, note: a.note, by: 'claude' });
    if (!why) { this.sendTabs(); this.sync?.changed('mstages'); }
    return why;
  },

  mockAct(this: SamaraBrowser, act: string, a: { id?: number; sheet?: string; to?: string | number | null; name?: string; open?: boolean } = {}): void {
    const st = this.mockStore;
    if (!st) return;
    const known = (s: unknown): s is string => typeof s === 'string' && st.list.some((x) => x.sheet === s);
    let why = '';
    switch (act) {
      case 'show': { const v = Number.isInteger(a.id) ? st.get(a.id!) : undefined; if (v) this.showMockup(v); return; }
      // Send to companion: the page names a number only; the Shell builds what goes.
      case 'send': case 'sendtab': case 'sendbranch': if (Number.isInteger(a.id)) void this.mockSend(act === 'send' ? 'version' : act === 'sendtab' ? 'tab' : 'branch', a.id!); return;
      // The tidy (2026-10-22): "Tidy now" in the trail's head; Archive, Restore and Picked from a sheet's menu.
      case 'tidy': void this.mockTidy(true); return;
      case 'archive': if (known(a.sheet)) why = st.archive(a.sheet); break;
      case 'restore': if (known(a.sheet)) why = st.restore(a.sheet); break;
      case 'pick': if (known(a.sheet)) why = st.setPicked(a.sheet, a.open === true); break;
      // Sheet 79: his mark on one version (FIX with a note, APPROVED, PARKED), or taking it off (null).
      case 'stage': { const sg = a.to === null || a.to === '' ? null : String(a.to) as MockStage;
        if (Number.isInteger(a.id) && (sg === null || ['fix', 'ok', 'park'].includes(sg))) why = st.setStage(a.id!, sg, { note: String(a.name ?? '').slice(0, 300), by: 'you' });
        if (!why) this.sync?.changed('mstages');
        break; }
      // Sheet 100: the magnifier on the trail's head, the quest log.
      case 'log': this.openMockLog(); break;
      // The broom (rule): only when he presses it, and only exact duplicates.
      case 'broom': { const n = st.sweep(); if (n) this.note('', { from: 'tabs', small: true, icon: 'tabs', kick: 'Tidied', title: `Removed ${n} duplicate${n === 1 ? '' : 's'}` }); break; }
      case 'branchnew': if (known(a.sheet)) { const id = st.newBranch(); why = st.toBranch(a.sheet, id); this.freshBranch = id; } break;
      case 'branch': if (known(a.sheet)) why = st.toBranch(a.sheet, typeof a.to === 'number' ? a.to : null); break;
      case 'top': if (known(a.sheet)) why = st.toBranch(a.sheet, null); break;
      case 'parent': if (known(a.sheet) && known(a.to)) why = st.toParent(a.sheet, a.to); break;
      case 'brename': if (Number.isInteger(a.id)) why = st.renameBranch(a.id!, String(a.name ?? '')); break;
      case 'bfold': if (Number.isInteger(a.id)) why = st.foldBranch(a.id!); break;
      case 'bdelete': if (Number.isInteger(a.id)) why = st.deleteBranch(a.id!); break;
      default: return;
    }
    if (why === 'it has children of its own') this.note('That mockup has its own children, so it cannot be a child. Move its children first.');
    this.sendTabs();
    if (this.freshBranch && act !== 'branchnew') this.freshBranch = 0;
  },

  /** A mockup tab's version tag, where it sits in the tree, and its sheet's versions (one line per V, its newest time). */
  mockTab(this: SamaraBrowser, t: Tab): Record<string, unknown> {
    const sheet = t.mock!.sheet;
    const list = this.mockStore?.list.filter((x) => x.sheet === sheet) ?? [];
    const byV = new Map<number, MockVersion>();
    for (const x of list) { const o = byV.get(x.v); if (!o || x.at >= o.at) byV.set(x.v, x); }
    const place = this.mockStore?.placeOf(sheet) ?? { branch: null, parent: null };
    return {
      sheet, branch: place.branch, parent: place.parent, kids: this.mockStore?.childrenOf(sheet).length ?? 0, project: this.mockStore?.projectOf(sheet) ?? '',
      // Its name in the trail ("88 · The address bar"), for the address bar (2026-10-25: not the number address).
      title: [...list].reverse().find((x) => x.key === t.mock!.key)?.title ?? list[list.length - 1]?.title ?? '',
      v: list.find((x) => x.key === t.mock!.key)?.v ?? 0,
      // Sheet 81: the stage of the version this tab shows, on its own V chip; its id, for marking it from the tab's menu.
      ...(() => { const sh = list.filter((x) => x.key === t.mock!.key); const m = sh.find((x) => x.stage); return { vid: sh[sh.length - 1]?.id ?? null, stage: m?.stage ?? null, said: m?.said ?? '' }; })(),
      at: t.mock!.at ?? list.filter((x) => x.key === t.mock!.key).reduce((m, x) => Math.max(m, x.at), 0), unseen: t.mock!.unseen === true,
      versions: [...byV.values()].sort((a, b) => b.v - a.v).slice(0, 30).map((x) => ({ id: x.id, v: x.v, at: x.at, now: x.key === t.mock!.key })),
    };
  },

  async mockTidy(this: SamaraBrowser, manual: boolean): Promise<string> {
    const st = this.mockStore;
    if (!st || this.mockTidying || (!manual && !tidyDue(st.tidiedAt, Date.now()))) return '';
    this.mockTidying = true;
    try {
      const sheets = [...new Set(st.list.map((x) => x.sheet))];
      // Which files are in their repo at HEAD: one ls-tree per repo. A repo git cannot read says nothing (never "gone").
      const known = new Map<string, boolean>();
      const byRepo = new Map<string, { dir: string; rels: Map<string, string> }>();
      for (const s of sheets) {
        const w = sheetKind(s) === 'live' ? null : this.mockWhere(s);
        if (!w) continue;
        const r = byRepo.get(w.repo) ?? { dir: w.repo, rels: new Map<string, string>() };
        r.rels.set(w.rel, s); byRepo.set(w.repo, r);
      }
      for (const r of byRepo.values()) {
        const rels = [...r.rels.keys()];
        for (let i = 0; i < rels.length; i += 100) {
          const part = rels.slice(i, i + 100);
          const out = await git(r.dir, ['ls-tree', '-r', '--name-only', 'HEAD', '--', ...part]);
          if (typeof out !== 'string') continue;
          const have = new Set(out.split(/\r?\n/).filter(Boolean));
          for (const rel of part) known.set(r.rels.get(rel)!, have.has(rel));
        }
      }
      // What each sheet says about itself (a "decided" strip, a DECIDED stamp), read again only when its newest version changed.
      let reads = 0;
      for (const s of sheets) {
        if (st.archived(s) || reads >= 80) continue;
        const v = st.list.filter((x) => x.sheet === s).sort((a, b) => b.at - a.at || b.id - a.id)[0];
        const w = v?.commit ? this.mockWhere(s) : null;
        if (!v || !w || st.meta.get(s)?.dkey === v.key) continue;
        reads++;
        const html = await git(w.repo, ['cat-file', 'blob', `${v.commit}:${w.rel}`]);
        if (typeof html === 'string') st.setDecided(s, v.key, saysDecided(html));
      }
      const open = new Set(this.tabs.filter((t) => t.mock).map((t) => t.mock!.sheet));
      const r = st.tidy(open, (s) => known.get(s) ?? null);
      const line = tidyLine(r);
      if (line || manual) this.note(line || 'The mockups are already tidy.');
      this.sendTabs();
      return line;
    } catch (e) {
      console.error('shell: mockups: the tidy failed: ' + (e as Error).message);
      return '';
    } finally { this.mockTidying = false; }
  },

  /** Sheet 107: what the tray's Mockups plaque needs: that mockups are on here, and how many sheets are NEW (its gem). */
  mockView(this: SamaraBrowser): Record<string, unknown> | null {
    const st = this.mockStore;
    if (!st) return null;
    const fresh = new Set(st.list.map((x) => x.sheet).filter((x) => st.meta.get(x)?.fresh && !st.archived(x))).size;
    return { fresh, toCompanion: Boolean(this.sendMock), branches: st.branches.map((b) => ({ ...b })) };
  },

  /**
   * Sheet 107 (2026-10-30): Mockups as the menu draws it. A tab per project (the five he has first, then any
   * new one), its topics as sub headings, its Done (built, parked, put away) at the bottom; each sheet with its number as
   * that project shows it, NEW until he opens it, its mark and its versions, each with the address it opens at.
   */
  mockTree(this: SamaraBrowser): Record<string, unknown> {
    const st = this.mockStore!;
    const bySheet = new Map<string, MockVersion[]>();
    for (const x of st.list) bySheet.set(x.sheet, [...(bySheet.get(x.sheet) ?? []), x]);
    for (const l of bySheet.values()) l.sort((a, b) => b.at - a.at || b.id - a.id);
    const node = (sheet: string, project: string) => {
      const items = bySheet.get(sheet)!, top = items[0]!, src = srcOf(top);
      // One line per version, the newest time of each, oldest first; a mark on any of its lines is its mark.
      const byV = new Map<number, MockVersion[]>();
      for (const x of items) byV.set(x.v, [...(byV.get(x.v) ?? []), x]);
      const versions = [...byV.entries()].sort((a, b) => a[0] - b[0]).map(([v, l]) => {
        const x = l[0]!, m = l.find((y) => y.stage);
        return { id: x.id, v, at: x.at, url: this.mockServer!.url(x.commit, srcOf(x)), ...(m ? { stage: m.stage, said: m.said ?? '', note: m.note ?? '' } : {}) };
      });
      // A sheet put away (the Archive of before) with no mark of its own reads as parked, in Done.
      const mark = [...versions].reverse().find((x) => x.stage)?.stage ?? (st.archived(sheet) ? 'park' : null);
      const lab = sheetLabel(cleanTitle(top.title), src);
      return { sheet, num: shownNum(project, top.title, src), name: lab.name, at: top.at, fresh: st.meta.get(sheet)?.fresh === true, mark, archived: st.archived(sheet), versions };
    };
    type Node = ReturnType<typeof node>;
    const rank = (n: Node) => { const k = parseInt(n.num.replace(/^[A-Z]/, ''), 10); return Number.isFinite(k) ? k * 100 + (/[a-z]$/.test(n.num) ? n.num.charCodeAt(n.num.length - 1) - 96 : 0) : -1; };
    const byRank = (a: Node, b: Node) => rank(b) - rank(a) || b.at - a.at;
    const byProject = new Map<string, Node[]>();
    for (const s of bySheet.keys()) { const p = st.projectOf(s); byProject.set(p, [...(byProject.get(p) ?? []), node(s, p)]); }
    const lastAt = (p: string) => Math.max(...byProject.get(p)!.map((n) => n.at));
    const known = (p: string) => { const i = KNOWN_PROJECTS.indexOf(p); return i < 0 ? 99 : i; };
    const names = [...byProject.keys()].sort((a, b) => known(a) - known(b) || lastAt(b) - lastAt(a));
    const projects = names.map((name) => {
      const all = byProject.get(name)!;
      const isDone = (n: Node) => n.archived || n.mark === 'built' || n.mark === 'park';
      const open = all.filter((n) => !isDone(n));
      const topicOf = (n: Node) => st.placeOf(n.sheet).branch;
      const topics = st.branches.map((b) => ({ id: b.id as number | string, name: b.name, icon: b.icon ?? null, sheets: open.filter((n) => topicOf(n) === b.id).sort(byRank) }))
        .filter((t) => t.sheets.length);
      const loose = open.filter((n) => !st.branches.some((b) => b.id === topicOf(n))).sort(byRank);
      if (loose.length) topics.push({ id: 'loose', name: NO_TOPIC, icon: null, sheets: loose });
      // What he worked on last first; Other last of all.
      topics.sort((a, b) => Number(a.name === NO_TOPIC) - Number(b.name === NO_TOPIC) || Math.max(...b.sheets.map((n) => n.at)) - Math.max(...a.sheets.map((n) => n.at)));
      // Sheet 119 (2026-11-09): a project wears the icon Claude named with its first topic, so a new one is never a letter.
      const icon = st.branches.filter((b) => b.icon && (b.project ?? null) === name).sort((a, b) => a.id - b.id)[0]?.icon ?? null;
      return { name, count: all.length, fresh: all.filter((n) => n.fresh).length, icon, topics, done: all.filter(isDone).sort(byRank) };
    });
    return { projects };
  },

  // ---- Sheet 100 (2026-10-28: "Quest log page and the picture strip"): every mockup in a page of its own,
  // projects and topics on the left, that topic's sheets in the middle, the one he picks big on the right with its
  // versions under it. A tab like Settings: its own small preload (mocklogpreload.cjs), only these doors.
  isMockLog(this: SamaraBrowser, sender: Electron.WebContents): boolean { const t = this.tabs.find((x) => x.internal === 'mocklog' && x.view?.webContents === sender); if (t) this.inTab(t); return Boolean(t); },

  /** Open the quest log (or bring its tab forward). */
  openMockLog(this: SamaraBrowser): void {
    if (!this.mockStore) return;
    if (!this.win || this.win.isDestroyed()) { this.whenOpen.push(() => this.openMockLog()); if (!this.lastPane()) this.createPane(); return; }
    let t = this.tabs.find((x) => x.internal === 'mocklog');
    // Sheet 107 v4: the tab he was on, for Back to Samara.
    const was = this.cur();
    if (was && was.internal !== 'mocklog') this.mockFrom = was.id;
    if (!t) {
      t = { id: ++this.seq, internal: 'mocklog', view: null, opener: null, title: 'Mockups', url: 'samara:mockups', favicon: '', loading: false, audible: false, muted: false, crashed: false,
        scrollY: 0, zoom: 0, lastSeen: Date.now(), blocked: null, trail: null, done: false, lent: false, upgraded: null, failed: null, blockedPopup: null, pane: this.pane.id };
      this.tabs.push(t);
    }
    this.activate(t.id);
    this.win?.focus();
  },

  /**
   * Sheet 107 v4 (2026-10-30: "a way to get out of mockups and back to my regular samara"): Back to Samara, or
   * Esc: he is back on the tab he was on (the newest of his own tabs if that one is gone, else a new one). Sheet 107 v5:
   * Mockups stays where he left it (same project, same sheet) for the plaque to bring back; it is not a tab in his list.
   */
  mockLogLeave(this: SamaraBrowser): void {
    const log = this.tabs.find((x) => x.internal === 'mocklog');
    if (!log) return;
    const mine = (x: Tab) => x !== log && !x.done && x.pane === log.pane;
    const back = this.tabs.find((x) => x.id === this.mockFrom && mine(x)) ?? [...this.tabs].filter((x) => mine(x) && !x.internal).sort((a, b) => b.lastSeen - a.lastSeen)[0];
    this.mockFrom = null;
    if (back) this.activate(back.id); else this.newTab(this.HOME);
  },

  mockLogWhere(this: SamaraBrowser, w: { p: string; s: string | null; v: number | null; n: number | null }): void { this.mockWhereWas = w; },

  /** What the quest log shows. Plain data, built from mockups.json and git only. */
  mockLogData(this: SamaraBrowser): Record<string, unknown> | null {
    if (!this.mockStore) return null;
    return { ...this.mockTree(), logos: this.mockLogos(), focus: this.mockFocus, toCompanion: Boolean(this.sendMock), was: this.mockWhereWas };
  },

  /** The quest log follows every change (a new version, a mark, a new picture), only when something it shows changed. */
  pushMockLog(this: SamaraBrowser): void {
    const wc = this.tabs.find((x) => x.internal === 'mocklog')?.view?.webContents;
    if (!wc || wc.isDestroyed() || wc.isLoading()) return;
    const d = this.mockLogData(), sig = JSON.stringify(d);
    if (sig === this.mockLogSig) return;
    this.mockLogSig = sig;
    wc.send('mocklog:data', d);
  },

  /** Sheet 107: he opened a sheet inside Mockups: it is seen (NEW goes) and counts as opened. */
  mockLogSeen(this: SamaraBrowser, sheet: string): void {
    const st = this.mockStore;
    if (!st || typeof sheet !== 'string' || !st.list.some((x) => x.sheet === sheet)) return;
    st.opened(sheet);
    st.setFresh(sheet, false);
    this.sendTabs();
  },

  /** Sheet 107: his mark on a version, from the mark in Mockups (approve, needs a fix with a note, park, or off). */
  mockLogStage(this: SamaraBrowser, id: number, to: string | null, note: string): void { this.mockAct('stage', { id, to, name: note }); },

  /** Sheet 107: Send to companion from Mockups. */
  mockLogSend(this: SamaraBrowser, id: number): void { this.mockAct('send', { id }); },

  cur(this: SamaraBrowser): Tab | undefined { return this.tabs.find((x) => x.id === this.active); },

  go(this: SamaraBrowser, address: string): void {
    this.pane.slotOpen = false;                         // he pressed Enter: the page he asked for gets the keyboard
    if (/^\s*samara:hyrule\s*$/i.test(address) && this.openHyrule()) return;
    const url = addressFor(address);
    const t = this.cur();
    if (!url) return;
    if (this.toPaid(url)) return;
    if (!t?.view || t.internal) { this.newTab(url); return; }
    t.crashed = false;
    const l = this.stopFor(url);
    if (l.length) { this.block(t, url, l); return; }
    t.blocked = null; t.failed = null; this.place();
    t.pending = url;
    t.playOkAt = Date.now();                             // he typed it: what it plays, he asked for
    void t.view.webContents.loadURL(this.secured(t, url)).catch(() => {});
    t.view.webContents.focus();
  },

  act(this: SamaraBrowser, what: string): void {
    const t = this.cur();
    const wc = t?.view?.webContents;
    switch (what) {
      case 'back': if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
      case 'forward': if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
      // A crashed page is rebuilt fresh from its snapshot, never reloaded in place (poking it hangs).
      case 'reload': if (t) { if (t.crashed) { this.closeView(t); this.activate(t.id); } else wc?.reload(); } break;
      case 'stop': wc?.stop(); break;
      case 'mute': if (t) { t.muted = !t.muted; wc?.setAudioMuted(t.muted); this.changed(); } break;
      case 'zoomin': if (wc && t) { t.zoom = Math.min(5, wc.getZoomLevel() + 0.5); wc.setZoomLevel(t.zoom); this.changed(); } break;
      case 'zoomout': if (wc && t) { t.zoom = Math.max(-5, wc.getZoomLevel() - 0.5); wc.setZoomLevel(t.zoom); this.changed(); } break;
      case 'zoomreset': if (wc && t) { t.zoom = 0; wc.setZoomLevel(0); this.changed(); } break;
      // Sheet 121 (4): "Side by side" in the ⋯ menu, or "Close side by side" while two pages show.
      case 'split': if (this.splitShown()) this.splitClose(); else this.splitOpen(); break;
      case 'newtab': this.newTab(this.HOME); this.win?.webContents.send('browser:focusslot'); break;
      case 'close': if (t) this.close(t.id); break;
      case 'reopen': this.reopen(); break;
      case 'reclaim': this.onReclaim?.(); break;
      // Sheet 40 B: the pop-out's own keys, from the page left behind.
      case 'poppause': case 'poppin': case 'popclose': this.onPopoutAct?.(what); break;
      case 'drawer-open': void this.drawer(true); break;
      // Sheet 60 section 4: "Notes for this site" (the ... menu) opens the rail; the frame says when it opens and goes.
      case 'siterail-on': this.pane.railOpen = true; this.sendNotes(this.pane); break;
      case 'siterail-off': this.pane.railOpen = false; break;
      case 'peek': void this.peek(); break;
      case 'frozen-ready': this.frozenReady(); break;
      case 'importmarks': void this.importMarks(); break;
      case 'settings': this.openSettings(); break;
      case 'quit': this.onQuit?.(); break;
      case 'bookmarks': this.openSettings('bookmarks'); break;
      case 'history': this.openThings('history'); break;
      case 'downloads': this.openThings('downloads'); break;
      case 'notes': this.openThings('notes'); break;
      case 'timer': this.timersHub?.setup(); break;
      case 'music': this.musicHub?.open(); break;
      // S1: the menu closes first, so it is not in the frozen screen.
      case 'newnote': this.quickNote?.(); break;
      case 'snip': { const h = this.snipHub; if (h) setTimeout(() => void h.start(), 250); break; }
      case 'print': if (wc && t && !t.internal) wc.print({}); break;
      // The mockups' broom (Phase R, 2026-11-24: tab clean up is retired; the overnight tidy moves old tabs to Earlier).
      case 'tidy': void this.mockTidy(true); break;
      case 'mockups': this.reopenMockups(); break;
      // The blue shield: open the popup he was looking for (as a tab, beside the page), or allow the site from now on.
      case 'popupopen': case 'popupallow': if (t?.blockedPopup) {
        const bp = t.blockedPopup;
        t.blockedPopup = null;
        if (what === 'popupallow' && bp.site) { this.popupOk.add(bp.site); try { writeFileAtomic(this.popupOkFile, JSON.stringify([...this.popupOk])); } catch { /* best effort */ } this.sync?.changed('prefs'); }
        if (!this.listed(bp.url).length) this.newTab(bp.url, t.id, true);
        this.sendTabs();
      } break;
      case 'winmin': this.win?.minimize(); break;
      case 'winmax': if (this.win) this.fillOrShrink(this.win); break;
      case 'winclose': this.win?.close(); break;
      // Autofill's save (sheet 77): the key's "Save this login" was clicked, or the card was put away.
      case 'afsaveask': this.afSaveAsk(); break;
      case 'afsavecancel': this.afSave = null; this.afBand(); break;
      // A double-click on the band's wood (2026-10-23: nothing happened on the Mac). Windows does this itself
      // for the drag area; on the Mac Samara does what his Mac is set to (System Settings, Desktop & Dock: "Double-click a
      // window's title bar to"): fill the screen and back (the default), tuck it in the Dock, or nothing.
      // Right-click on the square key: what the Mac's green button offers, which Samara's own keys lost (2026-10-23).
      case 'winmenu': this.windowMenu(); break;
      case 'titledbl': if (this.win && process.platform === 'darwin') {
        const set = systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string');
        const tuck = set === 'Minimize' || (!set && systemPreferences.getUserDefault('AppleMiniaturizeOnDoubleClick', 'boolean'));
        if (tuck) this.win.minimize();
        else if (set !== 'None') this.fillOrShrink(this.win);
      } break;
      case 'homehere': { const u = t?.url; if (u && isWeb(u)) { this.prefs.home = u; this.savePrefs(); this.note('', { from: 'menu', small: true, kick: 'Home page', title: 'This page' }); this.sendTabs(); } break; }
      case 'star': this.toggleMark(); break;
      // The + key on the shelf in the floating tab list (2026-10-20): its name box opened INSIDE that
      // see-through layer, out of sight, and the layer hung over the page. Now the list slides away and the band opens
      // its own box, exactly as the star does.
      case 'markadd': this.tray(false); this.win?.webContents.send('browser:tray', { open: false, mark: true }); break;
      case 'vault': void this.vaultKey(); break;
      case 'vaultcancel': this.vaultCancel(); break;
      case 'vaultlock': this.vault.lock(); this.note('', { from: 'shield', small: true, icon: 'key', kick: 'Bitwarden', title: 'Locked' }); break;
      case 'drawer-close': void this.drawer(false); break;
      // The red plate: the safe way out, or (the held lever) in anyway, for this site, this run.
      case 'phishback': if (t) { t.blocked = null; if (wc?.navigationHistory.canGoBack()) { this.place(); wc.navigationHistory.goBack(); } else this.close(t.id, false); } break;
      // A look-alike: the real site, typed fresh, never the link that led here.
      case 'phishreal': if (t?.blocked?.real) { const u = 'https://' + t.blocked.real + '/'; t.blocked = null; this.place(); if (wc && !wc.isDestroyed()) void wc.loadURL(u).catch(() => {}); } break;
      // A failed page: try again; or, with no secure version, open the plain one and remember the site.
      case 'failretry': if (t?.failed && wc) { const u = t.failed.url; t.failed = null; this.place(); void wc.loadURL(this.secured(t, u)).catch(() => {}); } break;
      case 'httpok': if (t?.failed?.kind === 'insecure' && wc) {
        const u = t.failed.url;
        try { const h = new URL(u).hostname; this.httpOk.add(h); this.peerHttp.delete(h); writeFileAtomic(this.httpOkFile, JSON.stringify([...this.httpOk])); writeFileAtomic(this.httpOkFile.replace(/[.]json$/, '-other.json'), JSON.stringify([...this.peerHttp])); this.sync?.changed('prefs'); } catch { /* best effort */ }
        t.failed = null; t.upgraded = null; this.place(); void wc.loadURL(u).catch(() => {});
      } break;
      // His bank: off to Chrome, and this tab steps back (or closes) so Samara never holds the page.
      case 'bankchrome': if (t?.blocked?.bank) { const u = t.blocked.url; this.toChrome(u); t.blocked = null; if (wc?.navigationHistory.canGoBack()) { this.place(); wc.navigationHistory.goBack(); } else this.close(t.id, false); } break;
      case 'failback': if (t) { t.failed = null; if (wc?.navigationHistory.canGoBack()) { this.place(); wc.navigationHistory.goBack(); } else this.close(t.id, false); } break;
      case 'phishopen': if (t?.blocked && !t.blocked.bank) { try { this.letThrough.add(new URL(t.blocked.url).hostname); } catch { /* bad url */ } const u = t.blocked.url; t.blocked = null; this.place(); void wc?.loadURL(u); } break;
    }
  },

  /** Find on page (Ctrl+F): a new word searches from the top; Enter goes to the next, Shift+Enter back. */
  find(this: SamaraBrowser, text: string, next: boolean, back: boolean): void {
    const wc = this.cur()?.view?.webContents;
    if (!wc) return;
    const q = String(text).slice(0, 200);
    if (!q) { wc.stopFindInPage('clearSelection'); this.win?.webContents.send('browser:found', { at: 0, of: 0 }); return; }
    wc.findInPage(q, { forward: !back, findNext: !next });
  },

  findStop(this: SamaraBrowser): void { this.cur()?.view?.webContents.stopFindInPage('keepSelection'); },

  /** The browser's keys, from the page or the frame. True when the key was ours. */
  key(this: SamaraBrowser, i: Electron.Input): boolean {
    if (i.type !== 'keyDown') return false;
    const k = i.key.toLowerCase(), c = i.control || i.meta;
    if (c && i.shift && k === 't') { this.act('reopen'); return true; }
    if (c && k === 't') { this.act('newtab'); return true; }
    if (c && k === 'w') { this.act('close'); return true; }
    if (c && !i.shift && k === 'h') { this.act('history'); return true; }
    if (c && !i.shift && k === 'j') { this.act('downloads'); return true; }
    if (c && k === 'l') { this.win?.webContents.focus(); this.win?.webContents.send('browser:focusslot'); return true; }
    if (c && k === 'f') { this.win?.webContents.focus(); this.win?.webContents.send('browser:findopen'); return true; }
    if ((c && k === 'r') || k === 'f5') { this.act('reload'); return true; }
    if (i.alt && k === 'arrowleft') { this.act('back'); return true; }
    if (i.alt && k === 'arrowright') { this.act('forward'); return true; }
    if (c && (k === '=' || k === '+')) { this.act('zoomin'); return true; }
    if (c && k === '-') { this.act('zoomout'); return true; }
    if (c && k === '0') { this.act('zoomreset'); return true; }
    // Ctrl+1 to 8 go to that tab, Ctrl+9 to the last, as in Chrome.
    if (c && !i.shift && /^[1-9]$/.test(k)) {
      const mine = this.paneTabs();
      const n = k === '9' ? mine[mine.length - 1] : mine[Number(k) - 1];
      if (n) this.activate(n.id);
      return true;
    }
    // Sheet 60: Esc closes the notes rail even while the page has the keyboard.
    // 2026-11-18 (a black full screen he could not close): F11 always toggles the window's full screen on the
    // PC (Samara has no menu there to give it one; the Mac's is ⌃⌘F), and leaving it takes a page's full screen with it.
    if (k === 'f11' && process.platform !== 'darwin' && this.win) { toggleFull(this.win); return true; }
    // Esc in a page's full screen: the page leaves it itself; if it has not a moment later (a hung page), Samara does.
    if (k === 'escape' && this.fullTab != null) {
      const t = this.tabs.find((x) => x.id === this.fullTab);
      if (t) setTimeout(() => { const p = this.paneOfTab(t); if (p && p.fullTab === t.id && t.view) { this.pane = p; this.pageFullOff(t, t.view); } }, 800);
      return false;
    }
    if (k === 'escape' && this.pane.railOpen) { this.pane.railOpen = false; this.win?.webContents.send('browser:railclose'); return true; }
    if (k === 'escape' && this.cur()?.loading) { this.act('stop'); return false; }
    if (c && k === 'tab') {
      const mine = this.paneTabs();
      const i2 = mine.findIndex((x) => x.id === this.active);
      const n = mine[(i2 + (i.shift ? -1 : 1) + mine.length) % mine.length];
      if (n) this.activate(n.id);
      return true;
    }
    return false;
  }
};
