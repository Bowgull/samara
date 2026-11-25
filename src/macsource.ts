// The update engine's Mac half (2026-10-30): moved out of mac.ts, where it was ~250 lines inline. Two sources
// feed one staged Samara.app: Samara's own code from GitHub (a sealed release, ghrelease.ts) and a new castLabs engine
// (a sealed engine release, enginerelease.ts, signed for video here by castLabs' tool, evs.ts). Whatever is ready is
// built into ONE new Samara beside the running one, in the background at low priority (macupdate.ts), so his UPDATE key
// has one Restart now. The swap keeps the old insides in rollback/ and puts them back if the new one does not start.
//
//   Samara/browser/installed.json          what runs: { version, commit, status: trial|good, engine? }
//   Samara/browser/staged/                  the new Samara, made ready
//   Samara/browser/engines/castlabs-<v>/    a new engine, unpacked and signed for video
//   failed-updates.txt / filed-updates.txt        Samara versions not to offer again / put away
//   failed-engines.txt / filed-engines.txt        the same for engines
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { catchUp } from './catchup.ts';
import { download as ghDownload, latest as ghLatest, titleOf, withSection, type Manifest } from './ghrelease.ts';
import { behindMs, behindWords, chromeStable, closesGap, downloadEngine, enginePlatform, latestEngine, type EngineManifest, type EnginePlatform } from './enginerelease.ts';
import { Evs, type Signed, type SigninKind } from './evs.ts';
import { SwitchOrder, signWithSwitches } from './switchorder.ts';
import { readRun } from './engineupdate.ts';
import { macMayTake } from './canary.ts';
import { fileURLToPath } from 'node:url';
import { engineGroups } from './pcsource.ts';
import { macUpdateScript } from './macupdate.ts';
import { macAppName, macBundleId, macHome } from './dirs.ts';
import { readJson, saveJson } from './store.ts';
import { VersionLists, isVersion, newer, plain, type CardGroup, type CheckOutcome, type CheckProgress, type Offer, type Source } from './updateengine.ts';
import { swallowed } from './swallow.ts';

type Fetch = Parameters<typeof ghLatest>[0];
export interface Installed { version: string; commit: string; status: string; engine?: string }

export class MacPaths {
  readonly listener: string;
  constructor(listener: string) { this.listener = listener; }
  get br(): string { return path.join(this.listener, 'browser'); }
  get installed(): string { return path.join(this.br, 'installed.json'); }
  get staged(): string { return path.join(this.br, 'staged', 'version'); }
  get script(): string { return path.join(this.listener, 'update.sh'); }
  get changelog(): string { return path.join(this.listener, 'Samara Changelog.md'); }
  get updateLog(): string { return path.join(this.listener, 'update.log'); }
  get night(): string { return path.join(this.listener, 'update-overnight.json'); }
  get prefs(): string { return path.join(this.listener, 'update-prefs.json'); }
}

export function readInstalled(file: string): Installed {
  return readJson<Installed>(file, { version: '', commit: '', status: '' }, (r) => {
    const j = r as Record<string, unknown>;
    return { version: String(j.version ?? ''), commit: String(j.commit ?? ''), status: String(j.status ?? ''), ...(typeof j.engine === 'string' ? { engine: j.engine } : {}) };
  });
}

/**
 * Deletes an old copy of Samara for good (2026-11-20). macOS 13's App Management can refuse
 * to delete inside an app bundle while still allowing the folder to move, so a refused copy waits in `old` (beside it,
 * in browser/) and the update script deletes `old` again on every update. Says what happened only when it had to wait.
 */
export function retireCopy(dir: string, old: string, name: string): string {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* refused: moved aside below */ }
  if (!existsSync(dir)) return '';
  try { mkdirSync(old, { recursive: true }); renameSync(dir, path.join(old, `${name} ${new Date().toISOString().replace(/[:.]/g, '-')}`)); } catch { /* left where it is */ }
  return existsSync(dir) ? `an old ${name} copy could not be deleted or moved: ${dir}` : `macOS would not let Samara delete an old ${name} copy; it waits in ${old} for the next update`;
}

/** How a script is run (tests swap this): 'prepare' waits and says how it ended; 'swap' is let go. */
export type RunScript = (script: string, phase: 'prepare' | 'swap', log: string) => Promise<number>;
const runScript: RunScript = (script, phase, log) => new Promise((res) => {
  const out = openSync(log, 'w');
  if (phase === 'swap') { spawn('/bin/bash', [script, 'swap'], { detached: true, stdio: ['ignore', out, out] }).unref(); res(0); return; }
  // taskpolicy -b: background priority for CPU and disk, so his Mac stays smooth while it works.
  const c = spawn('/usr/sbin/taskpolicy', ['-b', '/bin/bash', script, 'prepare'], { stdio: ['ignore', out, out] });
  c.on('error', () => res(-1));
  c.on('exit', (code) => res(code ?? -1));
});

