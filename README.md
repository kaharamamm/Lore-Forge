# Lore-Forge

Lore-Forge is a local-first desktop app for writing the worlds, lore, characters and stories of your games. It keeps every world as a plain folder of text files, checks the canon for contradictions as you write, and turns a world into a printable World Codex and a typeset Story Book. Nothing leaves your machine.

> Orsan the Grey can't kill Queen Ilsa in 1920: Orsan the Grey died in 1800 (source: Characters/Orsan the Grey).

Version 1.0.0 · world format `schemaVersion: 1`.

---

## Table of Contents

- [Overview](#overview)
- [Download](#download)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [The App](#the-app)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [World Format](#world-format)
- [Dates and Calendars](#dates-and-calendars)
- [Consistency Rules](#consistency-rules)
- [World Codex and Story Book](#world-codex-and-story-book)
- [Command-Line Interface](#command-line-interface)
- [Integration with Other Tools](#integration-with-other-tools)
- [App Settings and Storage](#app-settings-and-storage)
- [Development](#development)
- [Build, Packaging, and Releases](#build-packaging-and-releases)
- [Troubleshooting](#troubleshooting)
- [Tech Stack](#tech-stack)
- [Credits and Licences](#credits-and-licences)
- [License](#license)

---

## Overview

Lore-Forge is for writers and game designers who keep a world's canon: who was born when, who killed whom, which city stood where, what each faction wants. A world is a folder with a `world.json` and one Markdown file per entry, so it can live in git, be diffed, and be read by other tools. The desktop app edits those files; a command-line tool checks and exports the same folders.

Key capabilities:

- A library that shows every world as a book on a shelf, with search, new books and delete to the system trash
- Six entry types: characters, places, factions, items, events and notes, each with structured fields and a Markdown body
- Dates on your own calendar (custom eras and months), with partial, approximate and unknown dates
- A consistency engine with 16 rules that runs live and points at the exact field that breaks canon
- Names that link themselves in any text, with hover cards and Ctrl/⌘+click to open
- A timeline, a family tree and a relationship web, all pan-and-zoom, editable by dragging
- A story manuscript written chapter by chapter, which proposes entries from what you write and warns when the story contradicts the world
- Reference images with provenance, and visual description fields for artists and 3D tools
- A World Codex PDF (with art briefs and image prompts) and a print-ready Story Book (PDF, Word and Markdown)
- Book covers and entry pictures from 100+ drawn game icons, colours, bundled title fonts or your own images
- A dark, gold-accented interface; every type and severity is an icon plus a word, never colour alone

Lore-Forge owns:

- the world folder format and its JSON Schemas
- the rule engine, the starter rules and the story checks
- the desktop app (library, editor, views, story, exports)
- the World Codex and Story Book document model and their PDF, Word and Markdown renderers
- the `lore` command-line tool

Other tools (an AI assistant, a game engine importer) read the same folders through the schemas and the integration guide in [docs/INTEGRATION.md](docs/INTEGRATION.md).

---

## Download

Ready-made builds are on the [Releases](https://github.com/kaharamamm/Lore-Forge/releases/latest) page. No Node.js or build tools are needed.

| System | File | Install |
| --- | --- | --- |
| Windows 10/11 | `Lore-Forge-<version>-win-x64.exe` | Run the installer. |
| macOS (Apple Silicon) | `Lore-Forge-<version>-mac-arm64.dmg` | Open the disk image and drag Lore-Forge to Applications. |
| macOS (Intel) | `Lore-Forge-<version>-mac-x64.dmg` | The same. |
| Ubuntu, Debian | `Lore-Forge-<version>-linux-amd64.deb` | `sudo apt install ./Lore-Forge-<version>-linux-amd64.deb` |
| Other Linux | `Lore-Forge-<version>-linux-x86_64.AppImage` | `chmod +x Lore-Forge-*.AppImage`, then run it. |

The builds are not code-signed (signing needs paid certificates), so the first start asks once:

- **Windows:** SmartScreen says "Windows protected your PC". Choose **More info**, then **Run anyway**.
- **macOS:** the app "cannot be opened because Apple cannot check it". Open **System Settings → Privacy & Security** and choose **Open Anyway** (or right-click the app and choose **Open**).
- **Linux AppImage:** see [Troubleshooting](#appimage-does-not-start-on-linux) if it does not start; the `.deb` is the simplest choice on Ubuntu and Debian.

The app opens on the library with the sample world, **Camelamamm**. Your worlds are kept wherever Library settings points (see [App Settings and Storage](#app-settings-and-storage)).

---

## Quick Start

You need Node.js 22.18 or newer (Node 24 is recommended, see `.nvmrc`) and git.

```bash
npm install          # also downloads the Electron binary
npm run dev          # build and start the desktop app
```

The app opens on the library with the sample world, **Camelamamm**: a six-chapter story with 23 entries, a cover, two eras and no problems in `check`.

To open a world folder directly:

```bash
LORE_FORGE_OPEN=/path/to/world npm run dev
```

For tests, the CLI and packaging, see [Development](#development).

---

## Architecture

```text
packages/core  (@lore-forge/core)      types, dates, parser and serializer, rule engine, rules,
    │                                  story extraction and checks, document model, schemas
    │
    ├── packages/pdf  (@lore-forge/pdf)   PDF (pdfkit) and Word (docx) rendering of the documents
    │
    ├── packages/cli  (@lore-forge/cli)   lore check / export / codex / book
    │
    └── packages/desktop  (@lore-forge/desktop)
            ├── main process (Electron)   files, dialogs, exports, settings, recent worlds
            ├── preload                   window.lore: the only bridge between the two
            └── renderer (Preact)         library, editor, views, story, previews
```

Core has one runtime dependency (`yaml`) and runs anywhere Node runs. The same `check` the CLI prints is what the desktop app shows live; the same document the PDF is drawn from is what the in-app preview shows, so the preview and the file never disagree.

The desktop renderer runs sandboxed with context isolation and a strict content security policy (`default-src 'self'`). It reads and writes nothing itself: every file operation goes through `window.lore` (defined in `packages/desktop/src/shared/api.ts`) to the main process, which refuses any path outside the open world's folder.

Edits save automatically, a moment after you stop typing, to the entry's own file. A save writes only the files that changed and keeps any fields it does not know.

---

## Project Structure

```text
packages/
  core/
    src/
      types.ts                 world, entry, calendar and book types
      dates.ts                 date parsing and comparison on custom calendars
      parse.ts                 Markdown + YAML front matter to entries and back
      world-index.ts           ids, names, aliases and links across a world
      engine.ts, rules/        rule engine; one file per rule family, builtinRules in rules/index.ts
      story.ts, extract.ts     story chapters and the proposal extractor
      story-check.ts           live checks of what the story says
      relation-kinds.ts        which relation types fit which entry types
      entry-icons.ts           default pictures, race icons, suggestion icons
      views/                   timeline, family tree and relationship web layouts
      publish/                 World Codex and Story Book document model, Markdown output
      icons.ts                 game-icons path data (generated by scripts/gen-icons.mjs)
    schemas/                   *.schema.json (JSON Schema draft 2020-12)
    test/                      node:test tests; test/fixtures/shifting-sands is the rule test world
  pdf/
    src/index.ts               PDF layout: cover, front matter, chapters, running heads, page numbers
    src/docx.ts                the same book for Word
    src/fonts.ts               bundled and system cover fonts
    fonts/                     Liberation fonts for covers
  cli/
    src/main.ts                lore check / export / codex / book
  desktop/
    src/main/main.ts           Electron main process and IPC handlers
    src/shared/api.ts          the window.lore API shared by main, preload and renderer
    src/renderer/
      app.tsx                  world app shell, navigation, autosave, headless smoke test
      components/              library, editor, views, story, dialogs, pickers
      styles.css               the whole theme
    build.mjs                  esbuild bundling, fonts and assets
    electron-builder.yml       installers
worlds/
  camelamamm/                  the sample world, shipped with the app
scripts/
  gen-icons.mjs                writes core/src/icons.ts from @iconify-json/game-icons
docs/
  INTEGRATION.md               how other tools read and write worlds
```

---

## The App

### Library

The start screen is a bookcase. Every world is a book: a 3D spine with its title and emblem on the shelf; point at a book (or focus it with the keyboard) and it comes off the shelf and turns to show its cover and entry counts. Click or press Enter to open it.

- **New book** is the blank book at the end of the shelf: a name, a cover colour or picture, an emblem, and the folder it goes into.
- **Search books** above the shelf matches titles first, then subtitles and authors, then descriptions, ignoring accents and the Turkish dotted and dotless i. Ctrl+F or `/` focuses it, Esc clears it, Enter opens the only match.
- **Delete** sits on a book's cover, asks first, and moves the folder to the system trash. Nothing is deleted outright.
- **Open a world folder…** opens a world from anywhere on disk; it then stays on the shelf.
- **Library settings** chooses the folder new books go to.
- **About** lists the credits and licences.

Behind the shelf is a quiet animated scene (light through a window, dust, runes, candles and embers). It pauses while the window is hidden and stays still with the system's reduced-motion setting.

### World Home

Opening a world lands on Home: the book's cover (click it to edit the cover), counts of entries, eras and warnings, links to the timeline, family tree, relationship web and the two exports, and a card for every entry with its picture. The paint button on a card changes that entry's picture: an icon with its colours, or one of its images.

The **Book cover** editor sets the background (gradient or plain colour), a picture, the emblem and its colour, the title font and colour, and the spine colours. The title can be hidden on the cover; it always stays on the spine.

### Sidebar

Entries grouped by type, each with its picture, a warning count and an "ended" mark for the dead, destroyed and dissolved. Search (Ctrl+F) matches names and text. **+ New** creates an entry in a group. Entries can be dragged onto the family tree or the relationship web. The sidebar's width is adjustable and remembered.

### Editor (Ctrl+1)

A structured form per entry type, in collapsible sections, then the body text.

- **Status and dates first:** alive or dead, standing or destroyed, active or dissolved, intact or lost, with the matching dates. An ongoing status hides the end date (it stays in the file, and the rules still see it).
- **Details:** characters have race or kind, gender, title, occupation, languages, personality, goals, skills, affiliations, home and possessions; places kind, population, ruler and features; factions kind, leader, headquarters, ideology, allies and enemies; items kind, origin, location, owners and powers; events kind, date, place, participants, actions ("A killed B"), causes, outcome and consequences. Empty means unknown and is never written to the file.
- **Entry fields** (Part of, Target, Ruler, Home, …) show the chosen entry as a chip with its picture icon; click it to open that entry, × to clear it. Fields that hold several entries (affiliations, possessions) are rows of chips.
- **Suggestion lists** (race, gender, kind, relation types, verbs) are themed lists with an icon for every word; the chosen value shows its icon too.
- **Relationships:** typed and dated relations to other entries. The type list only offers types that fit the two entry types; custom types are still allowed.
- **Visual description and reference images** for artists and 3D tools (see [Images](#images)).
- **Body:** Markdown with `[[links]]` and `@mentions`. Names and aliases typed in any text link themselves: they are highlighted in their type colour, show a hover card, and open with Ctrl/⌘+click.

### Warnings Panel

Updates live while you type. Warnings are grouped into Errors, Warnings, Info and Marked intended. Each one says what is wrong, the canon fact it conflicts with and where that fact comes from. **Go to** jumps to the offending field; **Mark intended** keeps a contradiction on purpose (a resurrection, an unreliable narrator) with a note. Warnings never block saving.

### Timeline (Ctrl+2)

Era bands, lifespans and existence spans as bars, events as points, and warning markers, filterable by type. Drag or Shift+scroll moves along time; Ctrl+scroll or −/Fit/+ zooms. Click a bar or name to open it.

### Relationships (Ctrl+3)

- **Family tree:** generations top-down, spouses side by side, the dead marked and faded.
- **Relationship web:** the selected entry in the middle and everything it relates to around it, with a minimap. Links between the same two entries curve apart, each label on its own side.

Both are pan-and-zoom maps (drag to pan, Ctrl/⌘+scroll or pinch to zoom, Fit to see all). Drag an entry from the sidebar onto them, drag from a card's gold dot onto another card to link them, or click a line to change or delete the link. A change is written to both entries' files at once; Ctrl+Z undoes it. Under the map, the entry's relations are listed by group, with the events it appears in.

### Story (Ctrl+4)

A manuscript space for the whole story, written chapter by chapter, with a word count per chapter and in total. Chapters are saved as `story/NN-slug.md`.

As you write, Lore-Forge reads the text and **proposes** what it finds, never adding anything by itself: *King Camel was born in 1998.* proposes a character Camel, born 1998, with the title King. Each proposal shows the sentence it came from, with **Add**, **Edit…**, **Merge…** (fold it into an existing entry as an alias) and **Ignore**. Names that already exist are listed instead of proposed again, and new facts about them show as **Update**.

The same rules check what the story says: a sentence that breaks canon is underlined, and the `story-contradiction` rule flags the story disagreeing with an entry. Select words, or right-click a name, to add it to the world with its type guessed.

### World Settings

The gear in the top bar: the default era (dates without an era abbreviation count in it), the eras (name, abbreviation, start and end, colour, and how many dates use each), and the months with their lengths. Saved in `world.json`.

### Navigation

The arrow at the top left always returns to the library. Alt+←/→ and mouse buttons 4/5 step back and forward through the entries and views you visited, including between the library and a world. The cover and title next to the arrow open world Home.

---

## Keyboard Shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+H | World Home |
| Ctrl+1 / 2 / 3 / 4 | Editor, Timeline, Relationships, Story |
| Ctrl+F | Search (the sidebar in a world, the shelf in the library; `/` also works there) |
| Ctrl+S | Save now (saving is automatic) |
| Alt+← / Alt+→ | Back and forward (also mouse buttons 4 and 5) |
| Alt+↑ / Alt+↓ | Previous or next entry |
| Ctrl+Shift+W | Focus the warnings panel |
| Ctrl/⌘+click, Ctrl/⌘+Enter | Open the name under the pointer or cursor |
| Ctrl+Shift+A | Story: add the selected words to the world |
| Ctrl+Z | Undo the last relationship change on a graph |
| Esc | Close a dialog, list or preview |

Every control is reachable with Tab and Shift+Tab; dialogs keep focus inside them. The layout reflows down to one column, so it stays usable at 200% zoom. Text contrast is at least 4.5:1 (`npm run contrast -w @lore-forge/desktop` checks the palette).

---

## World Format

A world is a folder. Lore-Forge reads and writes these files and nothing else.

```text
my-world/
  world.json                   name, calendar, rules, book details, cover
  characters/char-*.md         one Markdown file per entry, by type
  places/place-*.md
  factions/fac-*.md
  items/item-*.md
  events/evt-*.md
  notes/note-*.md
  story/01-the-first-chapter.md   story chapters (optional)
  images/<entry-id>/<view>.png    reference images (optional)
  intended.json                warnings marked intended (optional)
  story-ignored.json           ignored story proposals (optional)
```

### world.json

| Key | Holds |
| --- | --- |
| `schemaVersion`, `id`, `name`, `description` | identity |
| `calendar` | `eras` (id, name, start, optional end and colour), `defaultEra`, `months` (name, days), `approxYears` |
| `rules` | per-rule severity overrides, e.g. `{ "duplicate-name": "info", "two-places-at-once": "off" }` |
| `book` | Story Book details: `title`, `author`, `publisher`, `dedication`, `epigraph`, `epigraphSource`, `copyright`, `trim`, `rightHandChapters`, `chapterYears` |
| `cover` | cover colours, picture, emblem, title font and colour, show title or emblem, spine colours |

### Entries

Each entry is Markdown with YAML front matter: the structured fields on top, the body text below.

```markdown
---
id: char-mr-camel
type: character
name: Mr Camel
aliases:
  - Barnaby Camel
summary: Patient camel-folk tea merchant of Camelamamm, who wakes the Singing Well.
race: camel-folk
born: "471"
status: alive
relations:
  - type: owns
    target: item-humming-map
    from: "498"
---

Mr Camel keeps the smallest tea house on the Street of Kettles…
```

References use entry ids (`target: item-humming-map`) or names. Unknown keys are kept as they are. Reference fields such as `home`, `ruler` and `leader` count as relationships in the rules and the graphs.

### Story chapters

`story/NN-slug.md` with a short header and plain prose:

```markdown
---
title: The Morning the Well Went Quiet
order: 1
date: 10.03.512
---

Every morning in Camelamamm began with a song…
```

### Images

Reference images are copied into `images/<entry-id>/` and listed on the entry with their view and provenance (tool, prompt, date, sources, rights note). Each type suggests its own views: characters A-pose, front, back, left, right, three-quarter and concept; places establishing shot, map, interior, exterior, mood and concept; items front, back, side, top, detail and concept; events scene, establishing shot, map, mood and concept. Other view names are allowed. In the editor they show as a gallery with one tile per view.

### Intended marks and ignored proposals

`intended.json` keeps the warnings you marked intended, with your note and the date. `story-ignored.json` keeps the story proposals you ignored, so they are not proposed again.

The full format, field by field, is in [docs/INTEGRATION.md](docs/INTEGRATION.md), and the JSON Schemas are in `packages/core/schemas/`.

---

## Dates and Calendars

Every world has its own calendar: eras with their own year numbering on one shared timeline, and months with their own lengths (12 months of 30 days when none are set).

Dates are typed as `DD.MM.YYYY` with as much as you know:

| Input | Meaning |
| --- | --- |
| `1920` | the year |
| `03.1920` | a month |
| `12.03.1920` | a day |
| `12.03` | a day in an unknown year |
| `~1800` | about 1800 (widened by `calendar.approxYears`) |
| `450 OK` | year 450 of the era `OK` |
| `?` | unknown |

The older `1920-03-12` form still works. Each date field shows how it was understood. Rules only warn when the known parts prove a conflict: died "1800" and acted "12.03.1800" is fine.

---

## Consistency Rules

| Rule id | Default | Fires when |
| --- | --- | --- |
| `after-death` | error | someone acts, takes part, stays somewhere or has a dated relation after they died |
| `before-birth` | error | the same, before they were born |
| `participant-not-existing` | error | a faction or item takes part in an event outside its existence |
| `place-not-existing` | error | an event or stay happens at a place before it was founded or after it was destroyed |
| `two-places-at-once` | warning | the same entity is at two different places at the same time (nested places are fine) |
| `dangling-reference` | warning | a field, `[[link]]` or `@mention` points at nothing |
| `duplicate-name` | warning | two entries share a name or alias (case-insensitive) |
| `parent-cycle` | error | parent relations form a loop |
| `parent-born-after-child` | error | a parent was born after their child |
| `dead-marked-alive` | error | the status is alive (or standing, active, intact) but an end date or a killing says otherwise |
| `invalid-date` | error | a date can't be parsed or uses an unknown era |
| `date-order` | error | an end comes before its start (died before born, destroyed before founded) |
| `file-error` | error | a file can't be read as an entry (the rest of the world still loads) |
| `relation-kind` | warning | a relation type doesn't fit the two entry types (an item `parent-of` a character) |
| `image-view` | info | an image's view is not one of the usual views for its entry type |
| `story-contradiction` | warning | a story chapter says something different from an entry |

Story sentences are also checked with the timeline rules, as if their proposals were already added. A rule's severity can be changed or the rule turned off in `world.json` under `rules`. The rule library and custom rules are described in [docs/INTEGRATION.md](docs/INTEGRATION.md#custom-rules-library).

---

## World Codex and Story Book

**World Codex** and **Story Book** in the top bar open an in-app preview built from the same document the files are drawn from. Saving writes the PDF and a Markdown copy next to it (for AI tools), and offers *Show in folder*.

### World Codex

A reference book of the whole world: a cover, contents, the world overview and calendar, every entry by type with its facts, relationships, visual description, text and reference images with provenance, an **art brief** per character, place, item and event (an image prompt, plus a 3D turnaround brief for characters and items), a timeline, a relationship summary, a glossary of names and aliases, and an appendix of open warnings. The preview chooses the entry types and turns the art briefs and the warnings appendix on or off.

### Story Book

When a world has story chapters, the Story Book is the story: each chapter in order, then the chronicle of events and notes as an appendix (which the preview can turn off). A world without chapters becomes a chronicle of its events and notes in in-world date order, in chapters by era or by year ranges; a page's own `chapter` field and `bookOrder` override that.

The book is laid out like a printed book:

1. The cover: the world's cover art with the book title, subtitle and author.
2. The title page, the copyright page, the dedication and the epigraph (each when set).
3. The contents, with page numbers.
4. Each chapter starting at the top of a new page, with its label, title and a drop cap.

Text is set in a serif face, justified and hyphenated, with no single line left at the top or bottom of a page. Margins are mirrored with a wider inside edge for the binding; running heads show the book title on left pages and the chapter on right pages; pages are numbered from the first chapter, with no number on chapter openings. There are no blank pages; for a printed copy, **Start chapters on right-hand pages** opens the title page and every chapter on a right-hand page.

Trim sizes: 6 × 9 in (default), 5.5 × 8.5 in and A5. The book details (title, author, publisher, dedication, epigraph, copyright text) are edited in the preview and saved in `world.json`. **Save Word (.docx)…** writes the same book for Word.

The Story Book assembles what you wrote. It never writes, rewrites or summarises prose.

### Fonts

PDFs embed DejaVu fonts, so Turkish (ş ğ İ ı) and other Latin Extended, Greek and Cyrillic text renders, and characters the fonts lack (such as emoji) are dropped rather than printed as empty boxes. Cover titles can use one of 16 bundled fonts (Cinzel Decorative, Uncial Antiqua, IM Fell English, EB Garamond, Pirata One and others) or an installed system TrueType/OpenType font; a font that cannot draw the title falls back to DejaVu with a note. PNG and JPEG images are embedded; WebP and GIF images are listed by file name.

---

## Command-Line Interface

```bash
npm run lore -- check <worldDir>             # human-readable; exit 0 = no errors, 1 = errors, 2 = unreadable or bad usage
npm run lore -- check <worldDir> --json      # machine-readable check report
npm run lore -- export <worldDir> --out world.snapshot.json   # versioned JSON snapshot of the world
npm run lore -- codex <worldDir> -o codex.pdf   # World Codex PDF + codex.md (alias: lore bible)
npm run lore -- book <worldDir> -o book.pdf     # Story Book PDF + book.md
npm run lore -- book <worldDir> -o book.docx    # the same book for Word
npm run lore -- book <worldDir> --trim a5       # trim: 6x9 (default, or book.trim), 5.5x8.5, a5
```

After `npm run build`, the compiled CLI is `packages/cli/dist/main.js` (bin name `lore`). No browser or display is needed.

---

## Integration with Other Tools

Worlds are meant to be read by other tools. [docs/INTEGRATION.md](docs/INTEGRATION.md) covers:

- the JSON Schemas in `packages/core/schemas/` (world manifest, entries, story chapters, intended marks, story ignores, check reports, snapshots)
- the world folder field by field: statuses, races, relation types, plain-name mentions and dates
- the check report and warning format
- custom rules on top of the built-in library
- story chapters and the extractor plug-in point, so an AI assistant can supply its own proposals and get the same duplicate checks
- how the World Codex and Story Book are built
- what is stable across versions

`lore check --json` and `lore export` produce versioned JSON for scripts and pipelines.

---

## App Settings and Storage

| Where | What |
| --- | --- |
| The world folder | everything about a world (see [World Format](#world-format)) |
| `<user data>/settings.json` | the folder new worlds go to |
| `<user data>/recent-worlds.json` | worlds opened from outside the worlds folder |
| `<user data>/recent-cover-uploads.json` | pictures uploaded for covers, offered again |
| `localStorage` | sidebar width, open or closed editor and warning sections, recent colours |

`<user data>` is the app's user-data folder: `~/.config/Lore-Forge` on Linux, `%APPDATA%\Lore-Forge` on Windows and `~/Library/Application Support/Lore-Forge` on macOS.

New worlds go to the project's `worlds/` folder when running from source and to `<user data>/worlds` in an installed app, unless Library settings chooses another folder. The installed app ships Camelamamm as a read-only world; copy its folder to edit it.

---

## Development

### Prerequisites

- Node.js 22.18 or newer (Node 24 recommended, see `.nvmrc`)
- npm 11 (it asks to approve install scripts; the approved ones, `esbuild`, `electron` and `electron-winstaller`, are listed under `allowScripts` in `package.json`)
- git

```bash
# Node 24 via nvm (skip if you already have it)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 24 && nvm use 24
```

### Commands

```bash
npm install                 # dependencies and the Electron binary
npm run dev                 # build and start the desktop app
npm test                    # all unit, rule, schema, PDF and CLI tests
npm run typecheck           # TypeScript across all packages and the tests
npm run build               # build every package
npm run lore -- check packages/core/test/fixtures/shifting-sands   # exits 1: the test world breaks canon on purpose
npm run watch -w @lore-forge/desktop                               # rebuild the desktop app on change
```

In watch mode, Ctrl+R in the app reloads renderer changes; restart for main-process changes.

### Tests

Tests use Node's built-in test runner with native TypeScript type stripping: no test framework and no build step. `--conditions=source` resolves the workspace packages to their `.ts` sources.

- `packages/core/test/` covers dates, parsing, every rule, the story extractor and checks, layouts, schemas and the document model.
- `packages/pdf/test/` renders real PDFs and Word files and checks their page order, running heads, page numbers and fonts (page text checks use `pdftotext` when it is installed).
- `packages/cli/test/` runs the real `lore` commands.

`packages/core/test/fixtures/shifting-sands` is the rule test world. It breaks canon on purpose so every rule fires once, and its README maps each rule to the entry that triggers it. It is a test fixture and does not show on the shelf.

### Headless smoke test

The desktop app has a built-in end-to-end run that loads a world, exercises every view, dialog and preview at 1280 × 720, 1920 × 1080 and 2560 × 1440, and exports the PDFs and a `.docx`:

```bash
LORE_FORGE_SMOKE=1 LORE_FORGE_OPEN=$PWD/packages/core/test/fixtures/shifting-sands \
  xvfb-run -a -s "-screen 0 2600x1500x24" npx electron packages/desktop --no-sandbox
```

It prints `SMOKE OK {...}` and exits 0, or exits 1 on a failed check, a renderer error, a crash or a failed export. It works on a temporary copy of the world and a throwaway library, so nothing real is touched. The virtual screen must be a little larger than the biggest size checked. Set `LORE_FORGE_SMOKE_OUT=<dir>` to keep the exported files.

### Icons

Icons come from [game-icons.net](https://game-icons.net). Only the icons the app uses are kept, as SVG path data in `packages/core/src/icons.ts`; add a name to `scripts/gen-icons.mjs` and run `node scripts/gen-icons.mjs` to regenerate it. The app icon's source is `packages/desktop/src/renderer/icon.svg`; `npm run icons -w @lore-forge/desktop` renders the installer icons into `packages/desktop/build/` (it runs Electron, so it needs a display or `xvfb-run -a`).

---

## Build, Packaging, and Releases

### Local builds

```bash
npm run dist:linux     # AppImage and .deb
npm run dist:win       # NSIS installer (best run on Windows; on Linux it needs wine)
npm run dist:mac       # disk image (needs macOS)
```

Each builds every package first, then runs electron-builder with `--publish never`, so nothing is uploaded. The files go to `packages/desktop/release/`.

| Setting | Value |
| --- | --- |
| App id | `dev.kaharamamm.loreforge` |
| Product name | Lore-Forge |
| File names | `Lore-Forge-<version>-<os>-<arch>.<ext>` |
| Windows | NSIS installer, with a choice of install folder |
| macOS | disk image, signed ad hoc (no Apple Developer certificate), hardened runtime off |
| Linux | `.deb` (its installer adds an AppArmor profile on Ubuntu 24+, so the sandbox stays on) and AppImage (category Office, with a desktop entry, executable `lore-forge`) |
| Bundled resources | the sample world `worlds/camelamamm` (read-only), the DejaVu fonts and their licence |
| Electron | pinned to an exact version (`45.1.0`), which electron-builder requires |

Only the sample world is packaged; other folders in `worlds/` stay private.

### Releases

`.github/workflows/release.yml` builds the downloads on GitHub's own Windows, Linux and macOS machines and attaches them to the release:

1. Bump the version in every `package.json` and in `GENERATOR` (`packages/core/src/snapshot.ts`), then commit and push.
2. Create and publish a release for the tag (for example `gh release create v1.0.0 --title "Lore-Forge 1.0.0" --notes-file notes.md`, or **Draft a new release** on GitHub).
3. The workflow runs the tests, builds the Windows installer, the `.deb` and AppImage, and the two macOS disk images, and uploads all five to that release (about 10 to 15 minutes).

**Actions → Release downloads → Run workflow** rebuilds the downloads for an existing tag. All packages share one version (`1.0.0`), set in each `package.json` and in `GENERATOR`.

---

## Troubleshooting

### Electron aborts on Ubuntu 23.10+ / 24.04

AppArmor blocks Chromium's user-namespace sandbox, and `node_modules/electron/dist/chrome-sandbox` is not a root setuid helper, so unpackaged Electron aborts. `npm run dev` detects this and passes `--no-sandbox` to the development process only; packaged builds are unchanged. To keep the sandbox on during development, fix the helper once (it is reset by `npm install`):

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

`LORE_FORGE_NO_SANDBOX=1` forces `--no-sandbox`.

### AppImage does not start on Linux

- *"AppImages require FUSE to run"*: Ubuntu 22.04 and later no longer install FUSE 2. Install it (`sudo apt install libfuse2t64` on Ubuntu 24.04, `libfuse2` on 22.04), or use the `.deb`.
- *"GPU process isn't usable. Goodbye."* right after start: Ubuntu 23.10 and later block the sandbox Chromium uses unless the app has an AppArmor profile, which the `.deb` installs and an AppImage cannot. Use the `.deb`, or start the AppImage with `--no-sandbox` (this turns Chromium's sandbox off for Lore-Forge).

### Windows or macOS refuses to open the app

The builds are not code-signed. On Windows choose **More info → Run anyway**; on macOS use **System Settings → Privacy & Security → Open Anyway**. See [Download](#download).

### The Electron binary is missing

If `npx electron --version` reports a missing binary, run `npm rebuild electron`.

### Running Electron from a VS Code terminal

VS Code's integrated tools can set `ELECTRON_RUN_AS_NODE=1`, which makes Electron behave as plain Node and reject its own options (`bad option: --no-sandbox`). Unset it first: `env -u ELECTRON_RUN_AS_NODE npm run dev`.

### A cover font shows as DejaVu in the PDF

The chosen font is not bundled and not installed as a TrueType or OpenType file, or it has no letters for some of the title. The export says so in a note. Pick a bundled font or install the font file.

### An image is missing from a PDF

PDFs embed PNG and JPEG only. WebP and GIF images are listed by file name; convert them to embed them.

### A world does not show on the shelf

The shelf lists the worlds folder (Library settings), the worlds you opened from elsewhere, and the sample world. A folder without a valid `world.json` is not a world; **Open a world folder…** says why.

---

## Tech Stack

| Category | Library |
| --- | --- |
| Desktop shell | Electron 45 |
| UI | Preact 10, TypeScript 5.9 |
| Build | esbuild 0.28, electron-builder 26 |
| Relationship web | React Flow (`@xyflow/react` 12) through `preact/compat` |
| Pan and zoom | d3-zoom and d3-selection 3 |
| Motion | `@formkit/auto-animate`, CSS transitions and View Transitions |
| World files | `yaml` 2 |
| PDF | PDFKit 0.20, DejaVu fonts, `hyphen` (en-US patterns) |
| Word | `docx` 9, `fflate` |
| Fonts | Cinzel (headings), 16 bundled cover fonts from Fontsource and Liberation |
| Icons | game-icons.net via `@iconify-json/game-icons` |
| Tests | `node:test` with native TypeScript type stripping, ajv for the schemas |

---

## Credits and Licences

- Icons: [game-icons.net](https://game-icons.net) by Lorc, Delapouite and contributors, CC BY 3.0. Used unchanged except for colour and size.
- Heading font: Cinzel by Natanael Gama and the Cinzel Project Authors, SIL Open Font License 1.1.
- Cover fonts: the Fontsource packages listed in `packages/pdf/package.json`, each under the SIL Open Font License 1.1; Liberation Sans and Serif, SIL Open Font License 1.1.
- PDF fonts: DejaVu Sans, Serif and Mono, Bitstream Vera / DejaVu licence.
- React Flow (MIT), d3 (ISC), Preact (MIT), PDFKit (MIT), auto-animate (MIT).

The app lists the same credits under **About** in the library.

---

## License

Lore-Forge is released under the [MIT License](LICENSE). Copyright (c) 2026 Ahmet Kadir Zengin.

The bundled icons and fonts keep their own licences (see [Credits and Licences](#credits-and-licences)): the game-icons.net icons are CC BY 3.0, the Cinzel, cover and Liberation fonts are SIL Open Font License 1.1, and the DejaVu fonts use the Bitstream Vera / DejaVu licence. Their licence texts ship with the app.

The sample world Camelamamm is part of this repository and under the same licence. Worlds you create with Lore-Forge are yours; the licence covers Lore-Forge itself, not what you write with it.
