// His pick (2026-11-25): the old Samara's folders, Keychain name and install spot are used as they are; a machine that
// never had the old Samara gets the new names. Nothing is copied or moved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OLD, macAppName, macBundleId, macHome, pcDocs, pcInstall, pcLocal, pcState, pcUserData } from '../src/dirs.ts';
import { evsHome } from '../src/evs.ts';
import { macUpdateScript } from '../src/macupdate.ts';
import { backScript } from '../src/macsource.ts';

const home = () => mkdtempSync(path.join(os.tmpdir(), 'dirs-'));
const sup = (h: string, ...p: string[]) => path.join(h, 'Library', 'Application Support', ...p);

test('Mac with the old Samara: its folders, app name (the Keychain item) and bundle id are kept', () => {
  const h = home();
  mkdirSync(sup(h, OLD), { recursive: true }); mkdirSync(sup(h, OLD + 'Listener'), { recursive: true });
  assert.equal(macAppName(h), OLD);
  assert.equal(macHome(h), sup(h, OLD + 'Listener'));
  assert.equal(macBundleId(h), `com.${OLD.toLowerCase()}.browser`);
  assert.equal(evsHome('darwin', {}, h), sup(h, OLD + 'Listener', 'evs'));
});

test('a fresh Mac gets the new names', () => {
  const h = home();
  assert.equal(macAppName(h), 'Samara');
  assert.equal(macHome(h), sup(h, 'Samara'));
  assert.equal(macBundleId(h), 'com.bowgull.samara');
  assert.equal(evsHome('darwin', {}, h), sup(h, 'Samara', 'evs'));
});

test('PC with the old Samara: settings, cookies, documents, castLabs and the install spot the launcher reads', () => {
  const h = home(), env = { APPDATA: path.join(h, 'Roaming'), LOCALAPPDATA: path.join(h, 'Local') };
  for (const d of [path.join(env.APPDATA, OLD), path.join(env.APPDATA, OLD.toLowerCase() + '-shell'), path.join(h, 'Documents', OLD), path.join(env.LOCALAPPDATA, OLD, 'Samara')]) mkdirSync(d, { recursive: true });
  assert.equal(pcState(env, h), path.join(env.APPDATA, OLD));
  assert.equal(pcUserData(env, h), path.join(env.APPDATA, OLD.toLowerCase() + '-shell'));
  assert.equal(pcDocs(h), path.join(h, 'Documents', OLD));
  assert.equal(pcLocal(env, h), path.join(env.LOCALAPPDATA, OLD));
  assert.equal(pcInstall(env, h), path.join(env.LOCALAPPDATA, OLD, 'Samara'));
  assert.equal(evsHome('win32', env, h), path.join(env.LOCALAPPDATA, OLD, 'evs'));
});

test('a fresh PC gets the new names', () => {
  const h = home(), env = { APPDATA: path.join(h, 'Roaming'), LOCALAPPDATA: path.join(h, 'Local') };
  assert.equal(pcState(env, h), path.join(env.APPDATA, 'Samara'));
  assert.equal(pcUserData(env, h), path.join(env.APPDATA, 'Samara'));
  assert.equal(pcDocs(h), path.join(h, 'Documents', 'Samara'));
  assert.equal(pcInstall(env, h), path.join(env.LOCALAPPDATA, 'Samara'));
  assert.equal(evsHome('win32', env, h), path.join(env.LOCALAPPDATA, 'Samara', 'evs'));
});

test('the Mac update and going back use his folder, and keep the app\'s old name and id (the Keychain item)', () => {
  const dir = "/Users/x/Library/Application Support/" + OLD + 'Listener';
  const id = `com.${OLD.toLowerCase()}.browser`;
  const s = macUpdateScript({ bundle: '/tmp/samara-1.0.0.tgz', version: '1.0.0', commit: 'a'.repeat(12), where: { dir, name: OLD, id } });
  assert.ok(s.includes(`DIR='${dir}'`), 'his folder');
  assert.ok(s.includes(`Set :CFBundleName ${OLD}`) && s.includes(`Set :CFBundleIdentifier ${id}`), 'the old name and id, so the Keychain item still opens');
  assert.ok(s.includes('Set :CFBundleDisplayName Samara') || s.includes('string Samara'), 'he still sees Samara');
  assert.ok(s.includes(`quit app id "${id}"`));
  assert.ok(!s.includes('Application Support/Samara'));
  const b = backScript(dir, id);
  assert.ok(b.includes(`BR='${dir}/browser'`) && b.includes(`quit app id "${id}"`) && !b.includes('com.bowgull'));
  assert.throws(() => macUpdateScript({ bundle: '/tmp/s.tgz', version: '1.0.0', commit: 'a'.repeat(12), where: { dir, name: 'x; rm -rf ~', id } }));
});
