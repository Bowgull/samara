// The music player in Samara (M1, 2026-11-25): the companion's Spotify sign-in comes over without being touched, an
// expired sign-in keeps the Client ID for the next one, a sign-in in his browser comes back to Samara by itself (asking
// for the Client ID first when this computer has none), and the Mac's own Spotify is read and steered in AppleScript.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Spotify, findCompanionSpotify, signIn, REDIRECT, type Fetch } from '../src/spotify.ts';
import { MacSpotify, readSpotify, scriptFor, type Run } from '../src/macspotify.ts';
import type { MediaNow } from '../src/media.ts';

const ID = 'a1'.repeat(16);
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'music-'));
const okJson = (j: unknown, status = 200) => ({ ok: status < 300, status, json: async () => j, text: async () => JSON.stringify(j) });

test('the companion\'s sign-in is found by its shape and copied in; its own file is left as it was', () => {
  const appData = tmp();
  mkdirSync(path.join(appData, 'Old'));
  mkdirSync(path.join(appData, 'Other'));
  mkdirSync(path.join(appData, 'Samara'));
  const theirs = path.join(appData, 'Old', 'spotify.json');
  const body = JSON.stringify({ clientId: ID, refreshToken: 'refresh-token-1', accessToken: 'x', expiresAt: 1 });
  writeFileSync(theirs, body);
  writeFileSync(path.join(appData, 'Other', 'spotify.json'), JSON.stringify({ something: 'else' }));
  const mine = path.join(appData, 'Samara', 'spotify.json');
  assert.equal(findCompanionSpotify(appData, mine, {}), theirs);
  const sp = new Spotify(mine, (async () => okJson({})) as Fetch);
  assert.equal(sp.connected, false);
  assert.equal(sp.adopt(theirs), true);
  assert.equal(sp.connected, true);
  assert.equal(JSON.parse(readFileSync(mine, 'utf8')).refreshToken, 'refresh-token-1');
  assert.equal(readFileSync(theirs, 'utf8'), body, 'the companion\'s file is untouched');
  if (process.platform !== 'win32') assert.equal(statSync(mine).mode & 0o077, 0, 'readable by him only');
  assert.equal(sp.adopt(theirs), false, 'never over a sign-in Samara already has');
  // Samara's own file is never taken for the companion's
  assert.equal(findCompanionSpotify(appData, mine, {}), theirs);
});

test('an expired sign-in is forgotten but its Client ID is kept for the next sign-in; a new refresh token is kept', async () => {
  const f = path.join(tmp(), 'spotify.json');
  writeFileSync(f, JSON.stringify({ clientId: ID, refreshToken: 'refresh-token-1' }));
  let answer: unknown = { access_token: 'tok', expires_in: 3600, refresh_token: 'refresh-token-2' };
  let status = 200;
  const fetcher = (async (url: string) => (url.includes('/api/token') ? okJson(answer, status) : okJson({ devices: [] }))) as Fetch;
  const sp = new Spotify(f, fetcher, () => 1000);
  await sp.devices();
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).refreshToken, 'refresh-token-2', 'PKCE rotates it: the new one is kept');
  const sp2 = new Spotify(f, fetcher, () => 10_000_000);
  answer = { error: 'invalid_grant' }; status = 400;
  await assert.rejects(sp2.devices(), (e: { kind?: string }) => e.kind === 'signin');
  assert.equal(sp2.connected, false);
  assert.equal(sp2.clientId, ID);
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { clientId: ID });
});

test('Spotify turning a token down: refreshed and tried once more; turned down again, the player offers Sign in again', async () => {
  const f = path.join(tmp(), 'spotify.json');
  writeFileSync(f, JSON.stringify({ clientId: ID, refreshToken: 'refresh-token-1', accessToken: 'old', expiresAt: 9e15 }));
  let refreshes = 0, calls = 0, refuse = 1;
  const fetcher = (async (url: string) => {
    if (url.includes('/api/token')) { refreshes++; return okJson({ access_token: 'new' + refreshes, expires_in: 3600 }); }
    calls++;
    return calls <= refuse ? okJson({ error: { message: 'expired' } }, 401) : okJson({ devices: [] });
  }) as Fetch;
  const sp = new Spotify(f, fetcher, () => 1000);
  assert.deepEqual(await sp.devices(), [], 'once: a fresh token, and it goes through');
  assert.equal(refreshes, 1);
  assert.equal(sp.connected, true);
  calls = 0; refuse = 5;
  await assert.rejects(sp.devices(), (e: { kind?: string }) => e.kind === 'signin');
  assert.equal(calls, 2, 'tried once more, not forever');
  assert.equal(sp.connected, false, 'not connected: the player shows Sign in to Spotify');
  assert.equal(sp.clientId, ID, 'the Client ID is kept for the next sign-in');
});

