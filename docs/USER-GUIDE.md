# Lore-Forge user guide

How the desktop app works, screen by screen. For the file format see [FORMAT.md](FORMAT.md); for the command line see [CLI.md](CLI.md).

## The App

### Library

The start screen is a bookcase. Every world is a book: a 3D spine with its title and emblem on the shelf; point at a book (or focus it with the keyboard) and it comes off the shelf and turns to show its cover and entry counts. Click or press Enter to open it.

- **New book** is the blank book at the end of the shelf: a name, a cover colour or picture, an emblem, and the folder it goes into.
- **Search books** above the shelf matches titles first, then subtitles and authors, then descriptions, ignoring accents and the Turkish dotted and dotless i. Ctrl+F or `/` focuses it, Esc clears it, Enter opens the only match.
- **Duplicate** and **Delete** sit on a book's cover. Duplicate asks for a name (it suggests "<name> (copy)"), copies the whole world into the worlds folder with a new id, keeps the cover and opens the copy. It works on the read-only sample too, which is how you get your own copy of Camelamamm. Delete asks first and moves the folder to the system trash. Nothing is deleted outright.
- **Take the tour** shows a short guided tour (eight steps) through the library and the sample world. It starts by itself the first time Lore-Forge opens; **Skip** or Esc ends it, Back and Next (or the arrow keys) move through it, and it does not change the sample. **About** has the same button.
- **Open a world folder…** opens a world from anywhere on disk; it then stays on the shelf.
- **Library settings** chooses the folder new books go to.
- **About** lists the credits and licences, and has **Updates** (see [Updates](#updates)).

Behind the shelf is a quiet animated scene (light through a window, dust, runes, candles and embers). It pauses while the window is hidden and stays still with the system's reduced-motion setting.

### World Home

Opening a world lands on Home: **Duplicate** (as on the shelf), the book's cover (click it to edit the cover), counts of entries, eras and warnings, links to the timeline, family tree, relationship web and the two exports, and a card for every entry with its picture. The paint button on a card changes that entry's picture: an icon with its colours, or one of its images.

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
- **Visual description, reference images and 3D models** for artists and 3D tools, under **Images | 3D model** tabs (see [Images](FORMAT.md#images) and [3D models](FORMAT.md#3d-models)).
  - **3D model:** **Add model…** copies a `.glb`, `.gltf` (with its data embedded), `.obj` or `.fbx` file into the world. Drag to orbit, scroll to zoom, right-drag (or Shift+drag) to pan; **Reset view** frames it again and **Auto-rotate** spins it. An entry can have several models: pick one from the row above the viewer, or rename and delete it there. Files over 25 MB get a warning, since they are slow to load. The viewer needs WebGL; if the graphics driver offers none, it says so instead.
- **Body:** Markdown with `[[links]]` and `@mentions`. Names and aliases typed in any text link themselves: they are highlighted in their type colour, show a hover card, and open with Ctrl/⌘+click.

### Warnings Panel

Updates live while you type. Warnings are grouped into Errors, Warnings, Info and Marked intended. Each one says what is wrong, the canon fact it conflicts with and where that fact comes from. **Go to** jumps to the offending field; **Mark intended** keeps a contradiction on purpose (a resurrection, an unreliable narrator) with a note. Warnings never block saving.

### Timeline (Ctrl+2)

A Gantt chart of the world: era ribbons and coloured era columns (an era's own colour when the calendar sets one), a year axis that names the months once you zoom in far enough, and one lane per dated entry, grouped by type. Lifespans and existence spans are solid cards in their type's colour with their icon, name and dates, and a taller card with the picture behind it when the entry has a picture; events without an end are diamonds (a round picture when they have one); warning markers sit after each one. **Lanes** shows one lane per entry; **Stacked** packs each type's entries side by side on as few rows as fit. Turn types on and off with the chips. Drag or Shift+scroll moves along time, Ctrl+scroll or −/Fit/+ zooms, and it stops at the first and last year. The **Overview** strip at the bottom shows the whole span with a frame around what is on screen: click or drag in it to jump, or use the arrow keys, Page Up/Down, Home and End. Click a bar or name to open it.

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

## Updates

Lore-Forge checks GitHub for a new version a few seconds after it starts and every four hours (switch this off under **About → Updates**; **Check now** checks at once). A notice in the bottom corner offers **Download**, **Later** and **What's new**, then shows the download's progress and **Restart to update**.

- Windows and the AppImage install the update themselves and restart.
- The `.deb` asks for your password once (`pkexec`, to run `dpkg`), then restarts.
- macOS builds are not signed, so **Download** opens the new disk image to drag into Applications.

Updates never touch your worlds or settings: they live in the folders below, not in the program's folder. Version 1.0.0 has no updater, so it needs one manual download of a newer version.

## App Settings and Storage

| Where | What |
| --- | --- |
| The world folder | everything about a world (see [World Format](FORMAT.md#world-format)) |
| `<user data>/settings.json` | the folder new worlds go to, whether the tour was seen (`tourDone`), automatic update checks (`autoUpdate`) |
| `<user data>/recent-worlds.json` | worlds opened from outside the worlds folder |
| `<user data>/recent-cover-uploads.json` | pictures uploaded for covers, offered again |
| `localStorage` | sidebar width, open or closed editor and warning sections, recent colours |

`<user data>` is the app's user-data folder: `~/.config/Lore-Forge` on Linux, `%APPDATA%\Lore-Forge` on Windows and `~/Library/Application Support/Lore-Forge` on macOS.

New worlds go to the project's `worlds/` folder when running from source and to `<user data>/worlds` in an installed app, unless Library settings chooses another folder. The installed app ships Camelamamm as a read-only world; **Duplicate** makes an editable copy.
