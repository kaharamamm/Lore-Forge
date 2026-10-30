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
  images/<entryId>/<view>.<ext>   reference images
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
---
Kadir leads caravans between [[place-qarim|Qarim]] and Saltmere.
```

- `id` is the stable key. Names can change, but ids should not. References (`target`, `place`, `partOf`,
  participant `id`, action `actor`/`target`, `[[...]]`, `@id`) may use an id, a name or an alias. Ids are
  preferred.
- Type-specific fields:
  - character: `born`, `died`, `status`, `locations`, `images`
  - place: `founded`, `destroyed`, `partOf`
  - faction: `founded`, `dissolved`
  - item: `created`, `destroyed`
  - event: `date`, `end`, `place`, `participants[{id, role}]`, `actions[{actor, verb, target}]`
  - note: none
- `relations[].type` is free text. The rules give meaning to `parent-of`, `child-of` and `killed`. Others,
  such as `member-of`, `ally-of`, `enemy-of`, `owns` and `spouse-of`, are grouped in the UI.
- Image `view` is one of `a-pose`, `front`, `back`, `left`, `right`, `three-quarter` or `concept`. The
  `provenance` field records where an image came from. AI tools that generate images should fill it in.
- Unknown front-matter keys are preserved when Lore-Forge saves. Lore-Forge writes keys in a fixed order so
  diffs stay small.

### Dates

The syntax is `[~]YEAR[-MM[-DD]] [ERA]`, or `?` / `unknown`. Examples: `1920`, `1920-03-12`, `~1800`,
`450 OK`, `-12`. Months and eras come from `world.json` → `calendar`. The snapshot includes every parsed date
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

## Stability

- `schemaVersion` appears in `world.json`, `intended.json`, the check report and the snapshot. It is `1`
  today.
- **Additive changes** keep version 1: new optional fields, new rules, new image views, new relation types.
  Consumers should ignore fields they don't know.
- **Breaking changes** bump the version: removing or renaming fields, or changing the meaning of a field or
  of the date syntax. Lore-Forge will migrate older worlds when it opens them. Consumers should check
  `schemaVersion` and refuse versions they don't know.
- Warning `message` text is meant for people and may change. Match on `ruleId` and `id` instead.
