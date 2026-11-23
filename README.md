# samara 🏮

my own desktop browser. hand-drawn, runs on my pc and my mac, and claude can drive it without touching my real one.

🚧 still building. rough edges are mine 🙂

**what it does**
- tabs live in a drawer, not a strip. peek at one without switching, or put two pages side by side
- a little shield on every site: ads, popups, dark mode and what claude may do there, per site
- ads and trackers blocked, cookie banners declined by themselves
- warns about scam pages and lookalike addresses (b1izzard.com style) before they load. safe browsing runs in private mode, so google never sees where i go
- paid video works (netflix and friends), pops out into its own little window, and goes to the tv when i want
- skips youtube sponsor bits and anime openings, using community databases
- one browser on two machines: bookmarks, settings, history and open tabs sync between my mac and my pc
- fills my logins from bitwarden, only when i click the key
- every version is named after a character. we're on gojo right now ^_^

**claude in the browser**
- claude gets its own tabs, grouped in my tab list, with a big STOP key
- before it starts, claude shows me its plan: the task, the sites, the steps. i can untick a site or tell it what to change
- bank and money sites are never opened for it
- it reads pages through fixed, read-only readers. it never runs its own code on a page
- the mockups trail: every design claude makes for me opens here, filed by project and topic, every version kept

**what i did**
i planned it, designed how it looks, set the rules for what claude can and can't do, and tested every piece on both machines before moving on. ai tools wrote the code, i was the very picky boss 🙂

**built with** electron (castlabs' build, for paid video), typescript, node 24

---

## running it

```
npm install
npm start          # windows
npm run start:mac  # macos
```

```
npm run check      # type check
npm test           # unit tests
```

Paid video needs castLabs' engine signed with your own castLabs EVS account; everything else runs on plain Electron.
The checks under `test/electron/` open real windows, so on Windows they run on a hidden desktop:
`tools/hidden-desktop-run.ps1`.

## licence

Copyright (c) 2026 Bowgull. All rights reserved. The code is public to read, not to reuse: there is no open-source
licence. Work by others that Samara uses keeps its own licence; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
and [docs/LICENCES.md](docs/LICENCES.md).
