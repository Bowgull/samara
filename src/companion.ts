// Samara's companion link: an optional line to a desktop companion app on this machine (a local WebSocket).
// Samara works on its own; when a companion is running, it can ask Samara to open pages, drive a tab for Claude, keep
// sync with another machine, and pass notes back and forth. The companion writes a fresh password to companion.token in
// Samara's state folder each time it starts; with no token there, Samara simply waits and never connects unlocked.
//
// It lives in the main process ON PURPOSE. The password is a header, and only a real program can set one; a page
// cannot. Keeping the socket here also means no window ever holds it, so a page can never reach the companion even if
// something gets past the sandbox. Windows ask through a narrow set of messages instead.
//
// It reconnects forever: a companion may restart several times a day, and Samara must simply carry on.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

const TOKEN_HEADER = 'x-samara-token';
const TOKEN_FILE = 'companion.token';

export interface LinkOptions {
  port: number;
  stateDir: string;
  /** Called with every message from the companion. */
  onMessage: (m: Record<string, unknown>) => void;
  /** Called when the line comes up or goes down, so windows can show it. */
  onConnected?: (up: boolean) => void;
  /** Says hello as the desktop helper, for the messages only that helper sends and takes (media.now, media.cmd). */
  asPet?: boolean;
  /** Says hello as Samara, so the companion treats it as the browser rather than one of its own windows. */
  role?: 'samara';
}

export class CompanionLink {
  private ws: WebSocket | null = null;
  private stopped = false;
  private pause = 500;
  /** True while the socket is open and the companion has been greeted. */
  connected = false;

  private readonly o: LinkOptions;

  constructor(o: LinkOptions) { this.o = o; }

  /** The password the companion wrote. Read fresh every attempt: each companion start writes a new one. */
  private token(): string | null {
    const f = path.join(this.o.stateDir, TOKEN_FILE);
    try { return existsSync(f) ? (readFileSync(f, 'utf8').trim() || null) : null; }
    catch { return null; }
  }

  start(): void { this.stopped = false; this.connect(); }

  private connect(): void {
    if (this.stopped) return;
    const token = this.token();
    // No password yet means no companion is running. Wait rather than connect without one.
    if (!token) { this.retry(); return; }

    const ws = new WebSocket(`ws://127.0.0.1:${this.o.port}/body`, { headers: { [TOKEN_HEADER]: token } });
    this.ws = ws;

    ws.on('open', () => {
      this.pause = 500;
      this.connected = true;
      this.o.onConnected?.(true);
      this.send(this.o.asPet ? { t: 'hello', v: 1, client: 'desktop', pid: process.pid } as never
        : this.o.role === 'samara' ? { t: 'hello', v: 1, client: 'desktop', shell: true, role: 'samara', pid: process.pid, bubble: false } as never
        : { t: 'hello', v: 1, client: 'desktop', shell: true, pid: process.pid, bubble: false });
    });
    ws.on('message', d => {
      // Nothing the companion sends may throw out of here and take Samara with it.
      try { this.o.onMessage(JSON.parse(String(d))); }
      catch (e) { console.error('samara: bad message from the companion: ' + (e as Error).message); }
    });
    ws.on('close', () => this.down());
    ws.on('error', () => { /* the companion is restarting; the close handler retries */ });
  }

  private down(): void {
    if (!this.connected) { this.retry(); return; }
    this.connected = false;
    this.o.onConnected?.(false);
    this.retry();
  }

  /** Backs off to a few seconds, so a companion that is down does not spin the processor. */
  private retry(): void {
    if (this.stopped) return;
    const wait = this.pause;
    this.pause = Math.min(4000, this.pause * 2);
    setTimeout(() => this.connect(), wait).unref?.();
  }

  /** "Try again": stop waiting out the back-off and try the companion right now. */
  tryNow(): void {
    if (this.stopped || this.connected) return;
    this.pause = 250;
    this.connect();
  }

  send(msg: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  stop(): void {
    this.stopped = true;
    try { this.ws?.close(); } catch { /* already gone */ }
    this.ws = null;
  }
}

