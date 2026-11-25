// The music player in Samara (M1, 2026-11-25, his "build it"): the player window (miniplayer.ts) and where its music
// comes from, with nothing else running. What used to be split between the companion's pet and its brain is here:
//
//  - the Mac: Spotify's own app on this Mac, read and steered through AppleScript while the player shows (macspotify.ts);
//  - both machines: Spotify's Web API for whatever device his account is playing on (connect.ts), every 5 s while the
//    player shows (never while it is hidden), and the keys on that device. On the PC this is the only feed.
//
// One stream reaches the player (connect.ts MediaMux): the Mac's own Spotify while it plays, else the device that plays.
// Spotify's sign-in is the companion's, copied in the first time; when there is none (or it expired) the player's ···
// menu offers "Sign in to Spotify", which opens Spotify's page in his browser and comes back to Samara by itself.
import { net, shell } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { MiniPlayer } from './miniplayer.ts';
import { MacSpotify } from './macspotify.ts';
import { ConnectPoller, MediaMux, checkDeviceId, readDevices, readPlayback } from './connect.ts';
import { Spotify, findCompanionSpotify, signIn, type Fetch } from './spotify.ts';
import type { PlayerCmd } from './playercmd.ts';
import type { MediaNow } from './media.ts';
import type { LyricsResult, SongKey } from './lyrics.ts';

export interface MusicHub {
  /** Open the player (or bring it forward). */
  open(): void;
  toggle(): void;
  close(): void;
  /** For Settings and the tests: signed in to Spotify on this computer. */
  readonly connected: boolean;
}

export interface MusicOpts {
  here: string;
  stateDir: string;
  origin: string;
  /** Where other programs keep their folders (the companion's spotify.json is looked for there). */
  appData: string;
  log(s: string): void;
  platform?: NodeJS.Platform;
  /** Tests: Spotify's network, the Mac's commands, lyrics, and where a sign-in page opens. */
  fetch?: Fetch;
  run?: import('./macspotify.ts').Run;
  lyrics?: (s: SongKey) => Promise<LyricsResult>;
  openUrl?: (url: string) => void;
}

const NOTE = {
  premium: 'Spotify only lets Premium be steered from here',
  reach: 'Can’t reach Spotify right now',
  move: 'Couldn’t move the music there',
  movePremium: 'Spotify only lets Premium move playback',
};

export function startMusic(o: MusicOpts): MusicHub {
  const mac = (o.platform ?? process.platform) === 'darwin';
  const fetcher: Fetch = o.fetch ?? ((url, init) => net.fetch(url, init as RequestInit) as never);
  const sp = new Spotify(path.join(o.stateDir, 'spotify.json'), fetcher);
  // the companion's sign-in, the first time (its file is only read)
  if (!sp.connected && sp.adopt(findCompanionSpotify(o.appData, path.join(o.stateDir, 'spotify.json')))) o.log('music: Spotify sign-in brought over from the companion');

  let note: string | null = null;
  const say = (t: string | null) => { if (t === note) return; note = t; player.setNote(t); };
  const mux = new MediaMux((m) => player.media(m as unknown as Record<string, unknown>));
  // Spotify's desktop app names its device after the computer: on the Mac that one is read locally, so it is this Mac's.
  const host = mac ? os.hostname().replace(/\.local$/i, '') : '';
  const poller = new ConnectPoller({
    fetch: async () => {
      if (!sp.connected) throw Object.assign(new Error('not connected'), { kind: 'none' });
      return readPlayback(await sp.playback(), Date.now(), host);
    },
    onState: (r) => {
      if (!mux.fromRemote(r) || !r?.coverUrl) return;
      const track = r.track, url = r.coverUrl;
      void sp.cover(url).then((d) => mux.cover(track, d), () => mux.cover(track, null));
    },
    onNote: (t) => { say(t); player.setSignIn(sp.connected ? 'ok' : signing ? 'waiting' : 'none'); },
  });
  const local = mac ? new MacSpotify((m: MediaNow) => { mux.fromPc(m); poller.setPcPlaying(mux.pcPlaying); }, (u) => sp.cover(u), o.run) : null;

  /** A key: the Mac's own Spotify when that is what shows, else the device his account plays on. */
  async function cmd(c: PlayerCmd): Promise<void> {
    const value = c.op === 'seek' ? c.position : c.op === 'volume' ? c.volume : undefined;
    if (mux.source === 'pc' && local) { await local.cmd(c.op, value); return; }
    const r = mux.remoteNow;
    if (!r) return;
    try {
      if (c.op === 'toggle') await sp.control(r.playing ? 'pause' : 'play', r.device.id);
      else if (c.op === 'seek') await sp.control('seek', r.device.id, c.position);
      else if (c.op === 'volume') await sp.control('volume', r.device.id, c.volume);
      else await sp.control(c.op, r.device.id);
      say(null);
    } catch (e) {
      const k = (e as { kind?: string }).kind;
      say(k === 'premium' ? NOTE.premium : k === 'device' ? `${r.device.name} isn’t answering` : NOTE.reach);
    }
    poller.soon();
  }

  let signing = false;
  async function doSignIn(): Promise<void> {
    if (signing) return;
    // no Client ID on this computer yet: the sign-in's first page asks for it
    const id = sp.clientId;
    signing = true; player.setSignIn('waiting');
    try {
      const t = await signIn(id, fetcher, o.openUrl ?? ((u) => { void shell.openExternal(u); }));
      sp.keep(t);
      o.log('music: signed in to Spotify');
      say(null);
      player.setSignIn('ok');
      poller.setVisible(false); poller.setVisible(player.watching);
    } catch (e) {
      say((e as Error).message.slice(0, 80));
      player.setSignIn('none');
    } finally { signing = false; }
  }

  const player: MiniPlayer = new MiniPlayer({
    origin: o.origin, preloadPath: path.join(o.here, 'playerpreload.cjs'), prefsFile: path.join(o.stateDir, 'player.json'),
    ...(o.lyrics ? { lyrics: o.lyrics } : {}),
    onCmd: (c) => { void cmd(c); },
    onWatch: (visible) => { poller.setVisible(visible); local?.watch(visible); },
    onDevices: () => {
      if (!sp.connected) { player.setDevices({ devices: [], error: 'Spotify isn’t connected' }); return; }
      void sp.devices().then((list) => player.setDevices({ devices: readDevices(list) }), () => player.setDevices({ devices: [], error: NOTE.reach }));
    },
    onTransfer: (raw) => {
      const id = checkDeviceId(raw);
      if (!id) return;
      void sp.transfer(id).then(() => { say(null); poller.soon(900); }, (e) => say((e as { kind?: string }).kind === 'premium' ? NOTE.movePremium : NOTE.move));
    },
    onSignIn: () => { void doSignIn(); },
  });
  player.setSignIn(sp.connected ? 'ok' : 'none');

  return {
    open: () => { player.open(); },
    toggle: () => player.toggle(),
    close: () => player.dispose(),
    get connected() { return sp.connected; },
  };
}
