# World format, dates and rules

A world is a plain folder of text files. This page describes it; the field-by-field reference and the JSON Schemas are in [INTEGRATION.md](INTEGRATION.md) and `packages/core/schemas/`.

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
| `artStyle` | one line describing the look of the book's pictures, added to every picture an AI assistant makes (optional) |
| `calendar` | `eras` (id, name, start, optional end and colour), `defaultEra`, `months` (name, days), `approxYears` |
| `rules` | per-rule severity overrides, e.g. `{ "duplicate-name": "info", "two-places-at-once": "off" }` |
| `book` | Story Book details: `title`, `author`, `publisher`, `dedication`, `epigraph`, `epigraphSource`, `copyright`, `trim`, `rightHandChapters`, `chapterYears` |
| `cover` | cover colours, picture, emblem, title font and colour, show title or emblem, spine colours |

### Entries

Each entry is Markdown with YAML front matter: the structured fields on top, the body text below.

```markdown
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

Mr Camel keeps the smallest tea house on the Street of Kettles…
```

References use entry ids (`target: item-humming-map`) or names. Unknown keys are kept as they are. Reference fields such as `home`, `ruler` and `leader` count as relationships in the rules and the graphs.

### Story chapters

`story/NN-slug.md` with a short header and plain prose:

```markdown
title: The Morning the Well Went Quiet
order: 1
date: 10.03.512

Every morning in Camelamamm began with a song…
```

### Images

Reference images are copied into `images/<entry-id>/` and listed on the entry with their view and provenance (tool, prompt, date, sources, rights note). A picture of one of the entry's [looks](#looks) names it (`look: caravan-days`) and is copied into `images/<entry-id>/<look-id>/`. They can be PNG, JPEG, WebP or GIF (animated GIFs play in the app; the PDF and Word exports use a GIF's first frame and leave WebP out with a note). Each type suggests its own views: characters A-pose, front, back, left, right, three-quarter and concept; places establishing shot, map, interior, exterior, mood and concept; items front, back, side, top, detail and concept; events scene, establishing shot, map, mood and concept. Other view names are allowed. In the editor they show as a gallery with one tile per view.

### 3D models

3D models live in `models/<entry-id>/<name>.<ext>`, one folder per entry, as `.glb`, `.gltf` (with buffers and textures embedded as `data:` URIs, since the file is copied alone), `.obj` or `.fbx`. The file name without its extension is the model's name. Nothing in the entry file lists them: the folder is the list, so adding or removing a model by hand works too. The folder is optional; worlds without it load as before. The models of one of the entry's [looks](#looks) go in a folder of their own, `models/<entry-id>/<look-id>/`.

### Looks

The `visual` fields describe how an entry looks most of the time: its **Default** look. When that changes for good or for a while (a war wound, coronation robes, old age), give the entry a look:

```yaml
looks:
  - id: caravan-days
    name: Caravan days
    reason: As a young camel he read maps for the long caravans of the Sunsea.
    before: evt-passing-of-ozra
    visual:
      clothing: Sun-bleached travelling robe, a brass compass on a cord.
```

- `id` is made from the first name and stays when the look is renamed, since its pictures and models use it.
- `reason` says why it looks different.
- When it applies: `from` and `to` (dates), `era` (an era code), `after` or `before` (an event, or any entry with a date, by id or name). Each part given narrows the time. A look after an event starts once the event is over, and one before an event ends as it begins, so the event itself shows the look the entry had going in. A look with none of them is not tied to a time.
- `visual` holds only the fields that change; the others come from the Default look.

On a date, the look that applies is the one that covers it and started last, else the Default look. The World Codex shows each look with its own pictures and art brief, and an event's art brief describes each participant in the look they have on the event's date.

### Intended marks and ignored proposals

`intended.json` keeps the warnings you marked intended, with your note and the date. `story-ignored.json` keeps the story proposals you ignored, so they are not proposed again.

The full format, field by field, is in [docs/INTEGRATION.md](INTEGRATION.md), and the JSON Schemas are in `packages/core/schemas/`.


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


## Consistency Rules

| Rule id | Default | Fires when |
| --- | --- | --- |
| `after-death` | error | someone acts, takes part, stays somewhere or has a dated relation after they died (a death known only from a killing counts too). Taking part in a long event only needs them alive for part of it |
| `before-birth` | error | the same, before they were born |
| `participant-not-existing` | error | a faction, item or place takes part in an event entirely outside its existence |
| `place-not-existing` | error | an event or stay happens at a place before it was founded or after it was destroyed |
| `two-places-at-once` | warning | the same entity is at two different places at the same time (nested places are fine, and so is the one day a stay ends and the next begins) |
| `dangling-reference` | warning | a field, `[[link]]` or `@mention` points at nothing |
| `duplicate-name` | warning | two entries share a name or alias (case-insensitive) |
| `parent-cycle` | error | parent relations form a loop |
| `parent-born-after-child` | error | a parent was born after their child |
| `dead-marked-alive` | error | the status is alive (or standing, active, intact) but an end date or a killing (an event's action or a `killed` relation) says otherwise |
| `invalid-date` | error | a date can't be parsed, uses an unknown era, or falls outside its era: after the era ended, or before it began when an earlier era exists (`-12` before the first era is fine). Story chapter dates are checked too |
| `date-order` | error | an end comes before its start (died before born, destroyed before founded) |
| `file-error` | error | a file can't be read as an entry (the rest of the world still loads), or an entry has no name |
| `relation-kind` | warning | a relation type doesn't fit the two entry types (an item `parent-of` a character) |
| `image-view` | info | an image's view is not one of the usual views for its entry type |
| `look-time` | warning | a look names an era or entry that does not exist, or an entry with no date, or ends before it starts; or a picture names a look its entry does not have |
| `look-outside-life` | warning | a look starts after its entry ended (died, destroyed, dissolved), or starts or ends before it existed |
| `look-overlap` | warning | two looks of one entry apply at the same time: they start together, or one runs on by its own end into a later one (a look without an end just gives way to the next) |
| `story-contradiction` | warning | a story chapter says something different from an entry |

Story sentences are also checked with the timeline rules, as if their proposals were already added. A rule's severity can be changed or the rule turned off in `world.json` under `rules`. The rule library and custom rules are described in [docs/INTEGRATION.md](INTEGRATION.md#custom-rules-library).
