// The DRM runtime: a second, separate Electron that exists only to play paid video (step 6.4).
//
// WHY IT IS ITS OWN PROCESS, and not just a window in the Shell:
//
// 1. `disableHardwareAcceleration()` is process-wide. On this machine it has to be off for protected
//    video, because screen capture cannot see an accelerated protected surface and the user sees a black box
//    (proved 2026-10-04). Turning it off for the whole Shell would slow every
//    other window for the sake of one.
// 2. This is castLabs Electron, which trails the stock build's security fixes by weeks. So only a
//    short list of paid services is ever allowed to load here. Everything else, including every
//    ordinary web page, stays in the stock Shell.
//
// WHY IT IS BUILT FROM TWO STACKED VIEWS rather than a page with a frame in it: paid services refuse
// to be framed. Crunchyroll answers ERR_BLOCKED_BY_RESPONSE and the others do the same. So the service
// is the page, and Samara's wooden bar is a second view sitting above it (see stack.ts).
//
// It looks like the ordinary pop-out because it uses the same bar page. Only one plays at a time
// across both runtimes (decision 34).
import { app, BaseWindow, components, ipcMain, session } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hold169, firstTime, ontoScreen, snapToEdges, MIN, BAR, type Box } from '../src/geometry.ts';
import { allowedInDrm, serviceFor } from '../src/services.ts';
import { rulesFor, watcherFor } from '../src/skip/skipbutton.ts';
import { stack, type Stack } from '../src/stack.ts';

const HERE = import.meta.dirname;
const STATE_DIR = process.env.SAMARA_STATE_DIR ?? '';
const LINK = process.env.SAMARA_DRM_URL ?? '';
/**
 * Which switch to use to get past screen capture. The plan asks to try the narrower one first: if it
 * works it keeps hardware acceleration for everything except the protected video overlay. Set
 * SAMARA_DRM_MODE=full to fall back to turning acceleration off altogether, which 6.1 proved works.
 */
const MODE = (process.env.SAMARA_DRM_MODE ?? 'narrow').toLowerCase();

if (MODE === 'full') {
  app.disableHardwareAcceleration();
} else {
  // Keep acceleration, but stop Chromium putting protected video in a display-only overlay, which is
  // the specific thing screen capture cannot see. If this is not enough the user sees a black box, and 'full' is
  // the fallback. Only their eyes can tell the difference, which is why both modes exist.
  // With underscores (2026-11-07): the GPU process reads a driver workaround only by its own name; the hyphenated
  // spelling this had was silently ignored, so overlays stayed on (getGPUInfo: supportsOverlays true).
  app.commandLine.appendSwitch('disable_direct_composition_video_overlays');
}

// Its own name and its own folder, BEFORE asking for the single-instance lock.
//
// Without this it shares both with the Shell, because they run from the same package.json. The lock is
// held per app name, so the Shell holding it made every attempt to start this one exit with code 0,
// silently: the runtime "started" and vanished, and nothing anywhere said why. Found 2026-10-04.
//
// Separate folders are right anyway: their paid-service sign-ins belong to this runtime and nothing else.
app.setName('samara-paid-video');
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'samara-paid-video'));
} catch (e) {
  console.error('drm: could not set its own folder: ' + (e as Error).message);
}
if (!app.requestSingleInstanceLock()) {
  console.error('drm: another paid-video runtime is already running');
  app.exit(0);
}

let win: BaseWindow | null = null;
let views: Stack | null = null;
const boxFile = path.join(STATE_DIR, 'popout.json');

/** The same remembered size and place as the ordinary pop-out, so it does not jump between runtimes. */
function remembered(): Box | null {
  try {
    if (!existsSync(boxFile)) return null;
    const j = JSON.parse(readFileSync(boxFile, 'utf8'));
    return ['x', 'y', 'width', 'height'].every(k => Number.isFinite(j?.[k]))
      ? { x: j.x, y: j.y, width: j.width, height: j.height } : null;
  } catch { return null; }
}
function remember(box: Box): void {
  try { writeFileSync(boxFile, JSON.stringify(box)); } catch { /* a lost size is not worth a crash */ }
}

