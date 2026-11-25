// Samara's tools (U1, 2026-11-25): the plain part of the tools key's menu (toolswire.ts shows it), so the unit test can
// read it: which rows, in the ☰ menu's order, and the key that brings it up.
import type { MenuItemConstructorOptions } from 'electron';

export interface ToolHubs {
  timer?: (() => void) | null;
  music?: (() => void) | null;
  snip?: (() => void) | null;
  note?: (() => void) | null;
}

/** The key that brings the tools up anywhere. */
export function toolsKeyFor(_platform: NodeJS.Platform): string { return 'Control+Alt+T'; }

/** The tools menu, in the ☰ menu's order: each row only when its tool started. The quick-note key is shown beside New note. */
export function toolsMenu(h: ToolHubs, noteKey: string | null): MenuItemConstructorOptions[] {
  const rows: MenuItemConstructorOptions[] = [];
  if (h.timer) rows.push({ label: 'Timer', click: () => h.timer?.() });
  if (h.music) rows.push({ label: 'Music player', click: () => h.music?.() });
  // a snip a moment after the menu goes, so the menu is not in the frozen screen
  if (h.snip) rows.push({ label: 'Snip', click: () => { setTimeout(() => h.snip?.(), 200); } });
  if (h.note) rows.push({ label: 'New note', ...(noteKey ? { accelerator: noteKey, registerAccelerator: false } : {}), click: () => h.note?.() });
  if (!rows.length) rows.push({ label: 'No tools have started', enabled: false });
  return rows;
}

