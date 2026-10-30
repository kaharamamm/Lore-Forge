import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { artBrief, bookChapters, LORE_AND_LEGENDS, resolveLinks, storyBook, toMarkdown, worldCodex, WorldIndex } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';
import { world } from './helpers.ts';

const example = join(import.meta.dirname, '..', '..', '..', 'worlds', 'shifting-sands');

test('links in text resolve to display names; labels win; unknown refs keep their text', () => {
  const ix = new WorldIndex(world([{ id: 'char-a', type: 'character', name: 'Ayşe' }]));
  assert.equal(resolveLinks('[[char-a]] met [[char-a|her]], (@char-a) and [[Nobody]] @ghost.', ix), 'Ayşe met her, (Ayşe) and Nobody @ghost.');
});

test('art brief: a character gets an image prompt and an A-pose turnaround from the visual description', () => {
  const w = world([{ id: 'char-a', type: 'character', name: 'Ayşe', summary: 'A smith', visual: { appearance: 'Short grey hair', build: '1.6 m, stocky', props: 'a hammer' } }]);
  const b = artBrief(w.entries[0]!, new WorldIndex(w))!;
  assert.match(b.prompt, /^Full-body character concept art of Ayşe\. A smith\. Appearance: Short grey hair\. Height & build: 1\.6 m, stocky\./);
  assert.match(b.turnaround!, /Neutral A-pose/);
  assert.match(b.turnaround!, /front, back, left, right and three-quarter, same scale and the same height in every view \(1\.6 m, stocky\)/);
  assert.match(b.turnaround!, /Plain light-grey background, flat even lighting/);
  assert.match(b.turnaround!, /Props: only a hammer\./);
  assert.deepEqual(b.missing, ['Clothing', 'Colour palette', 'Distinguishing features']);
});

test('art brief: no props listed means "No props."; items get an object turnaround; places only a prompt; notes none', () => {
  const w = world([
    { id: 'char-a', type: 'character', name: 'A' },
    { id: 'item-b', type: 'item', name: 'B', visual: { material: 'Glass', size: '8 cm' } },
    { id: 'place-c', type: 'place', name: 'C', visual: { climate: 'Hot' } },
    { id: 'note-d', type: 'note', name: 'D' },
  ]);
  const ix = new WorldIndex(w);
  const [a, b, c, d] = ['char-a', 'item-b', 'place-c', 'note-d'].map((id) => artBrief(w.entries.find((e) => e.id === id)!, ix));
  assert.match(a!.turnaround!, /No props\./);
  assert.match(b!.turnaround!, /single object.*same scale in every view \(8 cm\).*no other props.*Material: Glass\./s);
  assert.match(c!.prompt, /^Wide establishing shot of C\. Climate & weather: Hot\./);
  assert.equal(c!.turnaround, undefined);
  assert.equal(d, undefined);
});

test('story book: chapters by era or year range, chapter override, bookOrder, undated notes last', () => {
  const w = world([
    { id: 'evt-late', type: 'event', name: 'Late', date: '1920' },
    { id: 'evt-early', type: 'event', name: 'Early', date: '1905' },
    { id: 'note-nudged', type: 'note', name: 'Nudged first', date: '1949', bookOrder: -1 },
    { id: 'evt-old', type: 'event', name: 'Old', date: '~200 OK' },
    { id: 'note-legend', type: 'note', name: 'A legend' },
    { id: 'evt-named', type: 'event', name: 'Named', date: '1700', chapter: 'The War' },
    { id: 'note-named', type: 'note', name: 'Undated but named', chapter: 'The War' },
    { id: 'char-x', type: 'character', name: 'Not in the book' },
  ], { manifest: { book: { chapterYears: 50 } } });
  const ch = bookChapters(w).map((c) => [c.title, c.pages.map((p) => p.entry.name)]);
  assert.deepEqual(ch, [
    ['Old Kingdom, 200–249', ['Old']],
    ['The War', ['Named', 'Undated but named']],
    ['After the Sundering, 1900–1949', ['Nudged first', 'Early', 'Late']],
    [LORE_AND_LEGENDS, ['A legend']],
  ]);
  const byEra = bookChapters(world([{ id: 'e1', type: 'event', name: 'E1', date: '1905' }, { id: 'e2', type: 'event', name: 'E2', date: '1700' }]));
  assert.deepEqual(byEra.map((c) => [c.title, c.pages.length]), [['After the Sundering', 2]]);
});

test('world codex of the example world: sections, art briefs, glossary and open warnings', async () => {
  const doc = worldCodex(await loadWorld(example));
  const tocText = doc.blocks.filter((b) => b.kind === 'heading' && b.toc && b.level === 1).map((b) => b.kind === 'heading' && b.text);
  assert.deepEqual(tocText, ['About this document', 'World overview', 'Characters', 'Places', 'Factions', 'Items', 'Events', 'Notes', 'Timeline', 'Relationship summary', 'Glossary of names', 'Appendix: consistency warnings']);
  const md = toMarkdown(doc);
  assert.match(md, /#### Art brief: Kadir Humpback/);
  assert.match(md, /#### Art brief: Saltmere/);
  assert.match(md, /3D turnaround brief/);
  assert.match(md, /- \*\*Saltmere Ağıtı:\*\* Note: alias of The Lament of Saltmere/);
  assert.match(md, /Şafakta İlsa'nın ışığı söndü/);
  assert.match(md, /ERROR \[after-death\] Orsan the Grey can't kill Queen Ilsa in 1920/);
  assert.match(md, /!\[Saltmere: Establishing shot\]\(images\/place-saltmere\/establishing\.png\)/);
  assert.match(md, /- \[Characters\]\(#characters\)\n  - \[Hadi\]\(#entry-char-hadi\)/);
});

test('story book of the example world resolves links and uses the place image for an event without one', async () => {
  const doc = storyBook(await loadWorld(example));
  const md = toMarkdown(doc);
  assert.match(md, /^# Tales of the Shifting Sands$/m);
  assert.match(md, /The old vizier opened the salt gate himself\. The Dune Guard poured through/);
  assert.doesNotMatch(md, /\[\[|@place-/);
  assert.ok(doc.blocks.some((b) => b.kind === 'image' && b.file === 'images/evt-fall-of-saltmere/scene.png'));
});

test('codex headings carry default entry pictures (Leyla: female), and a tombstone for the dead', async () => {
  const w = await loadWorld(example);
  const leyla = w.entries.find((e) => e.id === 'char-leyla')!;
  const dead = { ...w, entries: w.entries.map((e) => (e.id === leyla.id ? ({ ...e, status: 'dead' } as typeof e) : e)) };
  const doc = worldCodex(dead);
  const h = doc.blocks.find((b) => b.kind === 'heading' && b.text === leyla.name);
  assert.deepEqual(h && h.kind === 'heading' && [h.icon, h.mark], ['female', 'tombstone']);
  assert.ok(doc.blocks.some((b) => b.kind === 'heading' && b.level === 1 && b.text === 'Characters' && b.icon === 'person'));
  assert.doesNotMatch(toMarkdown(doc), /undefined/);
});
