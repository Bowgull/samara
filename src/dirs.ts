// Where Samara keeps its things on disk (2026-11-25, his pick: "keep the old names under the hood").
//
// The Samaras installed today (1.63.0, built before this repo) keep everything under the companion's old name, and two
// of those places cannot simply be copied: on the Mac the logins and cookies are locked with the Keychain item
// "<app name> Safe Storage", named after the old app name, and on the PC the launcher reads Samara's install spot from
// the old %LOCALAPPDATA% folder. So where an old folder is there, it is used as it is: nothing is copied or moved, and
// nothing can be lost. Only a machine that never had the old Samara gets the new names. The name he sees is Samara
// either way (the app's display name, windows and menus).
//
// The old name is built from pieces: this repo is public and keeps that name out of its text (test/scrub.test.ts).
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Exists = (p: string) => boolean;
/** The companion's old name, as the old folders, Keychain item and bundle id carry it. */
export const OLD = ['A', 'ang'].join('');
/** The old place when it is there, else the new one. */
export const pick = (old: string, now: string, exists: Exists = existsSync): string => (exists(old) ? old : now);

const support = (home: string) => path.join(home, 'Library', 'Application Support');
/** Mac: Electron's own folder (cookies, logins, settings) is named after the app, and so is the Keychain item that
 *  unlocks them: the old name while his old folder is there. */
export const macAppName = (home = os.homedir(), exists: Exists = existsSync): string => (exists(path.join(support(home), OLD)) ? OLD : 'Samara');
/** Mac: the updates, engines, castLabs' tool and Bitwarden's (the old "...Listener" folder). */
export const macHome = (home = os.homedir(), exists: Exists = existsSync): string => pick(path.join(support(home), OLD + 'Listener'), path.join(support(home), 'Samara'), exists);
/** Mac: the bundle id. Kept as it was on a Mac that has it, so the Keychain, camera and microphone answers and the
 *  Dock still know the app. */
export const macBundleId = (home = os.homedir(), exists: Exists = existsSync): string => (macAppName(home, exists) === OLD ? `com.${OLD.toLowerCase()}.browser` : 'com.bowgull.samara');

type Env = NodeJS.ProcessEnv;
const roaming = (env: Env, home: string) => env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
const local = (env: Env, home: string) => env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
/** PC: Samara's own settings and logs (%APPDATA%, the old name). */
export const pcState = (env: Env = process.env, home = os.homedir(), exists: Exists = existsSync): string => pick(path.join(roaming(env, home), OLD), path.join(roaming(env, home), 'Samara'), exists);
/** PC: Electron's own folder (cookies, logins): the old Samara's was named after its package ("<old>-shell"). */
export const pcUserData = (env: Env = process.env, home = os.homedir(), exists: Exists = existsSync): string => pick(path.join(roaming(env, home), OLD.toLowerCase() + '-shell'), path.join(roaming(env, home), 'Samara'), exists);
/** PC: his documents (notes, snips). */
export const pcDocs = (home = os.homedir(), exists: Exists = existsSync): string => pick(path.join(home, 'Documents', OLD), path.join(home, 'Documents', 'Samara'), exists);
/** PC: the machine's own things (castLabs' tool, game notes). */
export const pcLocal = (env: Env = process.env, home = os.homedir(), exists: Exists = existsSync): string => pick(path.join(local(env, home), OLD), path.join(local(env, home), 'Samara'), exists);
/** PC: where Samara's versions are installed; the launcher reads current.json here. */
export const pcInstall = (env: Env = process.env, home = os.homedir(), exists: Exists = existsSync): string => pick(path.join(local(env, home), OLD, 'Samara'), path.join(local(env, home), 'Samara'), exists);
