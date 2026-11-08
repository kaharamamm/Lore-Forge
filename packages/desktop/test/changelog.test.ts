import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inline, parseChangelog, withFallback } from '../src/shared/changelog.ts';

const md = `# Changelog

All notable changes are listed here. See [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **Display settings** in **Settings**:
  - the window;
  - its \`resolution\`.
- Patch notes.

## [1.0.0] - 2026-11-07

First public release. The downloads
were replaced.

- Desktop app.

### Changed

- **Timeline redesign**:
  - era ribbons;
  - an **Overview** strip.

  Panning stops at the first year.
- See [docs/MCP.md](docs/MCP.md).

[Unreleased]: https://github.com/x/y/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/x/y/releases/tag/v1.0.0
`;

test('releases, sections and nested bullets', () => {
  const r = parseChangelog(md);
  assert.deepEqual(r.map((x) => [x.version, x.date]), [['Unreleased', undefined], ['1.0.0', '2026-11-07']]);
  const added = r[0]!.sections[0]!;
  assert.equal(added.title, 'Added');
  assert.deepEqual(added.items.map((i) => i.text), ['**Display settings** in **Settings**:', 'Patch notes.']);
  assert.deepEqual(added.items[0]!.items.map((i) => i.text), ['the window;', 'its `resolution`.']);
  assert.deepEqual(r[1]!.intro, ['First public release. The downloads were replaced.'], 'a paragraph over two lines');
  assert.deepEqual(r[1]!.items.map((i) => i.text), ['Desktop app.']);
  const timeline = r[1]!.sections[0]!.items[0]!;
  assert.deepEqual(timeline.items.map((i) => i.text), ['era ribbons;', 'an **Overview** strip.']);
  assert.deepEqual(timeline.more, ['Panning stops at the first year.'], 'the indented paragraph belongs to the top bullet');
  assert.equal(r[1]!.sections[0]!.items[1]!.text, 'See [docs/MCP.md](docs/MCP.md).', 'the bullet after it is a new top bullet');
});

test('bold, code and links', () => {
  assert.deepEqual(inline('**Go to** opens `born: 03.1920`, see [the guide](docs/USER-GUIDE.md).'), [
    { bold: ['Go to'] }, ' opens ', { code: 'born: 03.1920' }, ', see ', { link: 'docs/USER-GUIDE.md', text: ['the guide'] }, '.',
  ]);
  assert.deepEqual(inline('a ** b'), ['a ** b'], 'an unclosed marker stays text');
  assert.deepEqual(inline('**[World Codex](x)**'), [{ bold: [{ link: 'x', text: ['World Codex'] }] }]);
});

test('a translated changelog falls back to English for a version it lacks', () => {
  const en = parseChangelog(md);
  const tr = parseChangelog('## [1.0.0] - 2026-11-07\n\nİlk sürüm.\n');
  const both = withFallback(tr, en);
  assert.equal(both[0], en[0]);
  assert.deepEqual(both[1]!.intro, ['İlk sürüm.']);
});

test('the real changelog reads: every release has a version and something in it', () => {
  const real = parseChangelog(readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8'));
  assert.ok(real.length >= 2);
  for (const r of real) assert.ok(r.intro.length + r.items.length + r.sections.length > 0, r.version);
  const one = real.find((r) => r.version === '1.0.0')!;
  assert.equal(one.date, '2026-11-07');
  assert.ok(one.sections.some((s) => s.title === 'Added' && s.items.length > 5));
});
