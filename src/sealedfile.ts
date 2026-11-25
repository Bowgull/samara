// Phase 1 (2026-11-24, his pick pending; default: history and Earlier): browsing files sealed at rest with the key his
// computer keeps for him (the Mac's Keychain, Windows' DPAPI, through Electron's safeStorage). A copy of the file taken
// off the machine, or read by another user, is noise.
//
// Rules:
//  - A plain file of before is read as it is and sealed at its next write (nothing to do by hand).
//  - A sealed file the key will not open (the Keychain prompt refused after an update) is NEVER written over: the
//    store says it is locked, keeps nothing new on disk, and the file is read again on the next start.
//  - A machine with no key at all (a test, a Linux box without a keyring) keeps writing plain, as before.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readText } from './store.ts';

export interface Keeper { available(): boolean; seal(s: string): string; open(b64: string): string }

/** The computer's own key (Electron's safeStorage), reached only when needed so plain tests never load Electron. */
export const osKeeper: Keeper = {
  available: () => { try { return safe()?.isEncryptionAvailable() === true; } catch { return false; } },
  seal: (s) => safe()!.encryptString(s).toString('base64'),
  open: (b) => safe()!.decryptString(Buffer.from(b, 'base64')),
};
function safe(): Electron.SafeStorage | null { try { return (createRequire(import.meta.url)('electron') as typeof Electron).safeStorage ?? null; } catch { return null; } }

/** The file's contents for writing: sealed when the machine has a key, plain otherwise. */
export function sealText(text: string, k: Keeper = osKeeper): string {
  try { if (k.available()) return JSON.stringify({ sealed: 1, data: k.seal(text) }); } catch { /* plain below */ }
  return text;
}

export class Unreadable extends Error {}

/** The file as data: null when there is none; throws Unreadable when it is sealed and the key will not open it. */
export function readSealed<T>(file: string, k: Keeper = osKeeper): T | null {
  if (!existsSync(file)) return null;
  const raw = readText(file);
  if (raw == null) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (j && typeof j === 'object' && !Array.isArray(j) && (j as { sealed?: unknown }).sealed === 1 && typeof (j as { data?: unknown }).data === 'string') {
    let text: string;
    try { text = k.open((j as { data: string }).data); } catch (e) { throw new Unreadable(`sealed, and this computer's key would not open it (${(e as Error).message})`); }
    return JSON.parse(text) as T;
  }
  return j as T;
}
