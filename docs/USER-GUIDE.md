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
- **Settings** (the gear; also in an open book, left of **World settings** in the top bar and on world Home):
  - **Language**: English or Türkçe (Turkish), each with its flag. The whole app changes at once, including warnings, the patch notes and the labels in the World Codex and Story Book. Until you pick one, Lore-Forge follows the system's language.
  - **Display**:
    - **Window**: Windowed, Maximized or Full screen.
    - **Resolution**: the window's size, from 1280 × 720 to 3840 × 2160. Sizes larger than the screen are greyed out, and a size dragged by hand shows as Custom.
    - **Interface scale**: Auto, or 80% to 150%. Auto keeps the proportions Lore-Forge was designed in at 1920 × 1080: larger on 2K and 4K screens, smaller in small windows.
  - **Where new worlds go**, and whether the sample world is on the shelf.

  Language and display changes apply at once and are remembered; the folder and the sample are saved with **Save**.
- **Patch notes** lists what changed in each version, newest first, from the changelog that comes with the app (it works offline). When the updater has found a newer version, its notes show on top.
- **Connect AI** connects Lore-Forge to an AI app (Claude Desktop, Claude Code, Codex, Cursor, or another app through **Copy the settings**). You can then ask the assistant to write a story in Lore-Forge, and it writes the whole book here. **Pictures** sets up the image service it uses (OpenAI, Google Gemini or xAI Grok) with your own API key. See [AI assistants](MCP.md).
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
- **Suggestion lists** (race, gender, kind, relation types, verbs) are themed lists with an icon for every word; the chosen value shows its icon too. Gender offers female (♀), male (♂) and genderless (⚲).
- **Undo and redo:** Ctrl+Z undoes the open entry's last change, whatever it was: a status pill (alive to dead), a list choice, a picture or icon, a row added or removed, or typing (one step per pause). Ctrl+Y or Ctrl+Shift+Z redoes it. The field comes into view and flashes. A change made outside the app since (by an AI assistant or an editor) is never undone by accident.
- **Relationships:** typed and dated relations to other entries. The type list only offers types that fit the two entry types; custom types are still allowed.
- **Visual description, reference images and 3D models** for artists and 3D tools, under **Images | 3D model** tabs (see [Images](FORMAT.md#images) and [3D models](FORMAT.md#3d-models)). The download button on a picture saves a copy of it anywhere. Pictures can be PNG, JPEG, WebP or GIF; an animated GIF moves everywhere the picture shows (Mr Camel's portrait in the sample world is one), and the World Codex and Story Book print its first frame. Mr Camel also has a 3D model, as an example.
  - **3D model:** **Add model…** copies a `.glb`, `.gltf` (with its data embedded), `.obj` or `.fbx` file into the world. A model turns by itself when it opens (**Auto-rotate**, off when the system asks for reduced motion). Drag to orbit, scroll to zoom, right-drag (or Shift+drag) to pan; **Reset view** frames it again. An entry can have several models: pick one from the row above the viewer, or download, rename and delete it there. **Download…** saves a copy anywhere, to use it in other programs. Files over 25 MB get a warning, since they are slow to load. The viewer needs WebGL; if the graphics driver offers none, it says so instead.
- **Looks:** the visual description, pictures and models above are the entry's **Default** look. When it looks different for a while or from some point on (after a war, in coronation robes, in old age), **+ New look** adds a look: give it a name, why it looks different, and when it applies (**Always**, **After an event**, **Before an event**, **Between dates** or **In an era**). A look after an event starts once the event is over, and one before an event ends as it begins. A look's visual description holds only what changes (the Default text shows in its empty fields), and it has its own pictures and 3D models, kept in a folder of their own. **Delete look** moves its pictures and models to the Default look. The checks warn about a look tied to an era or event that does not exist, a look before birth or after death, and two looks at the same time; **Go to** opens the look. Mr Camel's "Caravan days" in the sample world is an example.
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

**World settings** in the top bar (the calendar button): the default era (dates without an era abbreviation count in it), the eras (name, abbreviation, start and end, colour, and how many dates use each), and the months with their lengths. Saved in `world.json`.

### Changes from Outside the App

Lore-Forge watches the open book's folder and the library. When an AI assistant, a text editor or `git pull` changes the files, the book shows the change a moment later: new and changed entries, chapters and pictures, without a reload. New books appear on the shelf. If you are typing in the same entry or chapter at that moment, both are kept: the outside change and what you typed (where both changed the same field, your typing wins).

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
| Ctrl+Z | Undo: the open entry's last change in the Editor, the last link change on a graph |
| Ctrl+Y, Ctrl+Shift+Z | Redo in the Editor |
| Esc | Close a dialog, list or preview |
| F11 | Full screen on and off |
| Ctrl + / Ctrl − | Interface scale up or down (saved, as in Settings) |
| Ctrl 0 | Interface scale back to Auto |

Every control is reachable with Tab and Shift+Tab; dialogs keep focus inside them. The layout reflows down to one column, so it stays usable at 200% zoom. Text contrast is at least 4.5:1 (`npm run contrast -w @lore-forge/desktop` checks the palette).

## World Codex and Story Book

**World Codex** and **Story Book** in the top bar open an in-app preview built from the same document the files are drawn from. Saving writes the PDF and a Markdown copy next to it (for AI tools), and offers *Show in folder*.

### World Codex

A reference book of the whole world: a cover, contents, the world overview and calendar, every entry by type with its facts, relationships, visual description, text and reference images with provenance, each **look** with its own pictures, an **art brief** per character, place, item and event (an image prompt, plus a 3D turnaround brief for characters and items; a look gets its own, and an event's brief describes each participant as they look on its date), a timeline, a relationship summary, a glossary of names and aliases, and an appendix of open warnings. The preview chooses the entry types and turns the art briefs and the warnings appendix on or off.

### Story Book

When a world has story chapters, the Story Book is the story: each chapter in order, then the chronicle of events and notes as an appendix (which the preview can turn off). A world without chapters becomes a chronicle of its events and notes in in-world date order, in chapters by era or by year ranges; a page's own `chapter` field and `bookOrder` override that.

The book is laid out like a printed book:

1. The cover: the world's cover art with the book title, subtitle and author.
2. The title page, the copyright page (always; a plain notice when the field is empty), then the dedication and the epigraph when set.
3. The contents, with page numbers.
4. Each chapter starting at the top of a new page, with its label, title and a drop cap.

Text is set in a serif face, justified and hyphenated, with no single line left at the top or bottom of a page. Margins are mirrored with a wider inside edge for the binding; running heads show the book title on left pages and the chapter on right pages; pages are numbered from the first chapter, with no number on chapter openings. There are no blank pages; for a printed copy, **Start chapters on right-hand pages** opens the title page and every chapter on a right-hand page.

Trim sizes: 6 × 9 in (used when a book does not set one), 5.5 × 8.5 in, A5, A4 and US Letter. The sample Story Book is A4. The book details (title, author, publisher, dedication, epigraph, copyright text) are edited in the preview and saved in `world.json`. **Save Word (.docx)…** writes the same book for Word.

The Story Book assembles what you wrote. It never writes, rewrites or summarises prose.

### Fonts

PDFs embed DejaVu fonts, so Turkish (ş ğ İ ı) and other Latin Extended, Greek and Cyrillic text renders, and characters the fonts lack (such as emoji) are dropped rather than printed as empty boxes. Cover titles can use one of 16 bundled fonts (Cinzel Decorative, Uncial Antiqua, IM Fell English, EB Garamond, Pirata One and others) or an installed system TrueType/OpenType font; a font that cannot draw the title falls back to DejaVu with a note. PNG and JPEG images are embedded; WebP and GIF images are listed by file name.

## Updates

Lore-Forge checks GitHub for a new version a few seconds after it starts and every four hours (switch this off under **About → Updates**; **Check now** checks at once). A notice in the bottom corner offers **Download**, **Later** and **What's new**, then shows the download's progress and **Restart to update**.

- Windows and the AppImage install the update themselves and restart.
- The `.deb` asks for your password once (`pkexec`, to run `dpkg`), then restarts.
- macOS builds are not signed, so **Download** opens the new disk image to drag into Applications.

Updates never touch your worlds or settings: they live in the folders below, not in the program's folder. Copies of 1.0.0 downloaded before 7 November 2026 have no updater: download the current version once from the README, and from then on Lore-Forge updates itself.

## App Settings and Storage

| Where | What |
| --- | --- |
| The world folder | everything about a world (see [World Format](FORMAT.md#world-format)) |
| `<user data>/settings.json` | the folder new worlds go to, whether the tour was seen (`tourDone`), automatic update checks (`autoUpdate`), the window mode, size and interface scale (`display`), the language (`language`: `en` or `tr`) |
| `<user data>/recent-worlds.json` | worlds opened from outside the worlds folder |
| `<user data>/recent-cover-uploads.json` | pictures uploaded for covers, offered again |
| `<user data>/ai-images.json` | the picture service for AI assistants, its API keys and models (**Connect AI → Pictures**; readable only by you on macOS and Linux) |
| `localStorage` | sidebar width, open or closed editor and warning sections, recent colours |

`<user data>` is the app's user-data folder: `~/.config/Lore-Forge` on Linux, `%APPDATA%\Lore-Forge` on Windows and `~/Library/Application Support/Lore-Forge` on macOS.

New worlds go to the project's `worlds/` folder when running from source and to `<user data>/worlds` in an installed app, unless Settings chooses another folder. The installed app ships Camelamamm as a read-only world; **Duplicate** makes an editable copy.
