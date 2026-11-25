// The speed budget's arithmetic, kept apart from speed-check.ts so a plain test can hold it.
export interface Speed { startMs: number; pageMB: number; idleCpu: number; switchMs: number }
export type Budgets = Record<string, Speed>;

/** What went over budget, worded for the log. */
export function overBudget(m: Speed, b: Speed): string[] {
  const out: string[] = [];
  if (!(m.startMs <= b.startMs)) out.push(`start ${m.startMs} ms, budget ${b.startMs} ms`);
  if (!(m.pageMB <= b.pageMB)) out.push(`one page ${m.pageMB} MB, budget ${b.pageMB} MB`);
  if (!(m.idleCpu <= b.idleCpu)) out.push(`idle processor ${m.idleCpu}% of one core, budget ${b.idleCpu}%`);
  if (!(m.switchMs <= b.switchMs)) out.push(`tab switch ${m.switchMs} ms, budget ${b.switchMs} ms`);
  return out;
}
