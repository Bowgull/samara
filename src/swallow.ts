// Errors Samara chooses to carry on past (Phase 0, 2026-11-24). Many failures are fine to step over (a closed window, a
// temp file already gone), and the code says so with an empty catch. But an empty catch also hides the ones that are not
// fine: on Nov 12 a file paid video needs was removed and nothing said so for a week.
//
// swallowed(where, e) is the empty catch that leaves a trace: the first time each place fails it is written to the log
// (its kind and message, never an address or a value), after that only counted, and the flight recorder writes the
// counts once an hour. So a place that fails once is a line, and a place that fails all the time is a number that grows.
// Never throws, never blocks, never keeps a page's words: only `where` (written by us) and the error's own message,
// cut short.

type Sink = (line: string) => void;

const counts = new Map<string, number>();
let sink: Sink | null = null;
let since = new Map<string, number>();

/** Where the first failure of each place is written (the app's log). Until set, failures are only counted. */
export function setSwallowSink(s: Sink | null): void { sink = s; }

/** Carry on past `e`, leaving a trace. `where` is a short fixed name: "engine.tidy", "bsync.save". */
export function swallowed(where: string, e?: unknown): void {
  try {
    const n = (counts.get(where) ?? 0) + 1;
    counts.set(where, n);
    since.set(where, (since.get(where) ?? 0) + 1);
    if (n === 1 && sink) sink(`swallowed: ${where}: ${describe(e)}`);
  } catch { /* the trace itself must never be the failure */ }
}

/** The error's kind and message, one line, at most 160 characters. */
export function describe(e: unknown): string {
  if (e === undefined) return 'no error given';
  const err = e as { name?: unknown; code?: unknown; message?: unknown };
  const kind = typeof err?.code === 'string' ? err.code : typeof err?.name === 'string' ? err.name : typeof e;
  const msg = typeof err?.message === 'string' ? err.message : String(e);
  return `${kind}: ${msg.split('\n')[0]}`.slice(0, 160);
}

/** Every place that failed since Samara started, most failures first. */
export function swallowCounts(): { where: string; n: number }[] {
  return [...counts.entries()].map(([where, n]) => ({ where, n })).sort((a, b) => b.n - a.n);
}

/** The hourly line: places that failed since the last one, or null when none did. Starts a new hour. */
export function swallowSummary(): string | null {
  const recent = [...since.entries()].sort((a, b) => b[1] - a[1]);
  since = new Map();
  if (!recent.length) return null;
  const top = recent.slice(0, 8).map(([w, n]) => `${w} ${n}`).join(', ');
  return `swallowed this hour: ${top}${recent.length > 8 ? ` and ${recent.length - 8} more places` : ''}`;
}

/** Tests only. */
export function resetSwallowed(): void { counts.clear(); since = new Map(); sink = null; }
