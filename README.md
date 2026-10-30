# Lore-Forge

A local-first desktop app for writing the worlds, lore and characters of your games, with a consistency
checker that notices when your canon contradicts itself:

> Orsan the Grey can't kill Queen Ilsa in 1920: Orsan the Grey died in 1800 (source: Characters/Orsan the Grey).

A world is a plain folder of text files (`world.json` plus one Markdown file per entry). You can keep it in
git, diff it, and read it from other tools. Nothing leaves your machine.

Version 0.2.0 · world format `schemaVersion: 1` (worlds from 0.1 open unchanged).

## What's new in v0.2

- **Reference images for every entry type**, with the same storage (`images/<entryId>/`) and provenance
  record. Each type suggests its own views: characters A-pose, front, back, left, right, three-quarter,
  concept; places establishing shot, map, interior, exterior, mood, concept; items front, back, side, top,
  detail, concept; events scene, establishing shot, map, mood, concept. Any other view label is allowed and
  only gets an info note (`image-view`).
- **Visual description fields** (optional, free text): characters appearance, height & build, clothing,
  colour palette, distinguishing features, props; places architecture, climate, palette, scale; items
  material, size, details; events scene description, mood; factions emblem, attire, palette.
- **World Bible PDF** (`lore bible`, or **World Bible PDF…** in the app): cover, contents, world overview
  and calendar, every entry by type with facts, relationships, visual description, text and reference
  images with provenance, an **art brief** per character, place, item and event (image prompt, plus a 3D
  turnaround brief for characters and items), a timeline, a relationship summary, a glossary of names and
  aliases, and an appendix of open consistency warnings. A `.md` copy with the same content is written next
  to the PDF for AI tools.
- **Story Book PDF** (`lore book`, or **Story Book PDF…**): your events and notes in in-world date order,
  in chapters by era (or by year ranges with `book.chapterYears` in `world.json`), with links resolved to
  names and event or place images as illustrations. A page's `chapter` field puts it in a named chapter and
  `bookOrder` reorders pages inside a chapter. Undated pages go to *Lore & Legends* at the end.
  **The Story Book assembles what you wrote. It does not write, rewrite or summarise prose;** an event with
  no text shows its summary, or a "no text yet" line.

## What's in v0.1

- **Entries:** characters, places, factions, items, events and notes. Each has a name, aliases, a summary,
  tags, relations, a Markdown body with `[[links]]` and `@mentions`, and type-specific fields such as
  born/died, founded/destroyed, an event date, place, participants and actions ("A killed B").
- **Dates on your own calendar:** custom eras and months. Dates can be exact (`1920-03-12`), year-only
  (`1920`), approximate (`~1800`), in another era (`450 OK`), or unknown (`?`).
- **Consistency engine:** 14 starter rules (listed below). Warnings show the severity as an icon plus a word,
  the offending fact, and the canon fact it conflicts with, including that fact's source. Warnings never block
  saving. You can mark one as *intended* (for example, a resurrection) and add a note. The mark is stored in
  `intended.json` inside the world.
- **Desktop app:** a sidebar grouped by type with search, a structured entry editor, a live warnings panel
  that jumps to the offending field, a timeline, a relationship view, and reference images with provenance
  (tool, prompt, date, sources, rights).
- **CLI:** `lore check`, `lore export`, `lore bible`, `lore book`.
- **JSON Schemas and an integration guide** so other tools can read worlds. See
  [docs/INTEGRATION.md](docs/INTEGRATION.md).
- **Example world:** `examples/shifting-sands` triggers every rule on purpose. Its README maps each rule
  to the entry that triggers it.

## Install and run (Linux, Ubuntu-like)

You need Node.js 22.18 or newer. Node 24 is recommended (see `.nvmrc`), and git.

```bash
# Node 24 via nvm (skip if you already have it)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 24 && nvm use 24

cd Lore-Forge
npm install          # also downloads the Electron binary
npm test             # unit tests, rule tests, schema tests, CLI test
npm run typecheck
npm run lore -- check examples/shifting-sands     # exits 1: the example has errors on purpose
npm run dev          # build and start the desktop app
```

npm 11 asks you to approve install scripts. The approved ones (`esbuild`, `electron`,
`electron-winstaller`) are listed in `allowScripts` in `package.json`. If `npx electron --version` reports a
missing binary, run `npm rebuild electron`.

**Ubuntu 23.10+ / 24.04 sandbox error.** AppArmor blocks Chromium's user-namespace sandbox, and
`node_modules/electron/dist/chrome-sandbox` is not a root setuid helper, so unpackaged Electron aborts.
`npm run dev` detects that and passes `--no-sandbox` for the development process. Packaged builds (the
AppImage or the Windows installer) are unchanged. To keep the sandbox on during development, fix the helper
once (this is lost after `npm install`):

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

To open a world directly: `LORE_FORGE_OPEN=/path/to/world npm run dev`.

## Build the Windows installer (not published)

```bash
npm run dist:win
```

This produces an NSIS installer at `packages/desktop/release/Lore-Forge Setup 0.1.0.exe`. Run it on Windows
for the most reliable result. On Linux it needs `wine` installed. `--publish never` is set, so nothing is
uploaded. The example world is bundled as a read-only resource. Use "Open example world" and copy it if you
want to edit it.

On Linux, `npm run dist:linux` builds an AppImage into the same `release/` folder.

## Using the app

1. **Start:** open a world folder, create a new one (this asks for a parent folder and creates
   `world.json` plus the type folders), or open the example.
2. **Sidebar:** entries grouped by type, each with an error or warning count badge. Press **Ctrl+K** to
   search by name, alias, id or tag. Use **+ New** to create an entry in a group.
