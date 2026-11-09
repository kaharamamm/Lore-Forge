# Changelog

All notable changes to Lore-Forge are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-11-09

### Added

- **Turkish.** **Settings → Language** switches the whole app between English and Türkçe, each with its flag: every screen, the warnings and rule names, the patch notes, and the labels in the World Codex and Story Book. Until you pick one, Lore-Forge follows the system's language.
- **Settings inside a book:** the gear next to **World settings** opens the same Settings as the library (language, display, the worlds folder, the sample world). World settings has a calendar icon now.
- **Patch notes** in the library: what changed in each version, newest first, from the changelog that comes with the app (it works offline). A newer version the updater found shows on top with its notes.
- **Undo and redo in the editor.** Ctrl+Z undoes the open entry's last change, whatever it was: a status (alive to dead), a list choice, a picture or icon, a row added or removed, or typing (one step per pause). Ctrl+Y or Ctrl+Shift+Z redoes it. The field comes into view and flashes. A change made outside the app since (by an AI assistant or an editor) is never undone by accident.
- **GIF pictures.** Animated GIFs play everywhere a picture shows. The World Codex and Story Book (PDF and Word) print a GIF's first frame instead of leaving it out.
- In the sample world, Mr Camel's portrait is an animated GIF (steam rises from his kettle), and he has a 3D model.
- **Ask AI.** A tab next to Warnings runs Claude Code or Codex on the open book. Type a task (*"Write the next chapter"*, *"Fix the open warnings"*) and watch its replies, its steps and every change it makes as they happen; names in its steps link to the entries.
  - It runs on your own Claude or ChatGPT plan, says when you are close to your Claude usage limit, and can be stopped at any time.
  - It can only use Lore-Forge's own tools: no commands, no other files, no web.
  - Each book keeps its conversation, so follow-up questions work, also after a restart. Ctrl+J opens it.
  - **Ask AI about this:** an **Ask AI** button on each entry and in the Story view (also for the text you chose, and in its right-click menu) tells the AI what you mean and offers matching suggestions.
- **Book history.** Lore-Forge keeps snapshots of each book on this computer: when it opens, every 20 minutes while it changes, before each Ask AI task and before every restore.
  - **History** on World Home shows what changed since any snapshot and puts one entry, chapter or picture back, or the whole book.
  - **History** in an entry's header shows its earlier versions field by field, with **Restore this version**.
  - Every restore can be taken back too.
- **Undo an AI task.** After Ask AI changes the book, the panel lists what changed with an **Undo** button. Your own edits made meanwhile are left alone, and if something was edited again since, it asks first.
- **Make pictures from the app.** **Make a picture…** under an entry's pictures (and on each picture, to make a new one) draws one with the picture service set in Connect AI. The prompt comes from the visual description and the book's art style, and can be changed first; the picture lands in its view, for the look you are on. The AI tools and the app build the same prompt.
- **Spell checking in English and Turkish.** **Settings → Spelling** chooses the languages: English (US), English (UK), Türkçe, or none. Right-click a word with a wavy line for suggestions or **Add to the dictionary**; in the Story they sit at the top of its own menu. The names in the open book count as spelled right while it is open. Right-click in a text field now also offers Cut, Copy, Paste and Select all.
- **Share a book as one file.** **Share…** on World Home saves the whole book (entries, chapters, pictures, maps, 3D models and settings) as one `.loreforge` file, to send to someone or keep as a backup. **Open a book file…** in the library puts a shared book on the shelf as a copy of its own and opens it.
- **World maps.** A new **Map** view (Ctrl+5) shows the world's maps with its places pinned on them.
  - **Add a map…** takes a picture of a map. A book can have several (the world, a region, a city), and a map of one place opens from that place's pin on the other maps.
  - Each pin shows the place's picture and name. Hovering shows who lives there, what happened there and the places inside it; a click opens the place.
  - **Edit pins**: drag places onto the map and pins around it, nudge a pin with the arrow keys, undo with Ctrl+Z.
  - AI assistants can add maps (`save_map`), look at one with its pins (`get_map`) and pin places with `save_entries`. The new `map-pin` check warns about a pin on a map the book does not have.
  - The sample world has a map of the Sunsea, with Camelamamm, the Glass Dunes and the Hollow of Echoes on it.
