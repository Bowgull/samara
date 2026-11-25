// Snip in Samara (S1, 2026-11-25): the plain rules, no Electron (snip.ts, pinsnip.ts and snipwire.ts use them; the unit
// test reads them): the box he drew, where it falls on the picture, the file's name, a pinned snip's size, and the words
// Ask Claude types into a new chat.

/** The box he drew, in the overlay page's own pixels, with the page's size. */
export interface SnipBox { x: number; y: number; w: number; h: number; vw: number; vh: number }

/** A box he drew, checked: numbers, inside the page, at least 8 px each way (a click is not a snip). Null otherwise. */
export function cleanBox(r: unknown): SnipBox | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : NaN);
  const b = { x: n('x'), y: n('y'), w: n('w'), h: n('h'), vw: n('vw'), vh: n('vh') };
  if (Object.values(b).some((v) => Number.isNaN(v))) return null;
  if (b.vw < 1 || b.vh < 1 || b.vw > 20_000 || b.vh > 20_000 || b.w < 8 || b.h < 8 || b.x < 0 || b.y < 0) return null;
  if (b.x + b.w > b.vw + 1 || b.y + b.h > b.vh + 1) return null;
  return b;
}

/** Where the box falls on the full picture (it may be bigger than the page: a Retina screen), kept inside it. */
export function cropFor(r: SnipBox, size: { width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const sx = size.width / Math.max(1, r.vw), sy = size.height / Math.max(1, r.vh);
  const x = Math.min(size.width - 1, Math.max(0, Math.round(r.x * sx)));
  const y = Math.min(size.height - 1, Math.max(0, Math.round(r.y * sy)));
  return { x, y, width: Math.max(1, Math.min(size.width - x, Math.round(r.w * sx))), height: Math.max(1, Math.min(size.height - y, Math.round(r.h * sy))) };
}

/** "Snip 2026-11-25 14.03.22.png": sorts by time, and has no characters either machine refuses in a name. */
export function snipName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Snip ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.png`;
}

/** The bar (popout.css --bar), the room to the right for the slider, and the largest picture it opens at. */
export const BAR = 34, ROOM_R = 44, MAX_W = 360, MAX_H = 300, MIN_W = 240;
export const MIN_OPACITY = 0.3;

/** How big the window opens for a picture this size: the picture fits MAX_W x MAX_H, never narrower than MIN_W. */
export function pinSize(w: number, h: number): { width: number; height: number; picW: number; picH: number } {
  const k = Math.min(1, MAX_W / Math.max(1, w), MAX_H / Math.max(1, h));
  // A thin snip is shown no narrower than MIN_W (the bar needs its title and keys); the picture keeps its shape inside.
  const picW = Math.max(MIN_W, Math.round(w * k)), picH = Math.max(60, Math.min(MAX_H, Math.round(picW * h / Math.max(1, w))));
  return { width: picW + ROOM_R, height: picH + BAR, picW, picH };
}

/** A snip's name for Claude: "sn" and 16 letters and digits, made fresh for each. */
export const SNIP_ID = /^sn[a-f0-9]{16}$/;
/** The words typed into the new chat: his to finish and send. */
export function askText(id: string, file: string): string {
  return `Here is a snip I took of my screen. See it with Samara's browser_snip tool (snip: ${id}); if that tool is not there, the picture is the file ${file}\n\n`;
}