3. **Editor:** edit the structured fields and the body. Changes save automatically to the entry's file
   (the save status shows in the top bar, and **Ctrl+S** saves now). Date fields show how the date was
   understood, and reference fields show what they resolve to.
4. **Warnings panel:** updates live. Use **Go to** to jump to the offending field, or the canon link to open
   the conflicting entry. Use **Mark intended** to keep a contradiction on purpose. Intended warnings stay
   visible in their own group.
5. **Timeline (Ctrl+2):** lifespans and existence spans by type, with events as markers. Open-ended spans fade
   out. **Relationships (Ctrl+3):** the selected entry's outgoing and incoming relations, grouped, plus the
   events it appears in.
6. **PDFs:** **World Bible PDF…** and **Story Book PDF…** in the top bar save pending edits, ask where to
   save, write the PDF plus its `.md` copy, and show the file. The editor's *Visual description* and
   *Reference images* sections feed the World Bible's art briefs; *Story Book* (chapter, order) appears on
   events and notes.

Keyboard: **Ctrl+1/2/3** switch views, **Alt+↑/↓** move to the previous or next entry, **Ctrl+Shift+W**
focuses the warnings panel, and Tab or Shift+Tab reach every control. The layout reflows down to a single
column, so it stays usable at 200% zoom. Text contrast is at least 4.5:1, and severity is always shown as an
icon plus a word, never by color alone.

## CLI

```bash
npm run lore -- check <worldDir>            # human-readable; exit 0 = no errors, 1 = errors, 2 = unreadable/usage
npm run lore -- check <worldDir> --json     # machine-readable check report
npm run lore -- export <worldDir> --out world.snapshot.json   # versioned JSON snapshot
npm run lore -- bible <worldDir> -o bible.pdf   # World Bible PDF + bible.md (default name <world-id>-bible.pdf)
npm run lore -- book <worldDir> -o book.pdf     # Story Book PDF + book.md
```

PDFs are made with [pdfkit](https://pdfkit.org) and embedded DejaVu fonts, so Turkish (ş ğ İ ı) and other
Latin Extended, Greek and Cyrillic text renders. No browser is needed. PNG and JPEG images are embedded;
WebP or GIF images are listed by file name instead.

After `npm run build`, the compiled CLI is available at `packages/cli/dist/main.js` (bin name `lore`).

## The starter rules

| Rule id | Default | Fires when |
|---|---|---|
| `after-death` | error | someone acts, takes part, stays somewhere or has a dated relation after they died |
| `before-birth` | error | the same, before they were born |
| `participant-not-existing` | error | a faction or item takes part in an event outside its existence |
| `place-not-existing` | error | an event or stay happens at a place before it was founded or after it was destroyed |
| `two-places-at-once` | warning | the same entity is at two different places at the same time (nested places are fine) |
| `dangling-reference` | warning | a field, `[[link]]` or `@mention` points at nothing |
| `duplicate-name` | warning | two entries share a name or alias (case-insensitive) |
| `parent-cycle` | error | parent relations form a loop (A parent of B parent of A, including self) |
| `parent-born-after-child` | error | a parent was born after their child |
| `dead-marked-alive` | error | status is `alive`, but a death date or a killing says otherwise |
| `invalid-date` | error | a date can't be parsed or uses an unknown era |
| `date-order` | error | an end comes before its start (died before born, destroyed before founded, ...) |
| `file-error` | error | a file can't be read as an entry (the rest of the world still loads) |
| `image-view` | info | an image's view label is not one of the usual views for its entry type |

Vague dates never cause false alarms: a rule only fires when one date is *definitely* before the other,
with approximate dates widened by `calendar.approxYears`. In `world.json`, `"rules": { "duplicate-name":
"info", "two-places-at-once": "off" }` changes a rule's severity or turns it off.

## Folder layout

```
packages/core      @lore-forge/core: types, date math, parser/serializer, rule engine, rules, snapshot, JSON Schemas
  src/rules/       one file per rule family; builtinRules in index.ts
  schemas/         *.schema.json (draft 2020-12)
  test/            node:test behaviour tests
  src/publish/      World Bible / Story Book document model, art briefs, Markdown output
packages/pdf       @lore-forge/pdf: renders those documents to PDF (pdfkit + DejaVu fonts)
packages/cli       lore check / export / bible / book
packages/desktop   Electron main + preload, Preact renderer, electron-builder config
examples/shifting-sands   example world that triggers every rule
docs/INTEGRATION.md       how other tools (AI-HQ, Game-Forge) read worlds
```

## Development notes

- Tests use Node's built-in runner with native TypeScript type stripping. There is no test framework and no
  build step. `--conditions=source` resolves workspace packages to their `.ts` sources.
- The desktop app is bundled by esbuild (`packages/desktop/build.mjs`). `npm run watch -w
  @lore-forge/desktop` rebuilds on change.
- Runtime dependencies: `yaml` (core), `pdfkit` and `dejavu-fonts-ttf` (pdf), `preact` (desktop).
- Headless smoke test: `LORE_FORGE_SMOKE=1 LORE_FORGE_OPEN=$PWD/examples/shifting-sands xvfb-run -a npx
  electron packages/desktop --no-sandbox` prints `SMOKE OK {...}` and exits 0 once the world has loaded and
  rendered and it has exported both PDFs (set `LORE_FORGE_SMOKE_OUT=<dir>` to keep them). It exits 1 on a
  renderer error, a crash or a failed PDF export.

## License

Not chosen yet. Add a LICENSE file before publishing.
