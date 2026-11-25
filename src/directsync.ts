// N2 (2026-11-25): Samara on the Mac and Samara on the PC talk to each other directly, over Tailscale, so his notes,
// tabs, bookmarks and the rest keep travelling with the companion retired. Until now every bsync message went through
// the companion's hub on the PC; that hub still carries what is its own (updates for the Mac, "open on PC", a look at the
// Mac's window), and it is how the two Samaras meet the first time:
//
//   1. The Mac's Samara makes a pairing token (32 random bytes, sealed at rest) and sends it, with its own Tailscale
//      address, as `bsync.pair` through the hub. The hub only lets the Mac in with the sync key from the Mac's own
//      Tailscale address, so the PC's Samara can trust what arrives that way exactly as it trusts every bsync message.
//   2. The PC's Samara keeps the token (sealed) and the Mac's address, listens on its own Tailscale address only
//      (DIRECT_PORT), and answers `bsync.paired`.
//   3. The Mac's Samara connects straight to it. From then on, with or without the companion, every bsync message
//      goes this way while it is open; the hub is only the fallback.
//
// The direct link refuses: any other address, a wrong token (compared in constant time), any web page (an Origin
// header), any path but /samara-sync, and any message that is not bsync. It never listens on anything but Tailscale.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { writeFileAtomic } from './atomic.ts';
import { osKeeper, readSealed, sealText, type Keeper } from './sealedfile.ts';
import { myTailnetAddr, tailnet } from './homeroute.ts';

export const DIRECT_PORT = 47833;
export const DIRECT_PATH = '/samara-sync';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };
const isSync = (m: unknown): m is { t: string } => !!m && typeof m === 'object' && typeof (m as { t?: unknown }).t === 'string' && (m as { t: string }).t.startsWith('bsync.');
const BEAT_MS = 30_000;

interface Pairing { token: string; mac: string; at: number }

export interface DirectOpts {
  stateDir: string;
  keeper?: Keeper;
  log: (s: string) => void;
  /** A bsync message from the other machine. */
  onMessage: (m: Record<string, unknown>) => void;
  /** The direct link came up or went down. */
  onLink?: (up: boolean) => void;
  /** Tests: listen and dial here instead of this machine's Tailscale address, and accept this peer. */
  bind?: () => string | null;
  peerOk?: (addr: string) => boolean;
  port?: number;
}

/** Wraps a socket with a heartbeat: a link that died quietly (sleep, Wi-Fi) is ended, not trusted. */
function beat(s: WebSocket): () => void {
  let alive = true;
  s.on('pong', () => { alive = true; });
  const t = setInterval(() => { if (s.readyState !== WebSocket.OPEN) return; if (!alive) { s.terminate(); return; } alive = false; try { s.ping(); } catch { /* close follows */ } }, BEAT_MS);
  t.unref?.();
  return () => clearInterval(t);
}

// ------------------------------------------------------------------ the PC: the host

export class DirectHost {
  private pairing: Pairing | null = null;
  private server: http.Server | null = null;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  private mac: WebSocket | null = null;
  private retry: NodeJS.Timeout | null = null;
  private readonly file: string;
  private readonly o: DirectOpts;
  constructor(o: DirectOpts) {
    this.o = o;
    this.file = path.join(o.stateDir, 'direct-sync.json');
  }
  private loaded = false;
  /** Read once, when first needed (the computer's key is there only once the app is ready). */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try { const p = readSealed<Pairing>(this.file, this.o.keeper ?? osKeeper); if (p && TOKEN_RE.test(p.token) && typeof p.mac === 'string' && !this.pairing) this.pairing = p; } catch { /* paired again through the hub */ }
  }
  get paired(): boolean { this.load(); return !!this.pairing; }
  get up(): boolean { return this.mac?.readyState === WebSocket.OPEN; }

  /**
   * `bsync.pair` from the Mac, as the hub passed it on (the caller only hands over what came from the companion link).
   * Kept, and answered with `bsync.paired` (sent back the same way). False when it is not a pairing.
   */
  pair(m: Record<string, unknown>, reply: (r: Record<string, unknown>) => void): boolean {
    this.load();
    const token = String(m.token ?? ''), mac = String(m.mac ?? '');
    if (!TOKEN_RE.test(token) || !(this.o.peerOk ?? tailnet)(mac)) { this.o.log('direct sync: a pairing that was not one was ignored'); return false; }
    const was = this.pairing;
    this.pairing = { token, mac, at: Date.now() };
    if (!was || was.token !== token || was.mac !== mac) {
      try { writeFileAtomic(this.file, sealText(JSON.stringify(this.pairing), this.o.keeper ?? osKeeper)); } catch (e) { this.o.log('direct sync: the pairing is kept for this run only: ' + (e as Error).message); }
      this.o.log(`direct sync: paired with the Mac at ${mac}`);
      // A different Mac (or a new token): the old link is not that Mac.
      if (this.mac) { try { this.mac.close(); } catch { /* gone */ } }
    }
    this.listen();
    reply({ t: 'bsync.paired', port: this.o.port ?? DIRECT_PORT });
    return true;
  }

  /** Listen on this PC's Tailscale address (tried again each minute until Tailscale is up). Only once paired. */
  listen(): void {
    this.load();
    if (this.server || !this.pairing) return;
    const at = (this.o.bind ?? myTailnetAddr)();
    if (!at) { if (!this.retry) this.retry = setTimeout(() => { this.retry = null; this.listen(); }, 60_000); this.retry.unref?.(); return; }
    const srv = http.createServer((_q, r) => { r.writeHead(404).end(); });
    srv.on('upgrade', (req, sock, head) => this.upgrade(req, sock, head));
    srv.on('error', (e) => { this.o.log('direct sync: cannot listen: ' + e.message); this.server = null; });
    srv.listen(this.o.port ?? DIRECT_PORT, at, () => this.o.log(`direct sync: listening on ${at}`));
    this.server = srv;
  }

  private upgrade(req: http.IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): void {
    const peer = String(req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    const p = this.pairing;
    const ok = !!p && req.url === DIRECT_PATH && !req.headers.origin && peer === p.mac && same(String(req.headers['x-samara-pair'] ?? ''), p.token);
    if (!ok) { this.o.log(`direct sync: refused ${peer}`); socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onMac(ws));
  }

  private onMac(ws: WebSocket): void {
    if (this.mac && this.mac !== ws) { try { this.mac.close(); } catch { /* gone */ } }
    this.mac = ws;
    const stop = beat(ws);
    this.o.log('direct sync: the Mac connected');
    ws.on('message', (raw) => { let m: unknown; try { m = JSON.parse(String(raw)); } catch { return; } if (isSync(m) && m.t !== 'bsync.pair') this.o.onMessage(m as Record<string, unknown>); });
    ws.on('close', () => { stop(); if (this.mac === ws) { this.mac = null; this.o.onLink?.(false); } });
    ws.on('error', () => { /* close follows */ });
    this.o.onLink?.(true);
  }

  /** To the Mac, straight there. False when the direct link is not up (the caller uses the hub). */
  send(m: Record<string, unknown>): boolean {
    if (!this.up || !isSync(m)) return false;
    try { this.mac!.send(JSON.stringify(m)); return true; } catch { return false; }
  }
  close(): void { if (this.retry) clearTimeout(this.retry); try { this.mac?.close(); } catch { /* gone */ } this.wss.close(); this.server?.close(); this.server = null; }
}