/**
 * The one staged Samara. Samara's release and the engine each say what they want in it; it is (re)built in the
 * background whenever that changes, and is ready once the build matches what both want.
 *
 * Sheet 114 (2026-10-31): a newer version that comes out while one is ready never
 * takes the key away. The ready one stays staged and on the key (Restart now puts it in), and the newer one is made
 * behind it in staged-next; once that is ready it takes the ready one's place on the key.
 */
type Build = { key: string; sha: string; samara: MacStage['samara']; engine: MacStage['engine'] };
export class MacStage {
  samara: { m: Manifest; bundle: string } | null = null;
  engine: { version: string; app: string } | null = null;
  private building = '';
  private again = false;
  private built: Build | null = null;
  private readonly p: MacPaths;
  private readonly o: { run: RunScript; log: (s: string) => void; changed: () => void };
  constructor(p: MacPaths, o: { run?: RunScript; log: (s: string) => void; changed: () => void }) {
    this.p = p; this.o = { ...o, run: o.run ?? runScript };
  }

  /** What the build should be: "1.24.0", "1.23.0+44.9.3", or '' (nothing waits). */
  key(): string {
    const i = readInstalled(this.p.installed);
    const v = this.samara?.m.version ?? i.version;
    if (!this.samara && !this.engine) return '';
    return this.engine ? `${v}+${this.engine.version}` : v;
  }
  private stagedKey(dir = 'staged'): string { try { return readFileSync(path.join(this.p.br, dir, 'version'), 'utf8').trim(); } catch { return ''; } }
  /** The staged Samara is whole and its script untouched: Restart now can put it in (whatever is wanted since). */
  ready(): boolean {
    const b = this.built;
    if (!b || this.stagedKey() !== b.key) return false;
    try { return createHash('sha256').update(readFileSync(this.p.script)).digest('hex') === b.sha; } catch { return false; }
  }
  /** What Restart now puts in (Samara's release, the engine), while it is ready. */
  get readySamara(): MacStage['samara'] { return this.ready() ? this.built!.samara : null; }
  get readyEngine(): MacStage['engine'] { return this.ready() ? this.built!.engine : null; }
  /** Sheet 114: the newer one getting ready behind the ready one ("1.27.1"), and the ready one ("1.27.0"). */
  coming(): { next: string; now: string } | null {
    const k = this.key();
    if (!k || !this.ready() || k === this.built!.key) return null;
    const words = (s: MacStage['samara'], e: MacStage['engine']) => s && e ? `${s.m.version} with engine ${e.version}` : s ? s.m.version : e ? `engine ${e.version}` : '';
    return { next: words(this.samara, this.engine), now: words(this.built!.samara, this.built!.engine) };
  }
  /** The ready one is not wanted any more (put away or skipped): it leaves the key. */
  forget(): void { this.built = null; }
  /** Sheet 122: back once nothing is being built (his watched check waits for "setting it up" to end). */
  async whenBuilt(): Promise<void> { while (this.building || this.again) await new Promise((r) => setTimeout(r, 500)); }
  private script(stage: 'staged' | 'staged-next'): string {
    const i = readInstalled(this.p.installed);
    const version = this.samara?.m.version ?? i.version, commit = this.samara?.m.commit ?? i.commit;
    return macUpdateScript({ where: { dir: this.p.listener, name: macAppName(), id: macBundleId() }, bundle: this.samara?.bundle ?? '', version, commit, ...(this.engine ? { engine: this.engine } : {}), stage });
  }

