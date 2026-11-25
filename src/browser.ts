// Steps 6.19, 6.20 and 6.21: Samara.
//
// One window at first; dragging a tab out makes another (2026-10-13). Each window is a Pane: its frame, its
// tabs, its tray, its curtain. The rest (bookmarks, history, trails, the snapshot) is the one browser's. Its frame (the
// carved band and the tab rail, sheet 3) is a page of ours; each tab is its own
// WebContentsView, placed by hand in the page area. That placing is step 6.19: no layout library can hold a
// browser view, because a view is not a page element. The frame tells us once how wide the rail is and how
// tall the band is (its insets); from then on every resize is answered here, synchronously, from the window's
// own size, so the page never lags a frame behind the frame or tears at his scaling. Electron works in
// device-independent pixels, so Windows' monitor scaling is already accounted for.
//
// 6.21, NEVER LOSE A TAB: every tab is snapshotted (address, title, where it sat in the rail, scroll, zoom)
// every few seconds and on every navigation, to one file written atomically. Save-on-quit cannot be
// trusted (an updater or a PC shutdown closes windows first), so the snapshot is continuous and the
// same one powers crash reload, sleeping tabs and coming back after a restart. Every call INTO a tab has a
// timeout: calling a crashed one hangs (tested 2026-10-04).
//
// SAFETY, from the first line:
//  - His browsing lives in its own session (`persist:samara`), apart from the companion's pages and the pop-out.
//  - A tab can only ever be a web page: http and https. The address slot searches or goes to a site and
//    never runs anything (address.ts, tested).
//  - Tabs get NO preload and the safe preferences: a website can never reach the companion's doors.
//  - Every permission a site asks for is refused until 6.22 adds the asks (chips and the lever).
import { BrowserWindow, Menu, WebContentsView, app, ipcMain, net, powerMonitor, clipboard, desktopCapturer, dialog, nativeImage, nativeTheme, safeStorage, screen, systemPreferences, session as electronSession, shell, webContents as allWebContents, type DesktopCapturerSource } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { SAFE_WEB_PREFERENCES, denyPermissions, lockDown } from './safety.ts';
import { servePages, type PageServer } from './pageserver.ts';
import { askText, hyruleNotesFile, notePlaceMsg, writeGuide, type NotePlaceMsg } from './hyrulenotes.ts';
import { SELECTION_CODE } from './anchorpaint.ts';
import { RouteQueue, routeAsk, routeReport } from './hyruleroute.ts';
import { run, within } from './page.ts';
import { SIZES, capture, captureWindow, type CaptureOpts, type Shot, type WindowShot } from './capture.ts';
import { trouble } from './flight.ts';
/** How many trouble pictures are kept (the newest). */
export const TROUBLE_KEEP = 12;
import { CastSession, DEFAULT_PLAYER, airplayNames, findRemoteTvs, findTvs } from './tv.ts';
import { KEY, ensureCert, remote, startPairing, type TvTarget } from './tvremote.ts';
import { PAGE_VIDEO_JS, PAUSE_PAGE_JS, YOUTUBE_APP, YOUTUBE_NS, copyProtected, plainMedia, seekPageJs, tvAppLink, tvSteps, twitchMedia, twitchOf, youTubeId, youTubeOnTv, type TvAppLink } from './tvmedia.ts';
import { addressFor, engineHome, guessesUrl, parseGuesses, searchFor, setSearch, type Engine } from './address.ts';
import { writeFileAtomic, writeFileAtomicSoon } from './atomic.ts';
import { SessionStore, type SessionData } from './sessionstore.ts';
import { SPLIT_EDGE, SPLIT_GAP, SPLIT_HEAD, clampSplit, splitLeftWidth } from './splitview.ts';
/** Sheet 121 (5): the wood strip over a peeked page. */
export const PEEK_HEAD = 44;
import { fitIn } from './geometry.ts';
import { SavePaths, programAsk, quarantineMark, safeName, sameSite, siteOfUrl, zoneMark } from './downloads.ts';
import { readJson } from './store.ts';
import { carriesData, goesInward, grantKey, grantTop, keyWeigh, needsLookup, ownPopup, personal, privateHost, reachesIn, siteOf, JOB_SITES, jobTask } from './driverrules.ts';
import { resolvesInward } from './netlookup.ts';
import { SiteRules, notifyOrigin, siteKey, type Tri } from './siterules.ts';
import { DeviceOk, deviceName, type KnownDevice } from './devices.ts';
import { svgToPng } from './svgicon.ts';
import { lookalike } from './lookalike.ts';
import { askHelper, softEdge } from './winedge.ts';
import { isBar, parseBookmarks, parseChromeBookmarks, parseSafariBookmarks, type Mark } from './bookmarks.ts';
import { BW_LOGIN, LOCK_AFTER, Vault, fillScript, type Login } from './vault.ts';
import { DETAIL_KINDS, DetailsStore, PIN_MAX, PIN_MIN, PinSeal, cleanDetails, pinOk, detailFor, fillDetailsScript, samePin, type FieldKind } from './autofill.ts';
import { createHmac, randomBytes } from 'node:crypto';
import { claudeMessage, claudeOpenTarget, type ClaudeOpen } from './claudewire.ts';
import { Visits, search as searchVisits, forCompanion, neverKeep, bankSite, type Visit } from './visits.ts';
import { BrowserSync, urlKept, type SyncCookie, type SyncMsg, type TabSnap } from './bsync.ts';
import { routeHome } from './homeroute.ts';
import { Driver, type Job } from './driver.ts';
import { LOOP_STOP, LOOP_WARN, LoopCatch } from './loopcatch.ts';
import { declineCookies } from './cookiedecline.ts';
import { FORM_EVERY_MS, FORM_GRAB_JS, GONE_MS, cleanForm, formFillJs, hasTyping, placeName, readKept, sameName, writeKept, type KeptField, type KeptForm, type KeptJob } from './claudekeep.ts';
import { HELD_OPS, NEW_CHAT_MAX, cardRows, cleanWhy, newChatLink, newPass, noteDid, pickText, reportLines, reportOf, type Chat, type Hand, type HandReport } from './claudehand.ts';
import { pastSearches, searchQueryOf, topSites } from './recall.ts';
import { Downloads, kindOf, trayOf, type Dl } from './dlist.ts';
import { DRAINED, NoticeQueue, cleanNotice, plainNotice, type NoticeFrom, type NoticeIn, type NoticeShown } from './notices.ts';
import { saysDecided, sheetLabel, spaceOf, tidyDue, tidyLine } from './mockuptidy.ts';
import { KNOWN_PROJECTS, NO_TOPIC, branchHome, cleanTitle, isSamaraRepo, plainName, projectName, shownNum } from './mockfiling.ts';
import { HOME_NAME, artOf, diskReader, gather, homeHead, homeReady, keep, newShown, projectFolder, pullHome, pushHome, ART_DIRS } from './mockhome.ts';
import { LOGO_SPOTS, MockServer, MockStore, logoSlug, srcOf, SHOT_MAX_BYTES, SHOT_MAX_W, cleanPath, cleanSheet, findRepo, git, liveTitle, notesFrom, resolveVersion, sheetKind, splitRepoSheet, type MockSend, type MockSendItem, type MockStage, type MockVersion, type MockupDrop } from './mockups.ts';

/** A site name scrambled with this PC's own key: the file alone says nothing about where he has accounts. */
import type { CheckProgress } from './updateengine.ts';
/** What the update tray shows (sheet 35): the title ("Version 1.1.0: Gojo"), what the update does as groups of lines (a
 *  line with a key is a tick box he can untick), whether he can go back, and his overnight setting. */
export interface UpdateCard {
  version: string; since: number; title?: string;
  groups?: { name: string; items: { text: string; note?: string; key?: string; on?: boolean }[] }[];
  canBack?: boolean; overnight?: boolean;
  notes?: string[]; checks?: string[]; kind?: string;
  /** Sheet 108: castLabs wants him to sign in ('ask': the key says "Sign in to castLabs"), or Terminal is open. */
  signin?: 'ask' | 'waiting' | 'signing';
  /** Sheet 108: how far behind Chrome's security fixes the engine is, one line. */
  behind?: string;
  /** Sheet 114: a newer one getting ready behind this one; Restart now still puts this one in. */
  coming?: { next: string; now: string };
  /** Phase 2: the engine closes a gap in Chrome's security fixes (red key), and goes in by itself tonight (`tonight`). */
  security?: boolean; tonight?: boolean;
}
// His pick (2026-10-14): the lantern alone, lit and glowing, nothing behind it.
export const SAMARA_ICON = path.join(import.meta.dirname, '..', 'pages', 'art', 'samara', 'samara-open.ico');
/**
 * The key that scrambles the list of sites Bitwarden has logins for, kept under the computer's own lock (code audit L10,
 * 2026-10-14) instead of beside the list. Windows' own lock (DPAPI) never asks him anything; the Mac moves to its
 * Keychain with the login lock, so it does not bring a new Keychain question with every update before then.
 */
export const lockKey = (key: string): string => { try { return process.platform === 'win32' && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key).toString('base64') : ''; } catch { return ''; } };
export const unlockKey = (locked: string): string => { try { return safeStorage.decryptString(Buffer.from(locked, 'base64')); } catch { return ''; } };
export const scramble = (key: string, host: string) => createHmac('sha256', key).update(host.toLowerCase()).digest('hex').slice(0, 32);
import { PhishCheck } from './phish.ts';
import { SB_NAME, SafeBrowsing } from './safebrowsing.ts';
import { sched } from './sched.ts';
import { serviceFor } from './services.ts';
import { failureWords, isRisky, upgrade } from './secure.ts';
import { blockAds, guardRequests, privacyHooks, type AdBlock } from './skip/ads.ts';
import { CookieWall, cleanLink, cookieHeaders, guardPrivacy } from './privacy.ts';
import { createRequire } from 'node:module';
import { pageMenuItems, sendKindFor } from './pagemenu.ts';
import { WATCH_CSS, WATCH_HOSTS } from './watchmode.ts';
import { GOOGLE_WORDS_JS, googleRefused, refusalTarget } from './passkeys.ts';
import { EarlierStore } from './earlier.ts';
import { afterClose, entryKey, fading, migrateV1, tidyDue as railTidyDue, toPutAway, type EarlierEntry, type RailTab, type V1File } from './rail.ts';
import { RailPart } from './browser-rail.ts';
import { PanesPart } from './browser-panes.ts';
import { TvPart } from './browser-tv.ts';
import { ThingsPart } from './browser-things.ts';
import { AddressPart } from './browser-address.ts';
import { NoticesPart } from './browser-notices.ts';
import { SyncPart } from './browser-sync.ts';
import { ClaudePart } from './browser-claude.ts';
import { PopoutPart } from './browser-popout.ts';
import { MockupsPart } from './browser-mockups.ts';
import { SessionPart } from './browser-session.ts';

/**
 * Dark mode for web pages (X, 2026-10-14): Dark Reader's own engine (darkreader 4.9.133,
 * MIT), put into each page in a world of its own, so the page's scripts can neither see it nor switch it off.
 */
export const DARK_WORLD = 1002;
export const DARK_THEME = '{brightness:100,contrast:95,sepia:5}';
/**
 * His report (2026-10-20): dark mode was laggy on his 2017 MacBook. Dark Reader repaints a whole page, which is heavy on a
 * busy page and a dual-core Mac also playing a cloud-PC stream. So, like the real extension's "detect dark theme": a
 * page that is already dark (its own dark mode, or one it chose because sites are told he prefers dark) is left alone,
 * and Dark Reader only works on pages that are really light. Exported for the tab preload, which runs the same test.
 */
// A site that turns dark only once it has loaded (2026-10-23, his Bitwarden vault went black after logging in: its own
// dark theme under Dark Reader's): the page's own dark marks (a "dark" class or theme on <html> or <body>, or a
// dark-only color-scheme) are watched, and Dark Reader steps aside the moment they appear.
export const ALREADY_DARK = "var __samaraDarkMark=()=>{try{const els=[document.documentElement,document.body].filter(Boolean);for(const e of els){for(const c of e.classList)if(/dark/i.test(c)&&!/darkreader|light/i.test(c))return true;for(const n of ['data-theme','data-bs-theme','data-color-mode','data-mode','theme'])if(/dark/i.test(e.getAttribute(n)||''))return true;}return (document.querySelector('meta[name=color-scheme]')?.content||'').trim().toLowerCase()==='dark';}catch{return false;}};var __samaraWatchDark=()=>{try{const mo=new MutationObserver(()=>{if(__samaraDarkMark()){mo.disconnect();DarkReader.disable();}});mo.observe(document.documentElement,{attributes:true,childList:true});if(document.body)mo.observe(document.body,{attributes:true});}catch{}};var __samaraAlreadyDark=()=>{try{if(__samaraDarkMark())return true;const lum=(c)=>{const m=/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?/.exec(c||'');if(!m||(m[4]!==undefined&&+m[4]<0.5))return null;return(0.2126*m[1]+0.7152*m[2]+0.0722*m[3])/255;};const b=document.body?lum(getComputedStyle(document.body).backgroundColor):null;const h=lum(getComputedStyle(document.documentElement).backgroundColor);const v=b??h;if(v===null)return getComputedStyle(document.documentElement).colorScheme.includes('dark');return v<0.25;}catch{return false;}};";
export let darkSrc: string | null | undefined;
/** A synced list of site names: plain hosts only. */
/** Bitwarden's lock time as Settings keeps it (sheet 83). */
export const lockPick = (v: unknown): string => (typeof v === 'string' && v in LOCK_AFTER ? v : '30m');
export function hostList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((h): h is string => typeof h === 'string' && /^[a-z0-9.-]{1,253}$/i.test(h)).map((h) => h.toLowerCase()).slice(-2000) : [];
}
export function darkSource(): string | null {
  if (darkSrc === undefined) {
    try { darkSrc = readFileSync(createRequire(import.meta.url).resolve('darkreader/darkreader.js'), 'utf8'); }
    catch (e) { darkSrc = null; console.error('browser: dark mode could not load: ' + (e as Error).message); }
  }
  return darkSrc;
}

/** Sites with video, for the TV icon (sheet 99): the same list as the frame's VIDEO_SITE (browser.js). */
export const TV_VIDEO_SITE = /(^|\.)(youtube\.com|youtu\.be|twitch\.tv|crunchyroll\.com|netflix\.com|primevideo\.com|amazon\.(com|ca)|disneyplus\.com|vimeo\.com|kick\.com|max\.com|crave\.ca|stremio\.com)$/i;
export interface BrowserOptions { origin: string; preloadPath: string; stateDir: string; tabPreloadPath: string; settingsPreloadPath: string; thingsPreloadPath: string; /** tests only */ testLocal?: boolean;
  /** tests only (sheet 99): a pretend TV's remote service instead of finding his on the network */ tvAt?: { host: string; port: number; pairPort: number; name: string };
  /** Where the mockups' git repo is (sheet 47). Found from the Shell's own folder; a test gives its own. */ repoDir?: string;
  /** 2026-10-22, the Mac: no sibling repo beside Samara, but the MOCKUPS trail is on for other repos' pages and live
   *  pages (the Mac's Claude sessions, through mockupdoor.ts). Only when git is really there (macmain checks). */
  mockupsAnywhere?: boolean;
  /** 2026-10-31: the private mockups home's folder (mockhome.ts). Only the real Samara passes it (boot.ts), so a test
   *  never writes into his; a test gives a throwaway one. */
  mockHome?: string;
  /** Fake-site lists already loaded (a test gives its own); none: this browser loads its own. */
  phish?: PhishCheck;
  /** 2026-11-03 (BG4): the Hyrule map's own private folder (its page, the Journal, the 80 squares of Hyrule). Only the
   *  real Samara on the PC passes it, and only when the folder is there; no folder, no Hyrule tab. */
  hyruleDir?: string }

export interface Tab {
  id: number;
  /** Sheet 111: opened by a Claude session, as one of its pages (never saved; it is his once he drags it out). */
  claude?: boolean;
  /** Logged out: a Claude page outside its job's sites, on the driver's own session. */
  guest?: boolean;
  /** The window it is in (a Pane's id). */
  pane: number;
  /** One of the browser's own pages (Settings, Your things), not a website: it gets its own small preload and never navigates. */
  internal?: 'settings' | 'things' | 'mocklog' | 'hyrule';
  /** null while the tab is asleep: its page is closed to save memory, its snapshot kept. */
  view: WebContentsView | null;
  opener: number | null;
  title: string;
  url: string;
  favicon: string;
  loading: boolean;
  audible: boolean;
  muted: boolean;
  crashed: boolean;
  /** Lent to the popout: the live page is playing over his game; the browser shows a plate where it was. */
  lent: boolean;
  scrollY: number;
  /**
   * Coming back after a restart (2026-10-22): Chromium's own saved state for the page he was on (scroll, form
   * contents but never passwords), so the page comes back where it was as it draws, and the colour of the page, so the
   * page area shows that colour (not near-white) until it does. Kept on this machine only; sync never carries them.
   */
  pageState?: string;
  /** The last picture of the page as he left it (taken when his mouse heads for the tab list): shown at once when it
   *  wakes from sleep, so it never looks blank or crashed (2026-10-23). `waking`: its sound and video wait for the page. */
  leftShot?: string; waking?: boolean;
  /** Sheet 121 (3): a small picture of the page from the last time it was in front, for the tab list's hover picture. */
  card?: string; cardUrl?: string;
  /** Frozen (2026-10-23, Edge's sleeping tabs): its timers and network stop, the page stays; it thaws instantly. */
  frozen?: boolean;
  /** A freeze was asked for and may still land (2026-10-30): a thaw must undo it even before it is marked frozen. */
  freezing?: boolean;
  /** Which wake this is: a timer left from an earlier wake of the same tab must not end this one (2026-10-30). */
  wakeSeq?: number;
  /** It was put to sleep (not a brand-new tab): when it wakes it comes back quietly, paused at his spot. */
  slept?: boolean;
  /** Where its main video was when it went quiet (2026-10-23): a woken tab comes back paused right there. */
  videoAt?: number;
  pageBg?: string;
  zoom: number;
  lastSeen: number;
  /** Phase R: pinned to the top of the rail; never put away overnight. */
  pinned?: boolean;
  /** 6.24: a call is live in this tab (he allowed its camera, mic or a screen share): never slowed, never put to sleep. */
  call?: boolean;
  /** 6.22: stopped before loading because a list names it: which lists. */
  blocked: { url: string; lists: string[]; real?: string; bank?: boolean } | null;
  /** Sheet 3 section 3: the trail it belongs to (null = a loose tab), and whether he turned it in. */
  trail: number | null;
  done: boolean;
  /** HTTPS-first: the plain http address this load was upgraded from, until the secure one answers. */
  upgraded: string | null;
  /** The last popup this page opened by itself and was blocked: the shield glows blue until he looks (2026-10-12). */
  blockedPopup: { url: string; site: string } | null;
  /** The page did not load: no secure version (`insecure`), or any other failure, in plain words (6.22b bug 3). */
  failed: { kind: 'insecure' | 'error'; url: string; title: string; text: string; retry: boolean } | null;
  /** Loading (2026-10-12): waiting for the site, then loading, then idle; how far along, 0 to 1. */
  phase?: 'idle' | 'waiting' | 'loading';
  prog?: number;
  /** Where he asked to go, shown in the address slot at once, dimmed, until the page arrives. */
  pending?: string | null;
  /** The page in this view has drawn something since it woke: only then is there an old page to hold. */
  drawn?: boolean;
  /** Nothing plays until he asks (2026-10-20): when he last asked for this tab's page himself (address, bookmark, link). */
  playOkAt?: number;
  /** What the page was last told: he can see it, or it may play out of sight (a call, the pop-out, Spotify). */
  shown?: boolean;
  /** Sheet 40 B (2026-10-20): a still of the video, taken as it went to the pop-out, for the page left behind. */
  lentShot?: string;
  /** Sheet 47: a mockup Claude opened, one tab per sheet: which sheet, the commit it shows, and its picture (key). */
  /** `at`: when it last arrived (newest on top); `unseen`: arrived and not looked at yet (a soft glow until he does). */
  mock?: { sheet: string; commit: string; key: string; at?: number; unseen?: boolean };
}

/**
 * One browser window and what belongs to it alone (2026-10-13, tab dragging). Everything that used to be "the" window,
 * the tab in front, the tray, the curtain, is per window. The browser works in one pane at a time (`this.pane`): every
 * way in (a frame's message, a tab's event, a window's event) first says which window it is about.
 */
