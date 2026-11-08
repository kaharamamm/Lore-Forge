import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ageAtDeathText, check, detailRelations, ENTRY_ICON_NAMES, entryIcon, familyTree, guessGender, ICONS, parseEntry, raceIcon, racesOf, relationWeb, suggestionIcon, TYPE_ICON, references, serializeEntry, worldCodex, type Entry,
} from '@lore-forge/core';
import { manifest, world } from './helpers.ts';

const entry = (text: string): Entry => {
  const r = parseEntry(text);
  assert.deepEqual(r.problems, []);
  return r.entry!;
};

test('detail fields load, round-trip, and stay out of extra; empty ones are not written', () => {
  const e = entry('---\nid: c1\ntype: character\nname: Leyla\ngender: female\noccupation: Scribe\nlanguages: Old Qarimi, Common\naffiliations: [fac-a]\npopulation: 40\ntags: [old]\n---\n\nBody\n');
  assert.equal(e.details?.['gender'], 'female');
  assert.deepEqual(e.details?.['languages'], ['Old Qarimi', 'Common']);
  assert.deepEqual(e.details?.['affiliations'], ['fac-a']);
  // population is not a character field: it stays an unknown key, kept as-is.
  assert.deepEqual(e.extra, { population: 40 });
  assert.deepEqual(e.tags, ['old']);
  const out = serializeEntry({ ...e, details: { ...e.details, title: '' } } as Entry);
  assert.match(out, /^gender: female$/m);
  assert.match(out, /^tags:\n {2}- old$/m);
  assert.doesNotMatch(out, /^title:/m);
  assert.deepEqual(parseEntry(out).entry, e);
});

test('a numeric population is read as text; several races split on commas or lists', () => {
  const p = entry('---\nid: p1\ntype: place\nname: Qarim\npopulation: 4000\n---\n');
  assert.equal(p.details?.['population'], '4000');
  const c = entry('---\nid: c1\ntype: character\nname: X\nrace: [elf, human]\n---\n');
  assert.equal(c.type === 'character' && c.race, 'elf, human');
  assert.deepEqual(racesOf(c), ['elf', 'human']);
});

test('reference details count as relations, references and web edges; age at death is computed', () => {
  const w = world([
    { id: 'c1', type: 'character', name: 'Orsan', born: '1700', died: '1763', details: { home: 'p1', affiliations: ['f1'] } },
    { id: 'p1', type: 'place', name: 'Qarim', details: { ruler: 'c1' } },
    { id: 'f1', type: 'faction', name: 'Dune Guard', details: { leader: 'nobody' } },
  ]);
  const c = w.entries.find((e) => e.id === 'c1')!;
  assert.deepEqual(detailRelations(c).map((r) => `${r.source} ${r.type} ${r.target}`), ['c1 member-of f1', 'c1 lives-in p1']);
  assert.ok(references(c).some((r) => r.field === 'home' && r.ref === 'p1'));
  assert.ok(check(w).some((x) => x.ruleId === 'dangling-reference' && x.message.includes('"nobody"')));
  const web = relationWeb(w, 'c1')!;
  assert.ok(web.edges.some((e) => e.from === 'c1' && e.to === 'p1' && e.type === 'lives-in' && e.field === 'home'));
  assert.ok(web.edges.some((e) => e.from === 'c1' && e.to === 'p1' && e.type === 'rules' && e.holder === 'p1'));
  assert.equal(ageAtDeathText(c, manifest.calendar), 'about 63');
  const codex = JSON.stringify(worldCodex(w));
  assert.ok(codex.includes('Age at death') && codex.includes('lives in'));
});

test('relation web and family tree can add and hide entries without touching them', () => {
  const w = world([
    { id: 'a', type: 'character', name: 'A', relations: [{ type: 'parent-of', target: 'b' }] },
    { id: 'b', type: 'character', name: 'B' },
    { id: 'z', type: 'character', name: 'Z' },
  ]);
  assert.deepEqual(relationWeb(w, 'a', { add: ['z'] })!.nodes.map((n) => n.id).sort(), ['a', 'b', 'z']);
  assert.deepEqual(relationWeb(w, 'a', { hide: ['b'] })!.nodes.map((n) => n.id), ['a']);
  assert.deepEqual(familyTree(w, 'a', { add: ['z'] }).nodes.map((n) => n.id).sort(), ['a', 'b', 'z']);
  assert.deepEqual(familyTree(w, 'a', { hide: ['b'] }).nodes.map((n) => n.id), ['a']);
});

test('default pictures come from gender, names, titles and keywords', () => {
  const e = (d: object) => ({ body: '', ...d }) as Entry;
  assert.equal(guessGender(e({ type: 'character', id: 'x', name: 'Zehra' })), 'female');
  assert.equal(guessGender(e({ type: 'character', id: 'x', name: 'King Camel' })), 'male');
  assert.equal(entryIcon(e({ type: 'character', id: 'x', name: 'Q', details: { gender: 'Female' } })), 'female');
  assert.equal(entryIcon(e({ type: 'character', id: 'x', name: 'Qwz', race: 'camel-folk' })), 'camel-head');
  assert.equal(entryIcon(e({ type: 'character', id: 'x', name: 'Qwz' })), 'person');
  assert.equal(entryIcon(e({ type: 'place', id: 'x', name: 'The Sultan Palace' })), 'indian-palace');
  assert.equal(entryIcon(e({ type: 'place', id: 'x', name: 'Old Hut' })), 'hut');
  assert.equal(entryIcon(e({ type: 'place', id: 'x', name: 'Bronze Gate', details: { kind: 'çöl' } })), 'desert');
  assert.equal(entryIcon(e({ type: 'item', id: 'x', name: 'Glass Compass' })), 'compass');
  assert.equal(entryIcon(e({ type: 'event', id: 'x', name: 'Siege of Qarim' })), 'siege-tower');
  assert.equal(entryIcon(e({ type: 'event', id: 'x', name: 'Royal Wedding' })), 'linked-rings');
  assert.equal(entryIcon(e({ type: 'faction', id: 'x', name: 'Nothing Here' })), 'checked-shield');
  assert.equal(raceIcon('Undead'), 'death-skull');
  assert.equal(raceIcon('lizard-folk'), 'wolf-head');
  assert.equal(raceIcon('fennec-folk'), 'fox-head');
  // Suggestion lists show a picture per word: genders, kinds by entry type (the default-picture tables), verbs.
  assert.equal(suggestionIcon('character', 'gender', 'female'), 'female');
  assert.equal(suggestionIcon('character', 'gender', 'non-binary'), 'person');
  assert.equal(suggestionIcon('character', 'gender', 'Genderless'), 'genderless');
  assert.equal(suggestionIcon('character', 'gender', 'cinsiyetsiz'), 'genderless');
  assert.equal(suggestionIcon('place', 'kind', 'port'), 'anchor');
  assert.equal(suggestionIcon('item', 'kind', 'potion'), 'round-potion');
  assert.equal(suggestionIcon('faction', 'kind', 'guild'), 'two-coins');
  assert.equal(suggestionIcon('place', 'kind', 'region'), TYPE_ICON.place);
  assert.equal(suggestionIcon('event', 'verb', 'crowned'), 'crown');
  assert.equal(suggestionIcon('character', 'occupation', 'smith'), undefined);
  for (const i of ENTRY_ICON_NAMES) assert.ok(ICONS[i], i);
});