- **Looks.** An entry can look different over time: after a war, in coronation robes, in old age. In the editor's Appearance section, **+ New look** adds one next to the **Default** look, with a name, why it looks different, and when it applies (always, after or before an event, between dates, or in an era). A look has its own visual description (only what changes; the rest comes from the Default look), its own pictures and its own 3D models.
  - The checks warn about a look tied to an era or event that does not exist, a look before birth or after death, and two looks at the same time.
  - On the Timeline, a gold line along the bottom of an entry's card shows when each look applies; click it to open the entry on that look.
  - The World Codex shows every look with its pictures and its own art brief, and an event's art brief describes each participant as they look on its date.
  - AI assistants can add, change and remove looks, ask how entries look on a date (the new `look_at` tool), see the looks of the people a dated chapter names, and make or attach a picture of a look.
  - Mr Camel's "Caravan days" in the sample world is an example.
- **Download:** **Download…** next to a 3D model, and a download button on every picture, save a copy wherever you choose, for use in other programs (handy for what an AI assistant made).
- **Display settings** in **Settings**:
  - the window (Windowed, Maximized or Full screen);
  - its resolution (1280 × 720, 1366 × 768, 1600 × 900, 1920 × 1080, 2560 × 1440 or 3840 × 2160);
  - the interface scale (Auto, or 80% to 150%). Auto keeps the proportions of the 1920 × 1080 design: larger on 2K and 4K screens, smaller in small windows.
  - F11 switches full screen; Ctrl +, Ctrl − and Ctrl 0 change the scale.
  - The layout also fits better at 1280 × 720 and on 2K screens at 100%.

### Changed

- Gender suggests female (♀), male (♂) and genderless (⚲), instead of non-binary.
- 3D models turn by themselves when they open (Auto-rotate starts on), unless the system asks for reduced motion.
- Questions such as deleting a 3D model dim the whole window, like the others.
- The Warnings panel is wider, as wide as Ask AI next to it.
- The buttons on a picture are roomier: Details and Remove sit in its top corners, and Make a new picture, Replace and Save a copy share one bar along the bottom.
- World home has **Settings** next to **World settings**, and changing the language keeps Settings open.
- **Library settings** is called **Settings**. The display settings no longer explain themselves under each row, and the resolutions no longer carry HD, Full HD, 2K and 4K tags.
- **Story proposals find far more, and fewer wrong ones.**
  - A name's last word says what it is. "Hollin Wood" and "the Copper Market" are places, "the Seven Founders" is a group, "the Copper Paddle" is an item and "the Great Rockfall" is an event. "Edmund Hall" stays a person.
  - Places are found after place words with "the" ("across the Red Erg"), after "of the" ("the shaft of the Moon Well") and by their endings ("the Millpond", "the Greywood").
  - "The Hall of Heroes" and "the Ringing of the Bell" keep their whole names. "The Sunblade, a sword…" is an item, and "rode out of Highgate" is a place.
  - A first name alone ("Rhys") joins the one new person whose full name starts with it ("Rhys Varn").
  - No longer offered as names: signs in capitals, commands ("Hang it on the bell"), plurals of trades or things ("Carpenters", "Engines") and owners ("the Heralds' vault").
  - On four books written with AI assistants, 95% of the named people, places, groups, items and events are found, up from 68%, and 98% of them get the right type.
- **The story check is 5 to 10 times faster**, with the same results. A chapter that did not change is not read again: typing in one chapter checks only that chapter, and editing an entry checks none unless a name changes.
- **The consistency rules are about 8 times faster in big worlds.** In a world with 1,000 entries, a check takes 5 ms instead of 42 ms. A long family line no longer slows them down or stops them.
- **Typing stays smooth in big worlds:**
  - Typing in a chapter no longer runs the rules.
  - In a world so big that a check takes longer than 8 ms, typing in an entry runs them after a short pause instead of on every key.
  - Entry fields make their list of every entry only when it opens.
  - The name highlighting is shared by all text boxes, and is rebuilt only after you pause typing a name.
  - Lists longer than 100 entries no longer slide when they change, which saves a few milliseconds on every keystroke.
- **Warning ids** no longer depend on the order of rows, so a mark stays with its warning when a relation, stay or image is added or removed. Marks saved under the older ids still apply.

### Fixed

