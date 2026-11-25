// 6.28, the update key (2026-10-13, sheet 18): nothing updates on its own. When a newer Electron of
// the same major is out, it is downloaded, checked against Electron's own SHA-256 list, unpacked beside the old one
// and tested on this PC, all quietly and never while the user is in a game or a call. Only then does the key appear in the
// band. The user clicks Restart now when it suits them; Samara starts the new engine as a TRIAL and goes back to the old
// one by itself if it dies in its first three minutes (src/Body/EnginePointer.cs). A major version is never
// prepared here: that needs the castLabs DRM engine and a look first.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { writeFileAtomic } from './atomic.ts';
import { readJson, saveText } from './store.ts';
import { FUSE, readFuses } from './fusewire.ts';
import { SwitchOrder, signWithSwitches } from './switchorder.ts';
import { behindMs, behindWords, chromeStable, closesGap, downloadEngine, latestEngine } from './enginerelease.ts';
import { Evs, type Signed } from './evs.ts';
import { stampEngine } from './brand.ts';

/** The user's tick boxes on an engine update (2026-10-14): the login lock, and closing the back doors. On by default. */
export interface Choices { lock: boolean; closeBackdoors: boolean }
/** `fixed`: castLabs would only sign this engine as it came, so the tick boxes are not offered (2026-10-23). */
export interface Ready { version: string; since: number; castlabs?: boolean; choices?: Choices; major?: boolean; fixed?: boolean;
  /** Phase 2: it closes a gap in Chrome's security fixes (and passed the safety checks), so it goes in by itself tonight. */
  security?: boolean;
  /** Look checks (Samara's own page) that failed on it: reported on the key, they do not stop the offer. */
  look?: string[] }
import { newer, plain } from './updateengine.ts';
import { sched } from './sched.ts';
import { swallowed } from './swallow.ts';
export { newer, plain };
export interface UpdateOptions {
  shellDir: string; stateDir: string;
  /** In a game or a call right now: no downloads, no tests, no restarts. */
  quietNow: () => boolean;
  changed: (r: Ready | null) => void;
  /** A castLabs engine could not be re-signed for video; true when castLabs' tool needs the user to sign in again. */
  signinNeeded?: (signIn: boolean) => void;
  /** castLabs' tool (tests swap this). */
  evs?: Evs;
}
/** Running on castLabs' engine (Widevine, VMP-signed): only it has the components API (checked 2026-10-13: stock 44.7.0 has none). */
export const onCastlabs = (): boolean => { try { return Boolean(createRequire(import.meta.url)('electron').components); } catch { return false; } };

interface Pointer { version: string; dir: string; status: 'trial' | 'good'; previous: { version: string; dir: string } | null; at: string }

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
/** The newest plain release of the same major as `current`, newer than it and not one that failed before. */
export function pick(versions: string[], current: string, failed: Set<string>): string | null {
  const major = VERSION.exec(current)?.[1];
  let best: string | null = null;
  for (const v of versions) {
    if (!VERSION.test(v) || VERSION.exec(v)![1] !== major || failed.has(v) || !newer(v, current)) continue;
    if (!best || newer(v, best)) best = v;
  }
  return best;
}
/** The hash Electron lists for a file in its SHASUMS256.txt, or null. */
export function shaFor(list: string, file: string): string | null {
  for (const line of list.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64}) [ *]?(.+)$/i.exec(line.trim());
    if (m && m[2] === file) return m[1]!.toLowerCase();
  }
  return null;
}

const DAY = 24 * 60 * 60_000;

/** What the safety checks said about an engine (test/electron/calls-check.ts and engine-safety-check.ts). */
export interface TestResult { ok: boolean; look: string[]; chrome: string; missing?: boolean;
  /** Stopped by a call or a game, not by the engine. */
  held?: boolean }
/** calls-check.ts exits with this when only look checks (Samara's own page) failed: the engine itself is fine. */
export const LOOK_ONLY = 5;
/**
 * One check script's run, read from its exit code and output: blocking failures stop the engine; look failures are kept
 * for the key. The engine's Chromium comes from engine-safety-check.ts's "ENGINE chrome=" line.
 */