  /** Build what is wanted, in the background. A change while building builds again once it ends. */
  async build(): Promise<void> {
    const k = this.key();
    if (!k) { if (this.built) { this.built = null; this.o.changed(); } return; }
    if (this.built?.key === k && this.stagedKey() === k) return;
    if (this.building) { this.again = true; return; }
    const i = readInstalled(this.p.installed);
    const version = this.samara?.m.version ?? i.version, commit = this.samara?.m.commit ?? i.commit;
    if (!isVersion(version) || !/^[0-9a-f]{12,40}$/.test(commit)) { this.o.log('update: Samara here has no release number yet, so a new engine waits for the next Samara release'); return; }
    // Sheet 114: one is ready, so the newer one is made behind it and the key stays.
    const behind = this.ready();
    const want = { samara: this.samara, engine: this.engine };
    const script = this.script(behind ? 'staged-next' : 'staged');
    const file = behind ? path.join(this.p.listener, 'update-next.sh') : this.p.script;
    this.building = k;
    if (behind) this.o.changed();
    try {
      writeFileSync(file, script); chmodSync(file, 0o700);
      this.o.log(`update: getting ${k} ready in the background${behind ? ` (behind ${this.built!.key}, which stays on the key)` : ''}`);
      const code = await this.o.run(file, 'prepare', path.join(this.p.listener, behind ? 'update-prepare-next.log' : 'update-prepare.log'));
      if (code !== 0 || this.stagedKey(behind ? 'staged-next' : 'staged') !== k) this.o.log(`update: getting ${k} ready failed (exit ${code}); see update-prepare${behind ? '-next' : ''}.log`);
      else if (!behind) { this.built = { key: k, sha: createHash('sha256').update(script).digest('hex'), ...want }; this.o.log(`update: ${k} is ready`); }
      else this.promote(k, want);
    } catch (e) { this.o.log('update: could not get it ready: ' + (e as Error).message); }
    finally { this.building = ''; }
    this.o.changed();
    if (this.again) { this.again = false; await this.build(); }
  }
  /** The newer one, made behind, takes the ready one's place on the key (the old staged copy is deleted). Not
   *  while Restart now is putting the old one in: the new Samara makes the newer one again. */
  private promote(k: string, want: { samara: MacStage['samara']; engine: MacStage['engine'] }): void {
    if (this.swapping) return;
    const staged = path.join(this.p.br, 'staged'), next = path.join(this.p.br, 'staged-next');
    rmSync(this.p.staged, { force: true });   // the old one is never put in half moved
    this.built = null;
    if (existsSync(staged)) { const w = retireCopy(staged, path.join(this.p.br, 'old'), 'staged'); if (w) this.o.log('update: ' + w); }
    renameSync(next, staged);
    const script = macUpdateScript({ where: { dir: this.p.listener, name: macAppName(), id: macBundleId() }, bundle: want.samara?.bundle ?? '', version: want.samara?.m.version ?? readInstalled(this.p.installed).version, commit: want.samara?.m.commit ?? readInstalled(this.p.installed).commit, ...(want.engine ? { engine: want.engine } : {}), stage: 'staged' });
    writeFileSync(this.p.script, script); chmodSync(this.p.script, 0o700);
    this.built = { key: k, sha: createHash('sha256').update(script).digest('hex'), ...want };
    this.o.log(`update: ${k} is ready, in place of the one before`);
  }
  /** Restart now: the script closes Samara, swaps the insides and opens it again. Once per run. */
  private swapping = false;
  async swap(): Promise<{ ok: boolean; why?: string }> {
    if (this.swapping) return { ok: true };
    if (!this.ready()) return { ok: false, why: 'The update is not ready yet. It will show up again when it is.' };
    this.swapping = true;
    await this.o.run(this.p.script, 'swap', this.p.updateLog);
    this.o.log(`update: putting in ${this.built!.key}; Samara closes and opens again`);
    return { ok: true };
  }
}

/** Samara's own code from GitHub, on the Mac. */
export class MacSamara implements Source {
  readonly id = 'samara' as const;
  readonly onKey = true;
  private at = 0;
  private tried = new Set<string>();
  readonly lists: VersionLists;
  private readonly p: MacPaths;
  private readonly stage: MacStage;
  private readonly o: { fetch: Fetch; log: (s: string) => void; changed: () => void; pub?: string; peer?: (v: string) => 'good' | 'bad' | null };
  constructor(p: MacPaths, stage: MacStage, o: { fetch: Fetch; log: (s: string) => void; changed: () => void; pub?: string; peer?: (v: string) => 'good' | 'bad' | null }) {
    this.p = p; this.stage = stage; this.o = o;
    this.lists = new VersionLists(path.join(p.br, 'failed-updates.txt'), path.join(p.br, 'filed-updates.txt'));
    const i = readInstalled(p.installed); this.startedAs = `${i.version}|${i.commit}|${i.engine ?? ''}`;
  }
  installed(): Installed { return readInstalled(this.p.installed); }
  /** What this Samara was when it started: only that version may be marked good by it. */
  private readonly startedAs: string;
  /** A trial that has run a minute is good. Only the Samara that IS that trial may say so (2026-10-30, his Mac: the old
   *  Samara, quitting for the update, marked the new 1.25.1 good before it had ever started, so nothing reopened it). */
  markGood(): void {
    const i = this.installed();
    if (i.status !== 'trial') return;
    if (`${i.version}|${i.commit}|${i.engine ?? ''}` !== this.startedAs) return;
    if (saveJson(this.p.installed, { ...i, status: 'good' })) this.o.log(`update: ${i.version}${i.engine ? ' on engine ' + i.engine : ''} is good`);   // failed: next start
  }
  private changelog(m: Manifest): void {
    try { let had = ''; try { had = readFileSync(this.p.changelog, 'utf8'); } catch { /* first */ } const now = withSection(had, m); if (now !== had) writeFileSync(this.p.changelog, now); } catch (e) { swallowed('update.changelog', e); }
  }
  ready(): Offer | null {
    const s = this.stage.readySamara, coming = this.stage.coming();
    if (!s) return null;
    const c = catchUp(s.m, s.m.history, this.current());   // his ask (2026-11-24): how many versions behind, and what each brought
    return { version: s.m.version, since: Date.parse(s.m.at) || Date.now(), title: titleOf(s.m), groups: c.groups, ...(c.behind ? { behind: c.behind } : {}), canBack: this.canBack(), ...(coming ? { coming } : {}) };
  }
  async check(why: string): Promise<void> { await this.look(why); }

