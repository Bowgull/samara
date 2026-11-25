// Notifications (2026-11-25): per-site Allow / Ask / Block, kept, synced only stricter; asked only by a secure page
// for its own site.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SiteRules, notifyOrigin } from '../src/siterules.ts';

const fresh = () => { const f = path.join(mkdtempSync(path.join(os.tmpdir(), 'ntf-')), 'rules.json'); return { f, r: new SiteRules(f) }; };

test('a site asks until he answers; his answer is kept across starts', () => {
  const { f, r } = fresh();
  assert.equal(r.notify('https://mail.google.com/'), 'ask');
  r.set('mail.google.com', { notify: 'allow' });
  assert.equal(new SiteRules(f).notify('mail.google.com'), 'allow');
  r.set('discord.com', { notify: 'block' });
  assert.equal(new SiteRules(f).notify('https://discord.com/channels/1'), 'block');
  r.set('discord.com', { notify: 'ask' });
  assert.equal(JSON.parse(readFileSync(f, 'utf8'))['discord.com'], undefined, 'back to Ask keeps nothing');
});

test('a rule on the site covers its parts, as camera and mic do', () => {
  const { r } = fresh();
  r.set('google.com', { notify: 'block' });
  assert.equal(r.notify('calendar.google.com'), 'block');
  r.set('mail.google.com', { notify: 'allow' });
  assert.equal(r.notify('mail.google.com'), 'allow');
});

test('from the other computer only a Block travels', () => {
  const { r } = fresh();
  r.takeFromPeer({ 'discord.com': { notify: 'allow' }, 'spam.example': { notify: 'block' } });
  assert.equal(r.notify('discord.com'), 'ask');
  assert.equal(r.notify('spam.example'), 'block');
});

test('only a secure page may ask, and only for its own site', () => {
  assert.equal(notifyOrigin('https://mail.google.com/', 'https://mail.google.com/mail/u/0'), true);
  assert.equal(notifyOrigin('https://chat.discord.com/', 'https://discord.com/app'), true);
  assert.equal(notifyOrigin('https://ads.example/', 'https://mail.google.com/'), false, 'a frame from another site');
  assert.equal(notifyOrigin('http://mail.google.com/', 'http://mail.google.com/'), false, 'not secure');
  assert.equal(notifyOrigin('nonsense', 'https://mail.google.com/'), false);
  assert.equal(notifyOrigin('https://foo.or.jp/', 'https://bar.or.jp/'), false, 'two registrants under a public suffix');
  assert.equal(notifyOrigin('https://a.github.io/', 'https://b.github.io/'), false, 'two sites on a shared host');
  assert.equal(notifyOrigin('https://www.bbc.co.uk/', 'https://news.bbc.co.uk/'), true);
  assert.equal(notifyOrigin('https://127.0.0.1:8443/', 'https://127.0.0.1:8443/x'), true);
  assert.equal(notifyOrigin('https://127.0.0.2/', 'https://127.0.0.1/'), false);
});
