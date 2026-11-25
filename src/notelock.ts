// Notes in Samara (N1, 2026-11-25): a locked copy of his notes, to keep somewhere else or to bring back. Sealed with a
// passphrase he chooses (scrypt, then AES-256-GCM), so the file is safe on a USB stick or in a cloud folder, and opens
// on any computer with the passphrase: unlike the store's own seal, which only this computer's key opens.
//
// The file is JSON: { samaraNotes: 1, kdf: { n, r, p, salt }, iv, tag, data }. A wrong passphrase, or a file that was
// changed, fails the GCM check; nothing half-read is ever used.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export const LOCK_N = 1 << 15, LOCK_R = 8, LOCK_P = 1;
/** Shorter than this and the copy is too easy to guess open. */
export const MIN_PASS = 8;

export interface LockedCopy { samaraNotes: 1; at: string; kdf: { n: number; r: number; p: number; salt: string }; iv: string; tag: string; data: string }

const key = (pass: string, salt: Buffer, n: number, r: number, p: number) => scryptSync(pass.normalize('NFKC'), salt, 32, { N: n, r, p, maxmem: 256 * n * r });

export function lockNotes(payload: unknown, pass: string, now = Date.now()): string {
  if (typeof pass !== 'string' || pass.length < MIN_PASS) throw new Error(`The passphrase needs at least ${MIN_PASS} characters.`);
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(pass, salt, LOCK_N, LOCK_R, LOCK_P), iv);
  const data = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()]);
  const out: LockedCopy = { samaraNotes: 1, at: new Date(now).toISOString(), kdf: { n: LOCK_N, r: LOCK_R, p: LOCK_P, salt: salt.toString('base64') },
    iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
  return JSON.stringify(out);
}

/** The notes in a locked copy. Throws 'wrong' for a wrong passphrase or a changed file, 'notours' for anything else. */
export function unlockNotes(text: string, pass: string): unknown {
  let j: LockedCopy;
  try { j = JSON.parse(text); } catch { throw new Error('notours'); }
  const k = j?.kdf;
  if (j?.samaraNotes !== 1 || !k || ![k.n, k.r, k.p].every(Number.isInteger) || k.n > 1 << 20 || k.n < 1 << 10 || k.r > 32 || k.p > 4) throw new Error('notours');
  try {
    const d = createDecipheriv('aes-256-gcm', key(String(pass ?? ''), Buffer.from(k.salt, 'base64'), k.n, k.r, k.p), Buffer.from(j.iv, 'base64'));
    d.setAuthTag(Buffer.from(j.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(j.data, 'base64')), d.final()]).toString('utf8'));
  } catch { throw new Error('wrong'); }
}
