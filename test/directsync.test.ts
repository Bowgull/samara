// N2 (2026-11-25): Samara to Samara. The Mac pairs through the hub, then the two talk straight; only bsync passes;
// a wrong token, another address or a web page is refused; a pairing survives a restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { DirectClient, DirectHost, DIRECT_PATH } from '../src/directsync.ts';
import type { Keeper } from '../src/sealedfile.ts';

const plain: Keeper = { available: () => true, seal: (s) => Buffer.from(s).toString('base64'), open: (s) => Buffer.from(s, 'base64').toString() };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'direct-'));
let port = 47930;
function pairUp() {
  const p = ++port;
  const atPc: Record<string, unknown>[] = [], atMac: Record<string, unknown>[] = [];
  const links: string[] = [];
  const common = { keeper: plain, log: () => {}, bind: () => '127.0.0.1', peerOk: (a: string) => a === '127.0.0.1', port: p };
  const pcDir = tmp(), macDir = tmp();
  const host = new DirectHost({ ...common, stateDir: pcDir, onMessage: (m) => atPc.push(m), onLink: (up) => links.push('pc ' + up) });
  const client = new DirectClient({ ...common, stateDir: macDir, onMessage: (m) => atMac.push(m), onLink: (up) => links.push('mac ' + up) });
  return { host, client, atPc, atMac, links, p, pcDir, macDir, common };
}

test('pairs through the hub, then bsync goes straight both ways; nothing else passes', async () => {
  const { host, client, atPc, atMac, links, p } = pairUp();
  assert.equal(client.send({ t: 'bsync.notes', list: [] }), false, 'not up yet: the caller uses the hub');
  const pm = client.pairMsg()!;
  let reply: Record<string, unknown> | null = null;
  assert.equal(host.pair(pm, (r) => { reply = r; }), true);
  assert.deepEqual(reply, { t: 'bsync.paired', port: p });
  await wait(100);
  client.start('127.0.0.1', p);
  await wait(300);
  assert.ok(client.up && host.up);
  assert.deepEqual(links.sort(), ['mac true', 'pc true']);
  assert.equal(client.send({ t: 'bsync.notes', list: [1] }), true);
  assert.equal(host.send({ t: 'bsync.tabs', at: 1 }), true);
  assert.equal(host.send({ t: 'update.get' }), false, 'only bsync');
  await wait(100);
  assert.deepEqual(atPc, [{ t: 'bsync.notes', list: [1] }]);
  assert.deepEqual(atMac, [{ t: 'bsync.tabs', at: 1 }]);
  client.close(); host.close();
});

test('refused: a wrong token, a web page, another path, a pairing that is not one', async () => {
  const { host, client, p } = pairUp();
  host.pair(client.pairMsg()!, () => {});
  await wait(100);
  const tryWs = (headers: Record<string, string>, at = DIRECT_PATH) => new Promise<string>((res) => {
    const s = new WebSocket(`ws://127.0.0.1:${p}${at}`, { headers });
    s.on('open', () => { s.close(); res('open'); }); s.on('error', () => res('refused')); s.on('unexpected-response', () => res('refused'));
  });
  const token = String(client.pairMsg()!.token);
  assert.equal(await tryWs({ 'x-samara-pair': 'A'.repeat(43) }), 'refused');
  assert.equal(await tryWs({ 'x-samara-pair': token, origin: 'https://evil.example' }), 'refused');
  assert.equal(await tryWs({ 'x-samara-pair': token }, '/other'), 'refused');
  assert.equal(await tryWs({ 'x-samara-pair': token }), 'open');
  assert.equal(host.pair({ t: 'bsync.pair', token: 'short', mac: '127.0.0.1' }, () => {}), false);
  assert.equal(host.pair({ t: 'bsync.pair', token, mac: '8.8.8.8' }, () => {}), false, 'only a Tailscale peer');
  client.close(); host.close();
});

test('the pairing is kept: after a restart the two connect with no hub at all', async () => {
  const { host, client, p, pcDir, macDir, common } = pairUp();
  host.pair(client.pairMsg()!, () => {});
  host.close(); client.close();
  await wait(100);
  const got: unknown[] = [];
  const host2 = new DirectHost({ ...common, stateDir: pcDir, onMessage: (m) => got.push(m) });
  const client2 = new DirectClient({ ...common, stateDir: macDir, onMessage: () => {} });
  assert.equal(client2.pairMsg()!.token, client.pairMsg()!.token, 'the Mac keeps its token');
  host2.listen();
  await wait(100);
  client2.start('127.0.0.1', p);
  await wait(300);
  assert.ok(client2.up);
  client2.send({ t: 'bsync.media' });
  await wait(100);
  assert.deepEqual(got, [{ t: 'bsync.media' }]);
  client2.close(); host2.close();
});
