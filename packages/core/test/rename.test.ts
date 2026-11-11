import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyRename, findAll, parseEntry, planRename, replaceFound, serializeEntry, textAround, turkishEnding, worldCodex,
  type Character, type Entry, type LoreEvent, type Place,
} from '@lore-forge/core';
import { world } from './helpers.ts';

test('Turkish endings follow the new name: vowel harmony, the buffer letters, d/t and c/ç', () => {
  const cases: [string, string, string, string][] = [
    ['Kadir', 'Murat', 'in', 'ın'], ['Kadir', 'Murat', 'e', 'a'], ['Kadir', 'Murat', 'den', 'tan'], ['Kadir', 'Murat', 'le', 'la'],
    ['Kadir', 'Murat', 'i', 'ı'], ['Kadir', 'Murat', 'deki', 'taki'], ['Kadir', 'Murat', 'ler', 'lar'], ['Kadir', 'Murat', 'dir', 'tır'],
    ['Kadir', 'Murat', 'di', 'tı'], ['Kadir', 'Murat', 'inki', 'ınki'],
    ['Kadir', 'Ayşe', 'in', 'nin'], ['Kadir', 'Ayşe', 'e', 'ye'], ['Kadir', 'Ayşe', 'i', 'yi'], ['Kadir', 'Ayşe', 'le', 'yle'],
    ['Kadir', 'Ayşe', 'den', 'den'], ['Kadir', 'Ayşe', 'di', 'ydi'], ['Kadir', 'Ayşe', 'dir', 'dir'], ['Kadir', 'Ayşe', 'miş', 'ymiş'],
    ['Ayşe', 'Kadir', 'nin', 'in'], ['Ayşe', 'Kadir', 'ye', 'e'], ['Ayşe', 'Kadir', 'yi', 'i'], ['Ayşe', 'Kadir', 'yle', 'le'],
    ['Ayşe', 'Kadir', 'de', 'de'], ['Ayşe', 'Kadir', 'ydi', 'di'], ['Ayşe', 'Ali', 'nin', 'nin'], ['Ayşe', 'Kadir', 'si', 'i'],
    ['Kadir', 'Kemal', 'in', 'in'], ['Kadir', 'Kartal', 'in', 'ın'], ['Kadir', 'Ömür', 'in', 'ün'], ['Kadir', 'Ahmet', 'de', 'te'],
    ['Kadir', 'Ahmet', 'ce', 'çe'], ['Murat', 'Kadir', 'tan', 'den'], ['Murat', 'Kadir', 'ın', 'in'], ['Kadir', 'Ali', 'in', 'nin'],
    ['Kadir', 'Murat Bey', 'e', 'e'], ['Kadir', 'Murat', 'İN', 'IN'], ['Kadir', 'Murat', 's', 's'], ['Kadir', 'Murat', 'll', 'll'],
  ];
  for (const [from, to, ending, want] of cases) assert.equal(turkishEnding(from, to, ending), want, `${from}'${ending} → ${to}'${want}`);
});

const book = () => world([
  { id: 'char-kadir', type: 'character', name: 'Murat', summary: 'Kadir sells tea.', body: 'Born in [[Saltmere]]. KADIR! Kadirs is another word.' },
  { id: 'place-saltmere', type: 'place', name: 'Saltmere', ruler: 'Kadir', body: "Kadir'in evi burada. [[Kadir|the old merchant]] lives here. @char-kadir too. `Kadir` in code." },
  { id: 'event-fire', type: 'event', name: 'The Fire', participants: [{ id: 'Kadir' }], actions: [{ actor: 'Kadir', verb: 'founded', target: 'Saltmere' }] },
  { id: 'char-leyla', type: 'character', name: 'Leyla', relations: [{ type: 'friend-of', target: 'Kadir', note: 'Kadir saved her.' }] },
], { story: "Kadir walked to Saltmere. Kadir'e su verdiler. Kadir's tea was cold." });

