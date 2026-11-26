// His report (2026-10-20): dragging the pop-out made it jump all over, worst in some spots. The tidy-up (16 by 9, snap to
// an edge) ran on every pause during the drag, under his held mouse. Now it waits for the drag to end ('moved').
//
// A drag is played twice, both with pauses longer than the old 180 ms debounce and ending near the left edge: by the
// wooden bar (drag(), how Samara drags it on Mac and PC), and as Windows sends its own move (many 'move' events, then one
// 'moved'). Nothing may move the window while that happens; once it is let go it snaps to the edge as before.
//
// Run: npx electron test/electron/popout-drag-check.ts
import { app, BrowserWindow, screen } from 'electron';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { servePages } from '../../src/pageserver.ts';
import { Popout } from '../../src/popout.ts';
import { readSettings } from '../../src/settings.ts';

process.on('uncaughtException', (e) => { console.log('HARNESS NOTE ' + String((e as Error).message).split('\n')[0]); });
process.on('unhandledRejection', (e) => { console.log('HARNESS REJECTION ' + String((e as Error)?.stack ?? e)); app.exit(2); });
setTimeout(() => { console.log('HARNESS TIMEOUT'); app.exit(3); }, 60_000).unref();
app.on('window-all-closed', () => { /* the test decides */ });
const state = mkdtempSync(path.join(os.tmpdir(), 'popout-drag-'));
app.setPath('userData', state);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
BrowserWindow.prototype.focus = function () { /* not in a test */ };
let bad = 0;
const check = (what: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  -- ' + d : ''}`); if (!ok) bad++; };

app.whenReady().then(async () => {
  const pages = await servePages(path.join(HERE, '..', '..', 'pages'));
  const p = new Popout({ pages, preloadPath: path.join(HERE, '..', '..', 'src', 'samarapreload.cjs'), settings: () => ({ ...readSettings(state), clickThrough: false }), remembered: () => null, remember: () => {} });
  const w = p.open('https://example.com/');
  if (!w) { console.log('no window'); app.exit(2); return; }
  await wait(1500);
  const area = screen.getDisplayMatching(w.getBounds()).workArea;
  const b0 = w.getBounds();
  const ys = b0.y;
  // the drag: from the middle toward the left edge, ending 10 px from it, pausing 300 ms between steps
  const steps = [area.x + 300, area.x + 150, area.x + 60, area.x + 20, area.x + 10];
  const stillThere = (x: number) => { const b = w.getBounds(); return Math.abs(b.x - x) > 1 || Math.abs(b.y - ys) > 1 ? `at x=${x} it went to ${b.x},${b.y}` : ''; };

  // (1) The wooden bar, as every Samara drags it on both machines (drag(): 'start', a 'move' per step, 'end'). On the
  // Mac every setPosition also fires 'moved', so this is the drag the Mac really does.
  p.drag('start');
  let jumped = '';
  for (const x of steps) {
    p.drag('move', x - b0.x, 0);
    await wait(300);                        // longer than the old 180 ms: the old code would correct here
    jumped ||= stillThere(x);
  }
  check('dragging the bar: nothing moves the window while he holds it, even near an edge', !jumped, jumped);
  check('its size stays put during the drag too', Math.abs(w.getBounds().width - b0.width) <= 1, `${b0.width} -> ${w.getBounds().width}`);
  p.drag('end');
  await wait(600);
  check('once he lets go of the bar, it snaps to the edge as before', w.getBounds().x === area.x, `x=${w.getBounds().x}, edge=${area.x}`);

  // (2) Windows (and Linux) moving it themselves: many 'move' events, then one 'moved' when it ends. Nothing may correct it
  // before 'moved'. Not on the Mac: there 'moved' is only another name for 'move', so this drag cannot be played.
  if (process.platform !== 'darwin') {
    w.setPosition(b0.x, ys);
    await wait(600);
    jumped = '';
    for (const x of steps) {
      w.setPosition(x, ys);
      await wait(300);
      jumped ||= stillThere(x);
    }
    check('moved by the system: nothing moves the window before it is let go, even near an edge', !jumped, jumped);
    w.emit('moved');
    await wait(600);
    check('once the system lets go, it snaps to the edge as before', w.getBounds().x === area.x, `x=${w.getBounds().x}, edge=${area.x}`);
  }
  console.log(bad ? `${bad} FAILED` : 'ALL PASS'); app.exit(bad ? 1 : 0);
});
