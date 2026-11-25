// Spotify for the music player (M1, 2026-11-25: the companion is retired; ported from its spotify.ts). Spotify's Web API:
// what is playing on his account and on which device, the player's keys on that device, his devices, moving the music to
// one, and the album cover. Controlling playback needs Spotify Premium, which he has.
//
// Signed in with PKCE (no client secret): his own Spotify developer app's Client ID, and a sign-in in his browser that
// comes back to 127.0.0.1:47835/callback (the address his Spotify app already allows). The tokens are kept in
// spotify.json in Samara's state folder, readable by him only. The first time, the companion's spotify.json on this
// machine is copied in (read only, the companion's file is left as it is), so there is nothing to sign in to again.
// The network call is injected so the tests never reach Spotify.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { readJson, saveJson } from './store.ts';

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; json(): Promise<any>; text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer>; headers?: { get?(n: string): string | null };
}>;

interface Tokens { clientId: string; refreshToken: string; accessToken?: string; expiresAt?: number }

/** What the player says when Spotify needs signing in: where to do it. */
export const SIGN_IN_HINT = 'Sign in from the player’s ··· menu';
/** The sign-in's way back (his Spotify app allows exactly this address). */
export const REDIRECT = 'http://127.0.0.1:47835/callback';
export const SCOPE = 'user-modify-playback-state user-read-playback-state user-read-currently-playing';
const CLIENT_ID = /^[0-9a-f]{32}$/;

export class SpotifyError extends Error {
  readonly kind: 'none' | 'signin' | 'device' | 'premium' | 'rate' | 'api';
  /** For 'rate' (a 429): how long Spotify asked us to wait, in seconds. */
  readonly retryAfter: number;
  constructor(message: string, kind: 'none' | 'signin' | 'device' | 'premium' | 'rate' | 'api' = 'api', retryAfter = 0) { super(message); this.kind = kind; this.retryAfter = retryAfter; }
}

const shaped = (j: any): Tokens | null => (j && typeof j.clientId === 'string' && CLIENT_ID.test(j.clientId) && typeof j.refreshToken === 'string' && j.refreshToken.length > 10 && j.refreshToken.length < 2000 ? j : null);

/**
 * The companion's spotify.json on this machine, found by its shape in a folder beside Samara's (its own folder's name is
 * not needed): the newest one with a Client ID and a sign-in. Null when there is none.
 */
export function findCompanionSpotify(appData: string, skip: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.SAMARA_COMPANION_SPOTIFY) return env.SAMARA_COMPANION_SPOTIFY;
  let dirs: string[] = [];
  try { dirs = readdirSync(appData, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return null; }
  let best: { f: string; at: number } | null = null;
  for (const d of dirs) {
    const f = path.join(appData, d, 'spotify.json');
    if (path.resolve(f) === path.resolve(skip)) continue;
    try {
      if (!existsSync(f)) continue;
      const st = statSync(f);
      if (st.size > 20_000 || !shaped(JSON.parse(readFileSync(f, 'utf8')))) continue;
      if (!best || st.mtimeMs > best.at) best = { f, at: st.mtimeMs };
    } catch { /* not this one */ }
  }
  return best?.f ?? null;
}

export class Spotify {
  private t: Tokens | null = null;
  private readonly file: string;
  private readonly fetcher: Fetch;
  private readonly now: () => number;
  constructor(file: string, fetcher: Fetch, now: () => number = Date.now) { this.file = file; this.fetcher = fetcher; this.now = now; }

  get connected(): boolean { return this.load() !== null; }
  /** His Spotify app's Client ID, if Samara has ever had one (kept after a sign-in expires, for the next sign-in). */
  get clientId(): string | null { return this.load()?.clientId ?? readJson<{ clientId?: string } | null>(this.file, null)?.clientId ?? null; }
  private load(): Tokens | null {
    if (this.t) return this.t;
    this.t = readJson<Tokens | null>(this.file, null, shaped);
    return this.t;
  }
  /** The companion's file, copied in when Samara has none of its own. True when it was. */
  adopt(from: string | null): boolean {
    if (this.load() || !from) return false;
    const t = readJson<Tokens | null>(from, null, shaped);
    if (!t) return false;
    this.t = { clientId: t.clientId, refreshToken: t.refreshToken };
    return saveJson(this.file, this.t, { pretty: true, ownerOnly: true });
  }
  /** A finished sign-in: kept. */
  keep(t: Tokens): void { this.t = { ...t }; saveJson(this.file, this.t, { pretty: true, ownerOnly: true }); }