  /** Sheet 122: his "Check for updates" says each step (checking, downloading, setting up) while a look runs. */
  private report: ((p: Omit<CheckProgress, 'at'>) => void) | null = null;
  private running_: Promise<CheckOutcome> | null = null;
  current(): string { return this.installed().version; }
  async watch(report: (p: Omit<CheckProgress, 'at'>) => void): Promise<CheckOutcome> {
    this.lists.unfile(); this.tried.clear();
    this.report = report;
    try { return await this.look('his check', true); } finally { this.report = null; }
  }
  private look(why: string, now = false): Promise<CheckOutcome> {
    if (this.running_) return this.running_;
    if (!now && Date.now() - this.at < 60_000) return Promise.resolve(this.stage.readySamara ? 'ready' : 'none');
    this.at = Date.now();
    this.running_ = this.lookOnce(why).finally(() => { this.running_ = null; });
    return this.running_;
  }
  private async lookOnce(why: string): Promise<CheckOutcome> {
    try {
      const m = await ghLatest(this.o.fetch, undefined, this.o.pub);
      if (!m) return 'error';
      const i = this.installed();
      // The version he is on is in "Every version" too (however it was put in).
      if (m.version === i.version) this.changelog(m);
      if (!newer(m.version, i.version) || this.lists.blocked(m.version)) { if (this.stage.samara) { this.stage.samara = null; void this.stage.build(); this.o.changed(); } return 'none'; }
      // Phase 4 (canary.ts): the PC takes a new Samara first. The Mac waits a day for it, or less when the PC says it ran
      // a quiet day; never one the PC turned back. His own check skips the wait, never the turned back.
      const peer = this.o.peer?.(m.version) ?? null;
      if (peer === 'bad') { this.lists.skip(m.version); this.drop(m.version); this.o.log(`update: Samara ${m.version} was turned back on the PC; not offered here`); return 'none'; }
      if (!macMayTake(peer, Date.parse(m.at), Date.now(), this.report !== null)) {
        if (this.waitSaid !== m.version) { this.waitSaid = m.version; this.o.log(`update: Samara ${m.version} is on GitHub; the Mac takes it after the PC's quiet day`); }
        return 'none';
      }
      const title = titleOf(m);
      if (this.stage.samara?.m.version === m.version || this.tried.has(m.version)) {
        // already on its way: a watched check waits for it to be set up
        if (this.report && this.stage.samara?.m.version === m.version && !this.stage.readySamara) { this.report({ stage: 'setup', version: m.version, title }); await this.stage.whenBuilt(); }
        return this.stage.readySamara ? 'ready' : 'none';
      }
      this.tried.add(m.version);
      this.o.log(`update: Samara ${m.version} is on GitHub (${why}); downloading it`);
      const dir = path.join(this.p.br, 'github');
      mkdirSync(dir, { recursive: true });
      const bundle = path.join(dir, `samara-${m.version}.tgz`);
      let said = 0;
      const onBytes = (got: number, total: number) => { const t = Date.now(); if (got < total && t - said < 250) return; said = t; this.report?.({ stage: 'download', version: m.version, title, got, total }); };
      if (!(await ghDownload(this.o.fetch, m, bundle, undefined, onBytes))) { this.o.log(`update: Samara ${m.version} did not download whole; trying again later`); this.tried.delete(m.version); return 'error'; }
      this.changelog(m);
      this.stage.samara = { m, bundle };
      if (!this.report) { void this.stage.build(); return 'none'; }
      this.report({ stage: 'setup', version: m.version, title });
      await this.stage.build(); await this.stage.whenBuilt();
      return this.stage.readySamara?.m.version === m.version ? 'ready' : 'error';
    } catch (e) { this.o.log('update: GitHub check: ' + (e as Error).message); return 'error'; }
  }
  go(): Promise<{ ok: boolean; why?: string }> { return this.stage.swap(); }
  /** Put away or skipped: the one on the key (sheet 114: a newer one being made behind it stays wanted). */
  private drop(v: string): void { if (this.stage.samara?.m.version === v) this.stage.samara = null; this.stage.forget(); void this.stage.build(); this.o.changed(); }
  file(): void { const s = this.stage.readySamara ?? this.stage.samara; if (s) { this.lists.file(s.m.version); this.drop(s.m.version); } }
  skip(): void { const s = this.stage.readySamara ?? this.stage.samara; if (s) { this.lists.skip(s.m.version); this.drop(s.m.version); } }
  canBack(): boolean { return existsSync(path.join(this.p.br, 'rollback', 'Samara.app')); }
  private waitSaid = '';
  /** Phase 4 (canary): the version running is turned back, never offered again; the version before comes back. */
  turnBack(): boolean {
    const i = this.installed();
    if (!i.version || !this.canBack()) return false;
    this.lists.skip(i.version);
    return this.back();
  }
  /** The version before comes back; the one he left is put away (not offered again until he checks). */
  back(): boolean {
    if (!this.canBack()) return false;
    const i = this.installed(); if (i.version) this.lists.file(i.version);
    try { const out = openSync(this.p.updateLog, 'w'); spawn('/bin/bash', ['-c', backScript(this.p.listener)], { detached: true, stdio: ['ignore', out, out] }).unref(); this.o.log('update: going back to the last version (his click)'); return true; }
    catch (e) { this.o.log('update: could not go back: ' + (e as Error).message); return false; }
  }
  checkNow(): void { this.lists.unfile(); this.tried.clear(); void this.look('his check', true); }
}