export interface Pane {
  id: number;
  win: BrowserWindow | null;
  active: number | null;
  inset: { left: number; top: number; right: number; bottom: number };
  drawerOpen: boolean;
  peekShot: { tab: number; url: string; at: number; shot: string } | null;
  /** He is typing in this window's address bar: a tab coming forward does not take the keyboard from him (2026-11-20). */
  slotOpen?: boolean;
  peeking: boolean;
  hideTimer: NodeJS.Timeout | null;
  trayV: WebContentsView | null;
  trayOn: boolean;
  /** The list's newest state, held while it is shut and sent a moment later, so an open never rebuilds it mid-slide. */
  trayNext: Record<string, unknown> | null;
  trayNextT: ReturnType<typeof setTimeout> | null;
  /** Its page has loaded (an open before that is ignored, never a late slide). */
  trayReady: boolean;
  /** Which opening this is (a timer from an earlier one must not run during a later slide), and when it last shut. */
  traySeq?: number;
  trayShutAt?: number;
  trayAt: { x: number; y: number; hy?: number };
  /** Claude's rune panel, in its own see-through layer over the live page (2026-10-21, runeView). */
  runeV?: WebContentsView | null;
  runeOn?: boolean;
  /** Where the band's rune is (window pixels): its centre, the band's bottom, left and right. */
  runeAt?: { x: number; y: number; left: number; right: number };
  runeSize?: { w: number; h: number };
  /** When it last folded because the layer lost the keyboard: the same press on the rune must not reopen it. */
  runeShutAt?: number;
  runeHideT?: NodeJS.Timeout | null;
  /** The pop-out still last sent to this window's band (sent once, not with every message). */
  lentSent?: string;
  /** Autofill's light (sheet 77): its own see-through layer beside the box he clicked. */
  lightV?: WebContentsView | null;
  /** Sheet 102: the address bar's list on its own layer, and the last thing it was told (sent again once it has loaded). */
  sugV?: WebContentsView | null;
  sugLast?: SugShow | null;
  /** Sheet 106 v7: Samara's notices, on their own layer over the live page; the one it is drawing now. */
  noticeV?: WebContentsView | null;
  noticeOn?: number | null;
  /** Sheet 109: the hand card's layer (YOU HAVE IT / YOUR TURN / what Claude is told), and what it last drew. */
  handV?: WebContentsView | null;
  handLast?: string;
  handH?: number;
  handReady?: boolean;
  curtain: WebContentsView | null;
  curtainReady: Promise<unknown>;
  veil: { tab: number; nav: number; at: number; up: boolean; dimT: NodeJS.Timeout | null; capT: NodeJS.Timeout | null } | null;
  fullTab: number | null;
  watching: number | null;
  watchTimer: NodeJS.Timeout | null;
  /** Sheet 60: this window's "Notes for this site" rail is open (Esc in the page closes it). */
  railOpen?: boolean;
  /**
   * Sheet 120 A (2026-11-20): the band's menus and panels (⋯, star, shield, downloads, update, plan) float in their own
   * see-through layer over the LIVE page, the way the tab list and the rune do; the page is never frozen into a picture.
   * The layer is the frame's own page (?float); floatLast holds what the frame was last told, for a layer that loads late.
   */
  floatV?: WebContentsView | null;
  floatOn?: boolean;
  floatReady?: boolean;
  floatLast?: Map<string, unknown[]>;
  /** Sheet 121 (4): two pages side by side in this window (tab ids, and the left page's share of the width). */
  split?: { left: number; right: number; ratio: number } | null;
}
/** Sheet 60 section 4: a note as Samara's notes rail needs it (only notes that came from a page carry `src`). */
export interface RailNote { id: string; title: string; html: string; cat?: string; src?: { url: string; site: string }; updated: number }
export const newPane = (id: number): Pane => ({ id, win: null, active: null, inset: { left: 30, top: 66, right: 8, bottom: 8 }, drawerOpen: false, peekShot: null, peeking: false,
  hideTimer: null, trayV: null, trayOn: false, trayNext: null, trayNextT: null, trayReady: false, trayAt: { x: 42, y: 62 }, curtain: null, curtainReady: Promise.resolve(), veil: null, fullTab: null, watching: null, watchTimer: null });

/** A trail (Horse Browser's idea, sheet 3): pages that belong to one thing he is doing. `named` = he named it. */
export interface Trail { id: number; name: string; named: boolean; collapsed?: boolean; fresh?: boolean; /** sheet 47: the MOCKUPS trail */ mock?: boolean }
/** Sheet 47: the MOCKUPS trail always has this id, so it is the same trail across restarts and never mixed with his. */
export const MOCK_TRAIL = -1;
/** A trail put away in the Stash, before Phase R: read once, to move its pages into Earlier (railMove). */
export interface Stashed { id: number; name: string; tabs: { url: string; title: string }[]; at: number }

export const isWeb = (u: string) => /^https?:\/\//i.test(u);
/** A view whose page is still there (a view's page can be gone, or missing, once its window has closed). */
export const liveView = (v: WebContentsView | null | undefined): v is WebContentsView => { try { return Boolean(v?.webContents && !v.webContents.isDestroyed()); } catch { return false; } };
/** What the band's floating panels draw from (sheet 120 A): the frame's messages that also go to their layer. */
export const FLOAT_CHANNELS = new Set(['browser:tabs', 'browser:dls', 'browser:plan', 'browser:updatewhy']);
/**
 * Links that open an app instead of a page (2026-10-14: signing in to Claude on the Mac ended on "Open
 * Claude" and nothing happened, because every non-web link was dropped). Like Chrome: only these, and only after he
 * says yes in the band. Anything else stays blocked: an app link is a way to run things outside the browser.
 */
export const APP_LINKS: Record<string, string> = {
  claude: 'the Claude app', mailto: 'your email app', zoommtg: 'Zoom', zoomus: 'Zoom', msteams: 'Microsoft Teams',
  slack: 'Slack', discord: 'Discord', spotify: 'Spotify',
};
/**
 * In front, every time (2026-10-14: "when I click the browser from the wheel or the tray, anything, it should
 * ALWAYS come forward"). Windows refuses a plain focus() while another app has him, and only flashes the taskbar; on top
 * for a moment, then not, is the nudge it accepts. On the Mac the app itself has to take focus.
 */
export function bringFront(w: BrowserWindow): void {
  if (!w || w.isDestroyed()) return;
  if (w.isMinimized()) w.restore();
  if (process.platform === 'darwin') app.focus({ steal: true });
  w.setAlwaysOnTop(true); w.show(); w.moveTop(); w.focus();
  setTimeout(() => { if (!w.isDestroyed()) w.setAlwaysOnTop(false); }, 400);
  // 2026-11-01 (the wheel's Samara still stayed behind): on top was not enough while another app had the
  // front; the edge helper takes it for real (winedge.ts 'F').
  if (process.platform === 'win32') setTimeout(() => { if (!w.isDestroyed() && !w.isFocused()) void askHelper('F', w, undefined, 4000); }, 60);
}
/**
 * 2026-11-18 (a black full screen he could not close): leaving full screen always happens. Asked once; if the
 * window is still full screen a moment later (the Mac can drop the ask in the middle of its animation), asked again, and
 * on the Mac a last time through its other full screen. A new full screen in between (his F11, a page's button) wins.
 */
export const fullLeaving = new WeakMap<BrowserWindow, number>();
export let fullLeaveSeq = 0;
export function leaveFull(w: BrowserWindow, why: string): void {
  if (w.isDestroyed() || !w.isFullScreen()) return;
  const n = ++fullLeaveSeq;
  fullLeaving.set(w, n);
  w.setFullScreen(false);
  const again = (left: number) => setTimeout(() => {
    if (w.isDestroyed() || fullLeaving.get(w) !== n) return;
    if (!w.isFullScreen()) { fullLeaving.delete(w); return; }
    console.log(`shell: browser: the window stayed full screen after ${why}; asking again`);
    if (left > 0) { w.setFullScreen(false); again(left - 1); return; }
    fullLeaving.delete(w);
    try { if (process.platform === 'darwin') w.setSimpleFullScreen(false); } catch { /* not the Mac */ }
    w.setFullScreen(false);
  }, 1500);
  again(2);
}
/** F11 (the PC; the Mac's is ⌃⌘F in its View menu): into the window's full screen, or out of it and any page's in it. */
export function toggleFull(w: BrowserWindow): void {
  if (w.isDestroyed()) return;
  if (w.isFullScreen()) leaveFull(w, 'F11');
  else { fullLeaving.delete(w); w.setFullScreen(true); }
}
/** Never handed to another app, whatever claims them: they reach files, run code, or are the browser's own. */
export const NEVER_HANDED = new Set(['file', 'javascript', 'vbscript', 'data', 'blob', 'about', 'chrome', 'devtools', 'view-source', 'filesystem', 'jar', 'smb', 'afp', 'nfs', 'ftp', 'ms-msdt', 'search-ms', 'ms-officecmd', 'ms-settings',
  // Phase 1 (security audit): the rest of the ones Chrome never hands out (they run help files or local code).
  'shell', 'hcp', 'mk', 'ms-its', 'its', 'res', 'ms-help', 'help', 'vnd.ms.radio', 'ms-cxh', 'ms-cxh-full', 'ie.http', 'ie.https']);
/**
 * The app a link is for, by name; null when none. The known ones by their friendly name; any other (2026-10-25: shadow.tech
 * signing in hands him back to its app with tech.shadow://, which Samara called a fake site) by the app on this
 * computer that says it opens such links. He is still asked every time.
 */
export function appOf(u: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(String(u ?? ''));
  if (!m || u.length > 4000) return null;
  const scheme = m[1]!.toLowerCase();
  if (APP_LINKS[scheme]) return APP_LINKS[scheme]!;
  if (NEVER_HANDED.has(scheme) || scheme === 'http' || scheme === 'https') return null;
  try { const name = app.getApplicationNameForProtocol(u); return name ? name.replace(/\.app$/i, '').slice(0, 60) : null; } catch { return null; }
}
/** The right-click item that sends a page to the other machine's browser. */
export const OTHER_OPEN = process.platform === 'darwin' ? 'Open on PC' : 'Open on Mac';
/** How a look-alike is named on the red plate's list chips. */
export const LOOKS_LIKE = 'LOOKS LIKE ';
export const BANK = 'YOUR BANK';
/**
 * Sheet 89 (2026-10-25): Stremio in a tab. Its page plays through the engine its app runs on this Mac
 * (127.0.0.1:11470), which the home-network guard below stopped ("Streaming server is not available"). Stremio's own
 * page, and only it, may reach that one port.
 */
export const STREMIO_WEB = /^https:\/\/web\.stremio\.com(\/|$)/i;
export const STREMIO_ENGINE = /^(https?|wss?):\/\/(127\.0\.0\.1|localhost):11470(\/|$)/i;
export const STREMIO_APP = '/Applications/Stremio.app/Contents/MacOS';
/** Private Network Access for every tab (driverrules.ts reachesIn). */
export const netGuard = (d: Electron.OnBeforeRequestListenerDetails): boolean | Promise<boolean> => {
  let from = '';
  try { from = d.frame?.url || ''; } catch { /* frame gone */ }
  if (STREMIO_ENGINE.test(d.url) && STREMIO_WEB.test(from || d.referrer || '')) return false;
  if (reachesIn(d.url, from || d.referrer || '', d.resourceType === 'mainFrame')) return true;
  // A public-looking name may still point home (DNS rebinding): its real address decides (netlookup.ts).
  const host = needsLookup(d.url, from || d.referrer || '', d.resourceType === 'mainFrame');
  return host ? resolvesInward(host) : false;
};
/** Sheet 89: is Stremio's engine answering on this Mac? */
export const stremioUp = (): Promise<boolean> => new Promise((res) => {
  const s = netConnect(11470, '127.0.0.1');
  const done = (ok: boolean) => { s.destroy(); res(ok); };
  s.once('connect', () => done(true)); s.once('error', () => done(false)); s.setTimeout(800, () => done(false));
});
/**
 * Sheet 89 : opening Stremio starts its engine quietly when it is not running: the same small program Stremio's
 * app starts, from the app itself, with no Stremio window. It keeps running after Samara closes, as it does for the app.
 */
export async function startStremio(): Promise<void> {
  if (process.platform !== 'darwin' || !existsSync(path.join(STREMIO_APP, 'server.js')) || await stremioUp()) return;
  try { spawn(path.join(STREMIO_APP, 'node'), [path.join(STREMIO_APP, 'server.js')], { cwd: STREMIO_APP, detached: true, stdio: 'ignore' }).unref(); }
  catch (e) { console.error('shell: Stremio\'s engine would not start: ' + (e as Error).message); }
}
/** Where a new tab opens until he sets his own in Settings (2026-10-12: not Google). */
export const DEFAULT_HOME = 'https://search.brave.com/';
/** A plain Chrome's name for itself: Google refuses sign-in to anything calling itself Electron (2026-10-12). */
/** A web address's site, without www. Empty when it is not one. */
export const hostOf = (u: string): string => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
/**
 * Chrome's own name, for the computer Samara really runs on (2026-10-25: shadow.tech's "are you a bot" box
 * reloaded forever on the Mac). It said "Windows" everywhere, while the page's other clues (navigator.platform, the
 * client hints) said macOS; Cloudflare's check refuses a browser whose clues disagree. The version is given the way
 * Chrome gives it now (152.0.0.0), the same as the client hints.
 */
export const CHROME_UA = (v: string) => {
  const major = String(v).split('.')[0] + '.0.0.0';
  const os = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'linux' ? 'X11; Linux x86_64' : 'Windows NT 10.0; Win64; x64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major} Safari/537.36`;
};
/**
 * Google's sign-in pages get the browser's HONEST name (Electron's own, untouched). Measured by two other Electron
 * browsers in 2026 (Orca: a Chrome disguise was refused 12 of 12 times, the honest name 0 of 12; Ostia the same) and
 * it is what Google's own 2020 rules for browsers ask: no pretending to be Chrome. Everywhere else, plain Chrome.
 * research_notes/Google sign-in in Samara.
 */
/**
 * Sites that get the honest name too (2026-10-25: shadow.tech's Cloudflare "are you a bot" box reloaded forever).
 * Claiming Chrome while not having all of Chrome's own parts reads as a bot to Cloudflare's check; Electron's honest
 * name is a browser it knows. Google's sign-in, shadow.tech, and the Cloudflare check itself.
 */
// Netflix too (2026-10-25): Samara's video signature checked valid
// (streaming, 1361 days), so the E100 of 2026-10-14 points at the name: castLabs' own tracker (electron-releases #199)
// has a custom name breaking Netflix's DRM and the untouched name playing; castLabs' player, which plays it here, sends its own.
export const HONEST_SITES = /^https:\/\/(accounts\.(google|youtube)\.com|([a-z0-9-]+\.)*shadow\.tech|challenges\.cloudflare\.com|([a-z0-9-]+\.)*netflix\.com)(:\d+)?(\/|$)/i;
/** The requests that carry the honest name (the sites above, and what their pages load: Netflix's video). */
export const HONEST_REQUESTS = /^https:\/\/(accounts\.(google|youtube)\.com|challenges\.cloudflare\.com|[a-z0-9.-]+\.shadow\.tech|(([a-z0-9-]+\.)*)(netflix\.com|nflxvideo\.net|nflxext\.com|nflxso\.net))(:\d+)?\//i;
/** Netflix's own error codes on its player page: the playback was refused here (E100, M7xxx-xxxx, F7xxx). */
export const NETFLIX_REFUSED = /\b(E100|tvq-pb-101|M7\d{3}-\d{4}|F7\d{3}(-\d{1,4})?)\b/;
/** A popup that opens within this long of his click or key press is his (Chrome's own rule); later ones are a page's. */
export const GESTURE_MS = 1000;
/**
 * Sign-in pages a site opens in a small window on his click (Sign in with Google and the like): let through on his click
 * even though they are another site's (sheet 87's click-trick rule would otherwise stop them).
 */
export const SIGN_IN = /(^|\.)(accounts\.google\.com|appleid\.apple\.com|login\.microsoftonline\.com|login\.live\.com|github\.com|discord\.com|id\.twitch\.tv|facebook\.com|x\.com|twitter\.com|steamcommunity\.com|paypal\.com|accounts\.spotify\.com|auth0\.com|okta\.com)$/i;
/** Sheet 109: a pass from Ask Claude lets that chat read the tab for a day. */
export const PASS_MS = 24 * 60 * 60_000;
/** Sheet 109: browser_your_turn waits this long for him, inside the connector's own three minutes, then says he still has it. */
export const YOUR_TURN_MS = 170_000;
/** His rule (2026-10-20): a page may start playing by itself only this soon after he asked for it (a slow redirect included). */
export const PLAY_MS = 15_000;
/** The tab rail's slide in and out (2026-10-20): the same time the rail's CSS uses. */
export const TRAY_SLIDE_MS = 260;
/** The tab list's width at each size (sheet 71); browser.css draws the same widths. */
export const TRAY_W = { s: 300, m: 320, l: 340 } as const;
/** A tab not looked at for this long, and not playing sound, goes to sleep. */
// 2 hours (2026-10-12: fewer reloads when going back to a tab). Was 30 minutes. This PC has 16 GB.
export const SLEEP_AFTER_MS = 8 * 60 * 60_000;
/** A tab out of sight this long is frozen (Chromium's own freezing: no timers, no work, memory the system can reuse). */
export const FREEZE_AFTER_MS = 5 * 60_000;
/** The page's main video (the biggest one) and where it is, or null: read before a tab freezes or sleeps. */
export const VIDEO_AT_JS = `(() => { const v = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  return v && Number.isFinite(v.duration) && v.duration > 0 && v.currentTime > 1 ? Math.floor(v.currentTime) : null; })()`;
/** On waking: the main video goes to his spot and stays paused until he presses play himself (2026-10-23). */
// 2026-10-23 (filmed): YouTube sets its player up again after the first draw and starts from 0, so for 8 seconds, while
// it stays paused, it is put back at his spot each time it wanders off; his own press on play ends that at once.
export const VIDEO_BACK_JS = (at: number) => `(async () => {
  const big = () => [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  let done = false;
  for (let i = 0; i < 160; i++) {
    const v = big();
    if (v && v.readyState >= 1 && v.paused && Math.abs(v.currentTime - ${at}) > 0.5) { v.currentTime = ${at}; done = true; }
    else if (v && !v.paused && navigator.userActivation && navigator.userActivation.isActive) return done;
    await new Promise((r) => setTimeout(r, i < 80 ? 50 : 100));
  }
  return done;
})()`;
/**
 * A woken page is settled: fully loaded, and its layout has held still for half a second (YouTube draws a small player,
 * then the sidebar, then moves everything). The old picture stays over it until then, so he never watches it rebuild.
 * At most 3.5 seconds after it first drew.
 */
export const SETTLED_JS = `(async () => {
  const sig = () => { const v = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const r = v ? v.getBoundingClientRect() : null; const b = document.body;
    return [document.readyState, b ? b.scrollHeight : 0, b ? b.querySelectorAll('img,video,iframe').length : 0, r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',') : ''].join('|'); };
  const t0 = Date.now(); let last = sig(), since = Date.now();
  while (Date.now() - t0 < 3500) {
    await new Promise((r) => setTimeout(r, 100));
    const s = sig();
    if (s !== last) { last = s; since = Date.now(); continue; }
    if (document.readyState === 'complete' && Date.now() - since >= 500) return true;
  }
  return false;
})()`;
/** Sheet 102: what the address bar's list is told, as checked here. */
export interface SugShow { rows: { kind: string; title: string; url: string; favicon: string }[]; pick: number; typed: string; from: number; expect: number; first: boolean; x: number; y: number; width: number }
/** A size in plain words, as the download tray says it. */
export const mbOf = (n: number): string => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : (n || 0) + ' B');
export const SUG_KINDS = new Set(['search', 'guess', 'past', 'go', 'tab', 'mark', 'history', 'closed']);
/** Never a tab he looked at in the last 10 minutes, even when memory is short. */
export const SLEEP_MIN_MS = 10 * 60_000;
/** Sheet 100 v4: a mockup tab not looked at for this long closes by itself (it stays in the Mockups tab). */
export const MOCK_TUCK_MS = 3 * 86_400_000;
/**
 * Is the computer short on memory? On the Mac, its own pressure level (1 normal, 2 warning, 4 critical); on Windows,
 * under 12% of memory free. A failed read counts as fine.
 */
export function memoryShort(): Promise<boolean> {
  if (process.platform === 'darwin') {
    return new Promise((res) => execFile('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 2000 }, (e, out) => res(!e && Number(String(out).trim()) >= 2)));
  }
  return Promise.resolve(os.freemem() / os.totalmem() < 0.12);
}
/**
 * 6.24, interviews ("if it ever glitches and can't read my mic or my camera I'm in trouble"): the call sites run
 * with no ad blocking at all, so a filter list can never break a call. Their subdomains too.
 */
export const CALL_SITES = ['zoom.us', 'zoom.com', 'teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft', 'meet.google.com', 'webex.com'];
// The band's height (Windows draws its own buttons over it, see-through on the wood) and the page area's colour.
export const BAND_HEIGHT = 58;
/** The page's corners, rounded natively: the floating page (2026-10-12) has big soft corners (Flow browser does this). */
export const PAGE_RADIUS = 16;
export const PAGE_COLOUR = '#f6f3ee';
/** Chromium's saved state for a page is kept only up to this size (a page full of form fields can be large). */
export const PAGE_STATE_MAX = 64 * 1024;
/** Where the page is scrolled, and the colour it shows behind its content (the body's, else the page's, else white). */
export const PAGE_LOOK_JS = `[window.scrollY, (() => { const c = (e) => e ? getComputedStyle(e).backgroundColor : ''; const clear = (x) => !x || x === 'transparent' || /rgba\\(.*,\\s*0\\)$/.test(x);
  const b = c(document.body); if (!clear(b)) return b; const h = c(document.documentElement); return clear(h) ? 'rgb(255, 255, 255)' : h; })()]`;
/** 'rgb(14, 14, 16)' as '#0e0e10'; anything else is not a colour we keep. */
export function hexOf(c: unknown): string | undefined {
  const m = /^rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})/.exec(String(c));
  return m ? '#' + m.slice(1, 4).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('') : undefined;
}
/** The soft fade between pages (option 5): fade length, when a slow site dims, when a page counts as instant. */
export const VEIL_FADE_MS = 250, VEIL_DIM_MS = 1500, VEIL_INSTANT_MS = 300, VEIL_MAX_MS = 8000;
/** A woken page's picture fades out a little slower: one soft change instead of a page rebuilding (2026-10-23). */
export const WAKE_FADE_MS = 350;

/** Autofill and password fill run in a world of their own: the page cannot see or change the fill (page.ts adds the deadline). */
export const FILL_WORLD = 1001;

/**
 * A picture for the companion (Send to companion, 2026-10-21): at most 1200 px wide, as a PNG data URL, and dropped (null) when it
 * would still be over 1.5 MB. A huge picture is never sent.
 */
export function fitShot(shot: Shot | null, maxBytes = SHOT_MAX_BYTES): string | null {
  const url = shot?.dataUrl() ?? '';
  return url && url.length <= maxBytes ? url : null;
}
/** How a picture for the companion is taken (capture.ts): his size, PNG. */
export const SAMARA_SHOT = { maxWidth: SHOT_MAX_W, format: 'png', ms: 3000 } as const;

/** Sheet 37: a Claude session's plan, as shown to him. */
export interface PlanCard {
  id: string; task: string; steps: string[]; wont: string;
  /** local (2026-10-22): a page on this computer; the card does not list it. */
  sites: { site: string; login: boolean; favicon: string; local?: boolean }[];
  /** 2026-10-22: the session's folder name, for the card's kicker (CLAUDE · WAYMARK); '' when unknown. */
  from?: string;
}
/** His answer: go (with the sites he kept), change (with his note, Claude redoes the plan), or neither (not now). */
export interface PlanAnswer { go: boolean; change: boolean; keep: string[]; note: string; /** which card was answered */ card?: string }

