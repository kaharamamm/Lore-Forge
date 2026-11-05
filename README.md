<div align="center">

<img src="packages/desktop/build/icon.png" alt="Lore-Forge icon" width="96">

# Lore-Forge

**Write your game worlds. Catch the contradictions.**

A free, local-first desktop app for the worlds, lore, characters and stories of your games.
Every world is a plain folder of Markdown files, checked live for contradictions and exported as a World Codex PDF and a print-ready Story Book.

[![Latest release](https://img.shields.io/github/v/release/kaharamamm/Lore-Forge?label=release&color=c9963f)](https://github.com/kaharamamm/Lore-Forge/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/kaharamamm/Lore-Forge/total?color=c9963f)](https://github.com/kaharamamm/Lore-Forge/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-c9963f)](LICENSE)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-555)](#download)

[**Download**](#download) · [Features](#features) · [Quick start](#quick-start) · [User guide](docs/USER-GUIDE.md) · [World format](docs/FORMAT.md)

<img src="docs/media/demo.gif" alt="Opening the Camelamamm book from the shelf, browsing its entries and seeing an after-death error in the warnings panel" width="100%">

</div>

---

## Download

| System | Download | Install |
| --- | --- | --- |
| **Windows 10/11** (x64) | [`Lore-Forge-<version>-win-x64.exe`](https://github.com/kaharamamm/Lore-Forge/releases/latest) | Run the installer. |
| **macOS** (Apple Silicon) | [`Lore-Forge-<version>-mac-arm64.dmg`](https://github.com/kaharamamm/Lore-Forge/releases/latest) | Open the disk image and drag Lore-Forge to Applications. |
| **macOS** (Intel) | [`Lore-Forge-<version>-mac-x64.dmg`](https://github.com/kaharamamm/Lore-Forge/releases/latest) | The same. |
| **Ubuntu, Debian** (x64) | [`Lore-Forge-<version>-linux-amd64.deb`](https://github.com/kaharamamm/Lore-Forge/releases/latest) | `sudo apt install ./Lore-Forge-*-linux-amd64.deb` |
| **Other Linux** (x64) | [`Lore-Forge-<version>-linux-x86_64.AppImage`](https://github.com/kaharamamm/Lore-Forge/releases/latest) | `chmod +x Lore-Forge-*.AppImage`, then run it. |

All files are on the **[latest release](https://github.com/kaharamamm/Lore-Forge/releases/latest)** page. No Node.js or build tools are needed.

### Opening an unsigned app

The builds are not code-signed (signing needs paid certificates), so the first start asks once:

- **Windows:** SmartScreen says *"Windows protected your PC"*. Choose **More info**, then **Run anyway**.
- **macOS:** *"Lore-Forge cannot be opened because Apple cannot check it"*. Open **System Settings → Privacy & Security**, scroll down and choose **Open Anyway** (or right-click the app in Applications and choose **Open**). If macOS says the app *"is damaged"*, run `xattr -dr com.apple.quarantine /Applications/Lore-Forge.app` once in Terminal.
- **Linux AppImage:** if it says *"AppImages require FUSE"*, install `libfuse2t64` (Ubuntu 24.04) or `libfuse2` (22.04). If it exits with *"GPU process isn't usable"*, start it with `--no-sandbox` or use the `.deb`, which installs the AppArmor profile it needs.

---

## Why Lore-Forge

- **Canon you can trust.** 16 consistency rules run while you type: a character acting after their death, a parent born after their child, a city visited before it was founded. Each warning points at the exact field and the fact it breaks.
- **Your files, not a cloud.** A world is a folder of Markdown with YAML front matter. It works offline, lives happily in git, diffs cleanly and can be read by other tools. Nothing leaves your machine.
- **Built for game worlds.** Custom calendars and eras, partial dates, family trees, relationship webs, art briefs and reference images for artists and 3D tools.
- **From notes to a book.** Write the story chapter by chapter; Lore-Forge proposes entries from your prose and exports a typeset Story Book (PDF or Word).

## Features

| | |
| --- | --- |
| <img src="docs/media/library.png" alt="The library: each world is a book on a shelf"><br>**Library.** Every world is a book on a shelf, with search and new books. | <img src="docs/media/world-home.png" alt="World home with the book cover and entry cards"><br>**World home.** Cover, counts and a card for every entry. |
| <img src="docs/media/entry.png" alt="The entry editor for Mr Camel"><br>**Editor.** Structured fields per type, dates on your own calendar, linked names. | <img src="docs/media/warnings.png" alt="An after-death error in the warnings panel"><br>**Consistency warnings.** Live, with *Go to* and *Mark intended*. |
| <img src="docs/media/relationships.png" alt="The relationship web around Mr Camel"><br>**Relationship web and family tree.** Drag to link entries. | <img src="docs/media/timeline.png" alt="The timeline with eras, lifespans and events"><br>**Timeline.** Eras, lifespans, events and warning markers. |
| <img src="docs/media/story.png" alt="The Story space with a chapter and proposals"><br>**Story.** A chapter-by-chapter manuscript that proposes entries from your text. | <img src="docs/media/story-book-pdf.png" alt="Cover and first pages of the exported Story Book PDF"><br>**Story Book and World Codex.** Print-ready PDF, Word and Markdown. |

The warning in these screenshots was added on purpose to a copy of the sample world; the sample world itself has none.

More in the [user guide](docs/USER-GUIDE.md).

## Quick start

1. [Download](#download) and install Lore-Forge, then start it.
2. The library opens with the sample world **Camelamamm**: a six-chapter story about Mr Camel and the Singing Well, with 23 entries. Click its book to open it. The installed sample is read-only, so start your own world to write.
3. Click **New book** at the end of the shelf, give your world a name, colour and emblem.
4. In the sidebar, choose **+ New** next to *Characters*, type a name and a birth date. The entry is saved as `characters/<id>.md` a moment after you stop typing.
5. Set their status to *Dead* with a death date before the birth date, and watch the warnings panel flag it (`date-order`).

## Your data

A world is a folder you own:

```text
my-world/
  world.json                   name, calendar, rules, book details, cover
  characters/char-*.md         one Markdown file per entry, by type
  places/  factions/  items/  events/  notes/
  story/01-the-first-chapter.md   story chapters
  images/<entry-id>/<view>.png    reference images
```

```markdown
---
id: char-mr-camel
type: character
name: Mr Camel
race: camel-folk
born: "471"
status: alive
relations:
  - type: owns
    target: item-humming-map
---

Mr Camel keeps the smallest tea house on the Street of Kettles…
```

Edit the files with any text editor, keep them in git, or read them from your own tools. Fields Lore-Forge doesn't know are kept. Details: [World format, dates and rules](docs/FORMAT.md) and [Integration guide](docs/INTEGRATION.md).

## Command line

The `lore` CLI checks and exports the same folders without a display, for scripts and CI. It currently runs from a source checkout:

```bash
npm run lore -- check worlds/camelamamm          # exit 1 when there are errors
npm run lore -- book worlds/camelamamm -o book.pdf
```

See [docs/CLI.md](docs/CLI.md).

## Build from source

You need Node.js 22.18 or newer (Node 24 recommended) and git.

```bash
git clone https://github.com/kaharamamm/Lore-Forge.git
cd Lore-Forge
npm install
npm run dev        # build and start the desktop app
npm test
```

Architecture, tests, packaging and releases: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Roadmap

- **Planned:** AI agents (Claude and other MCP clients) working in your world through an MCP server: reading canon, adding entries and relationships, writing chapters, and getting the consistency warnings back. Not shipped yet.
- Ideas and requests are welcome in [issues](https://github.com/kaharamamm/Lore-Forge/issues).

## Contributing

Bug reports, feature ideas and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; this project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues: see [SECURITY.md](SECURITY.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Licence and credits

Lore-Forge is released under the [MIT License](LICENSE). Copyright (c) 2026 Ahmet Kadir Zengin. Worlds you create are yours; the licence covers Lore-Forge itself, not what you write with it. The sample world Camelamamm is under the same licence as the repository.

- Icons: [game-icons.net](https://game-icons.net) by Lorc, Delapouite and contributors, CC BY 3.0. Used unchanged except for colour and size.
- Heading font: Cinzel by Natanael Gama and the Cinzel Project Authors, SIL Open Font License 1.1.
- Cover fonts: the Fontsource packages listed in `packages/pdf/package.json` and Liberation Sans and Serif, SIL Open Font License 1.1.
- PDF fonts: DejaVu Sans, Serif and Mono, Bitstream Vera / DejaVu licence.
- React Flow (MIT), d3 (ISC), Preact (MIT), PDFKit (MIT), auto-animate (MIT).

The app lists the same credits under **About** in the library.
