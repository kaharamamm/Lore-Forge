# Lore-Forge user guide

How the desktop app works, screen by screen. For the file format see [FORMAT.md](FORMAT.md); for the command line see [CLI.md](CLI.md).

## The App

### Library

The start screen is a bookcase. Every world is a book: a 3D spine with its title and emblem on the shelf; point at a book (or focus it with the keyboard) and it comes off the shelf and turns to show its cover and entry counts. Click or press Enter to open it.

- **New book** is the blank book at the end of the shelf: a name, a cover colour or picture, an emblem, and the folder it goes into. **Start from** offers ready starts besides Blank: **Epic fantasy** (a First and a Second Age), **Fairy tale**, **Mystery** and **Horror** (the everyday calendar with twelve months), **Science fiction** (Old Earth years, then Galactic Standard ones) and **Game world** (two ages and custom fields for game data: level, class and hit points for characters; damage, rarity, weight and price for items; danger for places). Each brings a writing style, a picture style and a cover to match; all of it can be changed later in World settings.
- **Search books** above the shelf matches titles first, then subtitles and authors, then descriptions, ignoring accents and the Turkish dotted and dotless i. Ctrl+F or `/` focuses it, Esc clears it, Enter opens the only match.
- **Duplicate** and **Delete** sit on a book's cover. Duplicate asks for a name (it suggests "<name> (copy)"), copies the whole world into the worlds folder with a new id, keeps the cover and opens the copy. It works on the read-only sample too, which is how you get your own copy of Camelamamm. Delete asks first and moves the folder to the system trash. Nothing is deleted outright.
- **Take the tour** shows a short guided tour (eight steps) through the library and the sample world. It starts by itself the first time Lore-Forge opens; **Skip** or Esc ends it, Back and Next (or the arrow keys) move through it, and it does not change the sample. **About** has the same button.
- **Open a world folder…** opens a world from anywhere on disk; it then stays on the shelf.
- **Open a book file…** opens a book someone shared as one file (`.loreforge`, see **Share…** on World Home). Double-clicking the file does the same once Lore-Forge is installed, and so does dropping it anywhere on the Lore-Forge window. The book is copied into the worlds folder, under a name of its own if a book with that name is already there, and opens. The same file opened again opens that copy instead of making another.
- **Settings** (the gear; also in an open book, left of **World settings** in the top bar and on world Home):
  - **Language**: English or Türkçe (Turkish), each with its flag. The whole app changes at once, including warnings, the patch notes and the labels in the World Codex and Story Book. Until you pick one, Lore-Forge follows the system's language.
  - **Spelling**: the languages to check (English (US), English (UK), Türkçe), any of them or none. Until you choose, the app's language is checked. A word the dictionary does not know gets a wavy line: right-click it for suggestions or **Add to the dictionary**. Right-click in any text field also has Cut, Copy, Paste and Select all. The names in the open book (entries and their other names, eras, months and maps) count as spelled right while it is open. On Windows and Linux, a dictionary the computer does not have is downloaded once from Google; what you write is never sent. On macOS the system's checker picks the language, so Spelling is only on or off there.
  - **Display**:
    - **Window**: Windowed, Maximized or Full screen.
    - **Resolution**: the window's size, from 1280 × 720 to 3840 × 2160. Sizes larger than the screen are greyed out, and a size dragged by hand shows as Custom.
    - **Interface scale**: Auto, or 80% to 150%. Auto keeps the proportions Lore-Forge was designed in at 1920 × 1080: larger on 2K and 4K screens, smaller in small windows.
  - **Where new worlds go**, and whether the sample world is on the shelf.

  Language, display and spelling changes apply at once and are remembered; the folder and the sample are saved with **Save**.