test('a sign-in: his browser goes to Spotify and comes back to Samara with the code; a stranger\'s answer is ignored', async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string, init?: { body?: string }) => { calls.push(url + ' ' + (init?.body ?? '')); return okJson({ access_token: 'a', refresh_token: 'refresh-token-9', expires_in: 3600 }); }) as Fetch;
  const t = await signIn(ID, fetcher, (url) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://accounts.spotify.com');
    assert.equal(u.searchParams.get('redirect_uri'), REDIRECT);
    assert.equal(u.searchParams.get('client_id'), ID);
    const state = u.searchParams.get('state')!;
    void (async () => {
      const stranger = await fetch(`http://127.0.0.1:47835/callback?state=nope&code=evil`);
      assert.equal(stranger.status, 200);
      await fetch(`http://127.0.0.1:47835/callback?state=${state}&code=good`);
    })();
  }, 10_000);
  assert.equal(t.refreshToken, 'refresh-token-9');
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /code=good/);
  assert.doesNotMatch(calls[0]!, /evil/);
});

test('a sign-in with no Client ID on this computer asks for it first, then goes on to Spotify', async () => {
  const fetcher = (async () => okJson({ access_token: 'a', refresh_token: 'refresh-token-7', expires_in: 3600 })) as Fetch;
  const t = await signIn(null, fetcher, (url) => {
    const u = new URL(url);
    assert.equal(u.origin, 'http://127.0.0.1:47835');
    const n = u.searchParams.get('n')!;
    void (async () => {
      const form = await (await fetch(url)).text();
      assert.match(form, /Client ID/);
      assert.equal((await fetch('http://127.0.0.1:47835/start?n=wrong&id=' + ID)).status, 404, 'only this sign-in\'s page');
      assert.match(await (await fetch(`http://127.0.0.1:47835/start?n=${n}&id=nonsense`)).text(), /not a Client ID/);
      const go = await fetch(`http://127.0.0.1:47835/start?n=${n}&id=${ID.toUpperCase()}`, { redirect: 'manual' });
      assert.equal(go.status, 302);
      const to = new URL(go.headers.get('location')!);
      assert.equal(to.origin, 'https://accounts.spotify.com');
      await fetch(`http://127.0.0.1:47835/callback?state=${to.searchParams.get('state')}&code=good`);
    })();
  }, 10_000);
  assert.equal(t.clientId, ID, 'kept in the usual lower case');
});

test('a sign-in he cancels says so; a door that is not opened in time closes', async () => {
  const fetcher = (async () => okJson({})) as Fetch;
  await assert.rejects(signIn(ID, fetcher, (url) => { const s = new URL(url).searchParams.get('state'); void fetch(`http://127.0.0.1:47835/callback?state=${s}&error=access_denied`); }, 10_000), /cancelled/);
  await assert.rejects(signIn(ID, fetcher, () => {}, 200), /not finished in time/);
  await assert.rejects(signIn('nope', fetcher, () => {}), /not a Spotify Client ID/);
});

test('the Mac\'s Spotify: its line is read, its keys are AppleScript, nothing is asked while the player is hidden', async () => {
  assert.deepEqual(readSpotify('Song\tBand\tRecord\tplaying\t12,5\t180000\t40\thttps://i.scdn.co/image/x\n'),
    { title: 'Song', artist: 'Band', album: 'Record', status: 'playing', position: 12.5, duration: 180, volume: 0.4, art: 'https://i.scdn.co/image/x' });
  assert.equal(readSpotify('too\tshort'), null);
  assert.equal(readSpotify('S\tB\tR\tpaused\t1\t1000\t50\tjavascript:x')!.art, '', 'only an https cover');
  assert.equal(scriptFor('toggle'), 'tell application "Spotify" to playpause');
  assert.equal(scriptFor('volume', 3), 'tell application "Spotify" to set sound volume to 100');
  assert.equal(scriptFor('seek', -4), 'tell application "Spotify" to set player position to 0.0');
  assert.equal(scriptFor('rm -rf'), null);

  const ran: string[] = [];
  let up = true;
  const run: Run = async (file, args) => { ran.push(file + ' ' + args.join(' ')); if (file.endsWith('pgrep')) return { ok: up, out: '' }; return { ok: true, out: 'Song\tBand\tRecord\tplaying\t10\t200000\t50\thttps://i.scdn.co/a\n' }; };
  const sent: MediaNow[] = [];
  const m = new MacSpotify((x) => sent.push(x), async () => 'data:image/jpeg;base64,AA', run);
  await m.read();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.title, 'Song'); assert.equal(sent[0]!.thumb, 'data:image/jpeg;base64,AA');
  await m.read();
  assert.equal(sent.length, 1, 'no change, nothing sent');
  up = false;
  await m.read(); await m.read();
  assert.equal(sent.length, 2); assert.equal(sent[1]!.app, null, 'Spotify closed: said once');
  ran.length = 0;
  m.watch(false);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(ran.length, 0, 'hidden: nothing asked');
  up = true;
  assert.equal(await m.cmd('next'), true);
  assert.ok(ran.some((r) => r.includes('next track')));
  up = false;
  assert.equal(await m.cmd('next'), false, 'Spotify not running here');
});
