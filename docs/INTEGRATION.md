# Integrating with Lore-Forge worlds

This guide is for tools that read Lore-Forge worlds, such as AI-HQ (writing assistants, image generation)
and Game-Forge (game content pipelines). It describes world format **schemaVersion 1**.

There are four ways to consume a world. The most stable comes first:

1. **Snapshot (recommended):** `lore export <worldDir> --out world.snapshot.json` writes one JSON file with
   the manifest, every entry, the parsed dates, and the full check report. It is validated by
   `world-snapshot.schema.json`.
2. **Check report:** `lore check <worldDir> --json` gives only the warnings
   (`check-report.schema.json`). The exit code is 0 when there are no errors, 1 when there are errors, and 2
   for bad usage or an unreadable world.
3. **Library:** `@lore-forge/core` (pure TypeScript with no fs access) plus `@lore-forge/core/node`
   (`loadWorld`, `saveEntry`, `saveIntended`, `createWorld`).
4. **Raw files:** read the folder yourself using the format below and the schemas.

## JSON Schemas

Every schema is in `packages/core/schemas/`, uses JSON Schema draft 2020-12, and has an `$id` under
`https://lore-forge.local/schemas/v1/`.

| File | Describes |
|---|---|
| `world-manifest.schema.json` | `world.json` |
| `entry.schema.json` | the front matter of one entry file, plus `body` |
| `intended.schema.json` | `intended.json` |
| `check-report.schema.json` | `lore check --json` output |
| `world-snapshot.schema.json` | `lore export` output |

The test suite validates the example world, a real `lore check --json` and a real `lore export` against
these schemas with ajv.

## World folder

```
my-world/
  world.json          manifest: id, name, description, calendar, rule overrides
  intended.json       warnings marked "intended" (optional)
  characters/<id>.md  one file per entry; folder = type
  places/  factions/  items/  events/  notes/
  images/<entryId>/<view>.<ext>   reference images (any entry type)
```

An entry file has YAML front matter followed by a Markdown body:

```markdown
---
id: char-kadir
type: character
name: Kadir Humpback
aliases: [The Red Wind]
born: "1890"
status: alive
locations:
  - { place: place-qarim, from: "1900", to: "1915" }
relations:
  - { type: owns, target: item-glass-compass }
images:
  - file: images/char-kadir/front.png
    view: front
    provenance: { tool: ..., prompt: ..., date: "2026-10-30", sources: [...], rights: ... }
visual:
  appearance: Humanoid camel, sand-brown fur
  build: Tall (2.1 m with hump)
  props: The Glass Compass on a cord
---
Kadir leads caravans between [[place-qarim|Qarim]] and Saltmere.
```

- `id` is the stable key. Names can change, but ids should not. References (`target`, `place`, `partOf`,
  participant `id`, action `actor`/`target`, `[[...]]`, `@id`) may use an id, a name or an alias. Ids are
  preferred.
- Type-specific fields:
  - character: `born`, `died`, `status`, `locations`
  - place: `founded`, `destroyed`, `partOf`
  - faction: `founded`, `dissolved`
  - item: `created`, `destroyed`
  - event: `date`, `end`, `place`, `participants[{id, role}]`, `actions[{actor, verb, target}]`
  - note: `date` (optional; places the note in the Story Book)
- Fields on every type (all optional): `images`, `visual`, `chapter`, `bookOrder`.
- `relations[].type` is free text. The rules give meaning to `parent-of`, `child-of` and `killed`. Others,
  such as `member-of`, `ally-of`, `enemy-of`, `owns` and `spouse-of`, are grouped in the UI.
