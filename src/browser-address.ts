// Phase 4 (2026-11-24): SamaraBrowser's address methods, moved out of browser.ts unchanged. They run as the browser's own
// methods (browser.ts puts them on SamaraBrowser.prototype), so `this` is the browser.
import { WebContentsView, app, clipboard, dialog, shell } from 'electron';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { SAFE_WEB_PREFERENCES, lockDown } from './safety.ts';
import { within } from './page.ts';
import { writeFileAtomic, writeFileAtomicSoon } from './atomic.ts';
import { svgToPng } from './svgicon.ts';
import { parseBookmarks, parseChromeBookmarks, parseSafariBookmarks } from './bookmarks.ts';
import type { Mark } from './bookmarks.ts';
import { searchQueryOf } from './recall.ts';
import { Downloads } from './dlist.ts';
import type { NoticeIn } from './notices.ts';
import { keep } from './mockhome.ts';
import type { SamaraBrowser, SugShow } from './browser.ts';
import { isWeb, SUG_KINDS } from './browser.ts';

export const AddressPart = {
  // ------------------------------------------------------------------ sheet 102, the address bar's list
  /**
   * His pick (2026-10-29): the list sits on its own see-through layer over the LIVE page, as the tab list does, so it
   * opens at once and the page is never swapped for a still picture of itself (that took 44 to 564 ms). The typing stays
   * in the bar; the layer only draws and says which row he points at or clicks. Made once per window, kept hidden.
   */
  sugView(this: SamaraBrowser): WebContentsView | null {
    const w = this.win;
    if (!w || w.isDestroyed()) return null;
    const P = this.pane;
    if (P.sugV && !P.sugV.webContents.isDestroyed()) return P.sugV;
    const v = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES, preload: path.join(path.dirname(this.o.preloadPath), 'suggestpreload.cjs'), backgroundThrottling: false } });
    lockDown(v.webContents);
    v.setBackgroundColor('#00000000');
    v.setVisible(false);
    v.webContents.on('did-finish-load', () => { if (P.sugLast && v.getVisible()) v.webContents.send('suggest:show', { ...P.sugLast, first: true }); });
    void v.webContents.loadURL(`${this.o.origin}/suggest.html`).catch(() => { /* its window closed while it loaded */ });
    P.sugV = v;
    return v;
  },

  isSuggest(this: SamaraBrowser, sender: Electron.WebContents): boolean {
    const p = this.panes.find((x) => x.sugV && !x.sugV.webContents.isDestroyed() && x.sugV.webContents === sender);
    if (p) this.pane = p;
    return Boolean(p);
  },

  /** What the bar asks the list to show (checked here: kinds from a fixed few, plain words, his stored icons only), or null to put it away. */
  suggestShow(this: SamaraBrowser, m: unknown): void {
    const w = this.win, P = this.pane;
    if (!w || w.isDestroyed()) return;
    if (!m || typeof m !== 'object') {
      P.sugLast = null;
      const v = P.sugV && !P.sugV.webContents.isDestroyed() ? P.sugV : null;
      if (v?.getVisible()) { v.webContents.send('suggest:show', null); setTimeout(() => { if (!P.sugLast && !v.webContents.isDestroyed()) v.setVisible(false); }, 20); }
      return;
    }
    const a = m as Record<string, unknown>, r = (a.rect ?? {}) as Record<string, unknown>;
    const num = (x: unknown) => (Number.isFinite(Number(x)) ? Math.round(Number(x)) : 0);
    const str = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '');
    const rows = (Array.isArray(a.rows) ? a.rows : []).slice(0, 16).map((x: Record<string, unknown>) => ({
      kind: SUG_KINDS.has(str(x?.kind, 10)) ? str(x.kind, 10) : 'go', title: str(x?.title, 300), url: str(x?.url, 2000),
      favicon: /^data:image\//.test(str(x?.favicon, 20_000)) ? str(x.favicon, 20_000) : '',
    }));
    const [cw, ch] = w.getContentSize();
    const x = Math.max(0, Math.min(cw - 40, num(r.x))), y = Math.max(0, Math.min(ch - 40, num(r.y)));
    const width = Math.max(40, Math.min(cw - x, num(r.width)));
    const show: SugShow = { rows, pick: Number.isInteger(a.pick) ? Number(a.pick) : -1, typed: str(a.typed, 200), from: num(a.from), expect: Math.max(0, Math.min(4, num(a.expect))), first: a.first === true, x, y, width };
    const first = !P.sugLast || show.first;
    P.sugLast = show;
    const v = this.sugView();
    if (!v) return;
    // Its height is the list's own (the page says, suggestSize): a first guess until then, rows 40 tall.
    const b = v.getBounds(), height = first || !v.getVisible() ? Math.min(ch - y, 14 + 40 * Math.max(1, rows.length)) : b.height;
    v.setBounds({ x, y, width, height });
    if (first || !v.getVisible()) {
      w.contentView.addChildView(v); v.setVisible(true);
      // The list never needs the keyboard (its rows act through suggestAct). Chromium gives it the keyboard when it is
      // first shown, and the bar then closed under him a moment after he opened it (2026-11-22, grabbed while Samara
      // opens): it goes straight back to the bar.
      // (looked for every 10 ms for 400 ms: the bar shuts 120 ms after losing the keyboard)
      const until = Date.now() + 400;
      const back = setInterval(() => {
        if (Date.now() > until || w.isDestroyed() || v.webContents.isDestroyed()) { clearInterval(back); return; }
        if (v.webContents.isFocused() && P.slotOpen) w.webContents.focus();
      }, 10);
    }
    v.webContents.send('suggest:show', { ...show, first });
  },

  /** The list drew this tall: the layer is exactly that, so it never covers the page below the list. */
  suggestSize(this: SamaraBrowser, h: number): void {
    const w = this.win, v = this.pane.sugV;
    if (!w || w.isDestroyed() || !v || v.webContents.isDestroyed() || !this.pane.sugLast) return;
    const [, ch] = w.getContentSize(), b = v.getBounds();
    const height = Math.max(0, Math.min(ch - b.y, Math.round(h)));
    if (height !== b.height) v.setBounds({ ...b, height });
  },

  /** He points at or clicks a row in the list: the bar does it (it holds the typing and the choices). */
  suggestAct(this: SamaraBrowser, act: 'hover' | 'pick', i: number): void {
    const w = this.win;
    if (w && !w.isDestroyed()) w.webContents.send('browser:suggestAct', { act, i });
  },

  /** Shift+Delete on one of his own lines (sheet 102): a past search goes from History, every time he made it; a page, every visit to it. */
  suggestForget(this: SamaraBrowser, kind: string, url: string): void {
    if (typeof url !== 'string' || url.length > 2000) return;
    const q = kind === 'past' ? searchQueryOf(url)?.toLowerCase() : null;
    if (kind === 'past' && !q) return;
    if (kind !== 'past' && kind !== 'history') return;
    for (const v of [...this.visits.list]) if (q ? searchQueryOf(v.url)?.toLowerCase() === q : v.url === url) this.visits.forget(v.url, v.at);
  },

  // ------------------------------------------------------------------ site icons for the bookmarks
  /** Fetch one icon through his own browsing session and keep it as a small data picture. Images only, 64 KB at most. */
  async iconData(this: SamaraBrowser, url: string): Promise<string | null> {
    if (url.startsWith('data:image/svg+xml')) { const m = /^data:image\/svg\+xml(;base64)?,(.*)$/s.exec(url); try { return m && url.length < 90_000 ? await svgToPng(m[1] ? Buffer.from(m[2]!, 'base64') : Buffer.from(decodeURIComponent(m[2]!))) : null; } catch { return null; } }
    if (url.startsWith('data:image/')) return url.length < 90_000 ? url : null;
    if (!isWeb(url) || this.listed(url).length) return null;
    try {
      const r = await within(this.ses.fetch(url, { signal: AbortSignal.timeout(6000) }), 7000, null);
      const type = r?.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
      if (!r?.ok || !/^image\//.test(type)) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length || buf.length > 64 * 1024) return null;
      // An SVG is never kept as it is: it is drawn in a sealed page and only the picture of it is kept (svgicon.ts).
      if (type === 'image/svg+xml') return await svgToPng(buf);
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch { return null; }
  },

  /**
   * The first of these that is a picture Samara keeps: the page's icons in its own order, then the site's /favicon.ico
   * (2026-10-22, his Epomaker bookmark showed only a "K": the page offered just an SVG icon, which is never kept, and
   * nothing else was tried).
   */
  async keepIcon(this: SamaraBrowser, host: string, urls: string[]): Promise<void> {
    let d: string | null = null;
    for (const u of [...new Set(urls)].slice(0, 6)) { d = await this.iconData(u); if (d) break; }
    if (!d) return;
    this.icons.set(host, d);
    if (this.icons.size > 400) this.icons.delete(this.icons.keys().next().value!);
    void writeFileAtomicSoon(this.iconsFile, JSON.stringify(Object.fromEntries(this.icons))).catch(() => { /* best effort */ });
    this.sendTabs();
  },

  /** Bookmarks of sites he has not visited yet: ask the site for its icon (its page's icon link, else /favicon.ico). */
  async fillMarkIcons(this: SamaraBrowser): Promise<void> {
    if (this.iconsBusy) return;
    this.iconsBusy = true;
    try {
      for (const m of this.marks.slice(0, 60)) {
        let u: URL;
        try { u = new URL(m.url); } catch { continue; }
        if (this.icons.has(u.hostname)) continue;
        let link: string | null = null;
        try {
          const r = await within(this.ses.fetch(u.origin + '/', { signal: AbortSignal.timeout(6000) }), 7000, null);
          if (r?.ok) {
            const html = (await r.text()).slice(0, 300_000);
            const tag = [...html.matchAll(/<link\b[^>]*>/gi)].map((x) => x[0]).find((x) => /rel\s*=\s*["']?[^"'>]*\bicon\b/i.test(x) && !/mask-icon/i.test(x));
            const href = tag && /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
            if (href) link = new URL(href.replace(/&amp;/g, '&'), u.origin + '/').href;
          }
        } catch { /* fall back to /favicon.ico */ }
        let d = link ? await this.iconData(link) : null;
        if (!d) d = await this.iconData(u.origin + '/favicon.ico');
        if (d) { this.icons.set(u.hostname, d); this.sendTabs(); }
      }
      void writeFileAtomicSoon(this.iconsFile, JSON.stringify(Object.fromEntries(this.icons))).catch(() => { /* best effort */ });
    } finally { this.iconsBusy = false; }
  },

  // ------------------------------------------------------------------ 6.23 bookmarks
  saveMarks(this: SamaraBrowser): void { try { writeFileAtomic(this.marksFile, JSON.stringify(this.marks)); } catch { /* best effort */ } this.sync?.changed('marks'); },

  /**
   * "Bring bookmarks from Chrome": he picks the file Chrome's Export bookmarks made (in his Drive or Downloads).
   * Only the file he picks is read. New ones are added; ones he already has are left as they are.
   */
  async importMarks(this: SamaraBrowser): Promise<void> {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    const drive = 'G:\\My Drive';
    const r = await dialog.showOpenDialog(w, {
      title: 'Pick the bookmarks file Chrome exported', buttonLabel: 'Bring them in',
      defaultPath: existsSync(drive) ? drive : app.getPath('downloads'),
      filters: [{ name: 'Bookmarks file', extensions: ['html', 'htm'] }], properties: ['openFile'],
    });
    const file = r.filePaths[0];
    if (r.canceled || !file) return;
    let added = 0;
    try {
      if (statSync(file).size > 20 * 1024 * 1024) throw new Error('that file is too big to be a bookmarks file');
      const have = new Set(this.marks.map((m) => m.url));
      for (const m of parseBookmarks(readFileSync(file, 'utf8'))) if (!have.has(m.url)) { this.marks.push(m); have.add(m.url); added++; }
      this.marks = this.marks.slice(0, 5000);
      this.saveMarks();
    } catch (e) {
      this.note('', { kind: 'bad', from: 'menu', icon: 'star', kick: 'Bookmarks', title: 'Could not be read', rows: [{ g: 'Why', v: (e as Error).message }] });
      return;
    }
    if (added) void this.fillMarkIcons();
    this.note('', this.marksNotice(added, 'that file'));
    this.sendTabs();
  },

  /**
   * 2026-10-13: straight from Chrome or Safari on this machine, no export first. Only their bookmarks file is
   * read. Safari's needs macOS's Full Disk Access for Samara, which only you can give: the right page opens for him.
   */
  /** Bookmarks brought in: big, with where the bar ones went; nothing new is small news. */
  marksNotice(this: SamaraBrowser, added: number, from: string): Partial<NoticeIn> {
    return added ? { from: 'menu', icon: 'star', kick: 'Bookmarks', title: `Brought in ${added}`, rows: [{ g: 'From', v: from }, { g: 'Where', v: 'The bar ones are on the shelf in the drawer.' }] }
      : { from: 'menu', small: true, icon: 'star', kick: 'Nothing new', title: `You have all of ${from === 'that file' ? 'them' : from + '\u2019s'}` };
  },

  async importFrom(this: SamaraBrowser, source: 'chrome' | 'safari'): Promise<void> {
    const P = this.pane;
    const say = (o: Partial<NoticeIn>) => { if (P.win && !P.win.isDestroyed()) this.note('', { from: 'menu', icon: 'star', kick: 'Bookmarks', ...o }); };
    let found: Mark[] = [];
    try {
      if (source === 'chrome') {
        const base = process.platform === 'darwin'
          ? path.join(app.getPath('home'), 'Library', 'Application Support', 'Google', 'Chrome')
          : path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'User Data');
        const profiles = existsSync(base) ? readdirSync(base).filter((d) => d === 'Default' || /^Profile \d+$/.test(d)) : [];
        for (const p of profiles) {
          // Bookmarks on this computer, and (newer Chrome) the ones that come with his Google account.
          for (const name of ['Bookmarks', 'AccountBookmarks']) {
            const f = path.join(base, p, name);
            if (existsSync(f) && statSync(f).size < 20 * 1024 * 1024) found.push(...parseChromeBookmarks(readFileSync(f, 'utf8')));
          }
        }
        if (!profiles.length) { say({ kind: 'bad', title: 'Nothing from Chrome', rows: [{ g: 'Why', v: 'Chrome is not on this computer, or it has no bookmarks yet.' }] }); return; }
      } else {
        if (process.platform !== 'darwin') return;
        const f = path.join(app.getPath('home'), 'Library', 'Safari', 'Bookmarks.plist');
        const json = await new Promise<string>((res, rej) => execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', f], { maxBuffer: 32 * 1024 * 1024, timeout: 15_000 }, (e, out) => (e ? rej(e) : res(String(out)))));
        found = parseSafariBookmarks(json);
      }
    } catch (e) {
      if (source === 'safari') {
        say({ kind: 'need', kick: 'Safari', title: 'Keeps them private', rows: [{ g: 'Do this', v: 'In the window that opens, turn on Samara under Full Disk Access, then press this again.' }] });
        void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
      } else say({ kind: 'bad', title: 'Could not be read', rows: [{ g: 'Why', v: (e as Error).message }] });
      return;
    }
    const have = new Set(this.marks.map((m) => m.url));
    let added = 0;
    for (const m of found) if (!have.has(m.url)) { this.marks.push(m); have.add(m.url); added++; }
    this.marks = this.marks.slice(0, 5000);
    if (added) { this.saveMarks(); void this.fillMarkIcons(); }
    say(this.marksNotice(added, source === 'chrome' ? 'Chrome' : 'Safari'));
    this.sendTabs();
  },

  /** The star in the slot: the page he is on goes onto the shelf (its panel then opens to name it). Already there: nothing
   *  changes here; the panel opens to rename or remove it (2026-10-14: "edit the name it saves as"). */
  toggleMark(this: SamaraBrowser): void {
    const t = this.cur();
    if (!t || !isWeb(t.url)) return;
    if (this.marks.some((m) => m.url === t.url)) return;
    this.marks.unshift({ title: (t.title || t.url).slice(0, 200), url: t.url, folder: 'Bookmarks bar' });
    this.saveMarks();
    this.sendTabs();
  },

  /**
   * The bookmark's own right-click menu (2026-10-20): rename, remove, move, open, play in the pop-out, copy.
   * Found by its address, which is what the page sends; anything else is ignored.
   */
  markOp(this: SamaraBrowser, act: string, url: string, title = ''): void {
    const i = this.marks.findIndex((m) => m.url === url);
    if (i < 0 || !isWeb(url)) return;
    if (act === 'remove') this.marks.splice(i, 1);
    else if (act === 'rename') { const name = String(title).replace(/\s+/g, ' ').trim().slice(0, 200); if (!name) return; this.marks[i] = { ...this.marks[i]!, title: name }; }
    else if (act === 'left' || act === 'right') {
      const j = act === 'left' ? i - 1 : i + 1;
      if (j < 0 || j >= this.marks.length) return;
      [this.marks[i], this.marks[j]] = [this.marks[j]!, this.marks[i]!];
    }
    else if (act === 'newtab') { this.newTab(url, null, true); return; }
    else if (act === 'pop') { this.onPlayInPopout?.(url); return; }
    else if (act === 'copy') { clipboard.writeText(url); return; }
    else return;
    this.saveMarks();
    this.sendTabs();
  },

  /** From the star's panel: rename the bookmark for the page he is on, or take it off. */
  markAct(this: SamaraBrowser, act: string, title?: string): void {
    const t = this.cur();
    if (!t || !isWeb(t.url)) return;
    const i = this.marks.findIndex((m) => m.url === t.url);
    if (i < 0) return;
    if (act === 'remove') this.marks.splice(i, 1);
    else if (act === 'rename') { const name = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200); this.marks[i] = { ...this.marks[i]!, title: name || t.title || t.url }; }
    else return;
    this.saveMarks();
    this.sendTabs();
  }
};
