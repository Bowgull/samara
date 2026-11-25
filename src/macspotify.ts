// The music player's local feed on the Mac (M1, 2026-11-25; ported from the companion's macmedia.ts): Spotify's own app
// on this Mac, read and steered through AppleScript. Instant and free, so while it plays it is what the player shows
// (connect.ts chooseSource); Spotify on his phone or speakers comes through the Web API instead.
//
// Cheap on purpose (the Mac is old): Spotify is asked nothing unless it is running (pgrep), once a second while the
// player shows and not at all while it does not, and only a change is passed on. The cover is fetched once per track.
import { execFile } from 'node:child_process';
import type { MediaNow } from './media.ts';

type Now = { title: string; artist: string; album: string; status: 'playing' | 'paused' | 'stopped'; position: number; duration: number; volume: number; art: string };
export type Run = (file: string, args: string[], ms?: number) => Promise<{ ok: boolean; out: string }>;

const realRun: Run = (file, args, ms = 4000) => new Promise((resolve) => execFile(file, args, { timeout: ms }, (e, out) => resolve({ ok: !e, out: String(out) })));
// One line, tab-separated: the track's words, the state, where it is, how long, the volume and the cover's address.
const READ = [
  'tell application "Spotify"',
  'set t to current track',
  'return (name of t) & tab & (artist of t) & tab & (album of t) & tab & (player state as text) & tab & (player position as text) & tab & ((duration of t) as text) & tab & (sound volume as text) & tab & (artwork url of t)',
  'end tell',
];

export function readSpotify(line: string): Now | null {
  const p = line.replace(/\n$/, '').split('\t');
  if (p.length < 8) return null;
  const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const status = p[3] === 'playing' ? 'playing' : p[3] === 'paused' ? 'paused' : 'stopped';
  return { title: p[0]!.slice(0, 200), artist: p[1]!.slice(0, 200), album: p[2]!.slice(0, 200), status, position: num(p[4]!), duration: num(p[5]!) / 1000, volume: Math.max(0, Math.min(1, num(p[6]!) / 100)), art: /^https:\/\//.test(p[7]!.trim()) ? p[7]!.trim() : '' };
}

/** A key as AppleScript, or null. Numbers are checked by the caller (playercmd.ts) and clamped again here. */
export function scriptFor(op: string, value?: number): string | null {
  const say: Record<string, string> = { play: 'play', pause: 'pause', toggle: 'playpause', next: 'next track', prev: 'previous track' };
  if (say[op]) return `tell application "Spotify" to ${say[op]}`;
  if (op === 'seek' && Number.isFinite(value)) return `tell application "Spotify" to set player position to ${Math.max(0, Number(value)).toFixed(1)}`;
  if (op === 'volume' && Number.isFinite(value)) return `tell application "Spotify" to set sound volume to ${Math.round(Math.max(0, Math.min(1, Number(value))) * 100)}`;
  return null;
}

export class MacSpotify {
  private last: Now | null = null;
  private sentArt = '';
  /** Spotify is running here: null until first looked at. */
  private running: boolean | null = null;
  private timer: NodeJS.Timeout | null = null;
  private on = false;
  private readonly run: Run;
  private readonly send: (m: MediaNow) => void;
  private readonly cover: (url: string) => Promise<string | null>;
  constructor(send: (m: MediaNow) => void, cover: (url: string) => Promise<string | null>, run: Run = realRun) { this.send = send; this.cover = cover; this.run = run; }

  /** The player is showing (read every second) or not (nothing is read). */
  watch(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (on) { this.last = null; this.sentArt = ''; this.running = null; void this.tick(); }
  }
  /** Read now (after a key, so the player follows at once). */
  poke(): void { if (!this.on) return; if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => void this.tick(), 250); }

  private async tick(): Promise<void> {
    this.timer = null;
    if (!this.on) return;
    try { await this.read(); } catch { /* next time */ }
    if (this.on && !this.timer) { this.timer = setTimeout(() => void this.tick(), 1000); this.timer.unref?.(); }
  }

  async read(): Promise<void> {
    const up = (await this.run('/usr/bin/pgrep', ['-x', 'Spotify'])).ok;
    if (!up) {
      // said once: Spotify is not open on this Mac
      if (this.running !== false || this.last) { this.running = false; this.last = null; this.sentArt = ''; this.send({ t: 'media.now', v: 1, app: null }); }
      return;
    }
    this.running = true;
    const r = await this.run('/usr/bin/osascript', READ.flatMap((l) => ['-e', l]));
    const now = r.ok ? readSpotify(r.out) : null;
    if (!now) return;
    const was = this.last;
    // Only a change: a new track, play/pause, the volume, or a jump (more than 2.5 s off where it should be by now).
    const expected = was && was.status === 'playing' ? was.position + 1 : was?.position ?? 0;
    const changed = !was || was.title !== now.title || was.artist !== now.artist || was.status !== now.status || Math.abs(was.volume - now.volume) > 0.01 || Math.abs(expected - now.position) > 2.5;
    this.last = now;
    if (!changed) return;
    const msg: MediaNow = { t: 'media.now', v: 1, app: 'spotify', spotify: true, title: now.title, artist: now.artist, album: now.album, status: now.status, position: now.position, duration: now.duration, at: Date.now(), canSeek: true, volume: now.volume };
    if (now.art !== this.sentArt) { this.sentArt = now.art; msg.thumb = now.art ? await this.cover(now.art) : null; }
    this.send(msg);
  }

  /** One of the player's keys on this Mac's Spotify. False when Spotify is not running here. */
  async cmd(op: string, value?: number): Promise<boolean> {
    const script = scriptFor(op, value);
    if (!script || !(await this.run('/usr/bin/pgrep', ['-x', 'Spotify'])).ok) return false;
    await this.run('/usr/bin/osascript', ['-e', script]);
    this.poke();
    return true;
  }
}