- **Outside changes made while you type** (by an AI assistant, a text editor or git) are merged with your edits to the same entry or chapter, instead of your next save writing over them. Other files update at once instead of waiting for your saves. A save never writes over a file that changed a moment before: it is merged first.
- **Closing the window** saves everything still waiting to be saved. If something cannot be saved, Lore-Forge asks before closing.
- Files are written whole: a crash or a power cut during a save never leaves half a file.
- **An entry whose name is cleared** no longer disappears on the next load: it loads, with a warning that it has no name.
- **Half-filled rows are kept** with their dates and notes instead of being dropped on the next load: a relation without a target yet, a stay without a place, an action without an actor.
- **New entries never write over a file that is already there:** one that could not be read, or one named by hand.
- **A save that fails** (a locked or read-only file) is kept and tried again. The save indicator and Ctrl+S say so, and going back to the library waits for it, with **Close anyway**.
- Adding a picture while the entry changes (an AI assistant writing to it) no longer brings back the older entry and world.
- Dates with a dot written by hand are read as written. `born: 03.1920` was read as March of year 192, and saving wrote that back.
- Long events no longer give false errors: someone who lived through part of a war is fine, and so is a building begun before its place was founded.
- A date outside its era is flagged: after the era ended, or before it began when an earlier era exists. Story chapter dates are checked too.
- A killing written as a relation now counts for `dead-marked-alive`, and a death known only from a killing counts for `after-death`.
- No more false warnings for:
  - back-to-back stays with day dates;
  - notes and events "taking part" outside their dates;
  - empty rows;
  - a one-day event whose end is its start.
- Capitalised relation types ("Parent-of") are now understood.
- A malformed calendar or rule setting in `world.json` no longer stops the checks; it is reported.
- **Story warnings:**
  - a later sentence that contradicts an entry is reported even when an earlier one agrees;
  - giving an existing event a date in the story checks that event;
  - **Go to** reaches the sentence that said it, and the message names the chapter.
- A proposal's **Add** or **Apply** clicked twice adds once, and the card goes away at once.
- Undo (Ctrl+Z) of a link change on the graphs puts back only that change.
- Aliases and list fields show changes made outside the app, and the caret no longer jumps to the end of the text after one.
- You can type "sworn brother" as a custom relation type, "Port town" in fields with suggestions, and negative or decimal orders.
- Text typed in an entry field is kept when you leave the entry with Alt+← or the mouse's back button.
- **Go to** on a file that could not be read opens its folder. On an image warning it opens the Images tab, and the status and relation type fields now take the focus.
- Deleting an entry removes its intended marks too. An entry whose file could not be deleted stays in the list, with a message.
- The sidebar gets its width back after the window was narrow.

## [1.0.0] - 2026-11-07

First public release. The downloads of 4 November were replaced on 7 November by this build, which adds the AI assistants, self-update and everything listed below.

- Desktop app for Windows, macOS and Linux: library bookshelf, world home and book covers, editor for characters, places, factions, items, events and notes.
- Custom calendars with eras, months and partial dates.
- 16 consistency rules, live in the app and in `lore check`.
- Timeline, family tree and relationship web.
- Story space with chapter manuscripts, entry proposals and story contradiction checks.
- World Codex PDF and Story Book (PDF, Word and Markdown).
- Sample world Camelamamm.
- MIT licence.

### Added

- **AI assistants (MCP).** `lore mcp` is an MCP server for Claude Desktop, Claude Code, Codex, Cursor and other AI apps.
  - Asked for "a story about camels in Lore-Forge", an assistant creates the book and writes everything into it: entries with their details, relationships, a calendar, chapters and pictures. It also checks the book for contradictions and fixes them.
  - Its 18 tools also read, continue and change existing books, mark warnings intended and export the Story Book or World Codex. See [docs/MCP.md](docs/MCP.md).
- **Connect AI** in the library:
  - connects those apps in one click, and removes them again;
  - copies the settings for other apps;
  - sets up **Pictures**: OpenAI, Google Gemini or xAI Grok with your own key, which stays on your computer, and the newest image model the key can use.
- **Live updates:** the shelf and the open book show changes made outside the app (by an AI assistant, a text editor or `git pull`) a moment later.
- `artStyle` in `world.json`: one line describing the look of a book's pictures, added to every picture prompt.
- **Duplicate world**, on the shelf next to Delete and on the world home: a copy with a new id and its cover, which opens straight away. Works on the read-only sample world. `lore duplicate` does the same from the command line.
- **First-run tour** (eight steps through the library and the sample world), with Skip, Back and Next and Esc. Shown once; **Take the tour** in the library and in About brings it back.
- **3D models** for entries: **Images | 3D model** tabs in the editor. `.glb`, embedded `.gltf`, `.obj` and `.fbx`, stored in `models/<entry-id>/`, several per entry. The viewer (three.js) orbits, zooms, pans, resets and auto-rotates.
- Pictures for the sample world Camelamamm: portraits and scenes for its entries and cover.
- **Self-update** from GitHub Releases:
  - a check at start and every four hours;
  - a notice with Download, Later and What's new, then progress and Restart to update;
  - **About → Updates** has Check now and an on/off switch.
  - Worlds are never touched.
