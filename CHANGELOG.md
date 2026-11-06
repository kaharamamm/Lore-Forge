# Changelog

All notable changes to Lore-Forge are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Duplicate world**, on the shelf next to Delete and on the world home: a copy with a new id and its cover, which opens straight away. Works on the read-only sample world. `lore duplicate` does the same from the command line.
- **First-run tour** (eight steps through the library and the sample world), with Skip, Back and Next and Esc. Shown once; **Take the tour** in the library and in About brings it back.
- **3D models** for entries: **Images | 3D model** tabs in the editor. `.glb`, embedded `.gltf`, `.obj` and `.fbx`, stored in `models/<entry-id>/`, several per entry. The viewer (three.js) orbits, zooms, pans, resets and auto-rotates.
- Pictures for the sample world Camelamamm: portraits and scenes for its entries and cover.
- **Self-update** from GitHub Releases: a check at start and every four hours, a notice with Download, Later and What's new, progress, and Restart to update. **About → Updates** has Check now and an on/off switch. Worlds are never touched.
- The **`lore` command-line tool** ships with the app: `/usr/bin/lore` from the `.deb`, `resources\bin\lore.cmd` on Windows, `Lore-Forge.app/Contents/Resources/bin/lore` on macOS.
- Stable download links that never change between versions (`releases/latest/download/Lore-Forge-amd64.deb` and so on).

### Changed

- **Timeline redesign**, a Gantt chart in the app's look: era ribbons and coloured era columns, a sticky year axis with months when zoomed in, solid cards in each type's colour with icon, name and dates, picture cards for entries that have a picture, a **Stacked** layout that packs each type's entries side by side, and an **Overview** strip to see and move the visible part. Panning stops at the first and last year. The toolbar is one bar with clearer type chips, and the hint line and scale readout are gone.
- Timeline group titles no longer carry a strip of lines; panning and zooming the timeline is smoother.
- The sidebar's type groups are soft panels with a hairline under each heading instead of a coloured rail down their side; the selected entry and chapter are a soft gold-edged card, and rows show a light outline on hover.
- Typing no longer lags when a world has warnings: the story check catches up a quarter-second after you stop typing (or as soon as you leave the field) and is about a third faster, while the warnings from the rules, such as a name that is already taken or a death before birth, still appear as you type.
- **Status and dates** in the editor is a card with a soft gold border and an hourglass in its legend, instead of a thick coloured left edge. Entry chips and warnings lose their coloured left edges too: a warning's whole border takes its severity colour.
- The timeline opens at once and stays smooth while dragging and zooming: pictures are handed to the page as short links instead of whole files written out as text, and the hover card no longer redraws every lane.
- Zooming the timeline out stops where the years fill the track, so no empty time shows before the first or after the last year.
- Dragging the timeline's **Overview** (also right after **Fit**) never moves the view past the first or last year: every move is held inside the years before it is drawn.
- **About → Updates** no longer has the small print about where worlds are kept and the link to all releases.
- The editor shows the entry's picture in a circle beside its name, like the sidebar; entries without one keep their type icon.
- **+ New** in the sidebar closes without adding anything on Escape, on its × button, when you leave it empty, or on a click elsewhere.
- **Status and dates** is a plain fieldset like the rest of the editor. The editor has no coloured strip along its top, and the entry's id and file show as two small chips under its name.
- Family tree and relationship web cards have a calm border (dashed and grey for the dead or destroyed) and a soft gold ring on the open entry, with no coloured stripe down their left side. The family tree legend says just "dead".
- Links in the relationship lists (such as "owns … from Owners over time") show their label over the entry chip and the details under it, with the edit button in its own column; icons and names line up in entry chips such as **Mentioned here**.
- **World settings** no longer repeats "saved in world.json" under the calendar.
- The spine next to the cover in **New book** is as tall as the cover.
- The library shelf uses the full window width, with rows centred and books sized to the window (a little smaller below 1200 px, larger on 2K screens).
- Book titles on spines and covers shrink and wrap onto balanced lines to fit; an ellipsis is the last resort for very long titles.
- Releases are made with **Actions → Release** (version bump, tests, builds, release in one run).
- README rewritten for new users; reference material moved to `docs/`. Community files and issue templates added.

### Note for 1.0.0 users

1.0.0 has no updater: download the new version once from the links in the README. From then on Lore-Forge updates itself.

## [1.0.0] - 2026-11-04

First public release.

- Desktop app for Windows, macOS and Linux: library bookshelf, world home and book covers, editor for characters, places, factions, items, events and notes.
- Custom calendars with eras, months and partial dates.
- 16 consistency rules, live in the app and in `lore check`.
- Timeline, family tree and relationship web.
- Story space with chapter manuscripts, entry proposals and story contradiction checks.
- World Codex PDF and Story Book (PDF, Word and Markdown).
- Sample world Camelamamm.
- MIT licence.

[Unreleased]: https://github.com/kaharamamm/Lore-Forge/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/kaharamamm/Lore-Forge/releases/tag/v1.0.0