export function readRun(code: number | null, out: string): TestResult {
  const look = out.split(/\r?\n/).filter((l) => /^FAIL\s+\[look\]/.test(l)).map((l) => l.replace(/^FAIL\s+\[look\]\s*/, '').replace(/\s+--.*$/, '').trim()).filter(Boolean);
  const chrome = /^ENGINE chrome=(\d+\.\d+\.\d+\.\d+)/m.exec(out)?.[1] ?? '';
  return { ok: code === 0 || code === LOOK_ONLY, look, chrome };
}
/**
 * A version that failed its checks today, so the four-minute test is not run again on every check (2026-11-17: 44.11.4
 * was tested every few minutes all evening). One line per version, "44.11.4 2026-11-17", like failed.txt.
 */
export function failedToday(text: string, v: string, today: string): boolean {
  return text.split(/\r?\n/).some((l) => { const [x, d] = l.trim().split(/\s+/); return x === plain(v) && d === today; });
}
/** This machine's date, "2026-11-17" (a failed test waits until tomorrow, the user's tomorrow). */
export const dayOf = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The newest stable castLabs release newer than `current`, not one that failed before. */
export function newestCastlabs(releases: { tag: string; prerelease: boolean }[], current: string, failed: Set<string>): string | null {
  let best: string | null = null;
  for (const r of releases) {
    const m = /^v(\d+\.\d+\.\d+)\+wvcus$/.exec(r.tag);
    if (!m || r.prerelease || failed.has(m[1]!) || !newer(m[1]!, current)) continue;
    if (!best || newer(m[1]!, best)) best = m[1]!;
  }
  return best;
}

export class EngineUpdates {
  private readonly engines: string;
  private readonly stateFile: string;
  private readonly doneFile: string;
  private busy = false;
  private timers: NodeJS.Timeout[] = [];
  ready: Ready | null = null;
  private readonly o: UpdateOptions;
  private readonly evs: Evs;

  constructor(o: UpdateOptions) {
    this.o = o;
    this.evs = o.evs ?? new Evs({ log: (t) => console.log('shell: ' + t) });
    this.engines = path.join(o.shellDir, 'engines');
    this.stateFile = path.join(o.stateDir, 'engine-update.json');
    this.doneFile = path.join(o.stateDir, 'engine-just-updated.json');
    try {
      const s = readJson<any>(this.stateFile, null);
      if (typeof s?.version === 'string' && newer(s.version, process.versions.electron) && existsSync(this.exeOf(s.version))) {
        this.ready = { version: s.version, since: Number(s.since) || Date.now(), ...(s.castlabs === true ? { castlabs: true, fixed: true } : {}), ...(s.security === true ? { security: true } : {}), ...(Array.isArray(s.look) && s.look.length ? { look: s.look.map(String).slice(0, 10) } : {}) };
      }
    } catch { /* nothing waiting */ }
  }