export class SamaraBrowser {
  /** Every open window, and the one being worked in right now. With none open, `pane` is the last one (closed). */
  panes: Pane[] = [];
  pane: Pane = newPane(0);
  paneSeq = 0;
  /** The window he used last (focus), where a link from the companion or the other machine opens. */
  focused: Pane | null = null;
  get win(): BrowserWindow | null { return this.pane.win; }
  set win(v: BrowserWindow | null) { this.pane.win = v; }
  get active(): number | null { return this.pane.active; }
  set active(v: number | null) { this.pane.active = v; }
  get inset() { return this.pane.inset; }
  set inset(v) { this.pane.inset = v; }
  get drawerOpen(): boolean { return this.pane.drawerOpen; }
  set drawerOpen(v: boolean) { this.pane.drawerOpen = v; }
  get peekShot() { return this.pane.peekShot; }
  set peekShot(v) { this.pane.peekShot = v; }
  get peeking(): boolean { return this.pane.peeking; }
  set peeking(v: boolean) { this.pane.peeking = v; }
  get hideTimer() { return this.pane.hideTimer; }
  set hideTimer(v) { this.pane.hideTimer = v; }
  get trayV() { return this.pane.trayV; }
  set trayV(v) { this.pane.trayV = v; }
  get trayOn(): boolean { return this.pane.trayOn; }
  set trayOn(v: boolean) { this.pane.trayOn = v; }
  get trayAt() { return this.pane.trayAt; }
  set trayAt(v) { this.pane.trayAt = v; }
  get curtain() { return this.pane.curtain; }
  set curtain(v) { this.pane.curtain = v; }
  get curtainReady() { return this.pane.curtainReady; }
  set curtainReady(v) { this.pane.curtainReady = v; }
  get veil() { return this.pane.veil; }
  set veil(v) { this.pane.veil = v; }
  get fullTab() { return this.pane.fullTab; }
  set fullTab(v) { this.pane.fullTab = v; }
  get watching() { return this.pane.watching; }
  set watching(v) { this.pane.watching = v; }
  get watchTimer() { return this.pane.watchTimer; }
  set watchTimer(v) { this.pane.watchTimer = v; }
  paneOfTab(t: Tab): Pane | undefined { return this.panes.find((p) => p.id === t.pane); }
  /** The tabs in one window, in their order. */
  paneTabs(p: Pane = this.pane): Tab[] { return this.tabs.filter((t) => t.pane === p.id); }
  /** Work in the window this tab is in. False if that window is gone. */
  inTab(t: Tab): boolean { const p = this.paneOfTab(t); if (p) this.pane = p; return Boolean(p); }
  alive(p: Pane | null | undefined): p is Pane & { win: BrowserWindow } { return Boolean(p?.win && !p.win.isDestroyed()); }
  /** The window he used last, or any open one. */
  lastPane(): Pane | undefined { return this.alive(this.focused) && this.panes.includes(this.focused) ? this.focused : this.panes.filter((p) => this.alive(p)).pop(); }
  tabs: Tab[] = [];
  seq = 0;
  trails: Trail[] = [];
  trailSeq = 0;
  closed: string[] = [];
  /**
   * 2026-10-12: the picture of the page used to be taken AFTER the
   * click (up to 600 ms), and the live page was hidden before the frame had painted it, so the page area
   * flashed. Now the picture is taken while his mouse is on the way (hover), and the live page is hidden only
   * when the frame says the picture is on screen.
   */
  /** M6, his yes (2026-10-13): a picture of this browser's own window and the page in it, for Claude to check a fix. */
  async look(): Promise<{ frame: string | null; page: string | null; size: string }> {
    const w = this.win;
    if (!w || w.isDestroyed()) return { frame: null, page: null, size: 'the window is closed' };
    // The whole window as he sees it (capture.ts): the frame and every view shown in it, not the frame alone.
    const img = await captureWindow(w, { format: 'png', ms: 2000 });
    const t = this.cur();
    const b = w.getBounds();
    return { frame: img ? img.base64() : null, page: t ? await this.shotOf(t) : null, size: `${b.width}x${b.height} at ${b.x},${b.y}; drawer ${this.drawerOpen ? 'open' : 'shut'}; ${this.tabs.length} tabs` };
  }