app.whenReady().then(async () => {
  // Nothing can play before Widevine is loaded, so the window is not made until it is: a window that
  // appears and then fails is worse than one that takes a moment to arrive.
  try {
    await components.whenReady();
    console.log('drm: widevine ' + JSON.stringify(components.status()));
  } catch (e) {
    console.error('drm: widevine would not load, so protected video cannot play: ' + (e as Error).message);
    app.exit(2);
    return;
  }

  if (!allowedInDrm(LINK)) {
    console.error(`drm: refusing to load ${LINK.slice(0, 80)}; only paid services run in this runtime`);
    app.exit(3);
    return;
  }
  const service = serviceFor(LINK)!;

  // A paid player needs none of these, so none of them can even be asked for.
  for (const s of [session.defaultSession, session.fromPartition('persist:paid')]) {
    s.setPermissionRequestHandler((_wc, _p, done) => done(false));
    s.setPermissionCheckHandler(() => false);
    s.setDevicePermissionHandler(() => false);
  }

  const { screen } = await import('electron');
  const saved = remembered();
  const area = saved
    ? screen.getDisplayMatching(saved).workArea
    : screen.getPrimaryDisplay().workArea;
  const box = saved ? ontoScreen(saved, area) : firstTime(area);

  win = new BaseWindow({
    ...box, minWidth: MIN.width, minHeight: MIN.height,
    // A hidden title bar, not frame:false: Windows 11 rounds the corners and draws the soft edge (2026-10-12).
    titleBarStyle: 'hidden', transparent: false, backgroundColor: '#24160D', thickFrame: true,
    // Over WoW on the PC; on the Mac (M6) an ordinary window the user can put full screen.
    alwaysOnTop: process.platform !== 'darwin', show: false, title: 'Samara', icon: path.join(HERE, '..', 'pages', 'art', 'samara', 'samara.ico'),
  });
  if (process.platform === 'darwin') win.setWindowButtonVisibility(false);   // the bar's own buttons, as on the PC
  else win.setAlwaysOnTop(true, 'screen-saver');
  // Samara's face on the taskbar, never Electron's atom.
  try { win.setAppDetails({ appId: 'Samara', appIconPath: path.join(HERE, '..', 'pages', 'art', 'samara', 'samara.ico'), appIconIndex: 0, relaunchDisplayName: 'Samara' }); } catch { /* not Windows */ }

  views = stack({
    window: win,
    barHeight: BAR,
    preloadPath: path.join(HERE, '..', 'src', 'samarapreload.cjs'),
    chromePage: path.join(HERE, '..', 'pages', 'popout.html'),
    allow: allowedInDrm,
  });

  // Tell the bar what it is showing, once its own page is ready to listen.
  views.chrome.webContents.on('did-finish-load', () => {
    views?.chrome.webContents.send('popout:show', {
      // No address: this page is only the bar. The service is the view underneath it, because paid
      // services refuse to be framed.
      url: '', source: 'page', label: service.label, live: false,
      title: service.label.charAt(0) + service.label.slice(1).toLowerCase(),
    });
  });

  // Press the service's own Skip button for the user, if the user has asked for that (step 6.6). The watcher
  // goes in after every page load, because a service navigates between episodes without a new window.
  const wantsSkip = process.env.SAMARA_SKIP_INTROS !== '0';
  views.content.webContents.on('did-finish-load', () => {
    if (!wantsSkip) return;
    const url = views?.content.webContents.getURL() ?? '';
    const rule = rulesFor(url)[0];
    if (!rule) return;
    views?.content.webContents.executeJavaScript(watcherFor(rule), true)
      .then(r => console.log(`drm: skip-intro watcher ${r} on ${rule.host}${rule.steady ? '' : ' (this one is fragile)'}`))
      .catch(e => console.error('drm: could not watch for the Skip button: ' + (e as Error).message));
  });

  // Say what happened if the service refuses to load, rather than showing a blank window. The most
  // likely reasons are a licence problem or a sign-in, and both have a code worth reading.
  views.content.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3) return;                       // ERR_ABORTED: a normal redirect, not a failure
    console.error(`drm: ${service.label} would not load (${code} ${desc}) ${String(url).slice(0, 80)}`);
  });

  win.on('resize', settle);
  win.on('move', settle);
  win.on('closed', () => { win = null; app.quit(); });

  await views.show(LINK);
  win.show();
  console.log(`drm: ${service.label} open, mode ${MODE}`);
});

// Keep the size and place in step with the ordinary pop-out, 16 by 9 and all.
let pending: NodeJS.Timeout | null = null;
let correcting = false;
function settle(): void {
  views?.layout();
  if (correcting) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(async () => {
    if (!win || win.isDestroyed()) return;
    const { screen } = await import('electron');
    const b = win.getBounds();
    const { width, height } = hold169(b.width, b.height, 'width');
    const box = snapToEdges({ ...b, width, height }, screen.getDisplayMatching(b).workArea);
    if (box.width !== b.width || box.height !== b.height || box.x !== b.x || box.y !== b.y) {
      correcting = true;
      win.setBounds(box);
      setTimeout(() => { correcting = false; }, 250).unref?.();
    }
    views?.layout();
    remember(box);
  }, 180);
  pending.unref?.();
}

// Only the bar's own page may hide or close the window (Phase 0, 2026-11-24). The service has no preload, so this is the
// second lock, for a page that ever got past the first.
const fromBar = (e: Electron.IpcMainEvent): boolean => Boolean(views && e.sender === views.chrome.webContents && e.senderFrame?.parent === null);
ipcMain.on('popout:hide', (e) => { if (!fromBar(e)) return; if (win?.isVisible()) win.hide(); else win?.show(); });
ipcMain.on('popout:close', (e) => { if (!fromBar(e)) return; win?.destroy(); app.quit(); });

app.on('window-all-closed', () => app.quit());
process.on('uncaughtException', e => console.error('drm: uncaught: ' + (e as Error).message));
process.on('unhandledRejection', e => console.error('drm: unhandled: ' + String(e)));