test('planRename finds the old name in the story, in text, in [[links]] and in name fields, and nowhere else', () => {
  const hits = planRename(book(), 'char-kadir', 'Kadir', 'Murat');
  const seen = hits.map((h) => `${h.owner} ${h.field}: ${h.old} → ${h.new}`);
  assert.deepEqual(seen, [
    'story:story/01-chapter-1.md body: Kadir → Murat',
    "story:story/01-chapter-1.md body: Kadir'e → Murat'a",
    'story:story/01-chapter-1.md body: Kadir → Murat',
    'char-kadir summary: Kadir → Murat',
    'char-kadir body: KADIR → MURAT',
    'char-leyla relations[0].target: Kadir → Murat',
    'char-leyla relations[0].note: Kadir → Murat',
    'event-fire participants[0].id: Kadir → Murat',
    'event-fire actions[0].actor: Kadir → Murat',
    "place-saltmere body: Kadir'in → Murat'ın",
    'place-saltmere body: Kadir → Murat',
    'place-saltmere details.ruler: Kadir → Murat',
  ]);
  const second = hits[1]!;
  assert.equal(second.before, 'Kadir walked to Saltmere. ');
  assert.equal(second.after, " su verdiler. Kadir's tea was cold.");
  assert.ok(hits.every((h) => !h.shared));
  assert.equal(new Set(hits.map((h) => h.id)).size, hits.length, 'every hit has its own id');
});

test('applyRename makes every change but the skipped ones, and keeps the old name when asked', () => {
  const w = book();
  const hits = planRename(w, 'char-kadir', 'Kadir', 'Murat');
  const all = applyRename(w, 'char-kadir', 'Kadir', 'Murat');
  assert.equal(all.count, hits.length);
  assert.equal(all.chapters[0]!.body.trimEnd(), "Murat walked to Saltmere. Murat'a su verdiler. Murat's tea was cold.");
  const get = (id: string) => all.entries.find((e) => e.id === id)!;
  assert.equal(get('place-saltmere').body.trimEnd(), "Murat'ın evi burada. [[Murat|the old merchant]] lives here. @char-kadir too. `Kadir` in code.");
  assert.equal((get('place-saltmere') as Place).details?.['ruler'], 'Murat');
  const fire = get('event-fire') as LoreEvent;
  assert.deepEqual([fire.participants?.[0]?.id, fire.actions?.[0]?.actor, fire.actions?.[0]?.target], ['Murat', 'Murat', 'Saltmere']);
  assert.deepEqual(get('char-leyla').relations?.[0], { type: 'friend-of', target: 'Murat', note: 'Murat saved her.' });
  const kadir = get('char-kadir') as Character;
  assert.deepEqual([kadir.name, kadir.summary, kadir.body.trimEnd(), kadir.aliases], ['Murat', 'Murat sells tea.', 'Born in [[Saltmere]]. MURAT! Kadirs is another word.', undefined]);
  assert.equal(all.entries[0]!.id, 'char-kadir', 'the renamed entry comes first');

  const some = applyRename(w, 'char-kadir', 'Kadir', 'Murat', { skip: new Set(hits.filter((h) => h.owner === 'place-saltmere').map((h) => h.id)), keepOldName: true });
  assert.equal(some.count, hits.length - 3);
  assert.ok(!some.entries.some((e) => e.id === 'place-saltmere'), 'an entry with every change skipped is left alone');
  assert.deepEqual(some.entries.find((e) => e.id === 'char-kadir')!.aliases, ['Kadir']);
});

test('a shared old name: plain mentions are marked, and names that mean the other entry are left alone', () => {
  const w = world([
    { id: 'char-kadir', type: 'character', name: 'Murat', body: '' },
    { id: 'item-kadir', type: 'item', name: 'The Kadir Lamp', aliases: ['Kadir'], body: '' },
    { id: 'char-leyla', type: 'character', name: 'Leyla', relations: [{ type: 'owns', target: 'item-kadir' }], body: 'Kadir glows.' },
  ]);
  const hits = planRename(w, 'char-kadir', 'Kadir', 'Murat');
  assert.deepEqual(hits.map((h) => [h.owner, h.field, h.shared]), [['char-leyla', 'body', true]]);
});

test('the renamed entry’s other names follow it; longer names of other entries keep the old name', () => {
  const w = world([
    { id: 'char-kadir', type: 'character', name: 'Murat', aliases: ['Kadir the Merchant', 'Kadir'], body: '' },
    { id: 'item-lamp', type: 'item', name: "Kadir's Lamp", body: '' },
    { id: 'note-a', type: 'note', name: 'Gossip', body: "Kadir the Merchant lit Kadir's Lamp. Kadir smiled." },
  ]);
  const hits = planRename(w, 'char-kadir', 'Kadir', 'Murat');
  assert.deepEqual(hits.map((h) => `${h.owner} ${h.field}: ${h.old}`), ['char-kadir aliases[0]: Kadir', 'note-a body: Kadir', 'note-a body: Kadir']);
  const r = applyRename(w, 'char-kadir', 'Kadir', 'Murat');
  assert.deepEqual(r.entries.find((e) => e.id === 'char-kadir')!.aliases, ['Murat the Merchant', 'Kadir']);
  assert.equal(r.entries.find((e) => e.id === 'note-a')!.body.trimEnd(), "Murat the Merchant lit Kadir's Lamp. Murat smiled.");
});