  /**
   * His pick (2026-10-30): Samara's whole window as he sees it (the tab bar, the page, the curtain, the open list), and
   * the pop-out too while a video plays in it. Drawn by Samara itself (capture.ts), kept on this computer.
   */
  async seeWindow(o: CaptureOpts = {}): Promise<{ window: WindowShot | null; popout: WindowShot | null; size: string }> {
    const P = this.lastPane();
    const w = P?.win;
    const lent = this.tabs.find((t) => t.lent && t.view)?.view;
    const pop = lent ? BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x !== w && x.isVisible() && x.contentView.children.includes(lent)) : undefined;
    const [window, popout] = await Promise.all([w && !w.isDestroyed() ? captureWindow(w, o) : null, pop ? captureWindow(pop, o) : null]);
    const b = w && !w.isDestroyed() ? w.getBounds() : null;
    const size = b ? `${b.width}x${b.height}; ${this.paneTabs(P).length} tabs${pop ? '; a video in the pop-out' : ''}${w!.isMinimized() ? '; minimized' : ''}` : 'no Samara window is open';
    return { window, popout, size };
  }
  /** A page went away or stopped answering: one picture of his window as it was, kept for finding out why . */
  troubleAt = 0;
  troubleShot(kind: 'gone' | 'hang', wc: Electron.WebContents): void {
    if (Date.now() - this.troubleAt < 60_000) return;
    const t = this.tabs.find((x) => x.view && !x.view.webContents.isDestroyed() && x.view.webContents === wc);
    if (!t || !this.alive(this.paneOfTab(t))) return;                               // only his own tabs, in a window
    this.troubleAt = Date.now();
    let site = 'page'; try { site = new URL(t.url).hostname.replace(/[^a-z0-9.-]/gi, '') || 'page'; } catch { /* none */ }
    // A page that went away shows its plate after a moment: that is what he saw.
    setTimeout(() => {
      const w = this.paneOfTab(t)?.win;
      if (!w || w.isDestroyed()) return;
      void captureWindow(w, { ms: 1500, quality: 70 }).then((shot) => {
        if (!shot) return;
        const dir = path.join(this.o.stateDir, 'trouble');
        mkdirSync(dir, { recursive: true });
        const name = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${kind}-${site.slice(0, 40)}.jpg`;
        writeFileSync(path.join(dir, name), shot.data);
        // The newest few are kept; the folder never grows.
        for (const old of readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().slice(0, -TROUBLE_KEEP)) try { unlinkSync(path.join(dir, old)); } catch { /* next time */ }
        console.error(`flight: picture of the window kept (trouble/${name}${shot.missing.length ? `, ${shot.missing.length} part(s) gave none` : ''})`);
      }).catch(() => { /* no picture this time */ });
    }, kind === 'gone' ? 1500 : 0);
  }

  async shotOf(t: Tab): Promise<string | null> {
    if (!t.view || t.crashed || t.blocked || t.failed || t.lent) return null;
    try {
      // At the page's own size on screen (capture.ts): it is shown over the page, so never smaller than that.
      return (await capture(t.view, { ms: 600, maxWidth: Infinity, quality: 80 }))?.dataUrl() ?? null;
    } catch { return null; }
  }
  /** The mouse is heading for something that will cover the page: take its picture now. */
  async peek(): Promise<void> {
    const t = this.cur(), P = this.pane;
    if (!t || P.drawerOpen || P.peeking) return;
    if (P.peekShot && P.peekShot.tab === t.id && Date.now() - P.peekShot.at < 700) return;
    P.peeking = true;
    try { const shot = await this.shotOf(t); P.peekShot = shot ? { tab: t.id, url: t.url, at: Date.now(), shot } : null; if (shot) t.leftShot = shot; }
    finally { P.peeking = false; }
  }
  /** The frame has painted the picture: now the live page can go. */
  frozenReady(): void {
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    const t = this.cur();
    if (this.drawerOpen && t?.view && !t.lent) t.view.setVisible(false);
  }
  timers: NodeJS.Timeout[] = [];
  /** This browser's jobs on the scheduler. */
  get jobNames(): string[] { return ['browser.snapshot', 'browser.sleep-idle', 'browser.claude-forms']; }
  saveSoon: NodeJS.Timeout | null = null;
  readonly o: BrowserOptions;
  /** The one owner of browser-tabs.json (sessionstore.ts). */
  readonly session: SessionStore;
  /** Phase 5: Samara on its own (samara.ts) can be quit from its ... menu; the companion's windows never set this. */
  onQuit: (() => void) | null = null;
  /** The session the tabs open in. */
  ses: Electron.Session;
  // 6.22, protection.
  readonly phish: PhishCheck;
  /** Google Safe Browsing in private mode (safebrowsing.ts). */
  sb: SafeBrowsing | null = null;
  ads: AdBlock | null = null;
  readonly pausedFile: string;
  paused = new Set<string>();
  /** Sites he chose to open anyway, past a list, with the held lever. This run only. */
  readonly letThrough = new Set<string>();
  readonly asks = new Map<number, (allow: boolean) => void>();
  /** HTTPS-first: sites he chose to open without a secure version. Kept between runs. */
  readonly httpOkFile: string;
  httpOk = new Set<string>();
  /** Decision 18: sites he let download a program. Only his click on the chip adds to it. Kept between runs. */
  readonly trustedFile: string;
  trusted = new Set<string>();
  /**
   * His call (2026-10-14, code audit M3): sites the OTHER computer trusts (for programs, or opened without https)
   * travel here but do not count until he says yes once on this machine. A removal there still applies here.
   */
  /** Sheet 37: his per-site rules (Claude and companion, his login, camera, mic). */
  rules!: SiteRules;
  peerTrusted = new Set<string>();
  peerHttp = new Set<string>();
  askSeq = 0;
  /**
   * 6.24 calls (Zoom, Teams, Meet): camera and microphone he allowed on a site, kept only while a tab is still on
   * that site, so one call does not ask five times (they ask again for every device switch). Never written to disk.
   */
  readonly mediaOk = new Map<string, Set<string>>();
  /** 6.24: the screen-share picker waiting for his pick. One at a time. */
  /** Sites he is sharing his screen with right now (with or without camera). */
  readonly shareHosts = new Set<string>();
  share: { id: number; host: string; sources: Map<string, DesktopCapturerSource>; audio: boolean; done: (s: Electron.Streams | null) => void; timer: NodeJS.Timeout } | null = null;
  /** Sheet 69: the keyboards and mice each site may use, and the one device ask waiting for his pick. */
  devices!: DeviceOk;
  devAsk: { id: number; host: string; list: Electron.HIDDevice[]; done: (id?: string) => void; timer: NodeJS.Timeout; picked: string | null } | null = null;
  /** The little wood sounds (new tab, close, download done). Off until he turns them on in Settings. */
  sounds = false;
  /** The ⋯ menu's switches (sheet 3 section 10), kept between runs. Block ads and Block popups start on. */
  /**
   * Sheet 71 (2026-10-22): the tab list's size, Small / Medium / Large (Large = the 2026-10-21 size). Each machine
   * its own (the Mac's small screen and the PC's big one), so it is kept apart from the prefs, which sync.
   */
  tabSize: 's' | 'm' | 'l' = 'l';
  localFile = '';
  prefs = { ads: true, popups: true, home: DEFAULT_HOME, search: 'brave' as Engine, aiBox: true, startup: 'tabs' as 'tabs' | 'home', dark: true, darkOff: [] as string[], afSounds: true, lockAfter: '30m' };
  /** His home page, or his search engine's front page. Web pages only. */
  get HOME(): string { return isWeb(this.prefs.home) && this.prefs.home !== DEFAULT_HOME ? this.prefs.home : engineHome(); }
  /** The Stash of before Phase R, read once so railMove can put its pages in Earlier; empty after that. */
  stash: Stashed[] = [];
  /** Phase R (2026-11-24): the tabs put away overnight, and what trails, the done shelf and the Stash held before. */
  earlier!: EarlierStore;
  readonly stashFile: string;
  /** Sites he let open popups by themselves ("Allow popups on this site"). Kept between runs. */
  popupOk = new Set<string>();
  readonly popupOkFile: string;
  /** When he last clicked or pressed a key in each tab: Chrome's user-activation rule for popups. */
  lastGesture = new Map<number, number>();
  /** Download names taken by downloads still running (downloads.ts): never handed to a second download. */
  readonly savePaths = new SavePaths();
  /** Scrambled list of the sites he has Bitwarden logins for (no names, no passwords), for the gold key. */
  readonly sitesFile: string;
  sites: Set<string> | null = null;
  siteKey = '';
  readonly prefsFile: string;
  /** Electron's own name for itself, kept for Google's sign-in pages. */
  honestUA = '';
  /** Hidden sites' cookies (privacy.ts): which pairs are let through, and the privacy log. */
  wall!: CookieWall;
  /** The browser hints' brand line, as this engine's pages read it (privacy.ts), once a page has told it. */
  brands: string | null = null;
  /** A page's own name for the browser follows where it is going: honest on Google's sign-in, Chrome elsewhere. */
  nameFor(wc: Electron.WebContents): void {
    // The real address never goes out around the page (2026-10-26): calls still work, but the Mac's home-network
    // address stays in, and later a VPN cannot be gone around (WebRTC IP handling, Brave's own default).
    try { wc.setWebRTCIPHandlingPolicy('default_public_interface_only'); } catch { /* an older runtime */ }
    // The brand line, read once from Samara's own world in a page (a page cannot change what that world sees).
    if (!this.brands) wc.once('dom-ready', () => {
      if (this.brands || !/^https:/.test(wc.getURL())) return;
      run<string>(wc, 'JSON.stringify((navigator.userAgentData && navigator.userAgentData.brands) || [])', { world: 999, ms: 3000 }).then((j) => {
        const list = JSON.parse(String(j)) as { brand: string; version: string }[];
        if (Array.isArray(list) && list.length && list.every((x) => typeof x.brand === 'string' && /^\d+$/.test(String(x.version)))) this.brands = list.map((x) => `"${x.brand.replace(/"/g, '')}";v="${x.version}"`).join(', ');
      }).catch(() => { /* the next page tells it */ });
    });
    wc.on('did-start-navigation', (d) => {
      const x = d as unknown as { url: string; isMainFrame: boolean; isSameDocument: boolean };
      if (!x.isMainFrame || x.isSameDocument) return;
      wc.setUserAgent(HONEST_SITES.test(x.url) ? this.honestUA : CHROME_UA(process.versions.chrome));
    });
  }
  /** 6.23: his logins from Bitwarden, filled when he clicks the key. */
  readonly vault: Vault;
  readonly details: DetailsStore;
  readonly pinSeal: PinSeal;
  /** The tab and site a fill was started for: a fill never lands on a page that changed since. */
  vaultFor: { tab: number; host: string; url?: string; frame?: { pid: number; rid: number } } | null = null;
  /** Does the page he is looking at have a password box? Then the key shows in the slot. */
  hasLogin = false;
  /** Each site's icon, kept as a small picture so bookmarks always carry their icons, as in any browser. */
  readonly iconsFile: string;
  icons = new Map<string, string>();
  iconsBusy = false;
  /** 6.23: his bookmarks. The bar ones show on the velvet shelf; all of them are kept. */
  readonly marksFile: string;
  marks: Mark[] = [];
  /** 6.22b bug 5: where the window was, kept between opens. */
  readonly placeFile: string;
  /** 6.22b bug 1: the tab whose page asked for fullscreen (a video's own button): it fills the whole screen. */
  /** 6.22b bug 2: the right-click menu's own little window, kept hidden between uses. */
  menu: BrowserWindow | null = null;
  menuFor: { tab: number; p: Electron.ContextMenuParams } | null = null;
  menuItems: unknown[] | null = null;
  /** Sheet 109: the chats Ask Claude's list showed, in its order (ask0 is the first). */
  menuChats: Chat[] = [];
  /** Where the menu was put, so Claude's list beside it can grow it without moving it. */
  menuAt: { x: number; y: number; w: number } | null = null;
  /** Sheet 109: passes handed to Claude with a pick, each for one tab: that chat may read the tab without asking again. */
  tabPasses = new Map<string, { tab: number; until: number }>();
  /** 6.25a: the pages the companion (and Claude sessions) drive, in hidden windows of their own. */
  readonly driver: Driver;
  /** Driving sessions stuck repeating one step (loopcatch.ts). */
  loops = new LoopCatch();
  /** Set by main: he pressed STOP on a job, so the companion stops that turn. */
  onDriverStop: ((j: Job) => void) | null = null;
  /**
   * Sheet 37, the plan card. No longer asked through (2026-11-13: Samara's own asks come from Samara): askPlan
   * always uses Samara's band. Kept so both machines' wiring still compiles; nothing calls it.
   */
  onPlanAsk: ((card: PlanCard) => Promise<PlanAnswer | null>) | null = null;
  /** The live checklist: a planned session moved on to another step, or finished. */
  onPlanStep: ((card: string, at: number | null) => void) | null = null;
  /** Sheet 41: a Claude job's plan finished, card or not, so its row in the scroll-back can say done. */
  onPlanDone: ((jobId: number) => void) | null = null;
  /** Right-click "Send to companion" (sheet 62): the words, a picture, a link or the page go to his typing box. Null while the companion
   *  is not running (then the item is not in the menu). What it carries is checked again by pagemenu.ts cleanSent. */
  onSendToCompanion: ((s: Record<string, unknown>, picture?: Electron.NativeImage) => void) | null = null;
  /** Sheet 109: his Claude chats, last used first (the companion's list on this machine; on the Mac through the companion's door). */
  claudeChats: (() => Promise<Chat[]>) | null = null;
  /** Sheet 109: his pick into one of those chats. Null when it went; else why it did not. */
  onAskClaude: ((session: string, text: string) => Promise<string | null>) | null = null;
  /** Told when Samara's last window has closed (the pop-out holding one of its tabs goes with it, 2026-10-21). */
  onLastClosed: (() => void) | null = null;
  /** A video or song started in one of his tabs (the pop-out gets ready ahead, popoutipc.ts). */
  onPlaying: (() => void) | null = null;
  /** Right-click "Play in the pop-out" on a link. */
  onPlayInPopout: ((url: string) => void) | null = null;
  popTab: ((id: number) => void) | null = null;
  /** Right-click "Pop out this video": the same as the pop-out key (popoutipc.ts). */
  setPopTab(fn: (id: number) => void): void { this.popTab = fn; }
  planSeq = 0;
  planWait = new Map<string, (a: PlanAnswer | null) => void>();
  /** Which card each planned job showed, for its live checklist. */
  planOfJob = new Map<number, string>();
  /** The driver page he is watching in the page area (a live picture), or none. */
  /** History (2026-10-12): every page he opened, 90 days, only on this PC. */
  visits: Visits;
  /** Downloads (2026-10-12): the list behind the tray and the Downloads page; the live ones and how far along they are. */
  dls: Downloads;
  readonly live = new Map<number, Electron.DownloadItem>();
  readonly got = new Map<number, { got: number; total: number; rate: number }>();
  /** The tray holds only downloads since this: the browser opening, or his Clear list. */
  traySince = Date.now();
  trayTimer: NodeJS.Timeout | null = null;
  dlSendTimer: NodeJS.Timeout | null = null;
  /** The mouse's side buttons can arrive twice (window and page): one press, one step. */
  lastNav = 0;
  /**
   * Sheet 47 (2026-10-21): the mockups Claude opens. The versioned page server and the history file; both
   * null where there is no git repo , and then the whole feature quietly stays off.
   */
  mockServer: MockServer | null = null;
  mockStore: MockStore | null = null;
  mockRepo = '';
  mockReady: Promise<number> = Promise.resolve(0);
  /** Things waiting for the window to finish opening (a mockup opened while Samara was closed). */
  whenOpen: (() => void)[] = [];
  constructor(o: BrowserOptions) {
    this.o = o;
    trouble.on('gone', (wc: Electron.WebContents) => this.troubleShot('gone', wc));
    trouble.on('hang', (wc: Electron.WebContents) => this.troubleShot('hang', wc));
    this.ses = electronSession.fromPartition('persist:samara');
    // The computer sleeping is not him ignoring his tabs (2026-10-30, stability check): time asleep never counts toward
    // freezing or sleeping a tab, else every tab went to sleep at once the moment he came back.
    powerMonitor.on('suspend', () => { this.suspendedAt = Date.now(); });
    powerMonitor.on('resume', () => {
      const gap = this.suspendedAt ? Date.now() - this.suspendedAt : 0; this.suspendedAt = 0;
      if (gap > 0) for (const t of this.tabs) t.lastSeen += gap;
      this.idleQuietUntil = Date.now() + 90_000;
    });
    // Prime from home (2026-11-03): on the PC, Prime's addresses go out through the MacBook (homeroute.ts).
    if (process.platform === 'win32') void routeHome(this.ses, o.stateDir, (s) => console.log('shell: ' + s)).catch((e: Error) => console.error('shell: prime from home: ' + e.message));
    const repo = findRepo(o.repoDir ?? path.join(import.meta.dirname, '..', '..', '..'));
    if (repo || o.mockupsAnywhere) {
      this.mockRepo = repo ?? '';
      // 2026-10-22: pages from another session's repo are served too, found by the name kept in mockups.json.
      this.mockThumbs = path.join(o.stateDir, 'mockthumbs');
      this.mockServer = new MockServer(repo ?? '', (n) => this.mockStore?.repoPath(n) ?? null, this.mockThumbs);
      this.mockStore = new MockStore(path.join(o.stateDir, 'mockups.json'));
      this.mockReady = this.mockServer.start();
      // 2026-10-31 : every mockup kept in one private repo, ~/projects/mockups (mockhome.ts). Samara's own art
      // for its sheets there comes from Samara; Claude's commits made while Samara was off are filed a moment after start.
      this.mockHomeWant = o.mockHome ?? '';
      this.mockSeenFile = path.join(o.stateDir, 'mockhome-seen.json');
      this.mockHomeAdopt();
      // The tidy (2026-10-22): at most once a day, a while after start, plain code only (no quota, no Qwen).
      setTimeout(() => { void this.mockTidy(false); }, 30_000).unref?.();
    }
    this.session = new SessionStore(path.join(o.stateDir, 'browser-tabs.json'));
    this.pausedFile = path.join(o.stateDir, 'adblock-paused.json');
    this.devices = new DeviceOk(path.join(o.stateDir, 'device-ok.json'));
    this.prefsFile = path.join(o.stateDir, 'browser-prefs.json');
    this.localFile = path.join(o.stateDir, 'browser-local.json');
    const l = readJson<{ tabSize?: unknown } | null>(this.localFile, null); if (l?.tabSize === 's' || l?.tabSize === 'm') this.tabSize = l.tabSize;   // none: Large
    this.placeFile = path.join(o.stateDir, 'browser-window.json');
    // Plugging the monitor in or out: Samara goes back to where it was the last time this setup was in use.
    const setupChanged = () => setTimeout(() => this.backToSetupSpot(), 700);
    screen.on('display-added', setupChanged); screen.on('display-removed', setupChanged);
    this.marksFile = path.join(o.stateDir, 'browser-bookmarks.json');
    this.iconsFile = path.join(o.stateDir, 'browser-favicons.json');
    for (const [h, d] of Object.entries(readJson<Record<string, unknown>>(this.iconsFile, {}))) if (typeof d === 'string' && d.startsWith('data:image/')) this.icons.set(h, d);
    setTimeout(() => { void this.fillMarkIcons(); }, 5000);
    this.popupOkFile = path.join(o.stateDir, 'browser-popups-ok.json');
    this.stashFile = path.join(o.stateDir, 'browser-stash.json');
    try {
      const a = readJson<unknown>(this.stashFile, null);
      if (Array.isArray(a)) this.stash = a.filter((s: Partial<Stashed>) => Number.isInteger(s?.id) && typeof s?.name === 'string' && Array.isArray(s?.tabs)).slice(0, 50)
        .map((s: Stashed) => ({ id: s.id, name: s.name.slice(0, 24), at: Number(s.at) || 0, tabs: s.tabs.filter((t) => typeof t?.url === 'string' && isWeb(t.url)).slice(0, 80).map((t) => ({ url: t.url, title: String(t.title ?? t.url).slice(0, 200) })) }));
    } catch { /* none yet */ }
    this.earlier = new EarlierStore(path.join(o.stateDir, 'browser-earlier.json'), () => { if (this.restored) { this.sync?.changed('prefs'); this.sendTabs(); } });
    this.railMove(o.stateDir);
    setSearch(this.prefs.search, this.prefs.aiBox);
    this.vault = new Vault();
    this.sitesFile = path.join(o.stateDir, 'vault-sites.json');
    // Autofill (sheet 77): his details and his PIN's seal, both kept with the Keychain.
    this.details = new DetailsStore(path.join(o.stateDir, 'autofill-details.json'));
    this.pinSeal = new PinSeal(path.join(o.stateDir, 'autofill-pin.json'));
    this.vault.keepSealed = () => this.pinSeal.has();
    this.vault.setLockAfter(LOCK_AFTER[this.prefs.lockAfter]);
    const ok = readJson<unknown[] | null>(this.popupOkFile, null, (a) => Array.isArray(a) ? a : null);
    if (ok) this.popupOk = new Set(ok.filter((x): x is string => typeof x === 'string'));
    try {
      const v = readJson<{ keyLocked?: unknown; key?: unknown; sites?: unknown } | null>(this.sitesFile, null);
      const key = typeof v?.keyLocked === 'string' ? unlockKey(v.keyLocked) : typeof v?.key === 'string' ? v.key : '';
      if (key && Array.isArray(v?.sites)) { this.siteKey = key; this.sites = new Set(v.sites.filter((x: unknown) => typeof x === 'string')); }
      // An older file kept the key in plain text beside the list: lock it now (Windows), the list stays the same.
      if (typeof v?.key === 'string' && key) { const locked = lockKey(key); if (locked) writeFileAtomic(this.sitesFile, JSON.stringify({ keyLocked: locked, sites: [...(this.sites ?? [])] })); }
    } catch { /* none yet */ }
    // Chromium's own name, for the sign-in pages that need it (arm() gives everything else plain Chrome's).
    this.honestUA = this.ses.getUserAgent();
    try {
      const a = readJson<unknown>(this.marksFile, null);
      if (Array.isArray(a)) this.marks = a.filter((m: Partial<Mark>) => typeof m?.url === 'string' && isWeb(m.url) && typeof m.title === 'string')
        .map((m: Mark) => ({ title: m.title.slice(0, 200), url: m.url, folder: String(m.folder ?? '').slice(0, 80) })).slice(0, 5000);
    } catch { /* none yet */ }
    // Sheet 89 : Stremio on normal Samara's shelf, once, where its app is installed (he can take it off for good).
    if (existsSync(STREMIO_APP)) {
      const mark = path.join(o.stateDir, 'stremio-shelf.json');
      if (!existsSync(mark)) {
        if (!this.marks.some((m) => STREMIO_WEB.test(m.url))) { this.marks.unshift({ title: 'Stremio', url: 'https://web.stremio.com/', folder: '' }); setTimeout(() => this.saveMarks(), 0); }
        try { writeFileAtomic(mark, JSON.stringify({ at: new Date().toISOString() })); } catch { /* tries again next start */ }
      }
      // its own icon, the large one from its site, not the tiny favicon
      if (!this.icons.has('web.stremio.com')) setTimeout(() => { void this.keepIcon('web.stremio.com', ['https://web.stremio.com/images/icon_196x196.png']); }, 4000);
    }
    this.httpOkFile = path.join(o.stateDir, 'browser-http-ok.json');
    this.trustedFile = path.join(o.stateDir, 'download-trusted.json');
    this.visits = new Visits(path.join(o.stateDir, 'browser-history.json'));
    this.rules = new SiteRules(path.join(o.stateDir, 'site-rules.json'), () => { this.sync?.changed('prefs'); this.sendTabs(); this.pushSettings(); });
    this.driver = new Driver({ ses: this.ses, preload: o.tabPreloadPath, listed: (u) => this.listed(u), changed: () => { this.sendTabs(); this.saveClaudeSoon(); }, stopped: (j) => this.onDriverStop?.(j), testLocal: o.testLocal === true, stateDir: o.stateDir,
      rules: { ai: (u) => this.rules.ai(u), login: (u) => this.rules.login(u) },
      tabFor: (t) => this.claudeTab(t.url, t.guest), closeTab: (id) => { if (this.tabs.some((x) => x.id === id)) { this.jobClosing.add(id); this.close(id, false); } },
      held: (page) => this.hands.has(page), drawn: (tab, fn) => this.drawnFor(tab, fn) });
    this.dls = new Downloads(path.join(o.stateDir, 'browser-downloads.json'));
    const loadSet = (f: string) => { const a = readJson<unknown>(f, null); return Array.isArray(a) ? new Set<string>(a.filter((x: unknown) => typeof x === 'string')) : new Set<string>(); };
    this.httpOk = loadSet(this.httpOkFile);
    this.trusted = loadSet(this.trustedFile);
    this.peerTrusted = loadSet(this.trustedFile.replace(/\.json$/, '-other.json'));
    this.peerHttp = loadSet(this.httpOkFile.replace(/\.json$/, '-other.json'));
    try {
      const p = readJson<any>(this.prefsFile, null);
      if (p !== null) {
        this.sounds = p?.sounds === true;
        this.prefs = { ads: p?.ads !== false, popups: p?.popups !== false, home: typeof p?.home === 'string' && isWeb(p.home) ? p.home.slice(0, 2000) : DEFAULT_HOME,
          search: ['ddg', 'google'].includes(p?.search) ? p.search : 'brave', aiBox: p?.aiBox !== false, startup: p?.startup === 'home' ? 'home' : 'tabs',
          dark: p?.dark !== false, darkOff: hostList(p?.darkOff), afSounds: p?.afSounds !== false, lockAfter: lockPick(p?.lockAfter) };
      }
    } catch { /* defaults */ }
    this.colorScheme();
    this.phish = o.phish ?? new PhishCheck(o.stateDir);
    if (!o.phish) void this.phish.start();
    this.sb = new SafeBrowsing(o.stateDir); this.sb.start();
    try { this.paused = new Set(readJson<Iterable<string>>(this.pausedFile, [])); } catch { /* none paused */ }
    this.wall = new CookieWall(o.stateDir);
    this.arm();
    this.callFile = path.join(o.stateDir, 'in-call.json');
    try { unlinkSync(this.callFile); } catch { /* none left over */ }
  }

  /** Everything a browsing session needs: plain Chrome's name, the asks, downloads, logins kept, the guards and the ad
   *  lists. */
  arm(): void {
    const ses = this.ses;
    // Plain Chrome, everywhere in his browsing session, except Google's sign-in pages (above).
    ses.setUserAgent(CHROME_UA(process.versions.chrome));
    // His data kept his (2026-10-26, privacy.ts): the honest name where it is needed, "do not sell my data" on every
    // request, hidden sites' cookies left off, tracking tags taken off links.
    guardPrivacy(ses, this.wall, (u) => HONEST_REQUESTS.test(u) ? this.honestUA : null, () => this.brands);
    privacyHooks(ses, { clean: cleanLink, headers: cookieHeaders(this.wall) });
    denyPermissions(ses);
    this.permissions();
    this.signIns();
    this.screenShare();
    this.hid();
    this.spelling();
    this.downloads();
    // Stay signed in (2026-10-13: Reddit logged him out). Chromium keeps new and changed cookies in
    // memory and writes them to disk in batches, so a hard stop of the Shell throws away whatever had not been
    // written yet - and a login cookie is exactly the kind that changes quietly. Nothing in the companion ever deletes a
    // cookie; they were simply lost. So every change is written within two seconds, and once more on the way out.
    let cookieWrite: NodeJS.Timeout | null = null;
    ses.cookies.on('changed', (_e, cookie, cause, removed) => {
      // M6: a login changed here; the other machine's browser gets it. Removals only when something removed it on
      // purpose (a sign-out, a site clearing it): an expired cookie expires on its own on the other machine too.
      if (!removed || cause === 'explicit') this.sync?.cookie(cookie as SyncCookie, removed);
      if (cookieWrite) clearTimeout(cookieWrite);
      cookieWrite = setTimeout(() => { cookieWrite = null; ses.cookies.flushStore().catch(() => { /* next change tries again */ }); }, 2000);
    });
    // A web page never reaches this computer or the home network (2026-10-14): on before the ad lists load.
    guardRequests(ses, netGuard, null);
    // His paused sites and the call sites go in with the lists, built into the kept engine (speed check 2026-10-24).
    void blockAds(ses, this.o.stateDir, { cosmetic: true, guard: netGuard, paused: [...this.paused, ...CALL_SITES] }).then((b) => {
      this.ads = b; if (b && !this.prefs.ads) b.stop();
    });
  }

  /**
   * 6.22, the asks (sheet 3 section 5). Fullscreen just works; camera and microphone ask through the chip that
   * hangs from the band, for this call only, never "always"; notifications, location and everything else are
   * refused without asking, because nothing he does needs them.
   */
  permissions(): void {
    this.ses.setPermissionRequestHandler((wc, permission, done, details) => {
      if (permission === 'fullscreen') { done(true); return; }
      this.inWc(wc);
      // Sharing the screen: the picker below is the real ask, every time, so Chromium's own gate just lets it reach it.
      if (permission === 'display-capture') { done(!this.driver?.owns(wc)); return; }
      // Notifications (2026-11-25, his ask): asked once per site and his answer kept, as in Chrome (Allow / Block, changed
      // later from the shield or Settings > Your sites). Only a secure page asking for itself (never a frame from another
      // site inside it, as in Chrome), never Claude's tabs.
      if (permission === 'notifications') { this.notifyAsk(wc, (details as { requestingUrl?: string }).requestingUrl || wc.getURL(), done); return; }
      if (permission === 'speaker-selection') { const top = hostOf(wc.getURL()); done(!this.driver?.owns(wc) && Boolean(this.mediaOk.get(grantKey(hostOf((details as { requestingUrl?: string }).requestingUrl || wc.getURL()), top))?.has('audio'))); return; }
      if (permission !== 'media' || !this.win || this.win.isDestroyed() || this.driver?.owns(wc)) { done(false); return; }
      const asked = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
      // A screen share arrives here first as "media" with no camera or microphone named (measured 2026-10-13,
      // Electron 44). Nothing is granted by letting it through: the picker below is where he says yes or no.
      // (Phase 1 audit note: this ask comes before the picker, so there is nothing yet to tell a share from a camera ask
      // with no types. Kept as measured; the parity sweep watches it on each engine update.)
      if (!asked.length) { done(true); return; }
      const types = asked.filter((x) => x === 'audio' || x === 'video');
      const host = hostOf((details as { requestingUrl?: string }).requestingUrl || wc.getURL());
      if (!host || !types.length) { done(false); return; }
      // Phase 1 (security audit): a grant belongs to this site inside this page, as in Chrome, not to the bare name, so
      // a zoom.us frame on another site never inherits a call he allowed on zoom.us.
      const key = grantKey(host, hostOf(wc.getURL()));
      // His rule for this site (sheet 37): Block never asks, Allow never asks; Ask is the old way, once per call.
      const said = types.map((x) => this.rules.media(host, x === 'video' ? 'camera' : 'mic'));
      if (said.includes('block')) { done(false); return; }
      if (said.every((x) => x === 'allow')) { const s = this.mediaOk.get(key) ?? new Set<string>(); for (const x of types) s.add(x); this.mediaOk.set(key, s); done(true); this.sendTabs(); return; }
      // Already allowed on this site during this call: no second ask.
      const ok = this.mediaOk.get(key);
      if (ok && types.every((x) => ok.has(x))) { done(true); return; }
      const what = types.includes('video') && types.includes('audio') ? 'Camera and microphone?' : types.includes('video') ? 'Your camera?' : 'Your microphone?';
      const top = hostOf(wc.getURL());
      const text = `${host}${top && top !== host ? ` (inside ${top})` : ''} wants it for what you are doing now. It stops when you leave the site.`;
      this.ask({ host, what, text, icon: types.includes('video') ? 'camera' : 'mic' }, (allow) => {
        if (allow) { const s = this.mediaOk.get(key) ?? new Set<string>(); for (const x of types) s.add(x); this.mediaOk.set(key, s); }
        done(allow);
        if (allow) this.sendTabs();             // the tab becomes a call tab at once
      });
    });
    // Calls ask "may I?" before they ask for real (Teams, Zoom). Yes only where he already said yes, on this site.
    this.ses.setPermissionCheckHandler((wc, permission, origin, details) => {
      if (permission === 'fullscreen') return true;
      // Sheet 69: a site may ask for a keyboard or mouse (the ask below is the real gate); never Claude's tabs, never http.
      if (permission === 'hid') return Boolean(wc && !this.driver?.owns(wc) && /^https:\/\//.test(origin));
      if (permission === 'notifications') return Boolean(wc && !this.driver?.owns(wc) && notifyOrigin(origin, wc.getURL()) && this.rules.notify(hostOf(origin)) === 'allow');
      if ((permission !== 'media' && permission !== 'speaker-selection') || (wc && this.driver?.owns(wc))) return false;
      const t0 = (details as { mediaType?: string }).mediaType;
      if (permission === 'media' && (t0 === 'audio' || t0 === 'video')) { const r = this.rules.media(hostOf(origin), t0 === 'video' ? 'camera' : 'mic'); if (r === 'block') return false; if (r === 'allow') return true; }
      // The page it is inside: the embedding origin, else the tab's own page.
      const top = hostOf((details as { embeddingOrigin?: string }).embeddingOrigin || (wc ? wc.getURL() : '') || origin);
      const ok = this.mediaOk.get(grantKey(hostOf(origin), top));
      if (!ok) return false;
      // Picking which speakers the call plays through comes with the microphone, as in Chrome.
      if (permission === 'speaker-selection') return ok.has('audio');
      const t = (details as { mediaType?: string }).mediaType;
      return t === 'audio' || t === 'video' ? ok.has(t) : ok.size > 0;
    });
  }

  /** Sites with a notifications ask on screen now: one ask per site, however often it asks. */
  private notifyAsking = new Map<string, ((allow: boolean) => void)[]>();
  /** A site asked to show desktop notifications: his kept answer, else one ask (kept once he answers). */
  notifyAsk(wc: Electron.WebContents, requestingUrl: string, done: (allow: boolean) => void): void {
    if (this.driver?.owns(wc) || !notifyOrigin(requestingUrl, wc.getURL())) { done(false); return; }
    const host = hostOf(requestingUrl);
    const said = this.rules.notify(host);
    if (said !== 'ask') { done(said === 'allow'); return; }
    const waiting = this.notifyAsking.get(host);
    if (waiting) { waiting.push(done); return; }
    this.notifyAsking.set(host, [done]);
    this.inWc(wc);
    this.ask({ host, what: 'Show notifications?', icon: 'bell', yes: 'Allow', no: 'Block',
      text: `${host} wants to show desktop notifications (new messages, reminders). Your answer is kept; change it any time from the shield.` }, (allow, timedOut) => {
      const all = this.notifyAsking.get(host) ?? [];
      this.notifyAsking.delete(host);
      // The ask closing by itself (two minutes, no answer) keeps nothing: the site may ask again another time.
      if (!timedOut) this.rules.set(host, { notify: allow ? 'allow' : 'block' });
      for (const d of all) d(allow);
      this.sendTabs();
    });
  }
  /** A click on one of a page's desktop notifications: Samara and that tab come to the front, at most once a second. */
  private notifyClickAt = 0;
  notifyClick(sender: Electron.WebContents): void {
    const t = this.tabs.find((x) => x.view?.webContents === sender);
    if (!t || Date.now() - this.notifyClickAt < 1000 || this.rules.notify(hostOf(sender.getURL())) !== 'allow') return;
    this.notifyClickAt = Date.now();
    const w = this.paneOfTab(t)?.win;
    if (!w || w.isDestroyed()) return;
    bringFront(w);
    this.inTab(t);
    this.activate(t.id);
  }
  /**
   * Sheet 69 (2026-10-22): a site that asks for a keyboard or mouse (WebHID: Epomaker's lighting page) gets a
   * parchment ask hanging from the band, listing only the devices the site asked for; he picks one and it is remembered
   * for that site, so next time it connects with no ask. Forget in the shield takes it back. Claude's tabs never get one.
   */
  hid(): void {
    this.ses.setDevicePermissionHandler((d) => d.deviceType === 'hid' && this.devices.allowed(hostOf(d.origin), d.device as Electron.HIDDevice));
    this.ses.on('select-hid-device', (event, details, done) => {
      event.preventDefault();
      const frame = details.frame;
      const wc = frame ? allWebContents.fromFrame(frame) : undefined;
      const origin = frame?.origin ?? '';
      const host = hostOf(origin);
      if (!wc || this.driver?.owns(wc) || !/^https:\/\//.test(origin) || !host || !this.win || this.win.isDestroyed()) { done(); return; }
      // No ask only when the one he allowed is the only match (2026-10-22, his TH99 PRO: with the dongle allowed and the
      // keyboard's cable plugged in too, the dongle was taken without asking and the cable keyboard never offered).
      const known = details.deviceList.find((d) => this.devices.allowed(host, d));
      if (known && details.deviceList.length === 1) { done(known.deviceId); return; }
      if (this.devAsk) { done(); return; }                       // one ask at a time
      this.inWc(wc);
      // Sheet 106: a "needs you" notice from the shield; the devices are picked on its parchment.
      const id = this.notices.push(cleanNotice(this.devNotice(host, [...details.deviceList], known?.deviceId ?? null)), (act, value) => this.devAnswer(id, act === 'allow' && value ? value : null));
      const timer = setTimeout(() => this.devAnswer(id, null), 120_000);
      this.devAsk = { id, host, list: [...details.deviceList], done, timer, picked: known?.deviceId ?? null };
    });
    // Plugged in or out while the ask is up: the list follows.
    this.ses.on('hid-device-added', (_e, d) => { if (this.devAsk && !this.devAsk.list.some((x) => x.deviceId === d.device.deviceId)) { this.devAsk.list.push(d.device); this.sendDevAsk(); } });
    this.ses.on('hid-device-removed', (_e, d) => { if (this.devAsk) { this.devAsk.list = this.devAsk.list.filter((x) => x.deviceId !== d.device.deviceId); this.sendDevAsk(); } });
  }
  sendDevAsk(): void {
    const a = this.devAsk;
    if (a) this.notices.update(a.id, cleanNotice(this.devNotice(a.host, a.list, a.picked)));
  }
  /** The device ask as a notice: only the devices the site asked for, the one allowed last time already picked. */
  devNotice(host: string, list: Electron.HIDDevice[], picked: string | null): NoticeIn {
    // How it is connected, from its own name (a wireless one calls itself a receiver or dongle); a cable otherwise.
    const how = (d: Electron.HIDDevice) => (/2\.4g|dongle|receiver|wireless/i.test(d.name) ? 'Wireless dongle' : 'Plugged in by cable');
    return { kind: 'need', from: 'shield', icon: 'keyboard', kick: `${host || 'This site'} wants`, title: list.length ? 'One of your devices' : 'A keyboard or mouse',
      rows: [{ g: '', v: list.length ? 'It wants to talk to one device. Pick it.' : 'None that it can use is plugged in.' }],
      picks: list.map((d) => ({ id: d.deviceId, name: deviceName(d), how: how(d) })), picked,
      keys: [{ label: 'Allow', act: 'allow' }, { label: 'No', act: 'no', plain: true }] };
  }
  /** His pick from the device ask: one of the devices it listed, or none. */
  devAnswer(id: number, deviceId: string | null): void {
    const a = this.devAsk;
    if (!a || a.id !== id) return;
    this.devAsk = null;
    clearTimeout(a.timer);
    this.notices.drop(id);
    const d = deviceId ? a.list.find((x) => x.deviceId === deviceId) : undefined;
    if (d) { this.devices.add(a.host, d); this.sendTabs(); }
    a.done(d?.deviceId);
  }
  /** Forget in the shield: this site asks again next time. */
  forgetDevice(key: string): void {
    const t = this.tabs.find((x) => x.id === this.active);
    const host = hostOf(t?.url ?? '');
    if (!host || !this.devices.list(host).some((x) => x.key === key)) return;
    this.devices.forget(host, key);
    this.sendTabs();
  }

  /**
   * 6.24: sharing his screen in a call. The site never chooses: he picks one screen or one window in a panel that
   * hangs from the band, every time, and his own sound goes only if he ticks it. Unanswered in 2 minutes means no.
   * the companion's own pages can never share anything.
   */
  screenShare(): void {
    this.ses.setDisplayMediaRequestHandler((req, done) => {
      const deny = () => { try { done(null); } catch { /* the page went away */ } };
      let wc: Electron.WebContents | undefined;
      try { wc = req.frame ? allWebContents.fromFrame(req.frame) : undefined; } catch { wc = undefined; }
      if (wc) this.inWc(wc);
      if (!wc || this.driver?.owns(wc) || !req.videoRequested || !this.win || this.win.isDestroyed() || this.share) { deny(); return; }
      const host = hostOf(req.securityOrigin) || hostOf(wc.getURL());
      const P = this.pane;
      void desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } }).then((list) => {
        this.pane = P;
        if (!this.win || this.win.isDestroyed() || this.share) { deny(); return; }
        // None of the companion's own browser windows can be shared.
        const own = new Set(this.panes.filter((p) => this.alive(p)).map((p) => p.win!.getMediaSourceId()));
        const sources = list.filter((s) => s.name.trim() && !own.has(s.id));
        if (!sources.length) { deny(); return; }
        const id = ++this.askSeq;
        const timer = setTimeout(() => this.shareAnswer(id, null, false), 120_000);
        this.share = { id, host, sources: new Map(sources.map((s) => [s.id, s])), audio: req.audioRequested, done, timer };
        this.win.webContents.send('browser:share', {
          id, host, audio: req.audioRequested,
          sources: sources.map((s) => ({ id: s.id, name: s.name.slice(0, 120), kind: s.id.startsWith('screen:') ? 'screen' : 'window', thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL() })),
        });
      }, deny);
    });
  }
  /** In a call right now? Restarting the browser would drop it, so the update key waits and so must anything else. */
  inCall = false;
  callFile = '';
  callNow(on: boolean): void {
    if (on === this.inCall) return;
    this.inCall = on;
    console.log(`shell: browser: ${on ? 'a call started' : 'no call now'}`);
    try { if (on) writeFileAtomic(this.callFile, JSON.stringify({ since: new Date().toISOString() })); else unlinkSync(this.callFile); } catch { /* best effort */ }
    this.onCall?.(on);
    if (!on) sched.wake();                            // background jobs held for the call go now
  }
  /** 6.28: a tested engine waiting for his Restart now (the update key), or null. */
  update: UpdateCard | null = null;
  setUpdate(u: UpdateCard | null): void { this.update = u; this.sendTabs(); }
  /** The companion's bubble line about an update was clicked (2026-11-01): the update card opens, once the window has its page. */
  openUpdate(): void {
    const tell = (n: number) => {
      const w = this.lastPane()?.win;
      if (w && !w.isDestroyed() && !w.webContents.isLoading()) w.webContents.send('browser:openupdate');
      else if (n < 20) setTimeout(() => tell(n + 1), 250);
    };
    setTimeout(() => tell(0), 300);
  }
  /** After an update put in overnight: what it did, shown once by the ... key (sheet 35). */
  updated: { title: string; lines: string[] } | null = null;
  setUpdated(d: { title: string; lines: string[] } | null): void { this.updated = d; this.sendTabs(); }
  /** Sheet 122: what his "Check for updates" is doing (checking, downloading, setting up, how it ended), or null. */
  checking: CheckProgress | null = null;
  setChecking(c: CheckProgress | null): void { this.checking = c; this.sendTabs(); }
  /** Why Restart now did not go ahead, in the update tray. */
  updateWhy(why: string): void { for (const p of this.panes) if (this.alive(p)) p.win!.webContents.send('browser:updatewhy', why); }
  /** The browser window is open. */
  get showing(): boolean { return this.panes.some((p) => this.alive(p)); }
  /** Told when a call starts or ends (the update key). */
  onCall?: (on: boolean) => void;
  /** His pick from the share panel: one of the sources it showed, or nothing. */
  shareAnswer(id: number, sourceId: string | null, sound: boolean): void {
    const s = this.share;
    if (!s || s.id !== id) return;
    this.share = null;
    clearTimeout(s.timer);
    const src = sourceId ? s.sources.get(sourceId) : undefined;
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('browser:share', { id, gone: true });
    try { s.done(src ? { video: src, ...(s.audio && sound ? { audio: 'loopback' as const } : {}) } : null); } catch { /* the page went away */ }
    if (src && s.host) { this.shareHosts.add(s.host); this.sendTabs(); }
  }

  /**
   * 6.24 spellcheck: Canadian and American English, like Chrome's. Chromium fetches the word lists from Google's
   * own dictionary server the first time, exactly as Chrome does. Suggestions are in the right-click menu.
   */
  spelling(): void {
    try {
      const want = ['en-CA', 'en-US'].filter((l) => this.ses.availableSpellCheckerLanguages.includes(l));
      if (want.length) this.ses.setSpellCheckerLanguages(want);
      this.ses.setSpellCheckerEnabled(true);
    } catch { /* no spellcheck is better than no browser */ }
  }
  /** Work in the window of the tab this page is in (a site asking for something). */
  inWc(wc: Electron.WebContents): void { const t = this.tabs.find((x) => x.view?.webContents === wc); if (t) this.inTab(t); }
  /**
   * Ask him, as a "needs you" notice dropping from what it is about (sheet 106 v7: the shield, the download key,
   * Claude's rune), with its one sound, and wait for his answer. Unanswered in 2 minutes means no.
   */
  ask(a: { host: string; what: string; text?: string; yes?: string; no?: string; from?: NoticeFrom; kick?: string; icon?: string; claude?: boolean }, done: (allow: boolean, timedOut?: boolean) => void): void {
    if (!this.win || this.win.isDestroyed()) { done(false); return; }
    let timer: NodeJS.Timeout | null = null;
    const id = this.notices.push(cleanNotice({
      kind: 'need', from: a.from ?? 'shield', kick: a.kick ?? `${a.host || 'This site'} wants`, title: a.what || 'Allow this?',
      ...(a.icon ? { icon: a.icon } : {}), ...(a.claude ? { claude: true } : {}),
      rows: [{ g: '', v: a.text || `${a.host || 'This site'} wants it for what you are doing now. You are asked again next time.` }],
      keys: [{ label: a.yes || 'Allow', act: 'yes' }, { label: a.no || 'No', act: 'no', plain: true }],
    }), (act) => { if (timer) clearTimeout(timer); done(act === 'yes'); });
    timer = setTimeout(() => { this.notices.drop(id); done(false, true); }, 120_000);
  }
  /**
   * A small window's place: centred over Samara's window (the one in front), kept fully inside that screen's work area.
   * With no Samara window, the screen the mouse is on.
   */
  overWindow(width: number, height: number): { x: number; y: number; width: number; height: number } {
    const w = this.win && !this.win.isDestroyed() ? this.win : null;
    const b = w ? w.getBounds() : null;
    const area = b ? screen.getDisplayMatching(b).workArea : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    return fitIn(area, { width, height, x: b ? b.x + (b.width - width) / 2 : area.x + (area.width - width) / 2, y: b ? b.y + (b.height - height) / 2 : area.y + (area.height - height) / 2 });
  }
  /** Is this page one of this browser's own (its tabs and their popups), never another window's or Claude's? */
  mine(wc: Electron.WebContents | null | undefined): wc is Electron.WebContents {
    return Boolean(wc && !wc.isDestroyed() && wc.session === this.ses && !this.driver?.owns(wc));
  }
  /**
   * Phase 1 (parity sweep 2026-11-12): the sign-ins Electron cancels by itself.
   * - HTTP Basic/Digest and proxy sign-in (routers, printers, intranets): a small sign-in box of Samara's own. Two wrong
   *   tries in a row on the same site end it, as Chrome does, rather than looping.
   * - Client certificates: he picks which one (Electron otherwise hands the site the first one silently), or none.
   */
  signIns(): void {
    const tries = new Map<string, number>();
    app.on('login', (e, wc, details, auth, cb) => {
      if (!this.mine(wc)) return;                               // another window's, or Claude's: cancelled as before
      e.preventDefault();
      const host = auth.isProxy ? `${auth.host}:${auth.port}` : hostOf(details.url) || auth.host;
      const n = (tries.get(host) ?? 0) + 1; tries.set(host, n);
      if (n > 3) { tries.delete(host); cb(); return; }
      this.signinBox({ host, realm: auth.realm, proxy: auth.isProxy, secure: /^https:/i.test(details.url) || auth.isProxy, again: n > 1 }, (user, pass) => {
        if (user === null) { tries.delete(host); cb(); return; }
        cb(user, pass ?? '');
      });
    });
    app.on('select-client-certificate', (e, wc, url, list, cb) => {
      if (!this.mine(wc)) return;
      e.preventDefault();
      if (!list.length) { cb(); return; }
      const host = hostOf(url);
      const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
      const id = this.notices.push(cleanNotice({ kind: 'need', from: 'shield', icon: 'key', kick: `${host || 'This site'} asks`, title: 'Which certificate?',
        rows: [{ g: '', v: 'It wants to know who you are from a certificate on this computer. Pick one, or none.' }],
        picks: list.slice(0, 8).map((c) => ({ id: c.fingerprint, name: (c.subject?.commonName || c.subjectName || 'Certificate').slice(0, 100), how: `${c.issuer?.commonName || c.issuerName || ''} · until ${day(c.validExpiry)}`.slice(0, 100) })),
        picked: list.length === 1 ? list[0]!.fingerprint : null,
        keys: [{ label: 'Use it', act: 'allow' }, { label: 'None', act: 'no', plain: true }] }), (act, value) => {
        clearTimeout(timer);
        const c = act === 'allow' && value ? list.find((x) => x.fingerprint === value) : undefined;
        if (c) cb(c); else cb();
      });
      const timer = setTimeout(() => { this.notices.drop(id); cb(); }, 120_000);
    });
  }
  /** The sign-in box: one small window over his browser per ask; his answer once, or null when he cancels or closes it. */
  signinBox(m: { host: string; realm: string; proxy: boolean; secure: boolean; again: boolean }, done: (user: string | null, pass: string | null) => void): void {
    const parent = this.win && !this.win.isDestroyed() ? this.win : undefined;
    if (!parent) { done(null, null); return; }
    const w = new BrowserWindow({ parent, modal: true, width: 400, height: 330, resizable: false, minimizable: false, maximizable: false, frame: false,
      show: false, backgroundColor: '#100A22', title: 'Sign in',
      webPreferences: { ...SAFE_WEB_PREFERENCES, preload: path.join(path.dirname(this.o.preloadPath), 'signinpreload.cjs') } });
    lockDown(w.webContents);
    let answered = false;
    const finish = (user: string | null, pass: string | null) => {
      if (answered) return; answered = true;
      ipcMain.removeListener('signin:answer', onAnswer);
      if (!w.isDestroyed()) w.close();
      done(user, pass);
    };
    const onAnswer = (e: Electron.IpcMainEvent, user: unknown, pass: unknown) => {
      if (w.isDestroyed() || e.sender !== w.webContents) return;   // only this box's own page answers this ask
      finish(typeof user === 'string' && user ? user : null, typeof pass === 'string' ? pass : null);
    };
    ipcMain.on('signin:answer', onAnswer);
    w.on('closed', () => finish(null, null));
    w.webContents.once('did-finish-load', () => { if (!w.isDestroyed()) { w.webContents.send('signin:show', m); w.show(); } });
    void w.loadURL(`${this.o.origin}/signin.html`).catch(() => finish(null, null));
  }
  /**
   * 6.22b bug 1: a page's own full screen (a video's button) fills the whole screen, band and drawer gone; it comes back
   * exactly as it was when the page leaves full screen (its button, Esc, F11, or the page dying).
   */
  pageFullOn(tab: Tab, view: WebContentsView): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    this.fullTab = tab.id;
    fullLeaving.delete(w);
    try { view.setBorderRadius(0); } catch { /* square anyway */ }
    // The hint once the window really is full screen (the Mac animates into its own Space for most of a second).
    const hint = () => setTimeout(() => { if (!w.isDestroyed() && w.isFullScreen() && this.panes.some((p) => p.win === w && p.fullTab === tab.id)) this.fullHint(w); }, 0);
    if (w.isFullScreen()) hint(); else w.once('enter-full-screen', hint);
    w.setFullScreen(true);
    this.place();
  }
  pageFullOff(tab: Tab, view: WebContentsView): void {
    if (this.fullTab !== tab.id) return;
    this.fullTab = null;
    try { if (!view.webContents.isDestroyed()) view.setBorderRadius(PAGE_RADIUS); } catch { /* an older runtime, or gone */ }
    if (this.win && !this.win.isDestroyed()) leaveFull(this.win, 'a page left full screen');
    this.place();
  }
  /**
   * Phase 1: "Press Esc to leave full screen", over the page for a few seconds each time a page goes full screen.
   * 2026-11-18: it was a window of its own, a child of Samara's, made while the Mac was still animating into full
   * screen; from then on the Mac could keep Samara's window stuck in full screen (a black Space he could not leave).
   * It is now a view inside Samara's own window, on both machines: no second window, nothing the Mac's full screen has
   * to carry.
   */
  fullHint(w: BrowserWindow): void {
    try {
      const v = new WebContentsView({ webPreferences: { ...SAFE_WEB_PREFERENCES } });
      v.setBackgroundColor('#00000000');
      lockDown(v.webContents);
      const [cw] = w.getContentSize(), width = 420, height = 64;
      v.setBounds({ x: Math.max(0, Math.round((cw - width) / 2)), y: 24, width, height });
      v.setVisible(false);
      w.contentView.addChildView(v);
      let done = false;
      const gone = () => { if (done) return; done = true; try { if (!w.isDestroyed()) w.contentView.removeChildView(v); } catch { /* gone */ } try { if (!v.webContents.isDestroyed()) v.webContents.close(); } catch { /* gone */ } };
      // Its few seconds count from when it shows; a hint that never loads is gone after 8 s anyway.
      v.webContents.once('did-finish-load', () => { if (done || w.isDestroyed() || v.webContents.isDestroyed()) return; v.setVisible(true); setTimeout(gone, 3500); });
      void v.webContents.loadURL(`${this.o.origin}/fullhint.html`).catch(() => { /* no hint this time */ });
      setTimeout(gone, 8000);
      w.once('leave-full-screen', gone);
      w.once('closed', gone);
    } catch { /* full screen still works without the hint */ }
  }
  /** A link to an app (APP_LINKS): asked in the band, then handed to the system, which opens that app. */
  offerApp(tab: Tab, u: string): void {
    const app = appOf(u);
    if (!app) return;
    let host = '';
    try { host = new URL(tab.view?.webContents.getURL() ?? '').hostname.replace(/^www\./, ''); } catch { /* none */ }
    this.inTab(tab);
    this.ask({ host, what: `Open ${app}?`, text: `${host || 'This page'} wants to hand you over to ${app}.`, yes: 'Open it', no: 'No', icon: 'popup' }, (ok) => {
      if (ok) void shell.openExternal(u).catch((e) => this.note('', { kind: 'bad', from: 'shield', kick: app, title: 'Would not open', rows: [{ g: 'Why', v: (e as Error).message }] }));
    });
  }
  /** His answer to an ask (the notice's own buttons say it; this is the old door, kept for the harnesses). */
  answer(id: number, allow: boolean): void { this.notices.answer(id, allow ? 'yes' : 'no'); }

  /**
   * 6.22: downloads go to his Downloads folder and are marked as from the internet (the Mark of the Web),
   * so Windows Defender and SmartScreen check them before anything opens them, exactly as for Chrome.
   */
  downloads(): void {
    this.ses.on('will-download', (_e, item, wc) => {
      // The companion's own pages never download (decision 42: he reads and clicks; files are not his to fetch).
      if (wc && this.driver?.owns(wc)) { item.cancel(); return; }
      if (wc) this.inWc(wc);
      const dir = app.getPath('downloads');
      const base = safeName(item.getFilename());
      // The name is held until this download ends, so a second one with the same name never writes over it (downloads.ts).
      const to = this.savePaths.pick(dir, base);
      item.once('done', () => this.savePaths.release(to));
      item.setSavePath(to);
      const from = item.getURL();
      const fromSite = siteOfUrl(wc?.getURL() || from);
      const d = this.dls.start(to, fromSite, item.getTotalBytes());
      this.live.set(d.id, item);
      let lastGot = 0, lastAt = Date.now();
      item.on('updated', () => {
        const now = Date.now(), g = item.getReceivedBytes();
        const rate = now > lastAt ? ((g - lastGot) / (now - lastAt)) * 1000 : 0;
        const was = this.got.get(d.id)?.rate ?? rate;
        this.got.set(d.id, { got: g, total: item.getTotalBytes(), rate: was * 0.7 + rate * 0.3 });
        lastGot = g; lastAt = now;
        this.sendDownloads();
      });
      this.sendDownloads(true);
      // Decision 18: a program or a script from a site he has not trusted waits for one yes in a chip. The site
      // is the page he was on (a download often comes from some other server behind it). Unanswered = no.
      if (isRisky(base)) {
        // The page's site, and where the file itself came from (an ad on a trusted site could hand him a program from
        // anywhere): downloads.ts decides whether he is asked, and what he is told.
        const ask = programAsk({ page: fromSite, file: siteOfUrl(item.getURLChain?.().slice(-1)[0] || from), trusted: this.trusted, otherTrusts: this.peerTrusted });
        if (ask) {
          const { site, fileSite, text } = ask;
          item.pause();
          this.ask({ host: site, what: `Download ${base}?`, text, yes: 'Download, trust this site', no: 'No', from: 'dl', kick: 'A program', icon: 'wont' }, (allow) => {
            if (item.getState() !== 'progressing') return;
            if (!allow) { item.cancel(); return; }
            if (site) {
              this.trusted.add(site); this.peerTrusted.delete(site);
              if (fileSite && !sameSite(fileSite, site)) { this.trusted.add(fileSite); this.peerTrusted.delete(fileSite); }
              try { writeFileAtomic(this.trustedFile, JSON.stringify([...this.trusted])); writeFileAtomic(this.trustedFile.replace(/\.json$/, '-other.json'), JSON.stringify([...this.peerTrusted])); } catch { /* best effort */ }
              this.sync?.changed('prefs');
            }
            item.resume();
          });
        }
      }
      item.once('done', (_ev, state) => {
        if (state === 'completed') {
          // Marked "from the internet", so the system checks it before it runs: Windows' zone mark, or on the Mac
          // Apple's quarantine flag (Gatekeeper asks before opening it), the way Safari marks downloads (2026-10-14).
          if (process.platform === 'darwin') execFile('/usr/bin/xattr', ['-w', 'com.apple.quarantine', quarantineMark(), to], (e) => { if (e) console.error('shell: could not mark the download for Gatekeeper: ' + e.message); });
          else try { writeFileSync(to + ':Zone.Identifier', zoneMark(from)); }
          catch (e) { console.error('shell: could not mark the download for Defender: ' + (e as Error).message); }
        }
        this.live.delete(d.id); this.got.delete(d.id);
        d.state = state === 'completed' ? 'done' : state === 'cancelled' ? 'stopped' : 'failed';
        if (state === 'completed') { try { d.size = statSync(to).size; } catch { /* keep */ } }
        this.dls.save();
        this.sendDownloads(state === 'completed' ? 'pop' : true);
        if (state === 'completed') { this.win?.webContents.send('browser:download', { name: d.name, state, quiet: true }); this.dlNotice(d); }
        else if (state === 'interrupted') {
          // Sheet 106: red, from the download key, with Try again (the same address, from the same page when it is still there).
          this.note('', { kind: 'bad', from: 'dl', kick: 'Did not finish', title: d.name, files: [{ id: d.id, kind: kindOf(d.name), name: d.name, meta: `${d.site ? d.site + ' · ' : ''}Did not finish` }],
            keys: [{ label: 'Try again', act: 'retry' }, { label: 'Close', act: 'ok', plain: true }] }, (act) => {
            if (act !== 'retry' || !isWeb(from)) return;
            try { if (wc && !wc.isDestroyed()) wc.downloadURL(from); else this.ses.downloadURL(from); } catch { /* gone */ }
          });
        }
      });
    });
  }

  /** Is this address on a list, and has he not chosen to go anyway? Returns the lists, or none. */
  listed(u: string): string[] {
    try { if (this.letThrough.has(new URL(u).hostname)) return []; } catch { return []; }
    const lists = this.phish.check(u);
    if (lists.length) return lists;
    // Google already confirmed it (a page still waiting on Google is held in did-start-navigation instead).
    if (this.sb?.known(u)) return [SB_NAME];
    // On no list yet, but dressed up as a site he really uses (6.22's last piece).
    const real = lookalike(u);
    return real ? [LOOKS_LIKE + real.toUpperCase()] : [];
  }
  /**
   * His rule (2026-10-14): his bank never opens in Samara. Chrome gets safety fixes weeks sooner, so a bank or money
   * site gets a plate with one big "Open in Chrome" button instead of the page. Same stops as the fake-site lists.
   */
  stopFor(u: string): string[] { return isWeb(u) && bankSite(u) ? [BANK] : this.listed(u); }
  /** His bank, handed to Chrome (Safari on the Mac, Edge on Windows, if Chrome is not there). Web addresses only. */
  toChrome(u: string): void {
    let url = '';
    try { const x = new URL(u); if (x.protocol !== 'https:' && x.protocol !== 'http:') return; url = x.href; } catch { return; }
    const fail = (e: Error | null) => { if (e) this.note('', { kind: 'bad', from: 'shield', icon: 'globe', kick: 'Chrome', title: "Didn't open", rows: [{ g: 'Do this', v: 'Open your bank there yourself.' }] }); };
    if (process.platform === 'darwin') { execFile('open', ['-a', 'Google Chrome', url], (e) => { if (e) execFile('open', ['-a', 'Safari', url], fail); }); return; }
    const local = process.env.LOCALAPPDATA ?? '', pf = process.env.ProgramFiles ?? 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const chrome = [path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')].find((f) => existsSync(f));
    const edge = [path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')].find((f) => existsSync(f));
    const exe = chrome ?? edge;
    if (!exe) { fail(new Error('none')); return; }
    execFile(exe, [url], fail);
  }
  /**
   * Phase 3 (2026-11-18, go/no-go in passkeys.ts): a page asked for a passkey, which Samara cannot do on either machine.
   * The page only rings (tabpreload.cjs); the address offered is the one Samara reads itself from the page's own top
   * frame, never anything the page says. Once per address, so a page that keeps asking cannot keep the notice up.
   */
  passkeyAsked = new Map<number, string>();
  passkeyWanted(wc: Electron.WebContents): void {
    if (!this.mine(wc)) return;
    const u = wc.getURL();
    if (!isWeb(u)) return;
    this.chromeOffer(wc, u, u, 'passkey');
  }
  /** Google's "This browser or app may not be secure" (phase 3): the same offer, for the page he was signing in to. */
  async googleCheck(wc: Electron.WebContents, cameFrom: () => string): Promise<void> {
    if (wc.isDestroyed() || !this.mine(wc)) return;
    const u = wc.getURL();
    if (!/^https:\/\/accounts\.(google|youtube)\.com\//i.test(u)) return;
    let words = '';
    if (!googleRefused(u)) {
      try { words = String(await wc.executeJavaScriptInIsolatedWorld(1003, [{ code: GOOGLE_WORDS_JS }]) ?? ''); } catch { return; }
      if (wc.isDestroyed() || wc.getURL() !== u) return;
    }
    if (!googleRefused(u, words)) return;
    let from = '';
    try { from = cameFrom(); } catch { /* none */ }
    this.chromeOffer(wc, u, refusalTarget(u, from), 'google');
  }
  chromeOffer(wc: Electron.WebContents, at: string, target: string, why: 'passkey' | 'google'): void {
    const tab = this.tabs.find((t) => t.view?.webContents === wc);
    const key = tab?.id ?? -wc.id;
    if (this.passkeyAsked.get(key) === at) return;
    this.passkeyAsked.set(key, at);
    if (tab) this.inTab(tab);
    let host = '';
    try { host = new URL(at).hostname.replace(/^www\./, ''); } catch { /* none */ }
    const text = why === 'passkey'
      ? `${host || 'This site'} wants a passkey. Samara can't use passkeys; Chrome can.`
      : "Google says this browser may not be secure and won't sign you in here. Chrome can.";
    this.ask({ host, what: 'Open this page in Chrome?', text, yes: 'Open in Chrome', no: 'Not now', icon: 'key', kick: why === 'passkey' ? `${host || 'This site'} wants a passkey` : 'Google sign-in' },
      (ok) => { if (ok) this.toChrome(target); });
  }
  /** Stop a tab at a listed address: nothing loads, the frame shows the red plate instead. */
  block(tab: Tab, url: string, lists: string[]): void {
    const like = lists.find((l) => l.startsWith(LOOKS_LIKE));
    tab.blocked = { url, lists, ...(like ? { real: like.slice(LOOKS_LIKE.length).toLowerCase() } : {}), ...(lists[0] === BANK ? { bank: true } : {}) };
    tab.url = url;
    tab.loading = false;
    // Stopped just after, never inside the navigation event that called this: on engine 44.7.0, stop() inside
    // will-navigate took the whole browser down (found by engine-safety-check.ts, 2026-11-18). The event's own
    // preventDefault() already cancels the navigation; this stops what is left of the load.
    const view = tab.view;
    if (view) setImmediate(() => { try { if (!view.webContents.isDestroyed()) view.webContents.stop(); } catch { /* gone */ } });
    this.place();
    this.changed();
  }

  /** HTTPS-first: the address to really load, the secure one when it exists. Remembers what it upgraded. */
  secured(tab: Tab, url: string): string {
    const up = upgrade(url, this.httpOk);
    tab.upgraded = up ? url : null;
    return up ?? url;
  }
  /** The page did not load: the frame's own plate shows where it would be. */
  fail(tab: Tab, f: NonNullable<Tab['failed']>): void {
    tab.failed = f;
    tab.loading = false;
    tab.upgraded = null;
    this.place();
    this.changed();
  }

  /** 6.22: "Block ads on this site" off or on, for the site he is on. Kept between runs. */
  /** Sheet 37: one site's rules as the shield shows them. Login shows on for the job sites unless he turned it off. */
  siteState(u: string): { host: string; ai: boolean; login: boolean; camera: Tri; mic: Tri; notify: Tri; popupBlock: boolean; devices: KnownDevice[] } | null {
    const host = siteKey(u);
    if (!host || !isWeb(u)) return null;
    const lr = this.rules.login(host);
    return { host, ai: this.rules.ai(host), login: lr ?? JOB_SITES.includes(siteOf(host)), camera: this.rules.media(host, 'camera'), mic: this.rules.media(host, 'mic'), notify: this.rules.notify(host),
      popupBlock: this.prefs.popups && !this.popOk(host), devices: this.devices.list(hostOf(u)) };
  }
  /** A rule changed from the shield (the site he is on) or from Settings (any site in the list). */
  setSiteRule(key: string, value: unknown, site?: string): void {
    const host = site ? siteKey(site) : siteKey(this.cur()?.url ?? '');
    if (!host) return;
    // On the site he is on, ads and dark mode go through their own switches, which also redo the open page.
    if (!site && key === 'ads') { this.pauseAds(value !== true); return; }
    if (!site && key === 'dark') { this.setDarkHere(value === true); return; }
    if (key === 'ai' || key === 'login') this.rules.set(host, { [key]: value === true });
    else if ((key === 'camera' || key === 'mic' || key === 'notify') && (value === 'allow' || value === 'ask' || value === 'block')) this.rules.set(host, { [key]: value });
    else if (key === 'popups') {
      if (value === true) this.popupOk.delete(host); else this.popupOk.add(host);
      try { writeFileAtomic(this.popupOkFile, JSON.stringify([...this.popupOk])); } catch { /* best effort */ }
      this.sync?.changed('prefs'); this.sendTabs(); this.pushSettings();
    } else if (key === 'ads') {
      if (value === true) this.paused.delete(host); else this.paused.add(host);
      this.ads?.pause(host, value !== true);
      try { writeFileAtomic(this.pausedFile, JSON.stringify([...this.paused])); } catch { /* best effort */ }
      this.sync?.changed('prefs'); this.sendTabs(); this.pushSettings();
    } else if (key === 'dark') {
      const off = new Set(this.prefs.darkOff);
      if (value === true) off.delete(host); else off.add(host);
      this.prefs.darkOff = [...off].slice(-2000); this.savePrefs(); this.sendTabs(); this.pushSettings();
      this.sync?.changed('prefs');
    }
  }
  /** Forget every rule he set for one site (the x in Your sites): back to how every site starts. */
  /**
   * Clear everything one site keeps in Samara on this machine: its cookies, storage, cache and service workers (his ask,
   * 2026-10-20: Disney+ was stuck on "not available in your region" from a half-copied sign-in). He is signed out of it
   * here; nothing else is touched. Only ever with his OK (the Claude door asks him every time).
   */
  async forgetSite(site: string): Promise<{ site: string; cookies: number; tabs: number }> {
    const root = siteKey(site).replace(/^www\./, '');
    if (!root || !root.includes('.')) throw new Error('say which site, e.g. disneyplus.com');
    // Where a service signs in on another of its own domains, that one goes too.
    const PARTNERS: Record<string, string[]> = { 'disneyplus.com': ['disney.com', 'bamgrid.com'], 'crave.ca': ['bellmedia.ca'], 'primevideo.com': ['amazon.com', 'amazon.ca'] };
    const roots = [root, ...(PARTNERS[root] ?? [])];
    const under = (h: string) => roots.some((r) => h === r || h.endsWith('.' + r));
    let cookies = 0;
    for (const r of roots) {
      for (const c of await this.ses.cookies.get({ domain: r }).catch(() => [] as Electron.Cookie[])) {
        const d = String(c.domain ?? '').replace(/^\./, '');
        await this.ses.cookies.remove(`http${c.secure ? 's' : ''}://${d}${c.path || '/'}`, c.name).catch(() => {});
        cookies++;
      }
    }
    const origins = new Set<string>();
    for (const r of roots) for (const h of [r, 'www.' + r, 'login.' + r]) origins.add('https://' + h);
    for (const t of this.tabs) { try { const u = new URL(t.url); if (under(u.hostname)) origins.add(u.origin); } catch { /* not an address */ } }
    await this.ses.clearData({ origins: [...origins], dataTypes: ['cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'cache', 'fileSystems'] }).catch((e: Error) => console.error('shell: browser: clearing a site: ' + e.message));
    await this.ses.cookies.flushStore().catch(() => {});
    let tabs = 0;
    for (const t of this.tabs) { try { if (t.view && under(new URL(t.url).hostname)) { t.view.webContents.reload(); tabs++; } } catch { /* gone */ } }
    console.log(`shell: browser: cleared ${root} (${cookies} cookies, ${tabs} tabs reloaded)`);
    return { site: root, cookies, tabs };
  }
  clearSite(site: string): void {
    const host = siteKey(site);
    if (!host) return;
    this.rules.clear(host);
    this.popupOk.delete(host); this.paused.delete(host); this.ads?.pause(host, false);
    this.prefs.darkOff = this.prefs.darkOff.filter((h) => h !== host);
    try { writeFileAtomic(this.popupOkFile, JSON.stringify([...this.popupOk])); writeFileAtomic(this.pausedFile, JSON.stringify([...this.paused])); } catch { /* best effort */ }
    this.savePrefs(); this.sync?.changed('prefs'); this.sendTabs(); this.pushSettings();
  }
  /** Every site he set anything for, with all its rules, for Settings > Your sites. */
  yourSites(): { host: string; favicon: string; ai: boolean; login: boolean; ads: boolean; popups: boolean; dark: boolean; camera: Tri; mic: Tri; notify: Tri; bank: boolean }[] {
    const hosts = new Set<string>([...Object.keys(this.rules.all()), ...this.paused, ...this.popupOk, ...this.prefs.darkOff].map((h) => siteKey(h)).filter(Boolean));
    return [...hosts].sort().slice(0, 500).map((host) => {
      const u = 'https://' + host + '/', st = this.siteState(u)!;
      return { host, favicon: this.iconOf(u), ai: st.ai, login: st.login, ads: !this.paused.has(host), popups: st.popupBlock, dark: this.darkWanted(u), camera: st.camera, mic: st.mic, notify: st.notify, bank: bankSite(u) };
    });
  }
  pauseAds(on: boolean): void {
    const t = this.cur();
    let host = '';
    try { host = new URL(t?.url ?? '').hostname.replace(/^www\./, ''); } catch { return; }
    if (!host) return;
    if (on) this.paused.add(host); else this.paused.delete(host);
    this.ads?.pause(host, on);
    try { writeFileAtomic(this.pausedFile, JSON.stringify([...this.paused])); } catch { /* best effort */ }
    this.sync?.changed('prefs');
    t?.view?.webContents.reload();
    this.sendTabs();
  }

  /** SY: the other machine's lists, in place of these. Every entry is checked as if it were typed here. */
  takeLists(v: unknown): void {
    if (!v || typeof v !== 'object') return;
    const L = v as Record<string, unknown>;
    const put = (f: string, set: Set<string>) => { try { writeFileAtomic(f, JSON.stringify([...set])); } catch { /* best effort */ } };
    this.rules.takeFromPeer(L.siteRules);
    if (Array.isArray(L.popupOk)) { this.popupOk = new Set(hostList(L.popupOk)); put(this.popupOkFile, this.popupOk); }
    // A site the other computer added waits for his yes here; one it took off comes off here too.
    const meet = (incoming: unknown[], mine: Set<string>, other: Set<string>, file: string) => {
      const inc = new Set(hostList(incoming));
      for (const h of [...mine]) if (!inc.has(h)) mine.delete(h);
      for (const h of [...other]) if (!inc.has(h) || mine.has(h)) other.delete(h);
      for (const h of inc) if (!mine.has(h)) other.add(h);
      put(file, mine); put(file.replace(/\.json$/, '-other.json'), other);
    };
    if (Array.isArray(L.trusted)) meet(L.trusted, this.trusted, this.peerTrusted, this.trustedFile);
    if (Array.isArray(L.httpOk)) meet(L.httpOk, this.httpOk, this.peerHttp, this.httpOkFile);
    if (Array.isArray(L.adsPaused)) {
      const next = new Set(hostList(L.adsPaused));
      this.ads?.pauseMany([...this.paused].filter((h) => !next.has(h)), false);
      this.ads?.pauseMany([...next].filter((h) => !this.paused.has(h)), true);
      this.paused = next; put(this.pausedFile, this.paused);
    }
    // Phase R: the Stash no longer travels (each machine moved its own into Earlier); Earlier is joined, never replaced.
    const E = (L as { earlier?: { entries?: unknown; gone?: unknown } }).earlier;
    if (E && typeof E === 'object' && Array.isArray(E.entries)) {
      this.earlier.join(E.entries.filter((e: any) => typeof e?.url === 'string' && urlKept(e.url)), E.gone && typeof E.gone === 'object' ? E.gone as Record<string, number> : {});
    }
    this.sendTabs(); this.pushSettings();
  }
  /** The site's name for dark mode: its host without www. */
  darkHost(u: string): string { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
  /** Dark mode on this page: on everywhere unless he switched it off for this site. */
  darkWanted(u: string): boolean { return this.prefs.dark && isWeb(u) && !this.prefs.darkOff.includes(this.darkHost(u)); }
  /** Make one page dark, or put it back. Runs on every page load and on every switch. */
  paintDark(t: Tab): void {
    const wc = t.view?.webContents;
    if (!wc || wc.isDestroyed() || t.internal || !isWeb(wc.getURL())) return;
    const on = this.darkWanted(wc.getURL());
    const src = darkSource();
    if (!src) return;
    const steps = on ? [{ code: `if(!globalThis.DarkReader){${src}\n};true` }, { code: `${ALREADY_DARK}if(!DarkReader.isEnabled()&&!__samaraAlreadyDark()){DarkReader.enable(${DARK_THEME});__samaraWatchDark();}true` }] : [{ code: 'globalThis.DarkReader&&DarkReader.disable();true' }];
    void wc.executeJavaScriptInIsolatedWorld(DARK_WORLD, steps).catch(() => { /* the page went away */ });
  }
  paintDarkAll(): void { for (const t of this.tabs) this.paintDark(t); }
  /**
   * With dark mode on, every site is told he prefers dark (prefers-color-scheme), so the many that have a dark look of
   * their own (YouTube, Reddit, Twitch, LinkedIn...) draw it themselves, at no cost; Dark Reader then finds them already
   * dark and leaves them be. The companion's own pages never follow this setting, so only websites change.
   */
  colorScheme(): void { try { nativeTheme.themeSource = this.prefs.dark ? 'dark' : 'system'; } catch { /* not here */ } }
  /**
   * Dark mode from the page's first moment (2026-10-20: Gmail and LinkedIn stayed white for a long while).
   * dom-ready comes late on heavy sites, so the tab's own script asks here as the page starts, and runs Dark Reader in its
   * world straight away, the way the extension does at document start. Null: no dark mode on this page.
   */
  darkAtStart(wc: Electron.WebContents, url: string): { src: string; theme: string; test: string } | null {
    const t = this.tabs.find((x) => x.view?.webContents === wc);
    if (!t || t.internal || !this.darkWanted(url)) return null;
    const src = darkSource();
    return src ? { src, theme: DARK_THEME, test: ALREADY_DARK } : null;
  }
  /** The shield's "Dark mode on this site" switch, for the site he is on. Synced with his other prefs. */
  setDarkHere(on: boolean): void {
    const host = this.darkHost(this.cur()?.url ?? '');
    if (!host) return;
    const off = new Set(this.prefs.darkOff);
    if (on) off.delete(host); else off.add(host);
    this.prefs.darkOff = [...off].slice(-2000);
    this.savePrefs();
    for (const t of this.tabs) if (this.darkHost(t.url) === host) this.paintDark(t);
    this.sendTabs();
  }

  setSounds(on: boolean): void {
    this.sounds = on;
    this.savePrefs();
    this.sendTabs();
  }

  /** Sheet 87: the link he last clicked in each tab (the page's own message, his clicks only), and when. */
  lastLink = new Map<number, { url: string; at: number }>();
  linkClicked(sender: Electron.WebContents, href: string): void {
    const t = this.tabs.find((x) => x.view?.webContents === sender);
    if (!t) return;
    try { this.lastLink.set(t.id, { url: new URL(href).href, at: Date.now() }); } catch { /* not an address */ }
  }
  /**
   * Sheet 87 (his anime sites, every window): a new tab or window a page opens on his click is his only when it is the
   * link he clicked, the site's own page, or a sign-in page. An ad that a page opens on any click is none of those.
   */
  fairOpen(tab: Tab, pageUrl: string, u: string): boolean {
    const l = this.lastLink.get(tab.id);
    try { if (l && Date.now() - l.at < GESTURE_MS && new URL(u).href === l.url) return true; } catch { return false; }
    try {
      const to = new URL(u).hostname, from = new URL(pageUrl).hostname;
      return siteOf(to) === siteOf(from) || SIGN_IN.test(to);
    } catch { return false; }
  }
  /** A site he let open pop-ups. */
  popOk(site: string): boolean { return this.popupOk.has(site); }

  savePrefs(): void {
    try { writeFileAtomic(this.prefsFile, JSON.stringify({ sounds: this.sounds, ...this.prefs })); } catch { /* best effort */ }
    this.sync?.changed('prefs');
  }

  /** His home page, typed into Settings: a web address only. Empty puts the default back. */
  setHome(text: string): void {
    const t = String(text ?? '').trim();
    const u = t ? addressFor(t) : DEFAULT_HOME;
    if (!u || !isWeb(u)) { this.note('', { kind: 'bad', from: 'slot', small: true, kick: 'The address bar', title: 'Not a web address' }); return; }
    this.prefs.home = u;
    this.savePrefs();
    this.note('', t ? { from: 'menu', small: true, kick: 'Saved', title: 'Your home page' } : { from: 'menu', small: true, kick: 'Home page', title: 'Back to Brave Search' });
    this.sendTabs();
  }

  /** A switch in the ⋯ menu. Only the ones that exist; "Let the companion act without asking" is not one of them. */
  setPref(key: string, on: boolean): void {
    if (key === 'sounds') { this.setSounds(on); return; }
    if (key === 'ads') {
      this.prefs.ads = on;
      if (on) this.ads?.start(); else this.ads?.stop();
      this.cur()?.view?.webContents.reload();
    } else if (key === 'popups') this.prefs.popups = on;
    else if (key === 'dark') { this.prefs.dark = on; this.colorScheme(); this.paintDarkAll(); }
    else return;
    this.savePrefs();
    this.sendTabs();
  }

  /**
   * The tab drawer (2026-10-11: it slides OVER the page, opened by clicking the wood tab). A page is a
   * native view drawn above the frame, so no HTML can cover it. While the drawer is open the page is shown as a
   * still picture of itself in the frame and the live view is hidden; closing puts the live page straight back.
   */
  async drawer(open: boolean): Promise<void> {
    const w = this.win, P = this.pane;
    const t = this.cur();
    if (!w || w.isDestroyed()) return;
    this.drawerOpen = open;
    if (open) this.veilDown(0);
    if (!open) { if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; } this.place(); if (t?.view && !t.lent) t.view.setVisible(true); w.webContents.send('browser:frozen', null); return; }
    const p = this.peekShot;
    this.peekShot = null;
    // A picture taken on the hover is good if it is the same page and under 1.5 seconds old.
    let shot = t && p && p.tab === t.id && p.url === t.url && Date.now() - p.at < 1500 && !t.loading ? p.shot : null;
    if (!shot && t) shot = await this.shotOf(t);
    this.pane = P;
    if (!this.drawerOpen) return;               // closed again while the picture was taken
    w.webContents.send('browser:frozen', shot);
    if (!shot) { this.frozenReady(); return; }
    // The frame answers 'frozen-ready' once the picture is painted; never wait more than a moment for it.
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => { this.pane = P; this.frozenReady(); }, 250);
  }

  /** The frame, or the tab list's own layer (it sends the same tab clicks). */
  // These also say which window the message is about: every frame message is checked here first, so from here on the
  // browser works in that window.
  isFrame(sender: Electron.WebContents): boolean {
    const p = this.panes.find((x) => (this.alive(x) && sender === x.win!.webContents) || (x.trayV && !x.trayV.webContents.isDestroyed() && sender === x.trayV.webContents)
      || (liveView(x.floatV) && sender === x.floatV!.webContents));
    if (p) this.pane = p;
    return Boolean(p);
  }
  /**
   * The first seconds after Samara opens (2026-11-20). Chromium hands the keyboard to a tab when its page first
   * loads, even when nobody asked it to (seen on the hidden desktop: no focus() call, and the tab had it anyway). While
   * the bar is open and he has not clicked the page, the keyboard goes back to the bar.
   */
  holdBarAtStart(p: Pane): void {
    const w = p.win;
    if (!w) return;
    const clickedAt = new Map<number, number>();
    const watched = new Set<number>();
    const end = Date.now() + 8000;
    const timer = setInterval(() => {
      if (Date.now() > end || !this.alive(p)) { clearInterval(timer); return; }
      for (const t of this.tabs) {
        const wc = t.pane === p.id && t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
        if (!wc || watched.has(wc.id)) continue;
        watched.add(wc.id);
        wc.on('input-event', (_e, input) => { if (input.type === 'mouseDown') clickedAt.set(wc.id, Date.now()); });
      }
      if (!p.slotOpen) return;   // 2026-11-22: the bar is no longer opened for him; this only keeps it once HE opened it
      const f = allWebContents.getFocusedWebContents();
      if (!f || f === w.webContents || !this.tabs.some((t) => t.pane === p.id && t.view?.webContents === f)) return;
      if (Date.now() - (clickedAt.get(f.id) ?? 0) < 1000) return;   // he clicked the page: it is his
      w.webContents.focus();
      w.webContents.send('browser:focusslot', { start: true });
    }, 50);
  }
  /** The frame's address bar opened or closed (browser.js). */
  slotState(open: boolean): void { this.pane.slotOpen = open; }
  isMainFrame(sender: Electron.WebContents): boolean {
    const p = this.panes.find((x) => this.alive(x) && sender === x.win!.webContents);
    if (p) this.pane = p;
    return Boolean(p);
  }

  /** Tabs opened from links since he last opened the list (the tab arrow's +1). */
  newSince = 0;
  /** The band draws the name strips, the gold edge and the peg from this (only when something changed). */
  splitSent = new WeakMap<Pane, string>();
  /** Pairs read back from the saved tabs, waiting until both tabs are in the same window (other windows open a moment later). */
  splitsWanted: { L: Tab; R: Tab; ratio: number }[] = [];

  // ------------------------------------------------------------------ sheet 121 (5): peek at a link
  /**
   * His pick (2026-11-20): Shift and a click on a link (or holding the mouse down on it) opens it ON TOP of the page, no new
   * tab. A wood strip over it keeps it as a tab or puts it side by side; Esc, the × or a click outside closes it. Two
   * layers: a see-through one over the whole window (the shade, the strip and its keys, which takes the click outside),
   * and the page itself in the box under the strip.
   */
  lp: { pane: Pane; shade: WebContentsView; view: WebContentsView; from: number | null; ready: boolean } | null = null;

  // ------------------------------------------------------------------ sheet 121 (3): hover a tab to see it
  /**
   * His pick (2026-11-20): resting the mouse on a tab in the list for a moment shows a small picture of that page with its
   * full name and address, BESIDE the list. The list itself is not touched: the picture is its own small layer to the
   * right of it. The page in front is pictured live; the others show the picture taken the last time they were in front.
   */
  tabPeekV: WebContentsView | null = null;
  tabPeekOn = false;
  tabPeekReady = false;
  tabPeekSeq = 0;
  // ------------------------------------------------------------------ Stremio's downloads
  /**
   * 2026-10-25 : every stream he opens in Stremio starts
   * a download in its engine, and it went on for minutes after he left it, so clicking through a few left five running
   * at once. The downloads that start while his Stremio tab plays are Samara's; when he leaves the video or picks another,
   * all but the one he is now watching are stopped. Ones his Stremio app started are never touched.
   */
  stremioMine = new Map<number, { hashes: string[]; seen: Set<string> | null; url: string; timer?: NodeJS.Timeout }>();
  /** Stremio's engine on this Mac (a test points it at a stand-in). */
  stremioApi = 'http://127.0.0.1:11470';

  // ------------------------------------------------------------------ sheet 89, the TV
  /** What is on his TV now: one video (Google Cast) or this window (AirPlay, as a second screen). */
  tv: { kind: 'video' | 'window' | 'app'; tab: number; name: string; title: string; site: string; cast?: CastSession; back?: Electron.Rectangle; win?: BrowserWindow; app?: string } | null = null;
  /** The TV ask in the band: setting yeet up as a second screen (once), what is playing there, the code to link
   *  Samara (sheet 99, the very first send), or the TV that did not wake. */
  tvAsk: 'setup' | 'playing' | 'link' | 'asleep' | null = null;
  /** Sheet 99: how far a send has got (0 started, 1 waking the TV, 2 opening the app), for the TV icon's fill. */
  tvStep: number | null = null;
  tvLinkErr = '';
  tvName = 'your TV';
  // ---- sheet 99: the TV's own apps, through Google TV's remote service (tvremote.ts)
  get tvFile(): string { return path.join(this.o.stateDir, 'tv-remote.json'); }
  tvPair: { finish: (code: string) => Promise<void>; close: () => void } | null = null;
  tvPending: { tab: number; a: TvAppLink; at: number } | null = null;

  // ------------------------------------------------------------------ the soft fade between pages (2026-10-12)
  /**
   * Option 5 from the loading demo. When a page starts to change, a picture of the old page is laid over it in a
   * see-through layer of the companion's own (the curtain), so there is never a blank flash; a slow site dims it a little;
   * the moment the new page first draws, the curtain fades out over 0.25 s and the new page is underneath. A page
   * that arrives at once (Back, a fast site) just switches. A tab with nothing drawn yet shows the wood instead.
   */
  veilSeq = 0;
  /** A woken tab is on screen: what it held back (his video) may play now, if he is looking at it. */
  /** A woken tab is silent until he clicks or presses a key in it (2026-10-30: a woken YouTube tab played
   *  for a moment, at whatever volume he had left; the mute used to lift on a timer). */
  wakeHush = new Set<number>();
  /**
   * The Hyrule tab (2026-11-03, BG4): his Breath of the Wild map and Journal as a tab of its own, like Settings. Its
   * files are Nintendo's art and his save, so they live in their own private folder (never in Samara's code): Samara
   * serves that folder on this machine only, and the tab may move between its own pages and nowhere else. Its full
   * screen button (sheet 19) asks for the page's own full screen, which fills the screen like a video's: band and drawer
   * gone, back as they were on F, Esc or the button.
   */
  hyrulePages: Promise<PageServer> | null = null;
  /** The tab he was on before the Hyrule key. */
  hyruleFrom: number | null = null;
  vaultChecking = false;
  idleBusy = false;
  /** Just back from the computer sleeping: no tidying for a minute and a half while everything wakes. */
  idleQuietUntil = 0;
  suspendedAt = 0;
  nextTab: { claude: boolean; guest: boolean } | null = null;
  /**
   * Sheet 111: a tab in the background draws nothing, so Claude's picture of it came back empty. For the picture it is
   * shown UNDER his front page (the bottom of the window's layers), where he never sees it, then hidden again. Only while
   * his front page is shown and covers it; otherwise (the tab list's still picture is up) no picture is taken this way.
   */
  async drawnFor<T>(tab: number, fn: () => Promise<T>): Promise<T> {
    const t = this.tabs.find((x) => x.id === tab), v = t?.view, w = this.win, front = this.cur()?.view;
    if (!v || !w || w.isDestroyed() || v.getVisible() || !front || !front.getVisible()) return fn();
    try {
      w.contentView.addChildView(v, 0);
      if (v.getBounds().width < 2) v.setBounds(this.pageArea());
      v.setVisible(true);
      await new Promise((r) => setTimeout(r, 150));
      return await fn();
    } finally {
      // Hidden again, unless he switched to it meanwhile (then it is his front page and stays shown).
      if (!v.webContents.isDestroyed() && this.cur()?.id !== tab) v.setVisible(false);
    }
  }
  /** Option + drag anywhere on the frame (2026-10-23): the window follows. */
  dragFrom: { x: number; y: number; wx: number; wy: number } | null = null;
  loginKnown = false;

  // ------------------------------------------------------------------ autofill (sheet 77, 2026-10-23)
  /** The box he is in, on the page in front: what it is, its neighbours' kinds, where it is (page pixels). */
  af: { tab: number; kind: FieldKind; kinds: FieldKind[]; empty: boolean; rect: { x: number; y: number; w: number; h: number };
    offer: 'details' | 'login' | null; email: number; logins: Login[]; login: number } | null = null;
  /** The address bar asking for his PIN: the digits so far (never shown, never kept), and what to do once it opens. */
  afPin: { digits: string; then: 'fill' | 'save'; checking?: boolean } | null = null;
  /** A login he just sent on a page, waiting for him to look at it (kept in memory only, five minutes at most). */
  afSave: { tab: number; host: string; user: string; pass: string; at: number; asked: boolean; update?: string } | null = null;
  afBandMode: 'idle' | 'pin' | 'save' = 'idle';

  // ------------------------------------------------------------------ sheet 106 v7, notices
  /**
   * His yes (2026-10-30): every notice and ask is one "option B" notice, one at a time (notices.ts), on its own
   * see-through layer over the LIVE page (as the address bar's list is), so a video never stops for one. It drops from
   * under what caused it: the frame says where that key is, the layer is placed there, exactly the notice's size.
   */
  notices = new NoticeQueue((s) => this.noticeShow(s));
  /** What the queue last said to show (the layer is told it again once it has loaded), and the window showing it. */
  noticeNow: NoticeShown | null = null;
  noticePane: Pane | null = null;
  /** Each new placing has a number: a slower one never lands over a newer one. */
  noticeGen = 0;
  noticeAsk: { seq: number; done: (a: { left: number; right: number; bottom: number } | null) => void } | null = null;
  noticeAskSeq = 0;
  /** The TV's own asks (link, asleep, setup) as a notice, kept in step with tvAsk. */
  tvNotice: { id: number; ask: string; err: string } | null = null;

  /** Each showing has a number, so a fade that ends after a new showing never hides the new one. */
  lightSeq = 0;
  /** Keys taken for his PIN whose release has not come yet (finding 1). */
  afTaken = new Set<string>();
  // ------------------------------------------------------------------ M6 one browser on both machines (bsync.ts)
  /** Set by main: "Open on Mac" / "Open on PC", a full tab in the other machine's browser. */
  onOpenOther: ((url: string) => void) | null = null;
  /** Set by main: open a paid service in the paid-video window. True if it opened. */
  onPaid: ((url: string) => boolean) | null = null;
  /** Netflix refused to play in a tab here: main opens it in the paid-video window instead (true when it did). */
  onPaidFallback: ((url: string) => boolean) | null = null;
  /** The sync with the browser on his other machine (startSync). */
  sync: BrowserSync | null = null;
  /** What the sync needs from this browser: plain reads, and quiet writes that do not reload or say anything. */
  readonly syncTarget = {
    marks: () => this.marks.map((m) => ({ ...m })),
    setMarks: (list: Mark[]) => {
      this.marks = (Array.isArray(list) ? list : []).filter((m) => typeof m?.url === 'string' && isWeb(m.url) && typeof m.title === 'string')
        .slice(0, 5000).map((m) => ({ title: String(m.title).slice(0, 300), url: m.url, folder: String(m.folder ?? '').slice(0, 100) }));
      this.saveMarks(); this.sendTabs(); this.pushSettings();
    },
    // SY (2026-10-14): the lists he made travel with the settings. Money sites never do.
    // Sheet 79: the Mockups trail's marks travel too, by each version's picture.
    mockStages: () => [...(this.mockStore?.stageLog.values() ?? [])],
    // N0 (2026-11-25): his notes are Samara's (noteswire.ts sets notesHub); none until the notes have started.
    notes: () => (this.notesHub ? { list: this.notesHub.forSync(), own: this.notesHub.own() } : undefined),
    takeNotes: (list: unknown[], own: string[]) => { this.notesHub?.take(list, own); },
    takeMockStages: (list: unknown[]) => { if (this.mockStore?.takeStages(list)) this.sendTabs(); },
    // His details travel to his other machine only (2026-10-23), with the rest of his settings.
    prefs: () => ({ sounds: this.sounds, ...this.prefs, ...(this.details.empty() ? {} : { autofill: this.details.get() }), lists: {
      popupOk: [...this.popupOk], trusted: [...this.trusted, ...this.peerTrusted], httpOk: [...this.httpOk, ...this.peerHttp], adsPaused: [...this.paused], siteRules: this.rules.all(),
      // Phase R: Earlier travels (money sites never do); a page he removed on one machine is removed on both.
      earlier: { entries: this.earlier.entries.filter((e) => urlKept(e.url)), gone: this.earlier.gone },
    } }) as Record<string, unknown>,
    setPrefs: (p: Record<string, unknown>) => {
      const adsWas = this.prefs.ads;
      this.sounds = p.sounds === true;
      this.prefs = { ads: p.ads !== false, popups: p.popups !== false, home: typeof p.home === 'string' && isWeb(p.home) ? p.home.slice(0, 2000) : DEFAULT_HOME,
        search: p.search === 'ddg' || p.search === 'google' ? p.search : 'brave', aiBox: p.aiBox !== false, startup: p.startup === 'home' ? 'home' : 'tabs',
        dark: p.dark !== false, darkOff: hostList(p.darkOff), afSounds: p.afSounds !== false, lockAfter: lockPick(p.lockAfter) };
      this.vault.setLockAfter(LOCK_AFTER[this.prefs.lockAfter]);
      if (p.autofill && typeof p.autofill === 'object') this.details.set(p.autofill);
      setSearch(this.prefs.search, this.prefs.aiBox);
      this.paintDarkAll();
      this.takeLists(p.lists);
      if (adsWas !== this.prefs.ads) { if (this.prefs.ads) this.ads?.start(); else this.ads?.stop(); }
      this.savePrefs(); this.sendTabs(); this.pushSettings();
    },
    tabSnap: (): TabSnap => {
      if (this.panes.some((p) => this.alive(p)) && this.tabs.length) {
        // Mockups (sheet 47) stay on this PC: their page server is here only.
        return { tabs: this.tabs.filter((t) => !t.internal && !t.mock && isWeb(t.url)).map((t) => ({ url: t.url, title: t.title, trail: t.trail, done: t.done })), trails: this.trails.filter((x) => !x.mock).map((x) => ({ id: x.id, name: x.name })) };
      }
      try {
        const s = this.session.peek() as any;
        return { tabs: (Array.isArray(s?.tabs) ? s.tabs : []).filter((t: any) => typeof t?.url === 'string' && isWeb(t.url) && !t.mock).map((t: any) => ({ url: t.url, title: String(t.title ?? t.url), trail: Number.isInteger(t.trail) ? t.trail : null, done: t.done === true })),
          trails: (Array.isArray(s?.trails) ? s.trails : []).filter((x: any) => Number.isInteger(x?.id) && x.id !== MOCK_TRAIL).map((x: any) => ({ id: x.id, name: String(x.name ?? '') })) };
      } catch { return { tabs: [], trails: [] }; }
    },
    setTabs: (snap: TabSnap) => this.takeTabs(snap),
    pauseAll: () => this.pauseAll(),
    visits: () => this.visits.list.slice(),
    addVisits: (list: Visit[]) => this.visits.merge(list),
    forgetVisit: (url: string, at: number) => { const cb = this.visits.onChange; this.visits.onChange = null; this.visits.forget(url, at); this.visits.onChange = cb; },
    clearVisits: (from: number) => { const cb = this.visits.onChange; this.visits.onChange = null; this.visits.clear(from); this.visits.onChange = cb; },
    cookies: async () => (await this.ses.cookies.get({})) as SyncCookie[],
    setCookie: async (c: SyncCookie) => {
      await this.ses.cookies.set({
        url: `${c.secure ? 'https' : 'http'}://${String(c.domain ?? '').replace(/^\./, '')}${c.path || '/'}`, name: c.name, value: c.value,
        ...(c.hostOnly ? {} : { domain: c.domain }), path: c.path || '/', secure: c.secure === true, httpOnly: c.httpOnly === true,
        ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}), ...(c.sameSite ? { sameSite: c.sameSite } : {}),
      });
    },
    removeCookie: async (c: SyncCookie) => { await this.ses.cookies.remove(`https://${String(c.domain ?? '').replace(/^\./, '')}${c.path || '/'}`, c.name); },
  };

  // ------------------------------------------------------------------ C7 Claude's rune in the band (2026-10-21)
  // Sheet 50: a rune stone in the band while a Claude job runs, waits on him, or has finished and he has not
  // said Nice yet. The companion's claude.jobs / claude.wait reach the Shell (main.ts) and are passed here; the frame only
  // gets the jobs and, of the waiting items, WHICH session waits and for what kind (never Claude's exact input: the rune
  // only needs to turn blue). With no companion (Samara on its own) nothing arrives, so there is no rune.
  claudeLast: { jobs: unknown[]; waits: { session: string; kind: string }[] } | null = null;
  /** Set by main: a checked pause / play / message for a session, to the companion. */
  onClaude: ((m: Record<string, unknown>) => void) | null = null;
  /** Set by main: open a session in the Claude app (the exact claude:// link, or 'front' / 'mac', claudeOpenTarget). */
  onClaudeOpen: ((target: ClaudeOpen) => void) | null = null;
  /** The companion's news (null: the companion went away, so the rune goes too). Sent to every Samara window's band. */
  // ------------------------------------------------------------------ sheet 60: the notes rail ("Notes for this site")
  railNotes: RailNote[] = [];
  /** N0: Samara's own notes store, for the sync (noteswire.ts). */
  notesHub: import('./noteswire.ts').NotesLink | null = null;
  /** T1 (2026-11-25): his timers (timerswire.ts); none until they have started. */
  timersHub: import('./timerswire.ts').TimersHub | null = null;
  /** M1 (2026-11-25): the music player (musicwire.ts); none until it has started. */
  musicHub: import('./musicwire.ts').MusicHub | null = null;
  /** S1 (2026-11-25): Snip (snipwire.ts); none until it has started. */
  snipHub: import('./snipwire.ts').SnipHub | null = null;
  /** U1: ☰ › Tools › New note, the quick note (noteswire.ts); none until notes have started. */
  quickNote: (() => void) | null = null;
  /** N3: "Note this" on a selection (noteswire.ts keeps it). */
  onNoteThis: ((q: { url: string; title: string; before: string; exact: string; after: string }) => void) | null = null;
  /** N3: a web page finished loading (its pins are marked). */
  onTabLoaded: ((tab: Tab) => void) | null = null;
  /** N3: the notes marked on each tab, so a ribbon's click is only ever for a note that tab was given. */
  pinIds = new Map<number, Set<string>>();
  /** N3: the selection in a tab, as a quote, then to onNoteThis. */
  async noteThis(t: Tab): Promise<void> {
    const wc = t.view?.webContents;
    if (!wc || wc.isDestroyed() || !isWeb(t.url) || !this.onNoteThis) return;
    const q = await run<{ before: string; exact: string; after: string; title: string } | null>(wc, SELECTION_CODE, { world: 999, ms: 3000, fallback: null });
    if (q && typeof q.exact === 'string' && q.exact.trim()) this.onNoteThis({ url: t.url, title: String(q.title ?? t.title), before: String(q.before ?? ''), exact: q.exact, after: String(q.after ?? '') });
  }
  railCats: string[] = [];
  /** A new note for this site, from the rail (main.ts sends it to the companion). */
  onNoteSave: ((n: RailNote) => void) | null = null;
  /** 2026-11-20 (rule): a Samara window gained or lost the front; the companion's Ctrl and + steps aside so it zooms the page. */
  onFront?: (front: boolean) => void;
  frontWas = false;
  /** A note in the rail clicked: it opens where notes open (the companion's bubble). */
  onNoteOpen: ((id: string) => void) | null = null;
  /** BG5: a pin made, moved or taken off on the Hyrule map (main.ts sends it to the companion as notes.place). */
  onNotePlace: ((m: NotePlaceMsg) => void) | null = null;
  /** Sheet 26c: the map's "Ask companion" bar. His words go to the companion as if typed in his box; the answer is the companion's, in his bubble. */
  onAsk: ((text: string) => void) | null = null;
  /**
   * Sheet 25: a route ask from the companion (botw_route_add). Kept (hyruleroute.ts) until the Hyrule page is loaded, then
   * handed to its preload, which puts it in the map's own queue. Never brings the map forward: a map he is not looking
   * at takes it when he next opens it, and the companion hears "queued".
   */
  onRouteDone: ((r: { id: string; state: 'planned' | 'queued' | 'off'; title?: string; stops?: number }) => void) | null = null;
  routeQ: RouteQueue | null = null;
  get routeQueue(): RouteQueue { return this.routeQ ??= new RouteQueue(path.join(this.o.stateDir, 'hyrule-route.json')); }
  routeWaiting: { id: string; t: ReturnType<typeof setTimeout> }[] = [];
  /**
   * The map's save (2026-11-04). The map keeps everything in hy.* localStorage keys
   * (filters, cooking plan, route, Journal tab, map spot), but its page server takes a new port each launch, so the
   * origin changes and those keys were lost on every Samara restart. The preload mirrors them here and puts them back.
   * Only hy.* string values, at most 4 MB in all.
   */
  get hyruleSaveFile(): string { return path.join(this.o.stateDir, 'hyrule-save.json'); }

  // ------------------------------------------------------------------ lending a tab to the popout ("take the tab with you")
  /** Set by main: bring a lent tab back from the popout (the popout closes and hands it over). */
  onReclaim: (() => void) | null = null;
  /** Set by main: pause/play, pin or close the pop-out, from the tab page it left behind (sheet 40 B). */
  onPopoutAct: ((what: string) => void) | null = null;
  /**
   * Address suggestions as he types (6.22b item 6). Local and instant: his open tabs first ("switch to it"), then his
   * bookmarks, then tabs he closed lately. The first row is always what he typed, so Enter never surprises him.
   */
  preconnected = '';
  /** Set by main: something started playing in a tab, so anything the companion plays elsewhere (the pop-out) stops. */
  onMediaStarted: (() => void) | null = null;
  pendingTrail: number | null = null;
  // ------------------------------------------------------------------ Sheet 47: the MOCKUPS trail (2026-10-21)
  /** Mockups are on here: there is a git repo beside the Shell (not on his Mac). */
  get mockupsOn(): boolean { return Boolean(this.mockServer && this.mockStore); }
  /** Sheet 107: the sheet Mockups opens on next (a new one from Claude, or one picked elsewhere); n counts the asks. */
  mockFocus: { n: number; sheet: string; id: number } | null = null;
  /** The mockups home's folder (~/projects/mockups), or '' when it is not cloned on this machine. */
  mockHome = '';
  mockSeenFile = '';
  /** Where the home should be. 2026-11-03: a home cloned after Samara started is taken at the next show, not ignored
   *  until a restart (that day ten sheets were refused as "not in the repo's last commit" while it sat ready). */
  mockHomeWant = '';
  /** Why the last mockup was not opened, in words Claude can act on (the door answers with it). */
  mockWhy = '';
  /** Which Samara commit each home commit was shown with (read once each). */
  readonly mockArtAt = new Map<string, string>();
  /** A branch just made from a tab's menu: the frame opens its name for typing, once. */
  freshBranch = 0;
  /**
   * Send a mockup to the companion (2026-10-21): set by main only while the companion's body is running, like Send to companion for
   * words. The frame shows the item only while it is set, so a change redraws.
   */
  sendMock: ((m: MockSend) => void) | null = null;
  get onSendMockup(): ((m: MockSend) => void) | null { return this.sendMock; }
  set onSendMockup(fn: ((m: MockSend) => void) | null) { const was = Boolean(this.sendMock); this.sendMock = fn; if (was !== Boolean(fn)) this.sendTabs(); }
  /** Sheet 100: Samara's folder for mockup pictures; its sibling mocklogos holds each project's own logo. */
  mockThumbs = '';
  /**
   * The tidy (2026-10-22): merge duplicates, fold old versions, archive sheets gone from the repo or superseded
   * and untouched for two weeks (mockuptidy.ts has the rules). All plain code and git reads: no quota, no Qwen. Runs by
   * itself at most once a day (start, the trail coming back, the history opening); "Tidy now" runs it at once and always
   * says what it did. Nothing is deleted: the Archive in the history list has a Restore on every sheet.
   */
  mockTidying = false;
  /** Sheet 107 v4: the tab he was on before Mockups opened. */
  mockFrom: number | null = null;
  /** Sheet 107 v5: where he was in Mockups (project, sheet, version), so a Mockups that slept or was rebuilt opens there. */
  mockWhereWas: { p: string; s: string | null; v: number | null; n: number | null } | null = null;
  mockLogSig = '';
  mockLogTimer: ReturnType<typeof setTimeout> | null = null;

  /** Write every tab to disk. Scroll is asked of each live page with a deadline; a page that does not answer keeps its last. */
  /** Tabs he was on since the last save: only their scroll can have moved (measured 2026-10-20). */
  scrollDue = new Set<number>();
  /**
   * His saved tabs have been read back this run (or he starts on the home page). Until then nothing writes the tabs file
   * (2026-10-23: a mockup that arrived while Samara was still starting opened its tab first, that one tab was saved over
   * his list, and then the list read back held only it: every tab gone, twice). A mockup or link that arrives meanwhile
   * waits for the window's first load.
   */
  restored = false;

  /** Quitting: every window closes at once, and none of their tabs is dropped on the way out. */
  quitting = false;
  /** A Samara window fills the screen (a video, F11): the scheduler holds heavy background jobs. */
  get fullScreen(): boolean { return this.panes.some((p) => this.alive(p) && p.win?.isFullScreen() === true); }
  /** Notes per site for driving sessions, kept between runs. Claude's own words for its next visit. */
  notesOfSites: Record<string, string> | null = null;
  get siteNotes(): Record<string, string> {
    this.notesOfSites ??= readJson<Record<string, string>>(path.join(this.o.stateDir, 'driver-notes.json'), {});
    return this.notesOfSites!;
  }

  // ------------------------------------------------------------------ 6.25a: his view of the companion's pages
  /** The drawer and the address bar: STOP a job, close it, watch one of its pages, or open a page as his own tab. */
  // ------------------------------------------------------------------ sheet 109: handing his tab back and forth
  /**
   * His own tab, while a session drives it, can be his again for a while: by his Take over key on the band, or because
   * Claude gave him the turn (a sign in, a send, a buy, or stuck: browser_your_turn, with one line). While he has it
   * nothing acts on that tab (never under him); a card under the address bar has a note box and Hand back. He hands back
   * there, or by telling Claude in the chat (browser_take_back). Either way Claude is told what changed: the page he is
   * on, the names of the fields he filled (never what he typed), what he clicked, and his note.
   */
  hands = new Map<number, Hand>();
  /** Claude waiting in browser_your_turn, by page: answered when he hands back (null: the job ended). */
  handWait = new Map<number, (r: HandReport | null) => void>();
  /** Handed back with no one waiting: told with the session's next step. */
  handTold = new Map<number, { job: number; report: HandReport }>();
  /** Frame F: the card shows what Claude was told for a few seconds after he hands back. */
  handAfter: { tab: number; rows: [string, string][]; until: number } | null = null;
  handAfterT: NodeJS.Timeout | null = null;
  /** The address bar's bottom right (window pixels), from the band: the card hangs from there. */
  handSpot: { x: number; y: number } | null = null;
  news = new Map<number, string[]>();

  // ------------------------------------------------------------------ sheet 115: Claude's work survives a restart
  // Every Claude job (its plan, its own tabs, the chat it belongs to) and the typing in its forms are kept in
  // claude-kept.json (claudekeep.ts), and come back with the same job and page numbers when Samara starts again.
  get keepFile(): string { return path.join(this.o.stateDir, 'claude-kept.json'); }
  /** The chat each job belongs to (its connector's token), and when that chat was last heard from. */
  keepTokens = new Map<number, string>();
  keepSeen = new Map<number, number>();
  /** The typing in each of Claude's pages, as last looked at. */
  forms = new Map<number, KeptForm>();
  /** Jobs that came back from before a restart, or that a new chat carried on: the door treats them as its own. */
  keptJobs = new Set<number>();
  refilling = new Set<number>();
  keepT: NodeJS.Timeout | null = null;
  /** Nothing is written over the kept file until it has been read back (or the browser is closing). */
  keepLoaded = false;
  keepFrozen = false;
  /** Claude's tabs the job itself closes (not him). */
  jobClosing = new Set<number>();
  /** Claude's work changed (the update key's "waits" line). */
  onClaudeWork?: () => void;
  lastWork = '';
}

/** The Hyrule map's save, checked: only hy.* keys (short names) with string values, else null. */
export function hyruleSaveClean(o: unknown): Record<string, string> | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (/^hy\.[A-Za-z0-9_.-]{1,40}$/.test(k) && typeof v === 'string') out[k] = v;
  return out;
}

// Phase 4 (2026-11-24): the browser's methods live in parts by what they do (browser-rail.ts, browser-panes.ts, ...).
// Each part's methods become SamaraBrowser's own, exactly as if written in the class (not enumerable, on the prototype).
// Their signatures, as they were in the class:
export interface SamaraBrowser {
  // rail (browser-rail.ts)
  trayView(): WebContentsView | null;
  warmTray(P: Pane, v: WebContentsView, tries?: number): void;
  tray(open: boolean, at?: { x?: unknown; y?: unknown; }): void;
  trayFlush(P: Pane): void;
  cardOf(t: Tab | undefined): Promise<void>;
  tabPeekView(): WebContentsView | null;
  tabPeek(a: { id?: unknown; top?: unknown; bottom?: unknown; } | null): Promise<void>;
  railTab(t: Tab): RailTab;
  entryOf(t: Tab, at: number, from?: string): EarlierEntry;
  railMove(dir: string): void;
  railTidy(now?: number): number;
  putAway(ids: number[], at: number): EarlierEntry[];
  earlierBack(keys: string[], show?: boolean): void;
  earlierAct(a: { act: string; key?: string; }, reply?: (data: unknown) => void): void;
  tidyTrails(): void;
  placeTabs(ids: number[], trail: number | null, before: number | null, parent: number | null): boolean;
  // panes (browser-panes.ts)
  splitOf(P?: Pane): { L: Tab; R: Tab; ratio: number; } | null;
  splitShown(P?: Pane): { L: Tab; R: Tab; ratio: number; } | null;
  partnerOf(id: number, P?: Pane): Tab | null;
  inFront(t: Tab): boolean;
  splitBoxes(ratio: number): { left: Electron.Rectangle; right: Electron.Rectangle; } | null;
  placeSplit(x: { L: Tab; R: Tab; ratio: number; }): void;
  splitSend(): void;
  splitOpen(other?: number): void;
  splitClose(keep?: number): void;
  splitFromFrame(a: Record<string, unknown>): void;
  splitFocus(t: Tab): void;
  adoptSplits(): void;
  peekLink(sender: Electron.WebContents, href: string): void;
  linkPeek(href: string, from?: number | null): void;
  peekBox(): { shade: Electron.Rectangle; box: Electron.Rectangle; } | null;
  placePeek(): void;
  linkPeekClose(): void;
  peekAct(sender: Electron.WebContents, act: unknown): void;
  floatView(): WebContentsView | null;
  isFloat(sender: Electron.WebContents): boolean;
  floatShow(on: boolean): void;
  floatFromFrame(a: Record<string, unknown>): void;
  floatFromLayer(a: Record<string, unknown>): void;
  placeFloat(): void;
  fillOrShrink(w: BrowserWindow): void;
  curtainView(): WebContentsView | null;
  veilUp(t: Tab, from?: Tab): Promise<void>;
  veilUpInner(t: Tab, from?: Tab): Promise<void>;
  veilDown(fade: number): void;
  painted(sender: Electron.WebContents): void;
  wokeUp(t: Tab, seq?: number | undefined): void;
  wake(tab: Tab): void;
  wakeSettings(tab: Tab): void;
  wakeHyrule(tab: Tab): void;
  openHyrule(): boolean;
  hyruleLeave(): void;
  isSettings(sender: Electron.WebContents): boolean;
  openSettings(section?: string): void;
  settingsData(): Promise<Record<string, unknown>>;
  pushSettings(): void;
  setSetting(key: string, value: unknown): void;
  removeEntry(list: string, value: string): void;
  addressLookup(text: string): Promise<{ line: string; street: string; city: string; region: string; postal: string; country: string; }[]>;
  settingsAct(act: string): void;
  sideNav(dir: "back" | "forward"): void;
  windowMenu(): void;
  winDrag(sender: Electron.WebContents, phase: string, x: number, y: number): void;
  backToSetupSpot(): void;
  screensNow(): string;
  savedPlace(): { x: number; y: number; width: number; height: number; maximized: boolean; } | null;
  keepPlace(): void;
  pageMenu(tab: Tab, p: Electron.ContextMenuParams): void;
  ensureMenu(): BrowserWindow;
  hideMenu(): void;
  isMenu(sender: Electron.WebContents): boolean;
  menuSize(width: number, height: number, sub?: number): void;
  menuPick(id: string): void;
  askClaude(t: Tab, p: Electron.ContextMenuParams, chat: Chat | null, fresh: boolean): Promise<void>;
  passOk(pass: unknown, tab?: number): boolean;
  sendToCompanion(t: Tab, p: Electron.ContextMenuParams): Promise<void>;
  // tv (browser-tv.ts)
  stremioHashes(): Promise<string[]>;
  stremioMoved(tab: Tab, url: string): void;
  tvState(): Record<string, unknown> | null;
  tvCfg(): { host: string; name: string; linked: boolean; answer: boolean; pause: boolean; };
  saveTvCfg(c: ReturnType<SamaraBrowser["tvCfg"]>): void;
  tvTarget(host: string): TvTarget;
  tvFind(): Promise<{ host: string; name: string; } | null>;
  tvRemoteRun(steps: Parameters<typeof remote>[1]): Promise<void>;
  setTvStep(n: number | null): void;
  tvSend(t: Tab): Promise<void>;
  tvCode(code: string): Promise<void>;
  tvOpen(tabId: number, a: TvAppLink): Promise<void>;
  tvVideo(t: Tab): Promise<void>;
  tvWindow(t: Tab): Promise<void>;
  tvAct(act: string): Promise<void>;
  tvOff(bringBack: boolean): Promise<void>;
  raiseTray(): void;
  placeTray(): void;
  open(url?: string): void;
  createPane(url?: string, bring?: Tab | Tab[], at?: { x: number; y: number; width: number; height: number; }): void;
  tearOut(tabId: number): void;
  newWindowFor(tabId: number): void;
  moveTo(t: Tab, to: Pane): void;
  setInsets(left: number, top: number, right?: number, bottom?: number): void;
  pageArea(): { x: number; y: number; width: number; height: number; };
  place(): void;
  // things (browser-things.ts)
  isThings(sender: Electron.WebContents): boolean;
  openThings(section?: "history" | "downloads" | "notes"): void;
  historyPage(q: string, offset: number): { items: { url: string; title: string; at: number; favicon: string; }[]; more: boolean; };
  historyAct(act: string, url?: string, at?: number): void;
  openFromThings(url: string): void;
  dlView(d: Dl): Record<string, unknown>;
  dlNotice(d: Dl): void;
  downloadsPage(): Record<string, unknown>[];
  pushThings(what: "history" | "downloads" | "notes"): void;
  sendDownloads(pop?: boolean | "pop"): void;
  resendDownloads(): void;
  dlAct(act: string, id: number): void;
  dlDrag(sender: Electron.WebContents, id: number): void;
  freeze(t: Tab, on: boolean): Promise<void>;
  mayRest(t: Tab): boolean;
  thaw(t: Tab): void;
  rest(t: Tab): Promise<void>;
  sleep(tab: Tab): void;
  closeView(tab: Tab): void;
  sleepIdle(): Promise<void>;
  sleepIdleRound(): Promise<void>;
  claudeTab(url: string, guest: boolean): { tab: number; wc: Electron.WebContents; } | null;
  newTab(address: string, opener?: number | null, focus?: boolean): number | null;
  activate(id: number): void;
  close(id: number, lastClosesWindow?: boolean): void;
  tabAct(id: number, act: string): void;
  reopen(): void;
  jumpTask(task: "new-tab" | "new-window" | "mockups" | "hyrule" | "settings" | "reopen"): void;
  popupWindow(pw: BrowserWindow): void;
  lookForLogin(): Promise<void>;
  siteKnown(host: string): boolean;
  learnSites(): Promise<void>;
  say(kick: string, title: string, kind?: NoticeIn["kind"]): void;
  note(text: string, o?: Partial<NoticeIn>, on?: (act: string) => void): number;
  vaultKey(): Promise<void>;
  vaultUnlock(password: string): Promise<void>;
  vaultList(): Promise<void>;
  vaultPick(id: string): Promise<void>;
  vaultCancel(): void;
  lightView(): WebContentsView | null;
  isLight(sender: Electron.WebContents): boolean;
  // address (browser-address.ts)
  sugView(): WebContentsView | null;
  isSuggest(sender: Electron.WebContents): boolean;
  suggestShow(m: unknown): void;
  suggestSize(h: number): void;
  suggestAct(act: "hover" | "pick", i: number): void;
  suggestForget(kind: string, url: string): void;
  iconData(url: string): Promise<string | null>;
  keepIcon(host: string, urls: string[]): Promise<void>;
  fillMarkIcons(): Promise<void>;
  saveMarks(): void;
  importMarks(): Promise<void>;
  marksNotice(added: number, from: string): Partial<NoticeIn>;
  importFrom(source: "chrome" | "safari"): Promise<void>;
  toggleMark(): void;
  markOp(act: string, url: string, title?: string): void;
  markAct(act: string, title?: string): void;
  // notices (browser-notices.ts)
  noticeView(P?: Pane): WebContentsView | null;
  isNotice(sender: Electron.WebContents): boolean;
  noticeShow(s: NoticeShown | null): void;
  noticePlace(gen: number): Promise<void>;
  noticeBounds(w: BrowserWindow, a: { left: number; right: number; bottom: number; } | null, small: boolean, h?: number, wid?: number): Electron.Rectangle;
  noticeAnchor(P: Pane, from: NoticeFrom): Promise<{ left: number; right: number; bottom: number; } | null>;
  noticeAt(m: unknown): void;
  noticeFollow(): Promise<void>;
  noticeSize(wd: number, h: number): void;
  noticeAct(id: number, act: string, value?: string): void;
  noticeHover(on: boolean): void;
  noticeFile(sender: Electron.WebContents, id: number, act: "drag" | "open"): void;
  tvNoticeSync(): void;
  lightHide(): void;
  lightShow(m: { item: "letter" | "card" | "key"; text: string; count: string; }): void;
  afDecide(): Promise<void>;
  afLoginLabel(): { item: "key"; text: string; count: string; };
  afDetailsLabel(): { item: "letter"; text: string; count: string; } | { item: "card"; text: string; count: string; };
  afField(sender: Electron.WebContents, m: unknown): void;
  afPick(one?: boolean): Promise<void>;
  afFlick(d: number): void;
  afKey(tab: Tab, input: Electron.Input): boolean;
  afPinDigit(d: string): Promise<void>;
  afSetPin(value: unknown): Promise<void>;
  afCred(sender: Electron.WebContents, m: unknown): void;
  afSaveCheck(s: NonNullable<SamaraBrowser["afSave"]>): Promise<void>;
  afSaveAsk(): void;
  afSaveGo(m: unknown): Promise<void>;
  afBand(beat?: "call" | "open" | "wrong"): void;
  afSound(name: "call" | "unlock" | "fill" | "wrong"): void;
  // sync (browser-sync.ts)
  openForward(url: string): void;
  watchPlays(tab: Tab, url: string): void;
  toPaid(url: string): boolean;
  startSync(send: (m: SyncMsg) => void, log?: (s: string) => void): BrowserSync;
  takeTabs(snap: TabSnap): void;
  faviconFor(url: string): string;
  iconOf(url: string): string;
  // claude (browser-claude.ts)
  frontNow(): void;
  notesNews(notes: unknown, cats: unknown): void;
  sendNotes(p: Pane): void;
  noteSave(raw: unknown): void;
  noteOpen(id: unknown): void;
  isHyrule(sender: Electron.WebContents): boolean;
  hyruleNotes(): string | null;
  hyruleNotePlace(raw: unknown): void;
  hyruleNewNote(raw: unknown): void;
  hyruleAsk(raw: unknown): void;
  hyruleGuide(raw: unknown): void;
  hyruleRoute(raw: unknown): void;
  routeDeliver(): void;
  hyruleRouteTook(raw: unknown): void;
  hyruleRouteReport(raw: unknown): void;
  hyruleSaveLoad(): Record<string, string>;
  hyruleSave(raw: unknown): void;
  claudeNews(m: { t?: unknown; jobs?: unknown; items?: unknown; } | null): void;
  claudeHello(sender: Electron.WebContents): void;
  claudeFold(): void;
  runeView(): WebContentsView | null;
  isRune(sender: Electron.WebContents): boolean;
  runeFromBand(a: Record<string, unknown>): void;
  runeFromLayer(a: Record<string, unknown>): void;
  rune(open: boolean, at?: { x: number; y: number; left: number; right: number; }): void;
  placeRune(): void;
  claudeAct(raw: unknown): void;
  claudeOpen(raw: unknown): void;
  drive(op: string, a: Record<string, unknown>): Promise<Record<string, unknown>>;
  driveStep(op: string, a: Record<string, unknown>): Promise<Record<string, unknown>>;
  privateWords(): string[];
  noteHost(site: string): string;
  siteNote(url: string): string;
  setSiteNote(host: string, text: string): void;
  pageHost(id: number): string;
  sweepPage(id: number): number | null;
  pageJob(id: number): number | null;
  askPlan(card: Omit<PlanCard, "id">): Promise<PlanAnswer | null>;
  planReply(id: string, a: { go?: unknown; change?: unknown; keep?: unknown; note?: unknown; }): void;
  planClean(c: PlanCard, a: PlanAnswer): PlanAnswer;
  planStep(jobId: number, at: number | null): { ok: boolean; step?: string; };
  planJob(jobId: number, card: string): void;
  planLogin(task: string, site: string): boolean;
  planIcon(site: string): string;
  askForClaude(what: string): Promise<boolean | null>;
  askUpdate(version: string, text: string): Promise<boolean | null>;
  takeOver(job: number): void;
  handStart(page: number, mode: "you" | "turn", why: string): Hand | null;
  handEnd(page: number, note: string): HandReport | null;
  handBack(sender: Electron.WebContents, note: unknown): void;
  handSize(sender: Electron.WebContents, h: number): void;
  setHandSpot(x: number, y: number): void;
  handWatching(wc: Electron.WebContents): boolean;
  handDid(wc: Electron.WebContents, m: unknown): void;
  handView(P: Pane): WebContentsView | null;
  handPlace(P: Pane): void;
  handPaint(): void;
  stuckAsk(page: number, n: number | undefined): Promise<string>;
  yourTurn(page: number, why: string, ms?: number): Promise<Record<string, unknown>>;
  takeFromClaude(ids: number[]): void;
  tell(job: number, line: string, title?: string): void;
  claudeBind(job: number, token: string): void;
  claudeSeen(job: number): void;
  claudeGone(job: number): void;
  claudeKept(job: number): boolean;
  claudeOwner(job: number, token: string): boolean;
  claudeTokenOf(job: number): string;
  formSent(page: number): void;
  keptOf(j: Job): KeptJob;
  saveClaude(): void;
  saveClaudeSoon(): void;
  grabForms(): Promise<void>;
  grabForm(page: number): Promise<void>;
  saveClaudeNow(): Promise<void>;
  refill(page: number, form: KeptForm): Promise<{ put: number; missing: number; }>;
  restoreClaude(): Promise<void>;
  carryOn(token: string, name: string): { job: number; name: string; pages: { id: number; title: string; }[]; } | { live: string; } | null;
  earlierGroups(token: string): string[];
  claudeWork(): { doing: "filling an application" | "working"; where: string; tabs: number; } | null;
  workChanged(): void;
  handOff(page: number): void;
  driverAct(act: string, id: number): void;
  watch(pageId: number): void;
  unwatch(show?: boolean): void;
  // popout (browser-popout.ts)
  lend(id: number): { view: WebContentsView; url: string; title: string; } | null;
  giveBack(id: number, view: WebContentsView): void;
  isLent(id: number): boolean;
  guesses(text: string): Promise<string[]>;
  suggest(text: string): { kind: string; title: string; url: string; id?: number; }[];
  onePlaying(tab: Tab): void;
  pauseAll(): void;
  urlOf(id: number): string | null;
  mayPlay(sender: Electron.WebContents): { ok: boolean; shown: boolean; hold?: boolean; };
  seen(t: Tab): boolean;
  quietHidden(): void;
  pauseMedia(id: number): void;
  // mockups (browser-mockups.ts)
  openMockup(sheet: string, title?: string, branch?: string | null, o?: { project?: string | null; icon?: string | null; }): Promise<MockVersion | null>;
  openMockupDrop(m: MockupDrop): Promise<MockVersion | null>;
  openMockupDropWhy(m: MockupDrop): Promise<MockVersion | string>;
  mockHomeAdopt(): void;
  mockNo(why: string): null;
  mockKeep(m: MockupDrop): Promise<MockVersion | null>;
  mockSaySeen(commit: string): void;
  mockHomeWake(): Promise<number>;
  mockArt(commit: string, rel: string): Promise<Buffer | null>;
  mockWhere(sheet: string): { repo: string; rel: string; } | null;
  showMockup(ver: MockVersion): void;
  reopenMockups(): void;
  mockItem(ver: MockVersion, picture: boolean): Promise<MockSendItem>;
  mockLogos(): Record<string, string>;
  mockFindLogo(repo: string, project: string): void;
  mockShot(ver: MockVersion): Promise<string | null>;
  mockSend(what: "tab" | "version" | "branch", id: number): Promise<MockSend | null>;
  mockStages(): unknown[];
  mockMark(a: { repo: string; sheet: string; v: number | null; stage: string; said: string; note: string; }): string;
  mockAct(act: string, a?: { id?: number; sheet?: string; to?: string | number | null; name?: string; open?: boolean; }): void;
  mockTab(t: Tab): Record<string, unknown>;
  mockTidy(manual: boolean): Promise<string>;
  mockView(): Record<string, unknown> | null;
  mockTree(): Record<string, unknown>;
  isMockLog(sender: Electron.WebContents): boolean;
  openMockLog(): void;
  mockLogLeave(): void;
  mockLogWhere(w: { p: string; s: string | null; v: number | null; n: number | null; }): void;
  mockLogData(): Record<string, unknown> | null;
  pushMockLog(): void;
  mockLogSeen(sheet: string): void;
  mockLogStage(id: number, to: string | null, note: string): void;
  mockLogSend(id: number): void;
  cur(): Tab | undefined;
  go(address: string): void;
  act(what: string): void;
  find(text: string, next: boolean, back: boolean): void;
  findStop(): void;
  key(i: Electron.Input): boolean;
  // session (browser-session.ts)
  changed(): void;
  snapshot(all?: boolean): Promise<void>;
  snapshotNow(all?: boolean): Promise<void>;
  restore(): boolean;
  sendTabs(): void;
  sendPane(): void;
  hasWindow(): boolean;
  frontWindow(): BrowserWindow | null;
  closeAll(): void;
}
for (const part of [RailPart, PanesPart, TvPart, ThingsPart, AddressPart, NoticesPart, SyncPart, ClaudePart, PopoutPart, MockupsPart, SessionPart]) {
  for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(part))) Object.defineProperty(SamaraBrowser.prototype, k, { ...d, enumerable: false });
}
