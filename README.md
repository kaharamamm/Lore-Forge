# Lore-Forge

A local-first desktop app for writing the worlds, lore and characters of your games, with a consistency
checker that notices when your canon contradicts itself:

> Orsan the Grey can't kill Queen Ilsa in 1920: Orsan the Grey died in 1800 (source: Characters/Orsan the Grey).

A world is a plain folder of text files (`world.json` plus one Markdown file per entry). You can keep it in
git, diff it, and read it from other tools. Nothing leaves your machine.

Version 0.4.0 · world format `schemaVersion: 1` (worlds from 0.1 open unchanged).

## What's new in v0.4.6

- **Popups fit every window.** New book, the Book cover editor, World settings with its eras, About, the colour,
  font and icon pickers, dropdowns, the story chip and add menu, the right-click menu, the relationship dialog,
  the export preview and every confirm stay inside the window from 1024x640 to 2560x1440. Titles and Save/Cancel
  stay put while the body scrolls, wide dialogs go to one column when narrow, and menus flip or shift to stay on
  screen. Toasts move to the bottom-left while a dialog is open.
- **Camelamamm.** A finished sample world: *Mr Camel* in six chapters (about 5,900 words) with 23 entries, a
  cover, two eras and no problems in `check`. It is the world a new install opens with.
- **Any number of books.** The shelf wraps into as many rows as it needs and scrolls; covers load as they come
  into view, and the hovered row tilts in place. Recent worlds are no longer capped.
- **Search books.** A search box above the shelf matches titles first, then subtitles and authors, then
  descriptions, ignoring accents and Turkish dotted/dotless i. Ctrl+F or / focuses it, Esc clears it, and Enter
  opens the book when only one matches.

## What's new in v0.4.5

- **New book.** *Show title on cover* and *Show emblem on cover* are in the create dialog too, with or without a
  picture, so a plain cover is possible. The title always stays on the spine, shown beside the preview.
- **Shelf.** Moving the mouse off a book always returns it to rest, whether it was waiting to open, turning,
  fully open, or you moved straight onto the next book. The stats panel hides with it.
- **Book cover editor.** Edits are a draft with a live preview until **Save cover**; **Cancel** or Esc reverts,
  closing with unsaved changes asks first, and a short *Cover saved* note confirms. The buttons stay in view on
  small windows.
- **Title.** The three title styles are gone; **Title font** sits at the top of the Title section. Font lists and
  other dropdowns scroll with the wheel, touch and keyboard again, with the search box pinned on top.

## What's new in v0.4.4

- **Top bar.** Back sits top left, then the world's cover and title (one button) that opens world Home. The
  laurel icon is replaced by **World settings**, which also holds **About**. Mouse buttons 4 and 5 (and
  Alt+Left/Right) go back and forward, including between the library and a world.
- **Delete dialog.** A themed dialog with the book's cover, *Keep it* focused, a focus trap, and Esc or a click
  outside to keep the book.
- **Shelf.** A book now opens like a book, hinged on its spine edge, in place. The books beside it slide aside so
  they stay in frame and slide back afterwards. A book at the right edge opens to the left inside the shelf.
  Hover waits a moment, so spamming the mouse across the shelf no longer leaves books half open. Thickness grows
  with content but stays in a modest range.
- **Story.** Detection finds places, items, weapons, events and factions as well as characters. Select words or
  right-click a name to add it with the type guessed, pick another type, link it to an existing card or search
  the world. Ctrl+Shift+A adds the selection straight away.
- **Landing page.** A light shaft with dust, drifting runes and candles that follow the mouse a little. It pauses
  while the window is hidden and stays still under reduced motion.
- **New book.** Choose the emblem (icon picker) and the cover colour yourself. Random is only the starting
  value, and **Shuffle** rolls a new one.
- **Cover switches.** *Show title on cover* and *Show emblem on cover* (on by default). The title always stays on
  the spine. With a picture, the spine takes its colour from the picture's left edge and picks a readable
  title colour. You can set both yourself in the new **Spine** group, and *Automatic* resets them.
- **Cover fonts.** A searchable font picker grouped into *Bundled* (16 open-licence fonts, Liberation
  Serif/Sans among them) and *System* (every font installed on your computer). Each name is shown in its own
  font, and the list works from the keyboard. The choice is saved as `cover.font` in world.json. If a font is
  missing, the cover falls back to the style's font and says so. The PDF embeds the font, or uses DejaVu with
  a note when the font lacks the title's letters.