  /** castLabs engines live in castlabs-<version>, plain Electron ones in <version>. */
  private dirOf(v: string): string { return existsSync(path.join(this.engines, 'castlabs-' + plain(v))) ? 'castlabs-' + plain(v) : plain(v); }
  private exeOf(v: string): string { return path.join(this.engines, this.dirOf(v), 'electron.exe'); }
  /** The program the checks run: Samara.exe when it is there and signed (what the user will run), else electron.exe. */
  private testExe(v: string): string {
    const s = path.join(this.engines, this.dirOf(v), 'Samara.exe');
    return existsSync(s) && existsSync(s + '.sig') ? s : this.exeOf(v);
  }
  /**
   * Samara.exe beside electron.exe, with its own name and icons (brand.ts), and Samara.exe signed for
   * paid video. Never blocks an engine: without them, Samara runs on electron.exe as before.
   */
  private async brand(dir: string): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    if (!(await stampEngine(dir, this.o.shellDir, (l) => console.log(l)))) return false;
    const r = await this.evs.sign(dir, 'Samara');
    if (r !== 'ok') { console.log(`shell: Samara.exe was not signed for video (${r}); Samara keeps electron.exe`); rmSync(path.join(dir, 'Samara.exe'), { force: true }); rmSync(path.join(dir, 'Samara.exe.sig'), { force: true }); return false; }
    console.log(`shell: engine in ${path.basename(dir)} carries Samara's name and icon`);
    return true;
  }
  /** The engine running now, made before branding (2026-11-20): branded once, a few minutes after start. */
  private brandRunning(): void {
    if (process.platform !== 'win32' || !onCastlabs()) return;
    const dir = path.dirname(process.execPath);
    if (path.resolve(path.dirname(dir)) !== path.resolve(this.engines) || existsSync(path.join(dir, 'Samara.exe.sig'))) return;
    this.timers.push(setTimeout(() => { if (!this.busy && !this.o.quietNow()) { this.busy = true; void this.brand(dir).finally(() => { this.busy = false; }); } }, 3 * 60_000));
  }
  private failed(): Set<string> {
    try { return new Set(readFileSync(path.join(this.engines, 'failed.txt'), 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)); } catch { return new Set(); }
  }
  private pointer(): Pointer | null { return readJson<Pointer | null>(path.join(this.engines, 'current.json'), null); }
  private todayFile(): string { return path.join(this.engines, 'failed-today.txt'); }
  /** Failed the safety checks today: not tested again until tomorrow (or the user's own "Check for updates"). */
  private failedToday(v: string): boolean { try { return failedToday(readFileSync(this.todayFile(), 'utf8'), v, dayOf()); } catch { return false; } }
  private clearFailedToday(v: string): void {
    try { saveText(this.todayFile(), readFileSync(this.todayFile(), 'utf8').split(/\r?\n/).filter((l) => l.trim() && l.trim().split(/\s+/)[0] !== plain(v)).map((l) => l + '\n').join('')); } catch { /* none */ }
  }
  private markFailedToday(v: string): void {
    let keep: string[] = [];
    try { keep = readFileSync(this.todayFile(), 'utf8').split(/\r?\n/).filter((l) => l.trim().split(/\s+/)[1] === dayOf()); } catch { /* first */ }
    saveText(this.todayFile(), [...keep, `${plain(v)} ${dayOf()}`].join('\n') + '\n');
  }

  // ---- their ... menu on the update (sheet 35): put a version away, skip it for good, go back, check now
  private filedFile(): string { return path.join(this.o.stateDir, 'engine-filed.json'); }
  private filed(): Set<string> { try { return new Set(readJson<Iterable<string>>(this.filedFile(), [])); } catch { return new Set(); } }
  /** Put away: kept on file, not offered until the user checks for updates themselves. */
  file(): void { const r = this.ready; if (!r) return; const f = this.filed(); f.add(plain(r.version)); try { writeFileAtomic(this.filedFile(), JSON.stringify([...f])); } catch (e) { swallowed('engine.filed', e); } this.set(null); }
  /** Skip for good: never offered again (the same list a version that failed its checks goes on). */
  skip(): void {
    const r = this.ready; if (!r) return;
    saveText(path.join(this.engines, 'failed.txt'), [...this.failed(), plain(r.version)].join('\n') + '\n');
    this.set(null);
  }
  /** Is there an engine to go back to (the one before this, still kept)? */
  canBack(): boolean {
    const p = this.pointer();
    return !!p?.previous && existsSync(path.join(this.engines, p.previous.dir, 'electron.exe')) && path.resolve(path.dirname(process.execPath)) === path.resolve(this.engines, p.dir);
  }
  /** Go back to the engine before this one; the companion starts it when the Shell quits. */
  goBack(): boolean {
    const p = this.pointer();
    if (!p?.previous || !this.canBack()) return false;
    writeFileAtomic(path.join(this.engines, 'current.json'), JSON.stringify({ version: p.previous.version, dir: p.previous.dir, status: 'good', previous: null, at: new Date().toISOString() }));
    const f = this.filed(); f.add(plain(p.version)); try { writeFileAtomic(this.filedFile(), JSON.stringify([...f])); } catch { /* best effort */ }
    console.log(`shell: going back from engine ${p.version} to ${p.previous.version} (by hand)`);
    return true;
  }
  /** Check for updates now (Samara's ... menu): what was put away comes back, and a look right now. */
  async checkNow(): Promise<void> { for (const f of [this.filedFile(), this.todayFile()]) { try { unlinkSync(f); } catch { /* none */ } } this.denied.clear(); await this.check(true); }
  /** castLabs said no to signing these engines: not asked again until the time here. */
  private denied = new Map<string, number>();

  /** Ten minutes after start, then once a day (the scheduler; held through a call or a game, then run). */
  start(): void {
    this.trialCheck();
    this.brandRunning();
    sched.every('engine.check', DAY, () => this.check(), { first: 10 * 60_000, quiet: true });
  }
  stop(): void { this.timers.forEach(clearTimeout); this.timers = []; sched.cancel('engine.check'); this.stopQuiet?.(); this.stopQuiet = null; }

  /** Running on a trial engine for five minutes means it works: mark it good and tidy old engines away. */
  trialCheck(after = 5 * 60_000): void {
    const p = this.pointer();
    if (!p || p.status !== 'trial') return;
    if (path.resolve(path.dirname(process.execPath)) !== path.resolve(this.engines, p.dir)) return;
    this.timers.push(setTimeout(() => {
      const q = this.pointer();
      if (!q || q.version !== p.version || q.status !== 'trial') return;
      try { writeFileAtomic(path.join(this.engines, 'current.json'), JSON.stringify({ ...q, status: 'good', at: new Date().toISOString() })); } catch { return; }
      console.log(`shell: engine ${p.version} passed its trial`);
      this.tidy(q);
    }, after));
  }
  /** Keep only the engine in use and the one before it. */
  private tidy(p: Pointer): void {
    const keep = new Set([p.dir, p.previous?.dir].filter(Boolean));
    try {
      for (const d of readdirSync(this.engines)) {
        const full = path.join(this.engines, d);
        if (!keep.has(d) && (VERSION.test(d) || /^castlabs-\d+\.\d+\.\d+$/.test(d)) && statSync(full).isDirectory()) rmSync(full, { recursive: true, force: true });
      }
    } catch (e) { swallowed('engine.tidy', e); }
  }

  /** Is there a newer engine? Get it ready, quietly. */
  /** `byHand`: the user's own "Check for updates" click. It is never held by a call; only the background check waits. */
  async check(byHand = false): Promise<void> {
    if (this.busy || (!byHand && this.o.quietNow())) return;
    // One engine (2026-10-13): the browser runs on castLabs' engine so paid video plays in its tabs. A stock
    // Electron update would take Widevine away, so none is offered; castLabs' own come in their own step.
    if (onCastlabs()) { await this.castlabsCheck(byHand); return; }
    this.busy = true;
    try {
      const cur = process.versions.electron;
      const r = await fetch('https://registry.npmjs.org/electron', { headers: { Accept: 'application/vnd.npm.install-v1+json' }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`the npm registry said ${r.status}`);
      const v = pick(Object.keys(((await r.json()) as { versions?: Record<string, unknown> }).versions ?? {}), cur, this.failed());
      if (!v) { this.set(null); return; }
      if (this.ready?.version === v || this.failedToday(v)) return;
      console.log(`shell: engine ${v} is out (running ${cur}); getting it ready`);
      if (!existsSync(this.exeOf(v))) await this.fetchEngine(v);
      const t = await this.test(v);
      if (!t.ok) return;
      const stable = await chromeStable(fetch as never);
      const security = closesGap(process.versions.chrome, t.chrome, stable);
      this.behind = stable.length && t.chrome ? `Your engine today is ${behindWords(behindMs(process.versions.chrome, stable))} behind Chrome's security fixes. This one is ${behindWords(behindMs(t.chrome, stable))} behind.` : '';
      this.set({ version: v, since: Date.now(), ...(security ? { security } : {}), ...(t.look.length ? { look: t.look } : {}) });
      console.log(`shell: engine ${v} (Chromium ${t.chrome || '?'}) is ready${security ? " and closes a gap in Chrome's security fixes: it goes in tonight" : ''}; the update key is showing`);
    } catch (e) {
      console.log('shell: engine update check: ' + (e as Error).message);
    } finally { this.busy = false; }
  }

  /**
   * The castLabs engine (2026-10-14 and 2026-10-30): taken from the sealed engine release on GitHub
   * (enginerelease.ts: castLabs' own download, checked against castLabs' fingerprint and sealed with the release key),
   * made ready quietly: unpacked, signed for paid video with the castLabs account (evs.ts, castLabs' own tool that
   * Samara installs itself), and run through the safety checks. Only then does UPDATE light up.
   * Video wins over the safety switches (2026-10-30, until castLabs says yes): castLabs signs only an
   * engine exactly as they shipped it (proved 2026-10-23), so the switches stay as castLabs set them.
   */
  private async castlabsCheck(byHand = false): Promise<void> {
    if (this.busy || this.signin === 'waiting') return;
    this.busy = true;
    try {
      const cur = plain(process.versions.electron);
      const found = await latestEngine(fetch as never, cur, 'win32-x64');
      if (!found || this.failed().has(found.m.version) || this.filed().has(found.m.version)) { if (this.ready) this.set(null); return; }
      const { m, asset } = found, v = m.version;
      if (this.ready?.version === v && !this.signin) return;
      // Phase 2: castLabs wants him to sign in and he has not yet: told once, not signed again until he has.
      if (this.signin === 'ask' && this.signinFor?.version === v && this.evs.loginStamp() <= this.askedStamp) return;
      if (this.failedToday(v)) return;
      // 2026-11-02 (the PC lagged right after Samara opened): castLabs refusing to sign this engine was
      // tried again on every check and nudge, each time rewriting the engine's switches and hashing it whole. A refusal
      // waits a day now; the user's own "Check for updates" tries straight away.
      if ((this.denied.get(v) ?? 0) > Date.now()) return;
      const stable = await chromeStable(fetch as never);
      this.behind = stable.length ? `Your engine today is ${behindWords(behindMs(process.versions.chrome, stable))} behind Chrome's security fixes. This one is ${behindWords(behindMs(m.chrome, stable))} behind.` : '';
      // Never when the logins here are already locked: an engine as castLabs shipped it cannot read them, and they
      // would be lost.
      if (EngineUpdates.runningFuses()[FUSE.EnableCookieEncryption] === '1') {
        console.log(`shell: castLabs ${v} can only be signed for video without the login lock, and the logins here are locked; not offered`);
        return;
      }
      console.log(`shell: castLabs engine ${v} is on GitHub (running ${cur}); getting it ready`);
      if (this.ready) { this.getting = v; this.o.changed(this.ready); }
      const dir = path.join(this.engines, 'castlabs-' + v);
      if (!existsSync(path.join(dir, 'electron.exe'))) {
        mkdirSync(this.engines, { recursive: true });
        const zip = path.join(this.engines, asset.file);
        if (!(await downloadEngine(fetch as never, m, asset, zip))) throw new Error(`castLabs ${v} did not download whole`);
        await this.unzip(zip, 'castlabs-' + v);
      }
      this.pendingMajor = v.split('.')[0] !== cur.split('.')[0];
      const signed = await this.switchesAndSign(v);
      if (signed === 'denied') this.denied.set(v, Date.now() + DAY);
      if (signed !== 'ok') return;
      await this.brand(dir);
      let t = await this.test(v, byHand);
      // Phase 2: closed back doors that castLabs signed but that then fail the checks (video not playing, say): this
      // machine learns it for the major, and the engine is signed and checked again as castLabs shipped it.
      if (!t.ok && !t.held && this.closedNow.has(v)) {
        this.order.learn(v, 'the engine failed its checks with its back doors closed');
        this.clearFailedToday(v);
        if ((await this.switchesAndSign(v)) !== 'ok') return;
        await this.brand(dir);
        t = await this.test(v, byHand);
      }
      if (!t.ok) return;
      // A new major is never put in by itself: it waits for a click, security fixes or not.
      const security = !this.pendingMajor && closesGap(process.versions.chrome, m.chrome, stable);
      this.set({ version: v, since: Date.parse(m.published) || Date.now(), castlabs: true, major: this.pendingMajor, fixed: true, ...(security ? { security } : {}), ...(t.look.length ? { look: t.look } : {}) });
      console.log(`shell: castLabs engine ${v} (Chromium ${m.chrome}) is ready${security ? " and closes a gap in Chrome's security fixes: it goes in tonight" : ''}; the update key is showing`);
    } catch (e) {
      console.log('shell: engine update check: ' + (e as Error).message);
    } finally {
      this.busy = false;
      if (this.getting) { this.getting = ''; this.o.changed(this.ready); }
    }
  }
  /** Sheet 114: a newer engine being made ready while `ready` stays on the key. */
  getting = '';
  /** Sheet 108: castLabs wants the user to sign in ('ask'), or Terminal is open for it ('waiting'). */
  signin: 'ask' | 'waiting' | null = null;
  /** The engine waiting for that sign-in. */
  signinFor: { version: string; since: number } | null = null;
  /** Sheet 108: how far behind Chrome, for the card's one line. */
  behind = '';
  private pendingMajor = false;
  /** The user's click on "Sign in to castLabs": Terminal opens with the sign-in typed; once castLabs has the user, it signs. */
  async openSignin(): Promise<boolean> {
    if (this.signin !== 'ask') return false;
    const since = this.evs.loginStamp();
    if (!(await this.evs.openSignin())) return false;
    this.signin = 'waiting'; this.o.changed(this.ready);
    this.evs.watchSignin(since, (inNow) => {
      this.signin = inNow ? null : 'ask';
      this.o.changed(this.ready);
      if (inNow) void this.check();
    });
    return true;
  }
  /** Phase 2: the engine signed for paid video with its back doors closed first (switchorder.ts), or as castLabs
   *  shipped it when castLabs refuses that. The switches live in electron.exe, which the video signature covers. */
  async switchesAndSign(v: string, dir = path.join(this.engines, 'castlabs-' + plain(v))): Promise<Signed> {
    const { r, closed } = await signWithSwitches({ v: plain(v), fuseFile: path.join(dir, 'electron.exe'), stockFile: path.join(dir, 'stock-fuses.txt'), order: this.order, sign: () => this.evs.sign(dir), log: (t) => console.log('shell: ' + t) });
    if (closed) this.closedNow.add(plain(v)); else this.closedNow.delete(plain(v));
    if (r === 'signin') {
      const first = this.signin !== 'ask' || this.signinFor?.version !== plain(v);
      this.signin = 'ask'; this.signinFor = { version: plain(v), since: Date.now() }; this.askedStamp = this.evs.loginStamp();
      this.o.changed(this.ready);
      // Told once (Phase 2): the card and one note, not one on every check. A sign-in he does on his own, outside
      // Samara's key, is noticed too, and the engine is signed then.
      if (first) { this.o.signinNeeded?.(true); this.watchQuietly(); }
    } else if (r === 'ok') { this.signin = null; this.stopQuiet?.(); this.stopQuiet = null; }
    return r;
  }
  /** What this machine learned about closing the switches before signing. */
  private get order(): SwitchOrder { return new SwitchOrder(path.join(this.engines, 'switch-order.json')); }
  /** Engines signed here with their back doors closed (this run). */
  private readonly closedNow = new Set<string>();
  /** castLabs' login file as it was when he was asked to sign in. */
  private askedStamp = 0;
  private stopQuiet: (() => void) | null = null;
  /** Waits (a week, a look every half minute) for castLabs' sign-in, however he does it, then carries on. */
  private watchQuietly(): void {
    this.stopQuiet?.();
    this.stopQuiet = this.evs.watchSignin(this.askedStamp, (inNow) => {
      this.stopQuiet = null;
      if (inNow && this.signin === 'ask') { this.signin = null; this.o.changed(this.ready); void this.check(); }
    }, 7 * DAY, 30_000);
  }
  /** What the switches are on the engine running now ("0100..."), or '' (for the one-time login re-lock). */
  static runningFuses(): string { try { return readFuses(process.execPath); } catch { return ''; } }

  private set(r: Ready | null): void {
    this.ready = r;
    try { if (r) writeFileAtomic(this.stateFile, JSON.stringify(r)); else if (existsSync(this.stateFile)) unlinkSync(this.stateFile); } catch (e) { swallowed('engine.state', e); }
    this.o.changed(r);
  }

  /** Unpack a checked zip into engines/<dirName> (Windows' own tar unpacks zip files). */
  private async unzip(zip: string, dirName: string): Promise<void> {
    const into = path.join(this.engines, dirName + '.partial');
    rmSync(into, { recursive: true, force: true }); mkdirSync(into, { recursive: true });
    await new Promise<void>((res, rej) => {
      const t = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', into], { windowsHide: true });
      t.on('error', rej); t.on('exit', (c) => (c === 0 ? res() : rej(new Error(`unpacking ${dirName} failed (${c})`))));
    });
    rmSync(zip, { force: true });
    if (!existsSync(path.join(into, 'electron.exe'))) throw new Error(`${dirName} unpacked without electron.exe`);
    rmSync(path.join(this.engines, dirName), { recursive: true, force: true });
    renameSync(into, path.join(this.engines, dirName));
  }

  /** Download, check the SHA-256 against Electron's own list, unpack beside the old engine. */
  private async fetchEngine(v: string): Promise<void> {
    mkdirSync(this.engines, { recursive: true });
    const file = `electron-v${v}-win32-x64.zip`;
    const base = `https://github.com/electron/electron/releases/download/v${v}/`;
    const sums = await fetch(base + 'SHASUMS256.txt', { signal: AbortSignal.timeout(30_000) });
    if (!sums.ok) throw new Error(`no fingerprint list for ${v} (${sums.status})`);
    const want = shaFor(await sums.text(), file);
    if (!want) throw new Error(`${file} is not in Electron's fingerprint list`);
    const zip = path.join(this.engines, file + '.partial');
    const got = await fetch(base + file, { signal: AbortSignal.timeout(15 * 60_000) });
    if (!got.ok || !got.body) throw new Error(`the download of ${v} failed (${got.status})`);
    const hash = createHash('sha256');
    const out = createWriteStream(zip);
    await pipeline(Readable.fromWeb(got.body as import('node:stream/web').ReadableStream), async function* (src) { for await (const c of src) { hash.update(c as Buffer); yield c; } }, out);
    const sha = hash.digest('hex');
    if (sha !== want) { rmSync(zip, { force: true }); throw new Error(`${file} did not match Electron's fingerprint; thrown away`); }
    const into = path.join(this.engines, v + '.partial');
    rmSync(into, { recursive: true, force: true });
    mkdirSync(into, { recursive: true });
    // Windows' own tar unpacks zip files.
    await new Promise<void>((res, rej) => {
      const t = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', into], { windowsHide: true });
      t.on('error', rej);
      t.on('exit', (c) => (c === 0 ? res() : rej(new Error(`unpacking ${v} failed (${c})`))));
    });
    rmSync(zip, { force: true });
    if (!existsSync(path.join(into, 'electron.exe'))) throw new Error(`${v} unpacked without electron.exe`);
    rmSync(path.join(this.engines, v), { recursive: true, force: true });
    renameSync(into, path.join(this.engines, v));
  }

  /**
   * The new engine runs the safety checks in hidden windows, only when the user is not in a game or a call:
   * test/electron/engine-safety-check.ts (a public page loads; on castLabs, Widevine loads and a protected test stream
   * plays; the phishing block fires; a download is marked from the internet) and test/electron/calls-check.ts (screen
   * sharing, camera permission, spellcheck, and Samara's own page). Only blocking checks stop an engine; look checks
   * are reported on the key. A failure is remembered for the day, so the test is not run again until tomorrow.
   */
  private async test(v: string, byHand = false): Promise<TestResult> {
    if (!byHand && this.o.quietNow()) return { ok: false, look: [], chrome: '', held: true };
    const runs: TestResult[] = [];
    // engine-safety-check is required. calls-check (calls, camera, spellcheck, Samara's page) runs when this Samara has
    // it: releases carry only the safety check (2026-11-24: with both required, a Samara from a release turned every
    // engine away as "missing").
    const scripts = ['test/electron/engine-safety-check.ts', ...(existsSync(path.join(this.o.shellDir, 'test/electron/calls-check.ts')) ? ['test/electron/calls-check.ts'] : [])];
    for (const script of scripts) {
      const r = await this.runCheck(v, script);
      runs.push(r);
      if (!r.ok) break;
    }
    const ok = runs.length === scripts.length && runs.every((r) => r.ok);
    const look = runs.flatMap((r) => r.look), chrome = runs.find((r) => r.chrome)?.chrome ?? '';
    if (ok) { if (look.length) console.log(`shell: engine ${v} passed the safety checks; ${look.length} look check${look.length === 1 ? '' : 's'} on Samara's page failed (shown on the key, not blocking)`); return { ok, look, chrome }; }
    // Held by a call or a game mid-test is not a failure; anything else waits until tomorrow.
    const held = this.o.quietNow();
    if (!held && !runs.some((r) => r.missing)) this.markFailedToday(v);
    console.log(`shell: engine ${v} did not pass the safety checks; not offered, tried again tomorrow`);
    return { ok: false, look, chrome, ...(held ? { held } : {}) };
  }
  /** One check script on the new engine, at most four minutes. */
  private async runCheck(v: string, script: string): Promise<TestResult> {
    // 2026-11-20: the release left the check scripts out, so Electron sat on a missing file until the 4 minute kill and
    // every engine was turned away. Missing now says so at once, and is not counted against the engine.
    if (!existsSync(path.join(this.o.shellDir, script))) { console.log(`shell: engine ${v}: ${script} is missing from this Samara; the engine is not offered`); return { ok: false, look: [], chrome: '', missing: true }; }
    const pics = await mkdtemp(path.join(os.tmpdir(), 'samara-engine-test-'));
    let out = '';
    const code = await new Promise<number | null>((res) => {
      const t = spawn(this.testExe(v), [script, pics], { cwd: this.o.shellDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      t.stdout?.on('data', (d) => { out = (out + String(d)).slice(-20_000); });
      t.stderr?.on('data', () => { /* Chromium's own noise */ });
      const kill = setTimeout(() => { try { t.kill(); } catch { /* gone */ } }, 4 * 60_000);
      t.on('error', () => { clearTimeout(kill); res(null); });
      t.on('exit', (c) => { clearTimeout(kill); res(c); });
    });
    try { rmSync(pics, { recursive: true, force: true }); } catch { /* temp */ }
    if (code !== 0) console.log(`shell: engine ${v} ${path.basename(script)} said (exit ${code}): ${out.split('\n').filter((l) => /FAIL|HARNESS|passed/.test(l)).join(' | ').slice(0, 600)}`);
    return readRun(code, out);
  }

  /**
   * The user's click on Restart now: point the companion at the new engine as a trial, note it for the "updated" line, and
   * quit. The companion starts the Shell again on the new engine within seconds.
   */
  async restartNow(browserOpen: boolean, _choices?: Partial<Choices>, overnight?: { title: string; lines: string[] }): Promise<{ ok: boolean; why?: string }> {
    const r = this.ready;
    if (!r || !existsSync(this.exeOf(r.version))) return { ok: false, why: 'The update is not ready any more.' };
    if (this.o.quietNow()) return { ok: false, why: 'Not during a call or a game.' };
    if (this.signin) return { ok: false, why: 'Sign in to castLabs first, so the new engine plays video.' };
    const now = this.pointer();
    const running = path.dirname(process.execPath);
    const prevDir = now && path.resolve(this.engines, now.dir) === path.resolve(running) ? { version: now.version, dir: now.dir } : null;
    const p: Pointer = { version: r.version, dir: this.dirOf(r.version), status: 'trial', previous: prevDir, at: new Date().toISOString() };
    writeFileAtomic(path.join(this.engines, 'current.json'), JSON.stringify(p));
    writeFileAtomic(this.doneFile, JSON.stringify({ from: process.versions.electron, to: r.version, browser: browserOpen, ...(overnight ? { overnight: true, title: overnight.title, lines: overnight.lines } : {}) }));
    try { unlinkSync(this.stateFile); } catch { /* fine */ }
    console.log(`shell: restarting onto engine ${r.version} (${overnight ? 'overnight' : 'by hand'})`);
    return { ok: true };
  }

  /** After a restart: did it just update? Once only. */
  justUpdated(): { from: string; to: string; browser: boolean; overnight?: boolean; title?: string; lines?: string[] } | null {
    try {
      const j = JSON.parse(readFileSync(this.doneFile, 'utf8'));
      unlinkSync(this.doneFile);
      if (plain(j?.to) !== plain(process.versions.electron)) return null;   // rolled back: the old engine is running again
      return { from: String(j.from), to: String(j.to), browser: j.browser === true, overnight: j.overnight === true, ...(typeof j.title === 'string' ? { title: j.title } : {}), ...(Array.isArray(j.lines) ? { lines: j.lines.map(String) } : {}) };
    } catch { return null; }
  }
}
