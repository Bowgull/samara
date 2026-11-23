# Third-party notices

Samara uses the following work by others. Each keeps its own licence; nothing here changes it. Versions are the ones
in `package.json`. Packages installed by npm are not stored in this repo; their licence texts ship inside each package
in `node_modules`.

## Libraries

| Component | Version | Licence | Notes |
|---|---|---|---|
| Electron | 44.7.0 | MIT | Includes Chromium and Node.js, each under its own licences (see Electron's `LICENSES.chromium.html`). |
| castLabs Electron for Content Security (`electron-drm`, castlabs/electron-releases) | 44.5.1+wvcus | MIT for the Electron code; **not cleared for the rest** | The Widevine CDM it downloads and the castLabs EVS signing service come under castLabs' and Google's own terms, not MIT. See [docs/LICENCES.md](docs/LICENCES.md). |
| Ghostery adblocker (`@ghostery/adblocker-electron`, `@ghostery/adblocker`) | 2.18.2 | MPL-2.0 | Used unmodified from npm. MPL-2.0 is file-level: changes to its own files would have to be shared under MPL-2.0. |
| DuckDuckGo Autoconsent (`@duckduckgo/autoconsent`) | 16.53.0 | MPL-2.0 | Used unmodified from npm. Same MPL-2.0 file-level terms. |
| Dark Reader (`darkreader`) | 4.9.133 | MIT | |
| tldts (`tldts-experimental`) | 7.4.x | MIT | Built on the Public Suffix List (MPL-2.0). |
| ws | 8.x | MIT | |
| rcedit (build tool only) | 4.0.1 | MIT | Stamps Samara's name and icon on the engine. |
| @electron/fuses (build tool only) | 1.8.x | MIT | |
| pixelarticons (`pages/art/pixelarticons/`) | | MIT, (c) 2019 Gerrit Halfmann | Licence text alongside. |
| Ad and tracker filter lists (uBlock Origin, EasyList and others) | fetched at run time | Their own (GPL-3.0, CC BY-SA 3.0 and others) | Downloaded by Samara when it starts; not stored in this repo. |

## Fonts

| Font | Where | Licence |
|---|---|---|
| Cinzel | `pages/fonts/` | SIL Open Font License 1.1 (text alongside) |
| Figtree | `pages/fonts/` | SIL OFL 1.1 (text alongside) |
| Silkscreen | `pages/fonts/` | SIL OFL 1.1 (text alongside) |
| Caveat, IM Fell English, Patrick Hand, Press Start 2P, VT323 | `pages/fonts/notes/` | SIL OFL 1.1 (texts alongside) |
| Special Elite | `pages/fonts/notes/` | Apache-2.0 (text alongside) |

OFL fonts may be bundled and redistributed with software under any licence, but may not be sold on their own.