// ------------------------------------------------------------------ the Mac: the client

export class DirectClient {
  private token: string;
  private ws: WebSocket | null = null;
  private pcAddr = '';
  private port = DIRECT_PORT;
  private wait = 15_000;
  private timer: NodeJS.Timeout | null = null;
  private wanted = false;
  private closed = false;
  private readonly file: string;
  private readonly o: DirectOpts;
  constructor(o: DirectOpts) {
    this.o = o;
    this.file = path.join(o.stateDir, 'direct-sync.json');
    let t = '';
    try { const p = readSealed<{ token?: string }>(this.file, o.keeper ?? osKeeper); if (p && TOKEN_RE.test(String(p.token))) t = String(p.token); } catch { /* a new one */ }
    if (!t) {
      t = randomBytes(32).toString('base64url');
      try { writeFileAtomic(this.file, sealText(JSON.stringify({ token: t, at: Date.now() }), o.keeper ?? osKeeper)); } catch (e) { o.log('direct sync: the pairing is kept for this run only: ' + (e as Error).message); }
    }
    this.token = t;
  }
  get up(): boolean { return this.ws?.readyState === WebSocket.OPEN; }

  /** What to send through the hub so the PC's Samara knows this Mac (each time the hub link opens). Null without Tailscale. */
  pairMsg(): Record<string, unknown> | null {
    const me = (this.o.bind ?? myTailnetAddr)();
    return me ? { t: 'bsync.pair', v: 1, token: this.token, mac: me } : null;
  }

  /**
   * Dial the PC's Samara: at start when it was paired before (the companion may be off), and when the PC answers
   * `bsync.paired`. Tried again on a growing wait (15 s to 2 minutes) while the PC is away.
   */
  start(pcAddr: string, port = DIRECT_PORT): void {
    if (!(this.o.peerOk ?? tailnet)(pcAddr)) return;
    this.pcAddr = pcAddr; this.port = port; this.wanted = true;
    if (!this.ws) this.dial();
  }
  private dial(): void {
    if (this.closed || !this.wanted) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const s = new WebSocket(`ws://${this.pcAddr}:${this.port}${DIRECT_PATH}`, { headers: { 'x-samara-pair': this.token }, maxPayload: 64 * 1024 * 1024, handshakeTimeout: 10_000 });
    this.ws = s;
    let stop = () => {};
    let opened = false;
    s.on('open', () => { opened = true; this.wait = 15_000; stop = beat(s); this.o.log('direct sync: connected to the PC'); this.o.onLink?.(true); });
    s.on('message', (raw) => { let m: unknown; try { m = JSON.parse(String(raw)); } catch { return; } if (isSync(m)) this.o.onMessage(m as Record<string, unknown>); });
    s.on('close', () => {
      stop();
      const was = this.ws === s;
      if (was) this.ws = null;
      if (was && opened) this.o.onLink?.(false);
      if (was && !this.closed) { this.timer = setTimeout(() => this.dial(), this.wait); this.timer.unref?.(); this.wait = Math.min(this.wait * 2, 120_000); }
    });
    s.on('error', () => { /* close follows */ });
  }
  /** To the PC, straight there. False when the direct link is not up (the caller uses the hub). */
  send(m: Record<string, unknown>): boolean {
    if (!this.up || !isSync(m)) return false;
    try { this.ws!.send(JSON.stringify(m)); return true; } catch { return false; }
  }
  close(): void { this.closed = true; if (this.timer) clearTimeout(this.timer); try { this.ws?.close(); } catch { /* gone */ } }
}