- **Recent cover pictures.** *No picture* keeps the file. Small thumbnails under the picture buttons show the
  world's images and your recent uploads, so you can pick one again without uploading it.

## What's new in v0.4.3

- **No command palette.** Ctrl+K is gone. Everything it offered has a button: the view tabs (Home, Editor,
  Timeline, Relationships with the family tree and web, Story), **World settings** next to the tabs (and on
  Home), **New chapter** in the Story chapter list, **+ New** in the sidebar, **World Codex** and **Story Book**
  in the top bar, **About** in the top bar and **Reload from disk** on world Home.
- **Sidebar search** reads just *Search...* and still searches names and text (Ctrl+F).
- **Icon search.** The icon picker (card pictures and cover emblems) has a search box: type a name or a word
  such as *sword*, *tower*, *kale* or *kılıç*. It shows how many icons match, says so when none do, and works
  from the keyboard (Down into the grid, arrows inside it, Enter picks the first match).
- **Colour picker without Done.** Changes apply as you pick; click outside or press Esc to close it.
- **Books on the shelf are real 3D boxes.** Spine, front cover, back cover, top and page block. Hover or focus
  pulls the book towards you and turns it in your hand until the cover faces you; it turns back and slides in
  when you leave. With reduced motion the spine simply crossfades to the cover.

## What's new in v0.4.1

- **Story extraction reads more sentence shapes.** "Keller the grand magus created the scepter. he was a very
  good wizard." proposes a Keller character (title Grand Magus, occupation magus, male) and a Scepter item he
  made. Sentences with no new names propose nothing.
- **A real library.** Wooden bookcase with a soft magic glow and slowly drifting motes (off with reduced
  motion). Books stand spine out with their title; hover or focus pulls one off the shelf and turns it to show
  the cover and its entry counts, and it springs back when you leave. Click or Enter opens it. Many worlds wrap
  onto more shelves. The delete button sits on the cover's top-right corner (hover or keyboard focus) and still
  asks first; the shelf and recent worlds update straight after the trash.
- **`worlds/` instead of `examples/`.** The sample world lives in `worlds/shifting-sands`, and new books are
  created next to it in development.