  private async token(): Promise<string> {
    const t = this.load();
    if (!t) throw new SpotifyError('Spotify is not connected.', 'none');
    if (t.accessToken && (t.expiresAt ?? 0) > this.now()) return t.accessToken;
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: t.clientId }).toString();
    const r = await this.fetcher('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      if (j?.error === 'invalid_grant') {
        // the sign-in is gone: forget it, but keep the Client ID for the next sign-in
        this.t = null; saveJson(this.file, { clientId: t.clientId }, { pretty: true, ownerOnly: true });
        throw new SpotifyError('The Spotify sign-in has expired.', 'signin');
      }
      throw new SpotifyError(`Spotify would not refresh the sign-in (${r.status}).`);
    }
    t.accessToken = String(j.access_token); t.expiresAt = this.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000;
    if (typeof j.refresh_token === 'string' && j.refresh_token) t.refreshToken = j.refresh_token;   // PKCE sign-ins rotate it
    saveJson(this.file, t, { pretty: true, ownerOnly: true });   // a failure: refreshes again next time
    return t.accessToken;
  }

  private async call(method: string, p: string, body?: unknown, again = true): Promise<any> {
    const auth = await this.token();
    const r = await this.fetcher(`https://api.spotify.com/v1${p}`, { method, headers: { authorization: `Bearer ${auth}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    let j: any = {}; try { j = text ? JSON.parse(text) : {}; } catch { /* empty */ }
    if (r.status === 429) {
      const ra = Number(r.headers?.get?.('retry-after'));
      throw new SpotifyError('Spotify asked to slow down.', 'rate', Number.isFinite(ra) && ra > 0 ? Math.min(3600, ra) : 30);
    }
    if (r.status === 401) {
      // Turned down: refresh once and try again. Turned down after a fresh refresh too, the sign-in is no good: it is
      // forgotten (the Client ID kept), so the player offers "Sign in to Spotify" again instead of going quiet.
      if (this.t) this.t.expiresAt = 0;
      if (again) return this.call(method, p, body, false);
      const id = this.t?.clientId ?? this.clientId;
      this.t = null;
      saveJson(this.file, id ? { clientId: id } : {}, { pretty: true, ownerOnly: true });
      throw new SpotifyError('Spotify turned the sign-in down.', 'signin');
    }
    if (r.status === 403) throw new SpotifyError('Spotify only lets Premium accounts be controlled like this.', 'premium');
    if (r.status === 404 && /device/i.test(String(j?.error?.message ?? ''))) throw new SpotifyError('No Spotify is open to play on.', 'device');
    if (!r.ok) throw new SpotifyError(`Spotify said ${r.status}: ${String(j?.error?.message ?? text).slice(0, 160)}`);
    return j;
  }

  /** GET /me/player: the raw playback state, or null when nothing is playing anywhere (204). */
  async playback(): Promise<any | null> {
    const j = await this.call('GET', '/me/player?additional_types=episode');
    return j && typeof j === 'object' && j.device ? j : null;
  }
  /** Every device Spotify can play on right now. */
  async devices(): Promise<any[]> {
    const j = await this.call('GET', '/me/player/devices');
    return Array.isArray(j.devices) ? j.devices : [];
  }
  /** One of the player's keys, on that device. Positions in seconds, volume 0..1. */
  async control(op: 'play' | 'pause' | 'next' | 'prev' | 'seek' | 'volume', device: string, value?: number): Promise<void> {
    // no id (Spotify gave none): the device that is playing now, which is the one shown
    const d = device ? `device_id=${encodeURIComponent(device)}` : '';
    if (op === 'play') await this.call('PUT', `/me/player/play?${d}`);
    else if (op === 'pause') await this.call('PUT', `/me/player/pause?${d}`);
    else if (op === 'next') await this.call('POST', `/me/player/next?${d}`);
    else if (op === 'prev') await this.call('POST', `/me/player/previous?${d}`);
    else if (op === 'seek') await this.call('PUT', `/me/player/seek?position_ms=${Math.max(0, Math.round((value ?? 0) * 1000))}&${d}`);
    else if (op === 'volume') await this.call('PUT', `/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round((value ?? 0) * 100)))}&${d}`);
  }
  /** Move playback to another device (Spotify Connect's transfer), playing. */
  async transfer(device: string): Promise<void> {
    await this.call('PUT', '/me/player', { device_ids: [device], play: true });
  }
  /** An album cover from Spotify's image host, as a data URL for the player (its page loads nothing from the web). */
  async cover(url: string): Promise<string | null> {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'https:' || !/(^|\.)scdn\.co$|(^|\.)spotifycdn\.com$/.test(u.hostname)) return null;
    const r = await this.fetcher(u.toString(), { method: 'GET' });
    if (!r.ok || !r.arrayBuffer) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 400_000) return null;
    const type = buf[0] === 0x89 && buf[1] === 0x50 ? 'png' : buf[0] === 0xff && buf[1] === 0xd8 ? 'jpeg' : null;
    return type ? `data:image/${type};base64,${buf.toString('base64')}` : null;
  }
}

// ---------------------------------------------------------------------------------------------------- signing in

/** The address that starts a sign-in, and what the way back must carry. */
export function signInStart(clientId: string): { url: string; verifier: string; state: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: REDIRECT, code_challenge_method: 'S256', code_challenge: challenge, state, scope: SCOPE });
  return { url, verifier, state };
}

/**
 * A sign-in: a page opens in his browser (`open`), Spotify sends him back to 127.0.0.1:47835 with a code, the code is
 * swapped for the tokens, and the little page says he can close it. Without a Client ID yet (no companion file on this
 * computer), the first page is Samara's own, on that same address: one box for his Spotify app's Client ID, then on to
 * Spotify. Only the one state this sign-in made is accepted; the door closes after the first answer or 5 minutes.
 * Resolves with the tokens, or throws with a plain reason.
 */
export async function signIn(clientId: string | null, fetcher: Fetch, open: (url: string) => void, ms = 5 * 60_000): Promise<Tokens> {
  if (clientId !== null && !CLIENT_ID.test(clientId)) throw new Error('That is not a Spotify Client ID (32 letters and digits).');
  let id = clientId ?? '';
  let s = id ? signInStart(id) : null;
  const nonce = randomBytes(16).toString('hex');
  const page = (words: string, form = false, bad = false) => `<!doctype html><meta charset="utf-8"><title>Spotify for Samara</title>
<body style="font:16px system-ui;background:#1a1009;color:#f1e4cc;display:grid;place-items:center;height:90vh;margin:0"><main style="max-width:440px">
<p>${words}</p>${form ? `<form method="get" action="/start"><input type="hidden" name="n" value="${nonce}">
<label>Client ID<br><input name="id" autofocus size="36" maxlength="32" pattern="[0-9a-fA-F]{32}" required style="font:16px monospace;padding:6px;margin:6px 0"></label>
${bad ? '<p style="color:#ff9a8a">That is not a Client ID: 32 letters and digits, from your app on developer.spotify.com.</p>' : ''}
<br><button style="font:16px system-ui;padding:6px 16px">Sign in to Spotify</button></form>` : ''}</main>`;
  let server: Server | null = null;
  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The Spotify sign-in was not finished in time.')), ms);
      server = createServer((req, res) => {
        const u = new URL(req.url ?? '/', REDIRECT);
        const html = (status: number, body: string) => res.writeHead(status, { connection: 'close', 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" }).end(body);
        // Samara's own first page: the Client ID (only for this sign-in's nonce)
        if (u.pathname === '/start') {
          const given = (u.searchParams.get('id') ?? '').trim().toLowerCase();
          if (u.searchParams.get('n') !== nonce) { html(404, page('This sign-in page has gone. Start again from the music player.')); return; }
          if (!given) { html(200, page('Samara needs your Spotify app’s Client ID once. It is on developer.spotify.com, under your app’s settings.', true)); return; }
          if (!CLIENT_ID.test(given)) { html(200, page('Samara needs your Spotify app’s Client ID once.', true, true)); return; }
          id = given; s = signInStart(id);
          res.writeHead(302, { location: s.url, 'cache-control': 'no-store', connection: 'close' }).end();
          return;
        }
        if (u.pathname !== '/callback' || !s) { res.writeHead(404, { connection: 'close' }).end(); return; }
        const mine = u.searchParams.get('state') === s.state;
        const ok = mine && !!u.searchParams.get('code');
        html(200, page(ok ? 'Spotify is signed in. You can close this tab.' : 'That sign-in did not go through. Try again from the music player.'));
        if (!mine) return;   // not ours: keep waiting for ours
        clearTimeout(timer);
        if (ok) resolve(u.searchParams.get('code')!); else reject(new Error(u.searchParams.get('error') === 'access_denied' ? 'Spotify sign-in was cancelled.' : 'Spotify did not sign in.'));
      });
      server.on('error', (e) => { clearTimeout(timer); reject(new Error('Samara could not listen for the sign-in: ' + (e as Error).message)); });
      server.listen(47835, '127.0.0.1', () => open(s ? s.url : `http://127.0.0.1:47835/start?n=${nonce}`));
    });
    const r = await fetcher('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: id, code_verifier: s!.verifier }).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.refresh_token) throw new Error(`Spotify would not finish the sign-in (${r.status}).`);
    return { clientId: id, refreshToken: String(j.refresh_token), accessToken: String(j.access_token ?? ''), expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000 };
  } finally {
    // the door closes for good: no kept-alive line to it stays open either
    const sv = server as Server | null;
    sv?.close(); sv?.closeAllConnections();
  }
}