/** Going back on the Mac: only the app's insides change places, never the Samara.app folder itself (his pet peeve,
 *  2026-10-20: the Dock pin follows the folder), and the copy in rollback/ comes off macOS's list of apps. */
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export const backScript = (dir = macHome(), id = macBundleId()): string => [
  `APP="$HOME/Applications/Samara.app"; BR=${shq(path.posix.join(dir, 'browser'))}`,
  `osascript -e 'quit app id "${id}"' >/dev/null 2>&1 || true`,
  'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do pgrep -f "Samara.app/Contents/MacOS/" >/dev/null 2>&1 || break; sleep 0.5; done',
  'rm -rf "$BR/rollback/next"; mkdir -p "$BR/rollback/next" && mv "$APP/Contents" "$BR/rollback/next/Contents" && mv "$BR/rollback/Samara.app/Contents" "$APP/Contents" && mv "$BR/rollback/next/Contents" "$BR/rollback/Samara.app/Contents"; rmdir "$BR/rollback/next" 2>/dev/null',
  'LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister; $LSR -u "$BR/rollback/Samara.app" >/dev/null 2>&1; $LSR -f "$APP" >/dev/null 2>&1; touch "$APP"',
  '[ -f "$BR/installed.prev.json" ] && cp "$BR/installed.json" "$BR/installed.next.json" && mv "$BR/installed.prev.json" "$BR/installed.json" && mv "$BR/installed.next.json" "$BR/installed.prev.json"',
  'open -a "$APP"',
].join('\n');

/** Unpacks an engine zip into a folder (tests swap this). The Mac's own ditto keeps the app's signatures and links. */
export type Unzip = (zip: string, into: string) => Promise<boolean>;
const unzipIt: Unzip = (zip, into) => new Promise((res) => {
  const c = spawn('/usr/bin/ditto', ['-x', '-k', zip, into], { stdio: 'ignore' });
  c.on('error', () => res(false)); c.on('exit', (code) => res(code === 0));
});

/** His installed Samara, when this Samara runs from it (never a test or a run from a code folder). */
function runningApp(): string | null {
  const app = path.resolve(process.execPath, '..', '..', '..');
  return app === path.join(os.homedir(), 'Applications', 'Samara.app') ? app : null;
}
const FRAMEWORK_SIG = ['Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources', 'Electron Framework.sig'];
/** Where a Mac engine keeps its switches. */
const FRAMEWORK_BIN = ['Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework'];
/** Samara's own folder (src/..), where the check scripts are. */
const SHELL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Phase 2: the engine safety check (test/electron/engine-safety-check.ts) on a signed Mac engine, hidden, at most four
 *  minutes: a page loads, Widevine plays a protected stream, the phishing block fires, a download is marked. */