test('renaming a place: stays, parts, events, maps and Turkish endings', () => {
  const w = world([
    { id: 'place-saltmere', type: 'place', name: 'Tuzgöl', body: '' },
    { id: 'place-well', type: 'place', name: 'The Well', partOf: 'Saltmere', body: "Saltmere'de bir kuyu." },
    { id: 'char-a', type: 'character', name: 'Ada', locations: [{ place: 'Saltmere', from: '10' }], body: '' },
    { id: 'event-b', type: 'event', name: 'Battle', place: 'saltmere', body: '' },
  ], { manifest: { maps: [{ id: 'map-s', name: 'Map of Saltmere', image: 'maps/s.png', place: 'Saltmere' }] } });
  const r = applyRename(w, 'place-saltmere', 'Saltmere', 'Tuzgöl');
  const well = r.entries.find((e) => e.id === 'place-well') as Place;
  assert.deepEqual([well.partOf, well.body.trimEnd()], ['Tuzgöl', "Tuzgöl'de bir kuyu."]);
  assert.equal((r.entries.find((e) => e.id === 'char-a') as Character).locations?.[0]?.place, 'Tuzgöl');
  assert.equal((r.entries.find((e) => e.id === 'event-b') as LoreEvent).place, 'Tuzgöl', 'a name in any case is the same name');
  assert.deepEqual(r.maps, [{ id: 'map-s', name: 'Map of Tuzgöl', image: 'maps/s.png', place: 'Tuzgöl' }]);
});

test('nothing to rename: an unknown entry, an empty name, the same name', () => {
  const w = book();
  assert.deepEqual(planRename(w, 'nobody', 'Kadir', 'Murat'), []);
  assert.deepEqual(planRename(w, 'char-kadir', '', 'Murat'), []);
  assert.deepEqual(planRename(w, 'char-kadir', 'Kadir', ' '), []);
  assert.deepEqual(planRename(w, 'char-kadir', 'Kadir', 'Kadir'), []);
});

test('find: the Turkish and English i without case, whole words, symbols as they are; replace', () => {
  assert.equal(findAll('İstanbul, istanbul, ISTANBUL', 'istanbul').length, 3);
  assert.deepEqual(findAll('kır kir KIR', 'kır').map((f) => f.start), [0, 8]);
  assert.equal(findAll('Şafak şafak', 'ŞAFAK').length, 2);
  assert.equal(findAll('Kadir kadir', 'Kadir', { matchCase: true }).length, 1);
  assert.deepEqual(findAll('Ali, ali, Alişan', 'ali', { wholeWords: true }).map((f) => f.start), [0, 5]);
  assert.deepEqual(findAll('a.b axb a-b', 'a.b').map((f) => f.start), [0]);
  assert.deepEqual(findAll('fisher-man', '-man', { wholeWords: true }).map((f) => f.start), [6]);
  assert.deepEqual(findAll('text', ''), []);
  const text = 'the cat sat';
  assert.equal(replaceFound(text, findAll(text, 'at'), 'og'), 'the cog sog');
});

test('textAround: the words around a match on its line, cut with an ellipsis', () => {
  const text = 'First line.\nA long sentence with the word target somewhere in the middle of it, and more words after it.';
  const at = text.indexOf('target');
  assert.deepEqual(textAround(text, at, at + 6, 24), { before: '…sentence with the word ', after: ' somewhere in the…' });
  assert.deepEqual(textAround('one two', 4, 7), { before: 'one ', after: '' });
});

test('pronunciation: read and written next to the other names, and in the World Codex', () => {
  const { entry } = parseEntry('---\nid: place-c\ntype: place\nname: Camelamamm\npronunciation: "  KAM-eh-la-mam "\n---\n\nText.\n');
  assert.equal(entry?.pronunciation, 'KAM-eh-la-mam');
  const text = serializeEntry({ ...(entry as Entry), aliases: ['Camel Town'] });
  assert.match(text, /aliases:\n {2}- Camel Town\npronunciation: KAM-eh-la-mam\n/);
  const codex = JSON.stringify(worldCodex(world([{ id: 'place-c', type: 'place', name: 'Camelamamm', pronunciation: 'KAM-eh-la-mam' }])));
  assert.match(codex, /"Pronunciation","KAM-eh-la-mam"/);
  assert.match(codex, /Place \(place-c\), said KAM-eh-la-mam/);
});
