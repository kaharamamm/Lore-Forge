import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEntry, parseWorld, serializeEntry, WorldFormatError, type Entry } from '@lore-forge/core';
import { manifest } from './helpers.ts';

const kadir: Entry = {
  id: 'char-kadir', type: 'character', name: 'Kadir', aliases: ['The Red Wind'], born: '1890', status: 'alive',
  locations: [{ place: 'place-qarim', from: '1900', to: '1915' }],
  relations: [{ type: 'owns', target: 'item-compass' }],
  images: [{ file: 'images/char-kadir/front.png', view: 'front', provenance: { tool: 'Meshy', prompt: 'camel', date: '2026-10-30', sources: ['sketch.png'], rights: 'mine' } }],
  body: 'Kadir leads caravans to [[place-qarim]].\n',
};

test('an entry survives a save and reload unchanged', () => {
  const { entry, problems } = parseEntry(serializeEntry(kadir));
  assert.deepEqual(problems, []);
  assert.deepEqual(entry, kadir);
});

test('saved files are readable Markdown with front matter in a stable key order', () => {
  const text = serializeEntry(kadir);
  assert.ok(text.startsWith('---\nid: char-kadir\ntype: character\nname: Kadir\n'));
  assert.ok(text.endsWith('---\n\nKadir leads caravans to [[place-qarim]].\n'));
});

test('bare numbers in YAML are read as dates', () => {
  const { entry } = parseEntry('---\nid: a\ntype: character\nname: A\nborn: 1800\n---\n');
  assert.equal(entry?.type === 'character' && entry.born, '1800');
});

test('unknown keys are kept when the file is saved again', () => {
  const { entry } = parseEntry('---\nid: a\ntype: note\nname: A\nmood: grim\n---\nText\n');
  assert.deepEqual(entry?.extra, { mood: 'grim' });
  assert.match(serializeEntry(entry!), /mood: grim/);
});

test('broken files report problems instead of throwing', () => {
  assert.deepEqual(parseEntry('no front matter').problems, ['File must start with a "---" front-matter block.']);
  assert.deepEqual(parseEntry('---\nid: a\ntype: dragon\nname: A\n---\n').problems, ['"type" must be one of: character, place, faction, item, event, note.']);
  assert.deepEqual(parseEntry('---\nid: a\ntype: note\n---\n').problems, ['Missing "name".']);
  assert.match(parseEntry('---\nid: [a\n---\n').problems[0]!, /not valid YAML/);
});

test('a world needs world.json', () => {
  assert.throws(() => parseWorld([]), WorldFormatError);
  assert.throws(() => parseWorld([{ path: 'world.json', content: '{"schemaVersion": 2}' }]), /schemaVersion 2/);
});

test('duplicate ids and misplaced files become load issues', () => {
  const w = parseWorld([
    { path: 'world.json', content: JSON.stringify(manifest) },
    { path: 'characters/a.md', content: '---\nid: a\ntype: character\nname: A\n---\n' },
    { path: 'notes/a.md', content: '---\nid: a\ntype: note\nname: A2\n---\n' },
    { path: 'notes/b.md', content: '---\nid: b\ntype: place\nname: B\n---\n' },
  ]);
  assert.deepEqual(w.entries.map((e) => e.id), ['a', 'b']);
  assert.deepEqual(w.issues.map((i) => i.file), ['notes/a.md', 'notes/b.md']);
});

test('every entry type can carry reference images, a visual description and book fields', () => {
  const entries: Entry[] = [
    { id: 'place-gate', type: 'place', name: 'Gate', visual: { architecture: 'Bronze arch', palette: 'copper, sand' }, images: [{ file: 'images/place-gate/establishing.png', view: 'establishing' }], body: '' },
    { id: 'item-compass', type: 'item', name: 'Compass', visual: { material: 'Glass and brass' }, images: [{ file: 'images/item-compass/top.png', view: 'top', provenance: { tool: 'Blender' } }], body: '' },
    { id: 'evt-fall', type: 'event', name: 'Fall', date: '1920', visual: { scene: 'Towers burning', mood: 'grim' }, images: [{ file: 'images/evt-fall/scene.png', view: 'scene' }], chapter: 'The Fall', bookOrder: -1, body: '' },
    { id: 'fac-guard', type: 'faction', name: 'Guard', images: [{ file: 'images/fac-guard/emblem.png', view: 'emblem' }], body: '' },
    { id: 'note-song', type: 'note', name: 'Song', date: '~1850', bookOrder: 2, images: [{ file: 'images/note-song/illustration.png', view: 'illustration' }], body: 'Ş ğ İ ı\n' },
  ];
  for (const e of entries) {
    const { entry, problems } = parseEntry(serializeEntry(e));
    assert.deepEqual(problems, []);
    assert.deepEqual(entry, e);
  }
});

test('a non-number bookOrder is reported', () => {
  assert.deepEqual(parseEntry('---\nid: a\ntype: note\nname: A\nbookOrder: soon\n---\n').problems, ['"bookOrder" should be a number.']);
});