export type EngineCheck = (engineApp: string, version: string) => Promise<boolean>;
const checkIt = (log: (s: string) => void): EngineCheck => async (engineApp, v) => {
  const script = 'test/electron/engine-safety-check.ts';
  if (!existsSync(path.join(SHELL_DIR, script))) { log(`update: engine ${v}: ${script} is missing from this Samara`); return false; }
  const pics = path.join(os.tmpdir(), `samara-engine-test-${process.pid}-${Date.now()}`);
  mkdirSync(pics, { recursive: true });
  let out = '';
  const code = await new Promise<number | null>((res) => {
    const t = spawn(path.join(engineApp, 'Contents', 'MacOS', 'Electron'), [script, pics], { cwd: SHELL_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    t.stdout?.on('data', (d) => { out = (out + String(d)).slice(-20_000); });
    t.stderr?.on('data', () => { /* Chromium's own noise */ });
    const kill = setTimeout(() => { try { t.kill(); } catch { /* gone */ } }, 4 * 60_000);
    t.on('error', () => { clearTimeout(kill); res(null); });
    t.on('exit', (c) => { clearTimeout(kill); res(c); });
  });
  try { rmSync(pics, { recursive: true, force: true }); } catch { /* temp */ }
  const r = readRun(code, out);
  if (!r.ok) log(`update: engine ${v} safety check said (exit ${code}): ${out.split('\n').filter((l) => /FAIL|HARNESS|passed/.test(l)).join(' | ').slice(0, 600)}`);
  return r.ok;
};

/**
 * A new castLabs engine, on the Mac (2026-10-30): from the sealed engine release, signed for video here with
 * his castLabs account, exactly as castLabs shipped it (video wins over the safety switches until castLabs says yes).
 */
export class MacEngine implements Source {
  readonly id = 'engine' as const;
  readonly onKey = true;
  private busy = false;
  private signinState: 'ask' | 'waiting' | null = null;
  /** 2026-11-25 (his "I signed in but nothing happens"): from his castLabs sign-in until the engine is signed, checked
   *  and in the ready Samara (a few minutes), the card says so instead of going blank. At most 30 minutes. */
  private signingSince = 0;
  private signedIn(): void { this.signinState = null; this.signingSince = Date.now(); this.o.changed(); void this.sign(); }
  private pending: { m: EngineManifest; dir: string } | null = null;
  private behindLine = '';
  /** Chrome's stable releases as last read, for the security tier. */
  private stable: { version: string; time: number }[] = [];
  readonly lists: VersionLists;
  private readonly p: MacPaths;
  private readonly stage: MacStage;
  private readonly o: { fetch: Fetch; log: (s: string) => void; changed: () => void; evs: Evs; have: () => string; chrome: () => string; unzip?: Unzip; pub?: string; plat: () => EnginePlatform | null; app: () => string | null; checkEngine: EngineCheck };
  /** Whether his Samara's own engine carries a real video signature (castLabs' check, once a run). */
  private vmpOk: boolean | null = null;
  private resign = false;
  constructor(p: MacPaths, stage: MacStage, o: { fetch: Fetch; log: (s: string) => void; changed: () => void; evs?: Evs; have?: () => string; chrome?: () => string; unzip?: Unzip; pub?: string; plat?: () => EnginePlatform | null; app?: () => string | null; checkEngine?: EngineCheck }) {
    this.p = p; this.stage = stage;
    this.o = { ...o, evs: o.evs ?? new Evs({ log: o.log }), have: o.have ?? (() => plain(process.versions.electron)), chrome: o.chrome ?? (() => process.versions.chrome), plat: o.plat ?? (() => enginePlatform()), app: o.app ?? runningApp, checkEngine: o.checkEngine ?? checkIt(o.log) };
    this.lists = new VersionLists(path.join(p.br, 'failed-engines.txt'), path.join(p.br, 'filed-engines.txt'));
  }
  private get engines(): string { return path.join(this.p.br, 'engines'); }

  ready(): Offer | null {
    const p = this.pending?.m;
    if (p && this.signinState) return { ...this.words(p), signin: this.signinState };
    if (p && this.signingSince && Date.now() - this.signingSince < 30 * 60_000 && this.stage.readyEngine?.version !== p.version) return { ...this.words(p), signin: 'signing' };
    // The engine in the ready Samara (sheet 114: it stays on the key while a newer engine is made behind it).
    const m = this.seen.get(this.stage.readyEngine?.version ?? '');
    if (!m) return null;
    const { version, since, title, groups } = this.words(m);
    const coming = this.stage.coming();
    // Phase 2: red and "security fixes" on the Mac too, and (2026-11-24) in by itself tonight like the PC, once the
    // engine passed its safety check here. A new major never goes in by itself.
    const security = closesGap(this.o.chrome(), m.chrome, this.stable);
    const major = m.version.split('.')[0] !== this.o.have().split('.')[0];
    const sec = security ? { security: true, ...(this.passed.has(m.version) && !major ? { tonight: true } : {}) } : {};
    return { version, since, title, groups, canBack: existsSync(path.join(this.p.br, 'rollback', 'Samara.app')), ...(this.behindLine ? { behind: this.behindLine } : {}), ...(coming ? { coming } : {}), ...sec };
  }
  /** Each engine release seen this run, by version. */
  private readonly seen = new Map<string, EngineManifest>();
  private words(m: EngineManifest): { version: string; since: number; title: string; groups: CardGroup[] } {
    const since = Date.parse(m.published) || Date.now();
    return { version: m.version, since, groups: engineGroups(m.version, since, 'Mac'), title: this.resign && m.version === this.o.have() ? `Samara's engine ${m.version}, signed for video` : `Samara's engine ${m.version}` };
  }

  async check(why: string): Promise<void> {
    const plat = this.o.plat();
    if (this.busy || !plat || this.signinState === 'waiting') return;
    this.busy = true;
    try {
      // His Samara's castLabs engine with only castLabs' development signature (44.9.3 went in like that, 2026-10-31):
      // the same engine is offered again, signed for video here.
      this.resign = await this.unsigned();
      const found = await latestEngine(this.o.fetch, this.resign ? '0.0.0' : this.o.have(), plat, undefined, this.o.pub);
      if (!found || this.lists.blocked(found.m.version)) { if (this.pending) { this.pending = null; this.stage.engine = null; void this.stage.build(); this.o.changed(); } return; }
      const { m, asset } = found;
      // How far behind Chrome: today's engine, and the new one (Chrome's own list; the line is left out without it).
      const stable = await chromeStable(this.o.fetch);
      this.stable = stable;
      this.behindLine = stable.length ? `Your engine today is ${behindWords(behindMs(this.o.chrome(), stable))} behind Chrome's security fixes. This one is ${behindWords(behindMs(m.chrome, stable))} behind.` : '';
      if (this.pending?.m.version === m.version && (this.stage.engine?.version === m.version || this.signinState)) return;
      const dir = path.join(this.engines, `castlabs-${m.version}`);
      if (!existsSync(path.join(dir, 'Electron.app'))) {
        this.o.log(`update: castLabs engine ${m.version} is on GitHub (${why}); downloading it`);
        mkdirSync(this.engines, { recursive: true });
        const zip = path.join(this.engines, asset.file);
        if (!(await downloadEngine(this.o.fetch, m, asset, zip))) { this.o.log(`update: engine ${m.version} did not download whole`); return; }
        rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
        const ok = await (this.o.unzip ?? unzipIt)(zip, dir);
        rmSync(zip, { force: true });
        if (!ok || !existsSync(path.join(dir, 'Electron.app'))) { this.o.log(`update: engine ${m.version} did not unpack`); rmSync(dir, { recursive: true, force: true }); return; }
      }
      this.pending = { m, dir }; this.seen.set(m.version, m);
      await this.sign();
    } catch (e) { this.o.log('update: engine check: ' + (e as Error).message); }
    finally { this.busy = false; }
  }

  /** castLabs signs it for video; then it joins the staged Samara. */
  private async sign(): Promise<void> {
    const p = this.pending; if (!p) return;
    if (this.failedOn === `${p.m.version} ${new Date().toDateString()}`) return;
    // Every castLabs engine arrives with a development signature: only castLabs' own check says it is really signed.
    let closed = false;
    let r: Signed = 'ok';
    if (!(await this.o.evs.verify(p.dir))) ({ r, closed } = await this.signEngine(p));
    if (r === 'signin') {
      // Told once (Phase 2): the card asks; a sign-in he does any way at all is noticed, and the engine is signed then.
      this.signingSince = 0;
      if (this.signinState !== 'ask') { this.signinState = 'ask'; this.o.changed(); this.watchQuietly(); }
      return;
    }
    this.stopQuiet?.(); this.stopQuiet = null; this.stopWait?.(); this.stopWait = null;
    if (r !== 'ok') { this.o.log(`update: engine ${p.m.version} could not be signed for video (${r}); tried again later`); this.notSigning(); return; }
    this.signinState = null;
    // Phase 2: the safety check on the signed engine. Back doors closed that then fail it: learned for the major here,
    // signed again as castLabs shipped it, checked again. An engine that fails as shipped is not staged today.
    const app = path.join(p.dir, 'Electron.app'), v = p.m.version;
    let ok = await this.o.checkEngine(app, v);
    if (!ok && closed) {
      this.order.learn(v, 'the engine failed its safety check with its back doors closed');
      const again = await this.signEngine(p);
      if (again.r !== 'ok') { this.o.log(`update: engine ${v} could not be signed again as castLabs shipped it (${again.r})`); this.notSigning(); return; }
      ok = await this.o.checkEngine(app, v);
    }
    if (!ok) { this.failedOn = `${v} ${new Date().toDateString()}`; this.o.log(`update: engine ${v} did not pass its safety check; not offered, tried again tomorrow`); this.notSigning(); return; }
    this.passed.add(v);
    this.stage.engine = { version: p.m.version, app: path.join(p.dir, 'Electron.app') };
    this.o.changed();
    void this.stage.build();
  }

  private notSigning(): void { if (this.signingSince) { this.signingSince = 0; this.o.changed(); } }
  /** Engines that passed the safety check here (this run). */
  private readonly passed = new Set<string>();
  /** "<version> <day>": failed its safety check today. Kept on disk, so a restart the same day does not run the
   *  multi-minute check again. */
  private get failedFile(): string { return path.join(this.engines, 'check-failed-today.txt'); }
  private get failedOn(): string { try { return readFileSync(this.failedFile, 'utf8').trim(); } catch { return ''; } }
  private set failedOn(v: string) { try { mkdirSync(this.engines, { recursive: true }); writeFileSync(this.failedFile, v); } catch { /* best effort: checked again */ } }
  private get order(): SwitchOrder { return new SwitchOrder(path.join(this.engines, 'switch-order.json')); }
  /** castLabs signs it, its back doors closed first unless this Mac learned otherwise (switchorder.ts). */
  private signEngine(p: { m: EngineManifest; dir: string }): Promise<{ r: Signed; closed: boolean }> {
    const app = path.join(p.dir, 'Electron.app');
    return signWithSwitches({ v: p.m.version, fuseFile: path.join(app, ...FRAMEWORK_BIN), stockFile: path.join(p.dir, 'stock-fuses.txt'), order: this.order, sign: () => this.o.evs.sign(p.dir), log: (t) => this.o.log('update: ' + t) });
  }
  private stopQuiet: (() => void) | null = null;
  private watchQuietly(): void {
    this.stopQuiet?.();
    this.stopQuiet = this.o.evs.watchSignin(this.o.evs.loginStamp(), (inNow) => {
      this.stopQuiet = null;
      if (inNow && this.signinState === 'ask') this.signedIn();
    }, 7 * 24 * 60 * 60_000, 30_000);
  }

  /** Sheet 108: Terminal opens with castLabs' sign-in typed; once castLabs has him, the engine is signed.
   *  2026-11-25 (his "it's bugged": stuck on "Signing in..." after he closed Terminal, password forgotten): while it
   *  waits he can open Terminal again, or open castLabs' password reset instead; each starts a fresh wait. */
  private stopWait: (() => void) | null = null;
  async signin(kind: SigninKind = 'signin'): Promise<boolean> {
    if (this.signinState !== 'ask' && this.signinState !== 'waiting') return false;
    const since = this.o.evs.loginStamp();
    if (!(await this.o.evs.openSignin(kind))) return false;
    this.signinState = 'waiting'; this.o.changed();
    this.stopWait?.();
    this.stopWait = this.o.evs.watchSignin(since, (inNow) => {
      this.stopWait = null;
      if (inNow) this.signedIn(); else { this.signinState = 'ask'; this.o.changed(); }
    });
    return true;
  }

  /** True when his installed Samara runs a castLabs engine that castLabs' check does not pass (looked at once a run,
   *  through a link in a folder of its own: castLabs' tool reads a folder holding the app). */
  private async unsigned(): Promise<boolean> {
    const app = this.o.app();
    if (!app || !existsSync(path.join(app, ...FRAMEWORK_SIG))) return false;
    if (this.vmpOk === null) {
      const dir = path.join(this.p.br, 'vmp-check'), link = path.join(dir, 'Samara.app');
      try { mkdirSync(dir, { recursive: true }); if (!existsSync(link)) symlinkSync(app, link); } catch { return false; }
      this.vmpOk = await this.o.evs.verify(dir);
      if (!this.vmpOk) this.o.log("update: Samara's engine has only castLabs' development signature; offering it again, signed for video here");
    }
    return !this.vmpOk;
  }

  go(): Promise<{ ok: boolean; why?: string }> { return this.stage.swap(); }
  private drop(): void { this.pending = null; this.signinState = null; this.signingSince = 0; this.stopQuiet?.(); this.stopQuiet = null; this.stopWait?.(); this.stopWait = null; this.stage.engine = null; this.stage.forget(); void this.stage.build(); this.o.changed(); }
  file(): void { const v = this.stage.readyEngine?.version ?? this.pending?.m.version; if (v) { this.lists.file(v); this.drop(); } }
  skip(): void { const v = this.stage.readyEngine?.version ?? this.pending?.m.version; if (v) { this.lists.skip(v); this.drop(); } }
  // Going back is Samara's (one rollback copy holds the whole app, engine and all).
  canBack(): boolean { return false; }
  back(): boolean { return false; }
  checkNow(): void { this.lists.unfile(); void this.check('his check'); }
}