- `images[]` works on every entry type: `{file, view, provenance?}`. `view` is a kebab-case label. The usual
  views per type (`IMAGE_VIEWS` in core) are:

  | Type | Usual views |
  |---|---|
  | character | `a-pose`, `front`, `back`, `left`, `right`, `three-quarter`, `concept` |
  | place | `establishing`, `map`, `interior`, `exterior`, `mood`, `concept` |
  | faction | `emblem`, `banner`, `uniform`, `headquarters`, `concept` |
  | item | `front`, `back`, `side`, `top`, `detail`, `concept` |
  | event | `scene`, `establishing`, `map`, `mood`, `concept` |
  | note | `illustration`, `map`, `concept` |

  Other labels load fine and only raise the info rule `image-view`. `provenance` records where an image came
  from (`tool`, `prompt`, `date`, `sources`, `rights`). AI tools that generate images should fill it in and
  save the file under `images/<entryId>/`.
- `visual` is a map of free-text strings (`VISUAL_FIELDS` in core). Known keys: character `appearance`,
  `build`, `clothing`, `palette`, `features`, `props`; place `architecture`, `climate`, `palette`, `scale`;
  faction `emblem`, `attire`, `palette`; item `material`, `size`, `details`; event `scene`, `mood`. Unknown
  keys are kept and printed in the World Bible.
- `chapter` (string) and `bookOrder` (number, lower first, default 0) on events and notes control the Story
  Book. `world.json` may hold `"book": {"title", "author", "chapterYears"}`.
- Unknown front-matter keys are preserved when Lore-Forge saves. Lore-Forge writes keys in a fixed order so
  diffs stay small.

### Status

`status` is optional on characters (`alive`, `dead`, `unknown`), places (`standing`, `destroyed`,
`unknown`), factions (`active`, `dissolved`, `unknown`) and items (`intact`, `destroyed`, `lost`,
`unknown`). The app hides the end date (`died`, `destroyed`, `dissolved`) while the status is ongoing, but
the value stays in the file and the rules still use it. `LIFECYCLE`, `statusOf`, `isEnded` and
`endFieldVisible` in `@lore-forge/core` give the same answers the app uses.

### Relation types

`RELATION_KINDS` in `@lore-forge/core` is the table of known relation types: `{type, label, inverse, group,
from, to, sameType?, symmetric?, aliases?}`, where `from` and `to` list entry types. Examples: `parent-of`
character → character, `member-of` character → faction, `owns` character/faction → item/place,
`took-place-at` event → place, `about` note → anything, `related-to` anything ↔ anything. Use
`relationKindsFor(fromType, toType?)` to offer choices, `relationTargets(type, fromType)` to filter targets,
and `relationFits(kind, fromType, toType)` to validate. The `relation-kind` rule warns when a known type
doesn't fit. Types that are not in the table are allowed and not checked.

### Plain-name mentions

Names and aliases written in a body count as references, like `[[links]]`. Matching is case-sensitive,
whole-word (Unicode letters, digits and marks are word characters, so Turkish names work), longest name
first, and skips text inside `[[...]]`, `@id` and backticks. Names shorter than two characters are
ignored. `new MentionMatcher(entries).find(text, {exclude})` (or `new WorldIndex(world).mentions`) returns
`{start, end, text, ids}`; more than one id means the name is shared. In the snapshot, each entry has
`references: [{field, ref, id?, implicit?, ambiguous?}]`. Implicit (plain-name) references always resolve,
so they never produce `dangling-reference`.

### Dates

The syntax is `[~]DATE [ERA]`, or `?` / `unknown`. DATE is `YYYY`, `MM.YYYY`, `DD.MM.YYYY`, `DD.MM` (day and
month, year unknown), or the older `YYYY-MM` / `YYYY-MM-DD`, which still load. Examples: `1920`, `03.1920`,
`12.03.1920`, `1920-03-12`, `12.03`, `~1800`, `450 OK`, `-12`. In `MM.YYYY` the year needs three or more digits
(`03.0050`), a minus sign or an era code; otherwise two numbers read as `DD.MM`. Files keep the text as typed.
A `DD.MM` date is valid but never compared and is not in the snapshot's `dates` (its text stays in the entry). Months and eras come from `world.json` → `calendar`. The snapshot includes every parsed date
as `{text, year, era, approx, precision, lo, hi}`, where `lo` and `hi` are absolute day numbers on one axis
across all eras. Approximate dates are widened by `calendar.approxYears`. Use `lo` and `hi` to sort or
compare dates without re-implementing the calendar.

