// The engine a machine really runs, in one report (QA plan, 2026-11-25): its Electron and Chromium versions and every
// fuse (Electron's built-in safety switches), read from the binary itself. Read-only: it changes nothing.
//
//   node tools/qa/engine-report.mjs <electron binary>
//     Windows: %LOCALAPPDATA%\Samara\engines\castlabs-<v>\electron.exe (or the engine Samara is running)
//     Mac:     the .app's Contents/MacOS/Electron (or Samara's engine inside its own folder)
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';

const bin = process.argv[2];
if (!bin || !existsSync(bin)) { console.error('Give the path to the engine: node tools/qa/engine-report.mjs <electron binary>'); process.exit(2); }
const wire = await getCurrentFuseWire(bin);
const fuseOn = (o) => { const v = wire[o]; return v === '1' || v === 49 || v === true; };
// The versions, asked of the engine itself running as plain Node. Only while its RunAsNode fuse is on: with it off the
// engine would start as an app instead (Codex on PR #15), so it is not asked at all.
let versions = 'not asked (RunAsNode is off, so the engine cannot run as plain Node)';
if (fuseOn(FuseV1Options.RunAsNode)) {
  try {
    versions = execFileSync(bin, ['-p', 'JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node })'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 20_000 }).trim();
  } catch { versions = 'unknown (the engine did not answer)'; }
}
console.log(`engine:   ${bin}\nversions: ${versions}`);
// What each switch should be for a browser that holds his logins (Electron's security guidance); castLabs ships its
// own settings, which Samara keeps when it must for paid video (engineupdate.ts).
const want = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  // The two ASAR switches do not apply: Samara runs its code from a folder, checked by its own integrity seal
  // (integrity.ts), not from an .asar file.
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: undefined,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
};
let off = 0;
for (const [k, v] of Object.entries(wire)) {
  if (k === 'version' || k === 'strictlyRequireAllFuses' || k === 'resetAdHocDarwinSignature') continue;
  const name = FuseV1Options[Number(k)] ?? `fuse ${k}`;
  const on = v === '1' || v === 49 || v === true;
  const w = want[Number(k)];
  const flag = w === undefined ? '' : on === w ? '  ok' : '  << differs from the recommended setting';
  if (flag.startsWith('  <<')) off++;
  console.log(`  ${name.padEnd(42)} ${on ? 'on ' : 'off'}${flag}`);
}
console.log(off ? `\n${off} switch(es) differ from Electron's recommended settings for an app like this.` : '\nEvery switch is as recommended.');
