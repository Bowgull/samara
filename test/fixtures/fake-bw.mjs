#!/usr/bin/env node
// A stand-in for Bitwarden's command-line tool, for the autofill harnesses only (test/electron/autofill-check.ts,
// autofill-attacks-check.ts). It keeps a tiny made-up vault in FAKE_BW_DIR, takes the master password "correct horse",
// and logs every create and edit. Samara runs it under its own Electron as plain Node (vault.ts, SAMARA_TEST_BW), so it
// works the same on Windows, the Mac and Linux.
//   FAKE_BW_DIR/items.json   the vault's logins, if the harness wrote its own (else the one below), kept up to date by edits
//   FAKE_BW_DIR/state.json   { unlocked, session }: a harness may start it unlocked with its own session key
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
const dir = process.env.FAKE_BW_DIR, state = path.join(dir, 'state.json'), itemsFile = path.join(dir, 'items.json');
const st = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : { unlocked: false };
const SESSION = st.session || 'fakesessionkeyfakesessionkey0123456789';
const save = () => writeFileSync(state, JSON.stringify(st));
const items = existsSync(itemsFile) ? JSON.parse(readFileSync(itemsFile, 'utf8'))
  : [{ id: '11111111-1111-1111-1111-111111111111', type: 1, name: 'Northwind', login: { username: 'alex@example.com', password: 'opensesame', uris: [{ uri: 'https://shop.example' }] } }];
const [cmd, a1, ...rest] = process.argv.slice(2);
const ok = (o) => { process.stdout.write(typeof o === 'string' ? o : JSON.stringify(o)); process.exit(0); };
const live = () => st.unlocked && process.env.BW_SESSION === SESSION;
const stdin = (then) => { let b = ''; process.stdin.on('data', (d) => { b += d; }); process.stdin.on('end', () => then(Buffer.from(b.trim(), 'base64').toString('utf8'))); };
// Bitwarden's --url match is by whole domain (a login for example.com answers forum.example.com too); Samara narrows it.
const base = (h) => h.split('.').slice(-2).join('.');
if (cmd === 'status') ok({ status: live() ? 'unlocked' : 'locked', userEmail: 'alex@example.com' });
if (cmd === 'unlock') { if (process.env.SAMARA_BW_UNLOCK === 'correct horse') { st.unlocked = true; save(); ok(SESSION); } process.exit(1); }
if (cmd === 'lock') { st.unlocked = false; save(); ok('locked'); }
if (cmd === 'sync') ok('synced');
if (!live()) process.exit(1);
if (cmd === 'list' && a1 === 'items') { const i = rest.indexOf('--url'); const u = i >= 0 ? rest[i + 1] : null; ok(u ? items.filter((x) => x.login.uris.some((y) => base(new URL(u).hostname) === base(new URL(/^[a-z]+:\/\//i.test(y.uri) ? y.uri : 'https://' + y.uri).hostname))) : items); }
else if (cmd === 'get' && a1 === 'item') { const it = items.find((x) => x.id === rest[0]); if (!it) process.exit(1); ok(it); }
else if (cmd === 'create' && a1 === 'item') stdin((j) => { appendFileSync(path.join(dir, 'created.log'), j + '\n'); ok('{"id":"new"}'); });
else if (cmd === 'edit' && a1 === 'item') stdin((j) => {
  const i = items.findIndex((x) => x.id === rest[0]);
  if (i < 0) process.exit(1);
  appendFileSync(path.join(dir, 'edited.log'), rest[0] + ' ' + j + '\n');
  items[i] = { ...JSON.parse(j), id: rest[0] }; writeFileSync(itemsFile, JSON.stringify(items));
  ok(items[i]);
});
else process.exit(1);
