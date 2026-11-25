// Phase 2 (2026-11-24): the engine's back-door switches closed BEFORE castLabs signs it for video.
//
// 2026-10-23 castLabs refused an engine with its switches flipped ("Binary signature denied"), so since then every
// engine has been signed exactly as castLabs shipped it, back doors open (running as plain Node, NODE_OPTIONS, the
// inspector). The theory: the switches were flipped AFTER the video signature, which broke it, or flipped ones castLabs
// checks. So each machine now tries, per engine: the three back doors closed first, then castLabs signs. If castLabs
// refuses, the switches go back exactly as castLabs shipped them and it signs again, so video always wins. A refusal,
// or an engine whose video then does not play, is remembered for that major: the next major tries again.
//
// The login lock (cookie encryption) is NOT one of them. Once on it can never come off (Electron: turning it off
// later leaves every login unreadable), so an engine that castLabs would only sign as shipped would then be stuck.
// It waits for his own yes, after the back doors have held on both machines.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFileAtomic } from './atomic.ts';
import type { Signed } from './evs.ts';
import { FUSE, readFuses, setFuses, wireMap } from './fusewire.ts';
import { readJson } from './store.ts';

/** The three back doors, closed. */
export const CLOSED: Record<number, boolean> = { [FUSE.RunAsNode]: false, [FUSE.EnableNodeOptionsEnvironmentVariable]: false, [FUSE.EnableNodeCliInspectArguments]: false };

/** What this machine has learned: the major on which closing the switches failed, and why. */
export interface Learned { stockOnly?: number; why?: string; version?: string; at?: string }
const majorOf = (v: string): number => Number(/^(\d+)\./.exec(v)?.[1] ?? NaN);

export class SwitchOrder {
  private readonly file: string;
  constructor(file: string) { this.file = file; }
  read(): Learned { return readJson<Learned>(this.file, {}) ?? {}; }
  /** Try the switches closed first on this engine? Not on a major where it already failed here. */
  closedFirst(v: string): boolean { return this.read().stockOnly !== majorOf(v); }
  /** It failed on `v`: as castLabs shipped it for the rest of that major. */
  learn(v: string, why: string): void {
    try { writeFileAtomic(this.file, JSON.stringify({ stockOnly: majorOf(v), why, version: v, at: new Date().toISOString() } satisfies Learned)); } catch { /* best effort: tried again next engine */ }
  }
}

/** The switches as castLabs shipped them, kept beside the engine the first time it is seen, so they can always go back. */
export function stockWire(fuseFile: string, stockFile: string): Record<number, boolean> {
  if (!existsSync(stockFile)) writeFileSync(stockFile, readFuses(fuseFile));
  return wireMap(readFileSync(stockFile, 'utf8').trim());
}

/**
 * Sign an engine for video with its back doors closed when this machine has not learned otherwise, falling back to the
 * switches as castLabs shipped them when castLabs refuses. `closed` says which way it was signed.
 */
export async function signWithSwitches(o: { v: string; fuseFile: string; stockFile: string; order: SwitchOrder; sign: () => Promise<Signed>; log: (s: string) => void }): Promise<{ r: Signed; closed: boolean }> {
  let stock: Record<number, boolean>;
  try { stock = stockWire(o.fuseFile, o.stockFile); } catch (e) {
    // No switches to read (not where Electron keeps them): signed exactly as it is.
    o.log(`engine ${o.v}: its switches could not be read (${(e as Error).message}); signed as it is`);
    return { r: await o.sign(), closed: false };
  }
  if (o.order.closedFirst(o.v)) {
    o.log(`engine ${o.v} switches: ${setFuses(o.fuseFile, { ...stock, ...CLOSED })} (back doors closed, before castLabs signs)`);
    const r = await o.sign();
    if (r !== 'denied') return { r, closed: true };
    o.log(`castLabs would not sign engine ${o.v} with its back doors closed; signing it as castLabs shipped it`);
    o.order.learn(o.v, 'castLabs refused to sign it with the back doors closed');
  }
  o.log(`engine ${o.v} switches: ${setFuses(o.fuseFile, stock)} (as castLabs shipped it)`);
  return { r: await o.sign(), closed: false };
}
