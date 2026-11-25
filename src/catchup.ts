// "How far behind am I" (his ask, 2026-11-24: "do updates stack? will it know how many versions behind it is?").
// Each release's sealed manifest carries the versions before it and what each brought (newest first). A Samara that
// skipped some sees on its update card how many versions it is behind and, for each one, its lines: the newest release
// already holds every change before it, so one restart brings them all. Pure, so it is tested without Electron.
import { newer } from './updateengine.ts';

export type Kind = 'major' | 'feature' | 'fix';
/** One earlier version, as the manifest carries it. */
export interface Step { version: string; name: string; items: { text: string; kind: Kind }[] }
/** How many earlier versions a manifest carries, and how many lines each. */
export const HISTORY_MAX = 20;
export const STEP_ITEMS_MAX = 12;

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const NAME = /^[A-Za-z][A-Za-z0-9 .'-]{0,39}$/;
const kindOf = (k: unknown): Kind => (k === 'major' || k === 'feature' ? k : 'fix');

/** The releases before `version` and their lines, newest first (the release script; releases.json and whats-new.json). */
export function historyOf(versions: { semver: string; name: string; at: string }[], items: { at: string; text: string; kind?: string }[], version: string): Step[] {
  const at = versions.findIndex((v) => v.semver === version);
  const end = at < 0 ? versions.length : at;
  const out: Step[] = [];
  for (let i = end - 1; i >= Math.max(0, end - HISTORY_MAX); i--) {
    const v = versions[i]!, prev = versions[i - 1];
    const from = prev ? Date.parse(prev.at) : -Infinity, to = Date.parse(v.at);
    const lines = items.filter((l) => Date.parse(l.at) > from && Date.parse(l.at) <= to);
    out.push({ version: v.semver, name: v.name, items: lines.slice(0, STEP_ITEMS_MAX).map((l) => ({ text: String(l.text).slice(0, 160), kind: kindOf(l.kind) })) });
  }
  return out;
}

/** A manifest's history, kept only where every part is what a release writes (anything odd is simply left out). */
export function readHistory(raw: unknown): Step[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, HISTORY_MAX).flatMap((s): Step[] => {
    if (!s || typeof s !== 'object' || !VERSION.test(String((s as Step).version))) return [];
    const st = s as Step;
    const items = (Array.isArray(st.items) ? st.items : []).slice(0, STEP_ITEMS_MAX)
      .map((x) => ({ text: String(x?.text ?? '').slice(0, 160), kind: kindOf(x?.kind) })).filter((x) => x.text);
    return [{ version: st.version, name: typeof st.name === 'string' && NAME.test(st.name) ? st.name : '', items }];
  });
}

/** What the update card says for a jump from `installed` to the newest release: one group per version it brings, newest
 *  first, and when it brings more than one, the line saying how many. Without a history (an older release, or one
 *  version ahead) it is the newest release's own lines, as before. */
export function catchUp(newest: { version: string; notes: string[] }, history: Step[] | undefined, installed: string): {
  groups: { name: string; items: { text: string }[] }[]; behind?: string;
} {
  const own = { name: 'SAMARA', items: newest.notes.map((text) => ({ text })) };
  const missed = (history ?? []).filter((s) => s.version !== newest.version && newer(s.version, installed) && !newer(s.version, newest.version));
  if (!missed.length) return { groups: [own] };
  const label = (v: string, name: string) => `SAMARA ${v}${name ? ` · ${name.toUpperCase()}` : ''}`;
  const groups = [{ name: label(newest.version, ''), items: own.items }, ...missed.map((s) => ({ name: label(s.version, s.name), items: s.items.map((i) => ({ text: i.text })) }))]
    .filter((g) => g.items.length);
  const n = missed.length + 1;
  // A history only reaches back so far: an older Samara is at least this far behind.
  const older = (history ?? []).length >= HISTORY_MAX && missed.length === (history ?? []).filter((s) => s.version !== newest.version).length;
  return { groups, behind: `You are ${older ? 'more than ' : ''}${n} versions behind (you have ${installed}). This one update brings all of them.` };
}