## Warnings

A warning has the shape `{id, ruleId, severity, message, offending, conflicting?, intended?}`:

- `offending` and `conflicting` are `{entryId, field, source}`. `source` is human-readable, for example
  `Characters/Orsan the Grey`. `field` is a front-matter path such as `actions[0]` or `died`.
- `id` is `<ruleId>:<key>` and stays the same across runs, so you can track warnings over time.
  `intended.json` refers to warnings by this id.
- `severity` is `error`, `warning` or `info`. `intended` is set when an author marked the warning as
  deliberate. Treat intended warnings as canon.

A suggested use in AI-HQ and Game-Forge: run `lore check --json` before you generate content from a world,
and pass the messages to the model as known contradictions. After writing, run it again and refuse or flag
any changes that add new `error` warnings.

## Custom rules (library)

```ts
import { RuleRegistry, builtinRules, type Rule } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';

const noDragons: Rule = {
  id: 'game-forge/no-dragons', title: 'No dragons in this setting', description: '...', severity: 'warning',
  check: ({ world }) => world.entries.filter((e) => /dragon/i.test(e.name)).map((e) => ({
    key: e.id, message: `${e.name} is a dragon.`, offending: { entryId: e.id, field: 'name', source: e.name },
  })),
};
const registry = new RuleRegistry([...builtinRules, noDragons]);
const warnings = registry.check(await loadWorld('path/to/world'));
```

Rules are pure functions of the world. Rule ids must be unique, and you should namespace your own ids. The
`rules` map in `world.json` can override any rule's severity or set it to `"off"`.

## World Bible and Story Book

`lore bible <worldDir> -o out.pdf` and `lore book <worldDir> -o out.pdf` write a PDF and a Markdown sidecar
next to it (`out.md`, image links relative to it). The sidecar holds the same content as the PDF and is the
easiest input for AI tools; it starts with an HTML comment naming the document type. In the World Bible,
each character, place, item and event ends with `#### Art brief: <name>` containing an **Image prompt**
block and, for characters and items, a **3D turnaround brief** block (neutral A-pose or resting
orientation; front, back, left, right and three-quarter views; plain background; flat lighting; no props
unless listed; consistent scale), each in a `text` code fence. The prose layout of these files may change
between versions; for exact data use `lore export`.

Options: `worldBible(world, {types?, warnings? = true, artBriefs? = true})` limits the entry types and
drops the warnings appendix or the art briefs. `storyBook(world, {grouping?: 'era' | 'years' | 'single',
chapterYears?})` picks the chapters: one per era, year ranges inside each era (default 100 years, or
`book.chapterYears`), or a single chapter. A page's own `chapter` always wins. The app's preview and its
PDF are built from the same `Doc` with the same options. The CLI uses the defaults.

Library use: `worldBible(world)` / `storyBook(world)` return a renderer-neutral `Doc`; `toMarkdown(doc)` is in
`@lore-forge/core` and `renderPdf(doc, {worldDir})` / `writePublication(...)` in `@lore-forge/pdf`.
`artBrief(entry, index)` returns `{prompt, turnaround?, missing}`.

## Stability

- `schemaVersion` appears in `world.json`, `intended.json`, the check report and the snapshot. It is `1`
  today.
- **Additive changes** keep version 1: new optional fields, new rules, new image views, new relation types.
  Lore-Forge 0.2 (images on every type, `visual`, `chapter`, `bookOrder`, note `date`, manifest `book`, the
  `image-view` rule) was additive, and so was 0.3 (status on places, factions and items, the
  `relation-kind` rule, snapshot `references`), so worlds stay at version 1.
  Consumers should ignore fields they don't know.
- **Breaking changes** bump the version: removing or renaming fields, or changing the meaning of a field or
  of the date syntax. Lore-Forge will migrate older worlds when it opens them. Consumers should check
  `schemaVersion` and refuse versions they don't know.
- Warning `message` text is meant for people and may change. Match on `ruleId` and `id` instead.
