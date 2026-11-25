// What is playing, for the music player (M1, 2026-11-25: the companion is retired; ported from its media.ts). The
// shape every source turns into: the Mac's own Spotify app (macspotify.ts) or Spotify's Web API for the device it is
// playing on (connect.ts). The player only ever sees this one shape.

export type MediaStatus = 'playing' | 'paused' | 'stopped' | 'changing' | 'opened' | 'closed';

/** `app: null` means nothing is playing anywhere. */
export interface MediaNow {
  t: 'media.now';
  v: 1;
  /** A short name for the app ('spotify', 'chrome'), or null when there is no session. */
  app: string | null;
  spotify?: boolean;
  title?: string;
  artist?: string;
  album?: string;
  status?: MediaStatus;
  /** Seconds into the song, true at `at` (unix ms). Add the time since `at` while playing. */
  position?: number;
  duration?: number;
  at?: number;
  canSeek?: boolean;
  /** Spotify's own volume, 0..1; null when it cannot be read. */
  volume?: number | null;
  /** Present only when the cover changed: a data URL (PNG or JPEG), or null for no cover. */
  thumb?: string | null;
}

/** The latest state, with the last cover kept, so a player opened later gets the full picture. */
export class MediaState {
  private latest: MediaNow | null = null;
  private thumb: string | null = null;
  take(m: MediaNow): void {
    if (m.app === null) { this.latest = m; this.thumb = null; return; }
    if (m.thumb !== undefined) this.thumb = m.thumb;
    this.latest = m;
  }
  /** What a player that just opened is sent: the latest, cover included. */
  now(): MediaNow | null {
    if (!this.latest) return null;
    if (this.latest.app === null) return this.latest;
    return { ...this.latest, thumb: this.thumb };
  }
}