- **Cover editor.** Click the cover on world Home to set a gradient or plain colour, a picture (upload, the
  world's own, or none), an emblem and its colour, and the title lettering and colour. It is stored under
  `cover` in `world.json` and used on the shelf, the small top-bar cover, Home, the previews and the PDF covers
  (World Codex and the printed Story Book; the Word export has no cover page).
- **Colour picker.** One picker everywhere colours are chosen: hue ring around a saturation/brightness square,
  hex (with optional alpha, `#rrggbbaa`) and RGB fields, an opacity slider on a checkerboard, theme swatches and
  your recent colours. Keyboard: arrow keys on the ring and square, Shift for bigger steps.
- **Sharper portraits.** Pictures smaller than 128 px (such as placeholders) show the entry icon instead of
  a blurry upscale.

## What's new in v0.4

- **Story (Ctrl+4).** A manuscript space for the whole story, written chapter by chapter. The editor fills
  the window and scrolls on its own; the chapter list (new, reorder, delete) replaces the sidebar while you
  write, with a word count per chapter and for the whole story. Chapters save automatically to
  `story/NN-slug.md` (a short YAML header with `title`, `order` and an optional `date`, then plain prose).
  Names you type link themselves as in the entry editor: highlights, hover cards, **Ctrl/⌘+click** to open,
  and Back/Forward to return.
- **Proposals, never automatic.** As you write, Lore-Forge reads the text and proposes what it found:
  *King Camel was born in 1998.* proposes a character **Camel**, born 1998, title King. Battles, deaths,
  marriages, parents, places and named items are recognised too. Each proposal shows its fields and the
  sentence it came from, with **Add**, **Edit…** (change type, name, dates or relations first),
  **Merge…** (fold it into an entry you already have, adding the name as an alias) and **Ignore** (saved in
  `story-ignored.json`), plus **Ignore all**. Names that already match an entry are listed as
  *Already exists: Kadir Humpback (character)* instead of being proposed again; when the story says
  something new about one (a birth year it lacked), that shows as an **Update** you can apply.
- **Live warnings while you write.** The same rules as the rest of the world run on what the story says,
  a moment after you stop typing. A sentence that breaks canon is underlined in the editor and listed in the
  warnings panel, where **Go to** selects the sentence. A new rule, `story-contradiction`, flags the story
  disagreeing with an entry (*The story says Orsan the Grey was born in 1745, but Characters/Orsan the Grey
  says 1740.*). Mark intended works as everywhere else.
- **The Story Book is your story.** When a world has chapters, the Story Book prints them as the book
  (*Chapter 1. The Salt Road*), with the chronicle of events and notes as an appendix (a preview checkbox
  turns it off). Worlds without a story print as before.
- The extractor is deterministic and runs offline. An AI tool (AI-HQ) can plug in its own extractor and get
  the same duplicate checks; see [docs/INTEGRATION.md](docs/INTEGRATION.md#story).
- Worlds from 0.1–0.3.1 open unchanged; the `story/` folder is optional. The sample world (`worlds/shifting-sands`) has one chapter.

### Also in v0.4: the library, editing tools and a print-ready book

- **A library to start from.** The start screen is a bookshelf: each world is a book with its cover colour
  (or picture) and name; no folder paths. **New world** is the empty book at the end of the shelf. New
  worlds go into the app's `worlds/` folder by default (the project's `worlds/` in development, the app's
  user-data folder when installed); **Change…** picks another folder and is remembered. **Delete** on a
  book asks first, then moves the folder to the system trash (nothing is deleted outright).
- **Back to the library:** the small cover next to the world title returns to the shelf. Reload and Close
  are gone from the top bar (**Reload from disk** is on world Home),
  and so are the top-bar search box, the folder path and the permanent *Saved* label (the save status only
  shows for a moment after a save, or when saving fails).
- **Sidebar:** wider by default and resizable (drag its edge, or arrow keys on the handle; double-click
  resets). The width is remembered. **Warnings** are grouped into Errors, Warnings, Info and Marked
  intended, each with its count, collapsible, and the open/closed state is remembered.
- **Cards** of the same kind are all the same size. Bigger text fields, especially the long ones.
- **Pictures:** each card's picture can be changed: pick an icon, its colour and the background, or one of
  the entry's images (stored as `picture` in the entry). Without a choice the default fits the entry: a
  female or male figure from the gender, title or first name, a castle, palace, hut or house from a place's
  kind or name, a crown, ring, scroll or axe for items, and so on.
- **Race or kind** is a row of chips with icons: type to add (with suggestions), × to remove. Several races
  are allowed.
- **More detail, all optional:** characters have gender, title, occupation, languages, personality, goals,
  skills, affiliations, home and possessions; places kind, population, ruler and features; factions kind,
  leader, headquarters, ideology, allies and enemies; items kind, origin, location, owners and powers;
  events kind, causes, outcome and consequences. Empty means unknown and is never written to the file.
  Reference fields (home, ruler, leader, ...) count as relationships in the rules and the graphs.
- **Tags** were free keywords used only by the sidebar filter. The editor no longer shows them; tags in
  existing files are kept and still match the filter.
- **Relationships you can edit in place.** Drag an entry from the sidebar onto the family tree or the
  relationship web, drag from a node's handle to another node to connect them, click a line to change or
  delete the relationship. Every change is written to both entries' files at once and shows in the editor;
  **Ctrl+Z** undoes the last change.
- **Print-ready Story Book.** The PDF is laid out like a printed book: 6 × 9 in trim by default (also
  5.5 × 8.5 in and A5), mirrored margins with a wider inside edge for the binding, half-title, title page,
  copyright page, optional dedication and epigraph, contents, each chapter starting on a right-hand page
  with a drop cap, running heads (book title on left pages, chapter on right pages), page numbers from the
  first chapter (none on chapter openings), a serif text face, justified and hyphenated text, and no
  single lines left at the top or bottom of a page. **Save Word (.docx)…** writes the same book for Word
  (Word fills in the contents page numbers when it opens the file). The preview shows the trim, the front
  pages and the openings; the book details (title, author, publisher, dedication, epigraph, copyright text)
  are edited there and saved in `world.json`.
- **App icon:** an open book on an anvil with a gold spark, used for the window, the installers and a
  Linux launcher (`packages/desktop/build/lore-forge.desktop`).
- The app opens at 1920 × 1080 (or the screen size if smaller) and is checked at 1280 × 720, 1920 × 1080
  and 2560 × 1440.

## What's new in v0.3.1

- **A new look.** Dark, quiet panels with gold accents and Cinzel headings. Every type, status and action
  uses a drawn icon from [game-icons.net](https://game-icons.net) (no emoji, so no empty boxes on systems
  without an emoji font). **About** in the top bar lists the credits and licences.
- **Ctrl+F** focuses the sidebar search.
- **Book-cover start screen and a world home page.** Recent worlds and the sample world show as covers (the first
  place, event, item or character image in the world, or a generated cover). Opening a world lands on **Home (Ctrl+H)**: overview, counts and image
  cards for every entry. Entries show their portrait (the first image in the entry, or a generated
  emblem) in the sidebar, on hover cards, in the family tree and in the relationship web.
- **Pan and zoom.** The relationship web is a zoomable map with a minimap; the family tree and the timeline
  zoom too. Everywhere: drag to pan, **Ctrl/⌘+scroll** or pinch to zoom, **Fit** to see everything. A plain
  scroll wheel still scrolls the page (on the timeline, **Shift+scroll** moves along time).
- **Back and forward.** Mouse buttons 4/5 or **Alt+←/→** go through the entries and views you visited.
- **Status always has one value** (default *unknown*), the dead get a tombstone, and characters have a
  **race/kind** field (human, ghoul, vampire, …). Dates accept partial `DD.MM.YYYY` input.
- **World Codex** replaces "World Bible" everywhere (`lore bible` still works as an alias).
- Calm motion: lists and views animate briefly, and all of it turns off with the system's *reduce motion*
  setting.

## What's new in v0.3

- **A clearer look.** Every type has an icon, a word and a color (character, place, faction, item, event,
  note). They appear the same way in the sidebar, chips, links, the timeline and the trees. Ended entries
  carry a mark plus a word (dead, destroyed, dissolved) and are shown muted. Empty views explain what to do next, and saving or exporting shows a toast.
- **Status first.** Characters, places, factions and items start with a status (alive/dead,
  standing/destroyed, active/dissolved, intact/destroyed/lost). An ongoing status hides the death or
  destruction date. A hidden date stays in the file, the editor says so, and `dead-marked-alive` still
  catches it (now also for standing places, active factions and intact items).
- **Names link themselves.** Names and aliases typed in the text are highlighted in their type color
  (case-sensitive, whole words, longest name first, Turkish letters count as word letters). Hover one for a
  card with its type, dates and status. **Ctrl/⌘+click** or **Ctrl/⌘+Enter** opens it, and a picker appears
  when a name is shared. The chips under the text do the same from the keyboard. The checker and exports
  count these as references (they never cause `dangling-reference`).
- **Relationship types that make sense.** A table in core (`RELATION_KINDS`) says which types go from
  which entry type to which. The editor's relation dropdown and target picker only offer what fits, and the
  new `relation-kind` rule warns about nonsense like an item being `parent-of` a character. Custom types are
  still allowed.
- **Relationships view:** a family tree (generations top-down, spouses side by side, the dead marked and
  faded) and a relationship web around the selected entry. Every box opens its entry.
- **Timeline:** era bands with labels, lifespans as bars, events as points, warning markers, hover details,
  zoom (−/Fit/+ or Ctrl+scroll) and type filters. Click a name or bar to open it.
- **Export preview:** **World Codex** and **Story Book** in the top bar open an in-app preview built
  from the same document the PDF uses. Pick the entry types, art briefs and warnings appendix for the
  Codex, or chapters by era, by year ranges or as one chapter for the Book, then **Save PDF…**.


- **Reference images for every entry type**, with the same storage (`images/<entryId>/`) and provenance
  record. Each type suggests its own views: characters A-pose, front, back, left, right, three-quarter,
  concept; places establishing shot, map, interior, exterior, mood, concept; items front, back, side, top,
  detail, concept; events scene, establishing shot, map, mood, concept. Any other view label is allowed and
  only gets an info note (`image-view`).
- **Visual description fields** (optional, free text): characters appearance, height & build, clothing,
  colour palette, distinguishing features, props; places architecture, climate, palette, scale; items
  material, size, details; events scene description, mood; factions emblem, attire, palette.
- **World Codex PDF** (`lore codex`, or **World Codex PDF…** in the app): cover, contents, world overview
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
- **Dates on your own calendar:** custom eras and months. Dates are typed as `DD.MM.YYYY` with as much
  as you know: `1920`, `03.1920`, `12.03.1920`, or `12.03` when the year is unknown. Also approximate (`~1800`),
  in another era (`450 OK`), or unknown (`?`). The older `1920-03-12` form still works. Rules only warn when
  the known parts prove a conflict (died "1800" and acted "12.03.1800" is fine).
- **Consistency engine:** 14 starter rules (listed below). Warnings show the severity as an icon plus a word,
  the offending fact, and the canon fact it conflicts with, including that fact's source. Warnings never block
  saving. You can mark one as *intended* (for example, a resurrection) and add a note. The mark is stored in
  `intended.json` inside the world.
- **Desktop app:** a sidebar grouped by type with search, a structured entry editor, a live warnings panel
  that jumps to the offending field, a timeline, a relationship view, and reference images with provenance
  (tool, prompt, date, sources, rights).
- **CLI:** `lore check`, `lore export`, `lore codex`, `lore book`.
- **JSON Schemas and an integration guide** so other tools can read worlds. See
  [docs/INTEGRATION.md](docs/INTEGRATION.md).
- **Sample world:** `worlds/shifting-sands` triggers every rule on purpose. Its README maps each rule
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
npm run lore -- check worlds/shifting-sands       # exits 1: the sample world has errors on purpose
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
uploaded. The sample world is bundled as a read-only resource and shows on the shelf; copy its folder if you
want to edit it. (In development every world in `worlds/` can be edited and deleted.)

On Linux, `npm run dist:linux` builds an AppImage into the same `release/` folder.

## Using the app

1. **Library:** pick a book from the shelf, open a world folder from elsewhere, or create a new one (a name
   and a cover colour; it goes into the worlds folder shown under the shelf, which you can change).
2. **Home and sidebar:** the world home shows every entry as a card. The sidebar groups entries by type
   (icon and color), each with a portrait, an error or warning count badge and an ended mark. Press
   **Ctrl+F** to search names and text (*Search...*). Use **+ New** to create an entry in a group.
3. **Editor:** status and dates first, then the other structured fields and the body (names in it link
   themselves). Changes save automatically to the entry's file
   (the top bar shows *Saving…*, then *Saved* for a moment, then nothing; **Ctrl+S** saves now). Date fields show how the date was
   understood, and reference fields show what they resolve to.
4. **Warnings panel:** updates live. Use **Go to** to jump to the offending field, or the canon link to open
   the conflicting entry. Use **Mark intended** to keep a contradiction on purpose. Intended warnings stay
   visible in their own group.
5. **Timeline (Ctrl+2):** era bands, lifespans and existence spans by type, events as points and warning
   markers. Open-ended spans fade out. Drag or Shift+scroll to move along time, Ctrl+scroll or −/Fit/+ to
   zoom. **Relationships (Ctrl+3):** family tree or relationship web, then the
   selected entry's outgoing and incoming relations, grouped, plus the events it appears in.
6. **Story (Ctrl+4):** the manuscript, the chapter list and the Proposals panel (see *What's new in
   v0.4*). Nothing is added to the world until you click **Add**, **Apply** or **Merge**.
7. **PDFs:** **World Codex** and **Story Book** in the top bar open a preview with options. **Save PDF…**
   saves pending edits, asks where to save, writes the PDF plus its `.md` copy, and offers *Show in folder*.
   The Story Book also has a trim size, the book details and **Save Word (.docx)…**. The editor's *Visual description* and
   *Reference images* sections feed the World Codex's art briefs; *Story Book* (chapter, order) appears on
   events and notes.

Keyboard: **Ctrl+H** and **Ctrl+1/2/3/4** switch views, **Alt+←/→**
(or mouse buttons 4/5) go back and forward, **Ctrl/⌘+Enter** opens the name at the cursor in the text, **Esc**
closes the preview, **Alt+↑/↓** move to the previous or next entry, **Ctrl+Shift+W**
focuses the warnings panel, and Tab or Shift+Tab reach every control. The layout reflows down to a single
column, so it stays usable at 200% zoom. Text contrast is at least 4.5:1, and severity is always shown as an
icon plus a word, and entry types as an icon plus a word, never by color alone
(`npm run contrast -w @lore-forge/desktop` checks the palette).

## CLI

```bash
npm run lore -- check <worldDir>            # human-readable; exit 0 = no errors, 1 = errors, 2 = unreadable/usage
npm run lore -- check <worldDir> --json     # machine-readable check report
npm run lore -- export <worldDir> --out world.snapshot.json   # versioned JSON snapshot
npm run lore -- codex <worldDir> -o codex.pdf   # World Codex PDF + codex.md (default name <world-id>-codex.pdf)
npm run lore -- book <worldDir> -o book.pdf     # Story Book PDF + book.md
npm run lore -- book <worldDir> -o book.docx    # the same book for Word
npm run lore -- book <worldDir> --trim a5       # trim: 6x9 (default, or book.trim), 5.5x8.5, a5
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
| `dead-marked-alive` | error | status is `alive` (or `standing`, `active`, `intact`), but an end date or a killing says otherwise |
| `invalid-date` | error | a date can't be parsed or uses an unknown era |
| `date-order` | error | an end comes before its start (died before born, destroyed before founded, ...) |
| `file-error` | error | a file can't be read as an entry (the rest of the world still loads) |
| `relation-kind` | warning | a relation type doesn't fit the two entry types (an item `parent-of` a character); custom types are skipped |
| `image-view` | info | an image's view label is not one of the usual views for its entry type |
| `story-contradiction` | warning | a story chapter says something different from an entry (another birth year, title, ...) |

Story sentences are also checked with the timeline rules above (`after-death`, `before-birth`, ...), as if
the proposals were already added.

Vague dates never cause false alarms: a rule only fires when one date is *definitely* before the other,
with approximate dates widened by `calendar.approxYears`. In `world.json`, `"rules": { "duplicate-name":
"info", "two-places-at-once": "off" }` changes a rule's severity or turns it off.

## Folder layout

```
packages/core      @lore-forge/core: types, date math, parser/serializer, rule engine, rules, snapshot, JSON Schemas
  src/rules/       one file per rule family; builtinRules in index.ts
  schemas/         *.schema.json (draft 2020-12)
  test/            node:test behaviour tests
  src/publish/      World Codex / Story Book document model, art briefs, Markdown output
  src/story.ts, src/extract.ts, src/story-check.ts   story chapters, the proposal extractor, live story checks
packages/pdf       @lore-forge/pdf: renders those documents to PDF (pdfkit + DejaVu fonts)
packages/cli       lore check / export / codex (alias bible) / book
packages/desktop   Electron main + preload, Preact renderer, electron-builder config
worlds/                   the worlds folder; new books go here when running from the source checkout
worlds/shifting-sands     sample world that triggers every rule (and has one story chapter)
docs/INTEGRATION.md       how other tools (AI-HQ, Game-Forge) read worlds
```

## Development notes

- Tests use Node's built-in runner with native TypeScript type stripping. There is no test framework and no
  build step. `--conditions=source` resolves workspace packages to their `.ts` sources.
- The desktop app is bundled by esbuild (`packages/desktop/build.mjs`). `npm run watch -w
  @lore-forge/desktop` rebuilds on change.
- Runtime dependencies: `yaml` (core), `pdfkit`, `dejavu-fonts-ttf`, `hyphen` (en-US patterns),
  `docx` and `fflate` (pdf), `preact` (desktop).
- App icon: `src/renderer/icon.svg` is the source; `npm run icons -w @lore-forge/desktop` (Electron, so it
  needs a display or `xvfb-run -a`) renders `build/icon.png`, `build/icons/*.png`, `build/icon.ico` and
  `build/icon.icns`.
- Headless smoke test: `LORE_FORGE_SMOKE=1 LORE_FORGE_OPEN=$PWD/worlds/shifting-sands xvfb-run -a -s
  "-screen 0 2600x1500x24" npx electron packages/desktop --no-sandbox` prints `SMOKE OK {...}` and exits 0
  once the world has loaded and rendered, the views have been exercised at 1280 × 720, 1920 × 1080 and
  2560 × 1440 (the screen must be a little larger than the biggest size), and it has exported the PDFs and a
  `.docx` (set `LORE_FORGE_SMOKE_OUT=<dir>` to keep them). It works on a temporary copy of the world and
  exits 1 on a renderer error, a crash or a failed export.

## License

Not chosen yet. Add a LICENSE file before publishing.