- The **`lore` command-line tool** ships with the app: `/usr/bin/lore` from the `.deb`, `resources\bin\lore.cmd` on Windows, `Lore-Forge.app/Contents/Resources/bin/lore` on macOS.
- Stable download links that never change between versions (`releases/latest/download/Lore-Forge-amd64.deb` and so on). Each release has the five installers under these names, plus the updater's `latest*.yml` files.

### Changed

- **Timeline redesign**, a Gantt chart in the app's look:
  - era ribbons and coloured era columns;
  - a sticky year axis, with months when zoomed in;
  - solid cards in each type's colour with icon, name and dates, and picture cards for entries that have a picture;
  - a **Stacked** layout that packs each type's entries side by side;
  - an **Overview** strip to see and move the visible part.

  Panning stops at the first and last year. The toolbar is one bar with clearer type chips, and the hint line and scale readout are gone.
- Timeline group titles no longer carry a strip of lines; panning and zooming the timeline is smoother.
- The sidebar's type groups are soft panels with a hairline under each heading, instead of a coloured rail down their side. The selected entry and chapter are a soft gold-edged card, and rows show a light outline on hover.
- Typing no longer lags when a world has warnings. The story check catches up a quarter-second after you stop typing, or as soon as you leave the field, and is about a third faster. Warnings from the rules, such as a name that is already taken or a death before birth, still appear as you type.
- **Status and dates** in the editor is a card with a soft gold border and an hourglass in its legend, instead of a thick coloured left edge. Entry chips and warnings lose their coloured left edges too: a warning's whole border takes its severity colour.
- The timeline opens at once and stays smooth while dragging and zooming. Pictures are handed to the page as short links instead of whole files written out as text, and the hover card no longer redraws every lane.
- Zooming the timeline out stops where the years fill the track, so no empty time shows before the first or after the last year.
- Dragging the timeline's **Overview** (also right after **Fit**) never moves the view past the first or last year: every move is held inside the years before it is drawn.
- **About → Updates** no longer has the small print about where worlds are kept and the link to all releases.
- The editor shows the entry's picture in a circle beside its name, like the sidebar; entries without one keep their type icon.
- **+ New** in the sidebar closes without adding anything on Escape, on its × button, when you leave it empty, or on a click elsewhere.
- **Status and dates** is a plain fieldset like the rest of the editor. The editor has no coloured strip along its top, and the entry's id and file show as two small chips under its name.
- Family tree and relationship web cards have a calm border (dashed and grey for the dead or destroyed) and a soft gold ring on the open entry, with no coloured stripe down their left side. The family tree legend says just "dead".
- Links in the relationship lists (such as "owns … from Owners over time") show their label over the entry chip and the details under it, with the edit button in its own column. Icons and names line up in entry chips such as **Mentioned here**.
- **World settings** no longer repeats "saved in world.json" under the calendar.
- The spine next to the cover in **New book** is as tall as the cover.
- The library shelf uses the full window width, with rows centred and books sized to the window (a little smaller below 1200 px, larger on 2K screens).
- Book titles on spines and covers shrink and wrap onto balanced lines to fit; an ellipsis is the last resort for very long titles.
- Releases are made with **Actions → Release** (version bump, tests, builds, release in one run).
- README rewritten for new users; reference material moved to `docs/`. Community files and issue templates added.

### Fixed

- Story proposals no longer offer everyday words at the start of a sentence or a quote as new characters:
  - contractions ("I'm", "Don't");
  - questions and commands ("Are you…", "Remember…");
  - numbers;
  - plurals or -ing forms of words the chapter already uses ("Bells", "Flying").
- The Story Book always includes the copyright page. An empty copyright field still prints a plain notice with the author and year. The sample book is A4 and keeps its dedication and epigraph.

### Note for early 1.0.0 users

Copies downloaded before 7 November 2026 have no updater. Download the current version once from the links in the README; from then on Lore-Forge updates itself.

[1.1.0]: https://github.com/kaharamamm/Lore-Forge/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/kaharamamm/Lore-Forge/releases/tag/v1.0.0
