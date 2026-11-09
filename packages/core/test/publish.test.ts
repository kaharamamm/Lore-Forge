import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { artBrief, bookChapters, bookSite, LORE_AND_LEGENDS, mapPrompt, resolveLinks, storyBook, toMarkdown, worldCodex, WorldIndex } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';
import { world } from './helpers.ts';

/** The test world that breaks canon on purpose (every rule fires once); see its README. Not on the app's shelf. */
const example = join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'test', 'fixtures', 'shifting-sands');
const camelamamm = join(import.meta.dirname, '..', '..', '..', 'worlds', 'camelamamm');

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
  const w = await loadWorld(camelamamm);
  // Every sample entry has a picture now: take the events' away and give the Singing Well a known one, so the events
  // there borrow it.
  const well = { file: 'images/place-singing-well/establishing-test.png', view: 'establishing' };
  const doc = storyBook({ ...w, entries: w.entries.map((e) => (e.id === 'place-singing-well' ? { ...e, images: [well] } : e.type === 'event' ? { ...e, images: [] } : e)) });
  const md = toMarkdown(doc);
  assert.match(md, /^# Mr Camel and the Singing Well$/m);
  assert.match(md, /Mr Camel did not fight Malquor\. He sat down in front of the old gate with the Warden Key/);
  assert.doesNotMatch(md, /\[\[|@place-/);
  assert.ok(doc.blocks.some((b) => b.kind === 'image' && b.file === well.file));
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

test('world codex: each map with its places numbered by name, after the overview; nothing without maps', () => {
  const w = world([
    { id: 'qarim', type: 'place', name: 'Qarim', pins: [{ map: 'coast', x: 40, y: 60 }] },
    { id: 'aden', type: 'place', name: 'Aden', pins: [{ map: 'coast', x: 10.5, y: 20 }] },
    { id: 'inland', type: 'place', name: 'Inland' },
  ], { manifest: { maps: [{ id: 'coast', name: 'The Coast', image: 'maps/coast.png' }, { id: 'town', name: 'Qarim Town', image: 'maps/town.png', place: 'qarim' }] } });
  const doc = worldCodex(w);
  const parts = doc.blocks.flatMap((b) => (b.kind === 'heading' && b.level === 1 ? [b.text] : []));
  assert.deepEqual(parts.slice(0, 3), ['About this document', 'World overview', 'Maps']);
  const maps = doc.blocks.flatMap((b) => (b.kind === 'image' && b.pins ? [b] : []));
  assert.deepEqual(maps.map((m) => m.pins), [[{ n: 1, x: 10.5, y: 20, name: 'Aden', id: 'aden' }, { n: 2, x: 40, y: 60, name: 'Qarim', id: 'qarim' }], []]);
  const md = toMarkdown(doc);
  assert.match(md, /!\[The Coast\]\(maps\/coast\.png\)\n\n1\. Aden\n2\. Qarim\n/);
  assert.match(md, /A map of Qarim\.\n/);
  assert.match(md, /No places are pinned on this map yet\./);
  assert.ok(!worldCodex(world([{ id: 'x', type: 'place', name: 'X' }])).blocks.some((b) => b.kind === 'heading' && b.text === 'Maps'));
});

test('a map prompt: the places it shows, nearest first, where each lies, and no text on the picture', () => {
  const ix = new WorldIndex(world([
    { id: 'coast', type: 'place', name: 'The Coast', summary: 'A long salt coast. Windy.' },
    { id: 'qarim', type: 'place', name: 'Qarim', summary: 'A port city of white towers.', partOf: 'coast' },
    { id: 'well', type: 'place', name: 'The Old Well', partOf: 'qarim' },
    { id: 'far', type: 'place', name: 'Far Isle' },
  ]));
  const all = mapPrompt(ix);
  assert.match(all, /^A map of the world of [^,]+, seen from above\. Show these places, each where it would lie: Far Isle; The Coast \(A long salt coast\); Qarim \(A port city of white towers\), in The Coast; The Old Well, in Qarim\. Hand-drawn .* No text, no labels/);
  const coast = mapPrompt(ix, 'coast');
  assert.match(coast, /^A map of The Coast \(A long salt coast\), in the world of [^,]+, seen from above\. Show these places, each where it would lie: Qarim \(A port city of white towers\); The Old Well, in Qarim\./);
  assert.ok(!coast.includes('Far Isle'));
  // Three steps down is too small for the map: a tea house in a well in a town.
  const deep = new WorldIndex(world([{ id: 'a', type: 'place', name: 'A' }, { id: 'b', type: 'place', name: 'B', partOf: 'a' }, { id: 'c', type: 'place', name: 'C', partOf: 'b' }, { id: 'd', type: 'place', name: 'D', partOf: 'c' }]));
  assert.match(mapPrompt(deep), /lie: A; B, in A; C, in B\. /);
  assert.match(mapPrompt(deep, 'a'), /lie: B; C, in B\. /);
});

test('a book as a website: the World page with names linked and map pins linked, the Story page, and the pictures to copy', () => {
  const w = world([
    { id: 'qarim', type: 'place', name: 'Qarim', summary: 'A port.', pins: [{ map: 'coast', x: 40, y: 60 }], images: [{ file: 'images/qarim/establishing.png', view: 'establishing' }] },
    { id: 'nur', type: 'character', name: 'Nur', summary: 'A scribe of **Qarim** <who> keeps the ledgers.' },
  ], { manifest: { maps: [{ id: 'coast', name: 'The Coast', image: 'maps/coast.png' }] }, story: 'Nur walked to Qarim at dawn.' });
  const codex = worldCodex(w, { artBriefs: false, warnings: false, about: false, ids: false });
  const site = bookSite(w, codex, storyBook(w), { lang: 'en', labels: { contents: 'Contents', world: 'World', story: 'Story', footer: 'Made with Lore-Forge' }, icon: { svg: 'icon.svg', png: 'icon.png' } });
  assert.deepEqual(site.pages.map((p) => p.file), ['index.html', 'story.html']);
  const [index, story] = site.pages.map((p) => p.html);
  assert.match(index!, /<h3 id="entry-nur">/);
  // Lore-Forge's icon in the tab, on every page.
  for (const page of [index!, story!]) assert.match(page, /<link rel="icon" type="image\/png" href="icon.png">\n<link rel="apple-touch-icon" href="icon.png">\n<link rel="icon" type="image\/svg\+xml" href="icon.svg">/);
  assert.match(index!, /A scribe of <strong><a href="#entry-qarim">Qarim<\/a><\/strong> &lt;who&gt; keeps the ledgers\./);
  assert.match(index!, /<a class="pin" href="#entry-qarim" style="left:40%;top:60%" title="Qarim">1<\/a>/);
  assert.ok(!index!.includes('About this document') && !index!.includes('Art brief') && !index!.includes('consistency warnings'));
  assert.ok(!/<dt>(Id|File|World id)<\/dt>/.test(index!), 'no ids or file paths for readers');
  assert.match(story!, /<a href="index.html#entry-nur">Nur<\/a> walked to <a href="index.html#entry-qarim">Qarim<\/a> at dawn\./);
  assert.match(story!, /<nav class="pages"><a href="index.html">World<\/a><a href="story.html" aria-current="page">Story<\/a><\/nav>/);
  assert.deepEqual(site.files, ['images/qarim/establishing.png', 'maps/coast.png']);
});