- **Patch notes** lists what changed in each version, newest first, from the changelog that comes with the app (it works offline). When the updater has found a newer version, its notes show on top.
- **Connect AI** connects Lore-Forge to an AI app (Claude Desktop, Claude Code, Codex, Cursor, or another app through **Copy the settings**). You can then ask the assistant to write a story in Lore-Forge, and it writes the whole book here. **Pictures** sets up the image service it uses (OpenAI, Google Gemini or xAI Grok) with your own API key. See [AI assistants](MCP.md).
- **About** lists the credits and licences, and has **Updates** (see [Updates](#updates)).

Behind the shelf is a quiet animated scene (light through a window, dust, runes, candles and embers). It pauses while the window is hidden and stays still with the system's reduced-motion setting.

### World Home

Opening a world lands on Home: **Duplicate** (as on the shelf), **Share…**, the book's cover (click it to edit the cover), counts of entries, eras and warnings, links to the timeline, family tree, relationship web and the two exports, and a card for every entry with its picture. The paint button on a card changes that entry's picture: an icon with its colours, or one of its images.

**Share…** offers three ways to send the book out, each saved where you choose:

- **Book file**: the whole book as one `.loreforge` file, to send to someone or keep as a backup: its entries, chapters, pictures, maps, 3D models and settings, without the exports folder. Anyone with Lore-Forge opens it with a double-click, or with **Open a book file…** in the library. It is a zip file, so any zip tool can open it too.
- **Website**: a folder of web pages that open in any browser, even offline: `index.html` has every entry (as in the World Codex, without the art briefs, the warnings and the file details), the maps with their places to click and the timeline; `story.html` has the story, when the book has one. Names in the text link to their entries, and the pictures are copied next to the pages. Send the whole folder, or put it on any web host.
- **Game data**: a folder with `world-snapshot.json` (every entry with its dates worked out, its links, the maps and pins, the story and the check, the same file `lore export` writes) and the book's `images/`, `maps/` and `models/` folders, at the paths the JSON names. For a game engine (Unity, Godot, Unreal) or your own tools; [INTEGRATION.md](INTEGRATION.md) describes the format.

The **Book cover** editor sets the background (gradient or plain colour), a picture, the emblem and its colour, the title font and colour, and the spine colours. The title can be hidden on the cover; it always stays on the spine.

### Sidebar

Entries grouped by type, each with its picture, a warning count and an "ended" mark for the dead, destroyed and dissolved. Search (Ctrl+F) matches names and text, and finds chapters (by title, then text) and maps (by name) too, under the entries: a chapter opens in the Story at the words found, a map opens on the Map. **+ New** creates an entry in a group. Entries can be dragged onto the family tree or the relationship web. The sidebar's width is adjustable and remembered.

### Editor (Ctrl+1)

A structured form per entry type, in collapsible sections, then the body text.

- **A new name:** when you change an entry's name and leave the box, a line under it says how often the old name is still written in the book, with **Change them to “…”**. The list that opens shows every place (the chapters, the other entries' text and fields such as Home, Ruler or a relationship's target, and the maps) in its sentence, grouped by chapter and entry, each with a tick to change it or leave it. The entry's other names that hold the old one ("Ozra the Wellkeeper") change with it, while a longer name of another entry ("Ozra's Lantern") is left alone, and Turkish endings follow the new name (Kadir'in becomes Murat'ın, Kadir'e becomes Ayşe'ye). When another entry has the same name, its plain mentions start unticked. **Keep “…” as another name** adds the old name to the other names. The book is kept in its history first, and the note afterwards has **Undo**. **Not now** closes the line; it comes back the next time you leave the name box.
- **Pronunciation:** how the name is said, for invented names the voices would guess at: syllables with hyphens, the stressed one in capitals (`KAM-eh-la-mam`), or IPA between slashes. Lore-Forge's own voices say the name that way when they read aloud (English voices read the syllables with English sounds such as ah, eh, ee, oo, ay; Turkish ones read Turkish letters, `ka-me-LA-mam`), and **Hear it** plays it in the voice for the book's language. The World Codex and the website list it with the entry's facts. The computer's own voices do not use it.
- **Status and dates first:** alive or dead, standing or destroyed, active or dissolved, intact or lost, with the matching dates. An ongoing status hides the end date (it stays in the file, and the rules still see it).
- **Details:** characters have race or kind, gender, title, occupation, languages, personality, goals, skills, affiliations, home and possessions; places kind, population, ruler and features; factions kind, leader, headquarters, ideology, allies and enemies; items kind, origin, location, owners and powers; events kind, date, place, participants, actions ("A killed B"), causes, outcome and consequences. Empty means unknown and is never written to the file.
- **Custom fields:** when the book has fields of its own for the entry's type (World settings), they have their own section under Basics: a number box, a yes or no list, a list of the choices, or text. **Change these fields** opens World settings there.
- **Entry fields** (Part of, Target, Ruler, Home, …) show the chosen entry as a chip with its picture icon; click it to open that entry, × to clear it. Fields that hold several entries (affiliations, possessions) are rows of chips.
- **Suggestion lists** (race, gender, kind, relation types, verbs) are themed lists with an icon for every word; the chosen value shows its icon too. Gender offers female (♀), male (♂) and genderless (⚲).
- **Undo and redo:** Ctrl+Z undoes the open entry's last change, whatever it was: a status pill (alive to dead), a list choice, a picture or icon, a row added or removed, or typing (one step per pause). Ctrl+Y or Ctrl+Shift+Z redoes it. The field comes into view and flashes. A change made outside the app since (by an AI assistant or an editor) is never undone by accident.
- **Relationships:** typed and dated relations to other entries. The type list only offers types that fit the two entry types; custom types are still allowed.
- **Visual description, reference images and 3D models** for artists and 3D tools, under **Images | 3D model** tabs (see [Images](FORMAT.md#images) and [3D models](FORMAT.md#3d-models)). Pointing at a picture shows its buttons: Details (where it came from) and Remove in its top corners, and Make a new picture, Replace and Save a copy (anywhere you choose) along the bottom. Pictures can be PNG, JPEG, WebP or GIF; an animated GIF moves everywhere the picture shows (Mr Camel's portrait in the sample world is one), and the World Codex and Story Book print its first frame. Mr Camel also has a 3D model, as an example.
  - **Make a picture…** (under the pictures, and on each picture's toolbar to make a new one for that view) draws one with the picture service set in **Connect AI → Pictures** (OpenAI, Google Gemini or xAI Grok, billed to your key). The prompt is built from the visual description and the book's art style, and you can change it before drawing; the dialog says which service and model will draw. Drawing takes 10 to 60 seconds; you can close the dialog meanwhile, and the picture lands in its tile. It is saved like an added picture, with the tool and prompt in its details, for the look you are on.
  - **3D model:** **Add model…** copies a `.glb`, `.gltf` (with its data embedded), `.obj` or `.fbx` file into the world. A model turns by itself when it opens (**Auto-rotate**, off when the system asks for reduced motion). Drag to orbit, scroll to zoom, right-drag (or Shift+drag) to pan; **Reset view** frames it again. An entry can have several models: pick one from the row above the viewer, or download, rename and delete it there. **Download…** saves a copy anywhere, to use it in other programs. Files over 25 MB get a warning, since they are slow to load. The viewer needs WebGL; if the graphics driver offers none, it says so instead.
- **Looks:** the visual description, pictures and models above are the entry's **Default** look. When it looks different for a while or from some point on (after a war, in coronation robes, in old age), **+ New look** adds a look: give it a name, why it looks different, and when it applies (**Always**, **After an event**, **Before an event**, **Between dates** or **In an era**). A look after an event starts once the event is over, and one before an event ends as it begins. A look's visual description holds only what changes (the Default text shows in its empty fields), and it has its own pictures and 3D models, kept in a folder of their own. **Delete look** moves its pictures and models to the Default look. The checks warn about a look tied to an era or event that does not exist, a look before birth or after death, and two looks at the same time; **Go to** opens the look. Mr Camel's "Caravan days" in the sample world is an example.
- **Body:** Markdown with `[[links]]` and `@mentions`. Names and aliases typed in any text link themselves: they are highlighted in their type colour, show a hover card, and open with Ctrl/⌘+click.

### Warnings Panel

Updates live while you type. Warnings are grouped into Errors, Warnings, Info and Marked intended. Each one says what is wrong, the canon fact it conflicts with and where that fact comes from. **Go to** jumps to the offending field; **Mark intended** keeps a contradiction on purpose (a resurrection, an unreliable narrator) with a note. Warnings never block saving.

### Ask AI (Ctrl+J)

The side panel has two tabs, **Warnings** and **Ask AI**. Ask AI runs Claude Code or Codex on the open book, so you can give an AI tasks without leaving the app: *"Write the next chapter"*, *"Give every character a visual description"*, *"Fix the open warnings"*.

- **What you need:** Claude Code or Codex installed on this computer and signed in once in a terminal (`claude`, or `codex login`). The panel finds them by itself, and **Check again** looks again after you install one or sign in. A dot shows each one's state: green when signed in, amber when it could not tell, red when signed out or too old.
- **What it costs:** it runs on your own Claude or ChatGPT plan, the same as using that app yourself. If the app is signed in with an API key instead, every message is billed to that key, and the panel says so. With Claude, the panel also tells you when you get close to your usage limit and when it resets.
- **How it writes:** it follows the book's writing style (World settings). Before it writes or changes a chapter it gets a **chapter brief** from Lore-Forge: the story so far with the end of the chapter before, and on the chapter's date who is alive, how old they are, where they live and how they look, which places stand, and which events are done or still to come. With a part of a chapter chosen, it changes only that part and keeps the rest word for word. Afterwards it runs the book check and fixes what it finds, AI-sounding phrasing included.
- **What it can do:** only use Lore-Forge's own tools: read the book, save and link entries, write chapters, check the book, and make pictures when a picture service is set up. It cannot run commands, change other files or use the web. Claude Code runs with no built-in tools and only the Lore-Forge server; Codex runs read-only, with its shell, apps, plugins and browser off and only Lore-Forge's tools approved. Neither reads settings from the book's folder.
- **While it works:** its replies and steps appear as they happen (*Save 3 entries: …*, *Write the chapter …*), names in a step link to their entries and chapters, and every change shows in the rest of the window at once. You can keep working meanwhile. **Stop** ends it; what it already saved stays in the book.
- **Ask AI about this:** **Ask AI** in an entry's header, or in the Story view (about the chapter, or about the text you chose in it; the right-click menu on chosen text has it too), opens the panel with *About …* on the message box and a few suggestions. The AI is told which entry or chapter to read first, and the exact text you chose. × drops it.
- **Undo:** after a task that changed the book, a line names what it changed, with **Undo**. Files you saved yourself while it worked are never counted as its changes. If something it changed was edited again since, Lore-Forge asks first; the later version stays in the [book history](#book-history).
- **The conversation** remembers earlier messages, so you can ask follow-up questions, and each book keeps its own, also after a restart. **New conversation** starts over (the book keeps every change). Claude Code and Codex each have their own conversation.
- The **sample book** is read-only: the AI can read it and answer questions. Duplicate it to let the AI change it.
- Claude Desktop, Cursor and other AI apps cannot be run this way; connect them with **Connect AI** in the library (see [AI assistants](MCP.md)).

### Timeline (Ctrl+2)

A Gantt chart of the world: era ribbons and coloured era columns (an era's own colour when the calendar sets one), a year axis that names the months once you zoom in far enough, and one lane per dated entry, grouped by type. Lifespans and existence spans are solid cards in their type's colour with their icon, name and dates, and a taller card with the picture behind it when the entry has a picture; events without an end are diamonds (a round picture when they have one); warning markers sit after each one. A gold line along the bottom of a card shows when one of the entry's looks applies, with a small diamond where it starts: hover it for the look's name and when, and click it to open the entry on that look. **Lanes** shows one lane per entry; **Stacked** packs each type's entries side by side on as few rows as fit. Turn types on and off with the chips. Drag or Shift+scroll moves along time, Ctrl+scroll or −/Fit/+ zooms, and it stops at the first and last year. The **Overview** strip at the bottom shows the whole span with a frame around what is on screen: click or drag in it to jump, or use the arrow keys, Page Up/Down, Home and End. Click a bar or name to open it.

### Relationships (Ctrl+3)

- **Family tree:** generations top-down, spouses side by side, the dead marked and faded.
- **Relationship web:** the selected entry in the middle and everything it relates to around it, with a minimap. Links between the same two entries curve apart, each label on its own side.

Both are pan-and-zoom maps (drag to pan, Ctrl/⌘+scroll or pinch to zoom, Fit to see all). Drag an entry from the sidebar onto them, drag from a card's gold dot onto another card to link them, or click a line to change or delete the link. A change is written to both entries' files at once; Ctrl+Z undoes it. Under the map, the entry's relations are listed by group, with the events it appears in.

### Story (Ctrl+4)

A manuscript space for the whole story, written chapter by chapter, with a word count per chapter and in total. Chapters are saved as `story/NN-slug.md`. **New chapter** under the chapter list adds one at the end. The open chapter's arrows move it up or down, and the bin beside them deletes it (after asking).

**Board** (above the chapter list) shows the story as a planning board: a card for each chapter with its title, date, point of view (a character), what happens in it, and how far it is: **Idea**, **Draft**, **Revised** or **Done**. A chapter without a status counts as an idea until it has text, and as a draft once it has. Drag a card by its grip to move the chapter, or press the arrow keys on the grip. **Plan a chapter** adds a card for a chapter you have not written yet, and **Write** opens a card's chapter. Under the cards, **Who is in which chapter** has a row for each character and a mark for each chapter that names them or is told from their point of view. A character who is in three chapters or more and then missing for a long stretch is noted (*Not seen after chapter 6*), unless they died. A mark opens the chapter where the character is named, and Back returns to the board.

**Import a manuscript…** (on the Story's first screen, and **Import…** at the top of the chapter list) brings in a story written somewhere else: a Word file (.docx), Markdown or plain text. It is split into chapters at its chapter headings (a Word heading, a Markdown heading, or a line such as *Chapter 3: The Well*, *Bölüm 3* or *Prologue*), and the chapters go after the ones the book has. Bold and italic stay. A heading that is only *Chapter 3* takes the chapter's name from the line under it when that line reads as one. The people, places and events in the imported text are proposed as in any chapter.

As you write, Lore-Forge reads the text and **proposes** what it finds, never adding anything by itself: *King Camel was born in 1998.* proposes a character Camel, born 1998, with the title King. Each proposal shows the sentence it came from, with **Add**, **Edit…**, **Merge…** (fold it into an existing entry as an alias) and **Ignore**. Names that already exist are listed instead of proposed again, and new facts about them show as **Update**.

The same rules check what the story says: a sentence that breaks canon is underlined, and the `story-contradiction` rule flags the story disagreeing with an entry. The `ai-phrasing` rule notes writing that sounds like an AI wrote it (stock phrases such as *a testament to*, *a tapestry of* or *little did they know*, an aside between two dashes, and the *"It wasn't just X. It was Y."* turn): in the chapters with a blue underline, and in the entries' summaries, longer details and text in the Warnings panel. It reads English text, whoever wrote it, and **Mark intended** keeps one you want.

**Replace…** (Ctrl+Shift+H) finds a word or phrase in every chapter's title and text and lists each place in its sentence, by chapter. **Show** opens the chapter with the words chosen, **Replace** changes that one, and **Replace all** changes every one: the book is kept in its history first, and the note afterwards has **Undo**. Without **Match case**, "istanbul" finds "İstanbul" and "kır" does not find "kir"; **Whole words** leaves words that only contain it alone. To change a character's or place's name, change it in the editor instead: that also covers the entries and the fields that name it.

**Read aloud** (next to Ask AI) reads the chapter from the caret to the end, or only the part you chose. Lore-Forge brings thirteen English voices of its own, American and British, that run on your computer without the internet (on Windows, Linux and Macs with Apple chips); your computer's own voices are in the list too, for other languages. They say names with a **Pronunciation** the way it is written. English text starts with a Lore-Forge voice, a Turkish text with a Turkish voice when the computer has one. The sentence being read is marked and stays in view. The bar under the text pauses (a Lore-Forge voice stops mid-sentence and goes on from there), stops, and picks the voice and the speed; the voice is remembered for each language. While a voice gets ready (the first sentence, or a new voice), the bar says **Loading the voice…**. Changing the text stops the reading. Windows, macOS and Linux add more voices in their speech settings.

Choosing words in a chapter shows a small button: for a name, to add it to the world; for a longer part (a sentence, or paragraphs), **Ask AI about this part**. Right-click has the same, with more. Right-clicking a misspelled word puts the spelling suggestions at the top of the menu. Select words, or right-click a name, to add it to the world with its type guessed.

### Map (Ctrl+5)

Your world's maps, with its places pinned on them (the sample world has a map of the Sunsea to try). **Add a map…** takes a picture of a map (PNG, JPEG, WebP or GIF; a picture the book already has in the Map view works too) and copies it into the book's `maps/` folder. **Draw one with AI…** in the same dialog draws the picture with the picture service set up in Connect AI: the prompt is built from the book's places (the ones inside the place the map shows, and where each lies) and its art style, and you can change it first. The picture has no names on it; the pins add them. A book can have several maps: the whole world, a region, a city. Under **Shows**, a map of one place is tied to it: that place's pin on the other maps gets a small map button that opens its map, and its own map has a button back up.

Drag to move around and scroll to zoom (or use −, Fit and +; with the map in focus, the arrow keys move it). Each pin shows the place's picture and name. Hover a pin for what is tied to the place (who lives or stays there, the factions and items kept there, what happened there, the places inside it), and click it to open the place. A destroyed place has a dashed ring and a struck-through name. Choosing a place in the sidebar while the map is open shows it in the middle.

When the book has dated events at the map's places, or people who lived at or took part in events at two of its places, a bar at the bottom of the map shows them. The **year** slider (its ticks mark years with events) shows that year's events beside their places, fades the places that did not stand then, and puts the person whose journey is drawn where they were; the button at its end goes back to all of time. The **journey** list draws someone's way across the map as a line through numbered stops: where they lived and the events they were part of, in order (point at a number for what happened there). A place not pinned on the map shows at the place it lies in.

**Edit pins** lists the places on one side. Drag a place onto the map, or use its **Pin** button to put it in the middle of the view. Drag a pin to move it; the arrow keys nudge the pin in focus (Shift for bigger steps) and Delete takes it off. Ctrl+Z and Ctrl+Y undo and redo pin changes. **Map settings** (the gear) renames a map, changes its picture or the place it shows, or deletes it; the book history keeps a copy of a deleted map's picture. Pins are kept in percent of the picture, so they stay in place when the picture is replaced by a larger one.

### World Settings

**World settings** in the top bar (the calendar button):

- **Writing and pictures:** the book's **writing style** (point of view, tense, tone, audience, what to avoid; a short paragraph in your own voice helps too) and its **picture style** (one line, added to every picture an AI makes for the book, so they look alike). Ask AI and the AI apps connected to Lore-Forge follow both. Under each field, **Start from** offers ready styles: Cozy, Funny, Adventure, Epic, Mystery, Creepy, Horror, Dark and gritty and Fairy tale for the writing; Painterly fantasy, Storybook, Comic book, Anime, Dark ink, Gothic horror, Pixel art and Cinematic for the pictures. One click fills the field, to keep as it is or change. (Picture styles stay in English, which image services read best.) The sample world has both set.
- **Calendar:** the default era (dates without an era abbreviation count in it), the eras (name, abbreviation, start and end, colour, and how many dates use each), and the months with their lengths.
- **Custom fields:** fields of your own for each type of entry, such as HP and Strength for characters or Damage and Rarity for items. Each has a name and holds text, a number, yes or no, or one of a list of choices. They show in the editor, the World Codex and the website, and go into game data with their values (see [Custom fields](FORMAT.md#custom-fields)).

Saved in `world.json`.

### Book History

Lore-Forge keeps snapshots of each book on this computer, in its own folder (not in the book, so git and shared folders stay clean): when you open the book, every 20 minutes while it changes, before each Ask AI task and before every restore.

- **History** on World Home lists them. Pick one to see what changed since (entries, chapters, the book's settings, pictures), then put one thing back (**Put back**, **Bring back** or **Remove**) or **Restore the whole book to this point**. **Keep a snapshot now** keeps one when you want.
- **History** in an entry's header shows that entry's earlier versions, field by field next to what it says now, with **Restore this version**.
- Every restore keeps the book as it was first, so a restore can be taken back too.
- The 80 newest snapshots are kept. Each file's content is stored once, so snapshots of a book that hardly changed take little room.

### Changes from Outside the App

Lore-Forge watches the open book's folder and the library. When an AI assistant, a text editor or `git pull` changes the files, the book shows the change a moment later: new and changed entries, chapters and pictures, without a reload. New books appear on the shelf. If you are typing in the same entry or chapter at that moment, both are kept: the outside change and what you typed (where both changed the same field, your typing wins).

### Navigation

The arrow at the top left always returns to the library. Alt+←/→ and mouse buttons 4/5 step back and forward through the entries and views you visited, including between the library and a world. The cover and title next to the arrow open world Home.


## Keyboard Shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+H | World Home |
| Ctrl+1 / 2 / 3 / 4 / 5 | Editor, Timeline, Relationships, Story, Map |
| Ctrl+F | Search (the sidebar in a world, the shelf in the library; `/` also works there) |
| Ctrl+S | Save now (saving is automatic) |
| Alt+← / Alt+→ | Back and forward (also mouse buttons 4 and 5) |
| Alt+↑ / Alt+↓ | Previous or next entry |
| Ctrl+Shift+W | Focus the warnings panel |
| Ctrl+J | Ask AI, at its message box |
| Ctrl/⌘+click, Ctrl/⌘+Enter | Open the name under the pointer or cursor |
| Ctrl+Shift+A | Story: add the selected words to the world |
| Ctrl+Shift+H | Replace in the story |
| Ctrl+Z | Undo: the open entry's last change in the Editor, the last link change on a graph, the last pin change on the Map |
| Ctrl+Y, Ctrl+Shift+Z | Redo in the Editor and on the Map |
| Esc | Close a dialog, list or preview |
| F11 | Full screen on and off |
| Ctrl + / Ctrl − | Interface scale up or down (saved, as in Settings) |
| Ctrl 0 | Interface scale back to Auto |

Every control is reachable with Tab and Shift+Tab; dialogs keep focus inside them. The layout reflows down to one column, so it stays usable at 200% zoom. Text contrast is at least 4.5:1 (`npm run contrast -w @lore-forge/desktop` checks the palette).

## World Codex and Story Book

**World Codex** and **Story Book** in the top bar open an in-app preview built from the same document the files are drawn from. Saving writes the PDF and a Markdown copy next to it (for AI tools), and offers *Show in folder*.

### World Codex

A reference book of the whole world: a cover, contents, the world overview and calendar, each map with its places numbered on it and listed by number, every entry by type with its facts, relationships, visual description, text and reference images with provenance, each **look** with its own pictures, an **art brief** per character, place, item and event (an image prompt, plus a 3D turnaround brief for characters and items; a look gets its own, and an event's brief describes each participant as they look on its date), a timeline, a relationship summary, a glossary of names and aliases, and an appendix of open warnings. The preview chooses the entry types and turns the art briefs and the warnings appendix on or off.

### Story Book

When a world has story chapters, the Story Book is the story: each chapter in order, then the chronicle of events and notes as an appendix (which the preview can turn off). A world without chapters becomes a chronicle of its events and notes in in-world date order, in chapters by era or by year ranges; a page's own `chapter` field and `bookOrder` override that.

The book is laid out like a printed book:

1. The cover: the world's cover art with the book title, subtitle and author.
2. The title page, the copyright page (always; a plain notice when the field is empty), then the dedication and the epigraph when set.
3. The contents, with page numbers.
4. Each chapter starting at the top of a new page, with its label, title and a drop cap.

Text is set in a serif face, justified and hyphenated, with no single line left at the top or bottom of a page. Margins are mirrored with a wider inside edge for the binding; running heads show the book title on left pages and the chapter on right pages; pages are numbered from the first chapter, with no number on chapter openings. There are no blank pages; for a printed copy, **Start chapters on right-hand pages** opens the title page and every chapter on a right-hand page.

Trim sizes: 6 × 9 in (used when a book does not set one), 5.5 × 8.5 in, A5, A4 and US Letter. The sample Story Book is A4. The book details (title, author, publisher, dedication, epigraph, copyright text) are edited in the preview and saved in `world.json`. **Save Word (.docx)…** writes the same book for Word. **Save e-book (EPUB)…** writes it as an e-book for phones and e-readers (Apple Books, Google Play Books, Kobo, Calibre, and Send to Kindle takes it too), with the cover, the contents and PNG, JPEG, GIF and WebP pictures. In an e-book the text flows to fit the screen, so the trim size and page numbers do not apply.

**Save audiobook…** has a Lore-Forge voice read the story into one sound file: the title and author, then each chapter with its heading, with pauses between paragraphs and at scene breaks, and a chapter mark at the start of each chapter that players show in their chapter list. Names with a **Pronunciation** are said the way it is written, and the book's cover goes into the file. It is made on your computer without the internet, about four times faster than it plays on a typical computer, and you can keep working meanwhile: **Keep working** closes the dialog, and the top bar shows how far it is until a note says it is saved. **Stop** ends it and saves nothing. The file is Ogg Opus (`.opus`), which plays in VLC, on Windows and Android, and in web browsers; Apple Books does not open it. A book needs a Lore-Forge voice in its language: the English voices come with the app.

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
