/** Regression tests for audited bugs in the consistency rules, the engine and the story check. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStory, builtinRules, check, checkWorld, parseWorld, serializeEntry, sortWarnings, entryPath, type Warning, type World } from '@lore-forge/core';
import { manifest, warnings, world, type Draft } from './helpers.ts';

const ids = (ws: Warning[]) => ws.map((w) => w.id).sort();
const storyWarnings = (w: World) => check(w).filter((x) => x.offending.entryId.startsWith('story:'));
const LIFE_RULES = ['after-death', 'before-birth', 'participant-not-existing', 'place-not-existing'];

// ------------------------------------------------------------------------------------ 1. long events

test('bug 1: participants of a long event only need to overlap it', () => {
  const joan: Draft = { id: 'char-joan', type: 'character', name: 'Joan', born: '1412', died: '1431' };
  const company: Draft = { id: 'fac-company', type: 'faction', name: 'Free Company', founded: '1400' };
  const war: Draft = { id: 'evt-war', type: 'event', name: 'Hundred Years War', date: '1337', end: '1453', participants: [{ id: 'char-joan' }, { id: 'fac-company' }] };
  const gate: Draft = { id: 'place-gate', type: 'place', name: 'Gate', founded: '1500' };
  const building: Draft = { id: 'evt-building', type: 'event', name: 'Building of the Gate', date: '1490', end: '1510', place: 'place-gate' };
  assert.deepEqual(warnings([joan, company, war, gate, building]).filter((w) => LIFE_RULES.includes(w.ruleId)), []);
});

test('bug 1: a long event wholly outside a life or a place is still wrong; stays still need the whole span', () => {
  const joan: Draft = { id: 'char-joan', type: 'character', name: 'Joan', born: '1412', died: '1431' };
  const late: Draft = { id: 'evt-late', type: 'event', name: 'Late Siege', date: '1440', end: '1450', participants: [{ id: 'char-joan' }] };
  const early: Draft = { id: 'evt-early', type: 'event', name: 'Early Siege', date: '1380', end: '1400', participants: [{ id: 'char-joan' }] };
  assert.deepEqual(warnings([joan, late, early], 'after-death').map((w) => w.message), [`Joan can't take part in "Late Siege" from 1440 to 1450: Joan died in 1431 (source: Characters/Joan).`]);
  assert.deepEqual(warnings([joan, late, early], 'before-birth').map((w) => w.message), [`Joan can't take part in "Early Siege" from 1380 to 1400: Joan was born in 1412 (source: Characters/Joan).`]);
  const gate: Draft = { id: 'place-gate', type: 'place', name: 'Gate', founded: '1500', destroyed: '1850' };
  const before: Draft = { id: 'evt-a', type: 'event', name: 'Survey', date: '1480', end: '1490', place: 'place-gate' };
  const after: Draft = { id: 'evt-b', type: 'event', name: 'Toll', date: '1860', end: '1870', place: 'place-gate' };
  assert.equal(warnings([gate, before, after], 'place-not-existing').length, 2);
  const stay: Draft = { id: 'char-c', type: 'character', name: 'C', locations: [{ place: 'place-gate', from: '1490', to: '1510' }] };
  assert.equal(warnings([gate, stay], 'place-not-existing').length, 1, 'a stay must fit inside the place’s life');
  assert.equal(warnings([{ ...joan, locations: [{ place: 'place-gate', from: '1420', to: '1440' }] }, { ...gate, founded: '1400' }], 'after-death').length, 1, 'a stay must fit inside the life');
});

// ---------------------------------------------------------------------- 2. keys from content, not positions

const front = <T>(list: T[], row: T): T[] => [row, ...list];

test('bug 2: relation-kind ids name the relation, not its position', () => {
  const leyla: Draft = { id: 'char-l', type: 'character', name: 'Leyla' };
  const compass = (relations: unknown[]): Draft => ({ id: 'item-c', type: 'item', name: 'Compass', relations });
  const rels = [{ type: 'parent-of', target: 'char-l' }];
  const before = ids(warnings([compass(rels), leyla], 'relation-kind'));
  assert.deepEqual(before, ['relation-kind:item-c:parent-of>char-l']);
  const after = ids(warnings([compass(front(rels, { type: 'related-to', target: 'char-l' })), leyla], 'relation-kind'));
  assert.deepEqual(after, before);
  assert.ok(warnings([compass(rels), leyla], 'relation-kind', { intended: [{ warningId: 'relation-kind:item-c:0' }] })[0]?.intended, 'a mark under the old id still applies');
});

test('bug 2: image-view ids name the image file', () => {
  const b = (images: unknown[]): Draft => ({ id: 'char-b', type: 'character', name: 'B', images });
  const imgs = [{ file: 'd.png', view: 'fornt' }];
  assert.deepEqual(ids(warnings([b(imgs)], 'image-view')), ['image-view:char-b:d.png']);
  assert.deepEqual(ids(warnings([b(front(imgs, { file: 'a.png', view: 'front' }))], 'image-view')), ['image-view:char-b:d.png']);
  assert.ok(warnings([b(imgs)], 'image-view', { intended: [{ warningId: 'image-view:char-b:0' }] })[0]?.intended);
});

test('bug 2: invalid-date and date-order ids stay put when a relation or stay is added in front', () => {
  const x: Draft = { id: 'char-x', type: 'character', name: 'X' };
  const p: Draft = { id: 'place-p', type: 'place', name: 'P' };
  const c = (relations: unknown[], locations: unknown[] = []): Draft => ({ id: 'char-c', type: 'character', name: 'C', relations, locations });
  const rels = [{ type: 'ally-of', target: 'char-x', from: '1750 XX' }, { type: 'enemy-of', target: 'char-x', from: '1900', to: '1800' }];
  const locs = [{ place: 'place-p', from: '1900', to: '1800' }];
  const extraRel = { type: 'friend-of', target: 'char-x' };
  const extraLoc = { place: 'place-p', from: '1700', to: '1710' };
  for (const rule of ['invalid-date', 'date-order']) {
    const before = ids(warnings([c(rels, locs), x, p], rule));
    assert.ok(before.length > 0, rule);
    assert.deepEqual(ids(warnings([c(front(rels, extraRel), front(locs, extraLoc)), x, p], rule)), before, rule);
  }
  assert.ok(warnings([c(rels, locs), x, p], 'invalid-date', { intended: [{ warningId: 'invalid-date:char-c:relations[0].from' }] })[0]?.intended);
  assert.ok(warnings([c(rels, locs), x, p], 'date-order', { intended: [{ warningId: 'date-order:char-c:locations[0]' }] }).some((w) => w.intended));
});

test('bug 2: place-not-existing, after-death, before-birth and two-places ids for stays and dated relations stay put', () => {
  const gate: Draft = { id: 'place-gate', type: 'place', name: 'Gate', founded: '1500', destroyed: '1850' };
  const qarim: Draft = { id: 'place-qarim', type: 'place', name: 'Qarim' };
  const y: Draft = { id: 'char-y', type: 'character', name: 'Y', born: '1960' };
  const d = (locations: unknown[], relations: unknown[]): Draft => ({ id: 'char-d', type: 'character', name: 'D', born: '1450', died: '1700', locations, relations });
  const locs = [{ place: 'place-gate', from: '1400', to: '1450' }, { place: 'place-qarim', from: '1690', to: '1710' }, { place: 'place-gate', from: '1695', to: '1705' }];
  const rels = [{ type: 'killed', target: 'char-y', from: '1950' }];
  const extraLoc = { place: 'place-qarim', from: '1460', to: '1470' };
  const extraRel = { type: 'ally-of', target: 'char-y' };
  for (const rule of ['place-not-existing', 'after-death', 'before-birth', 'two-places-at-once']) {
    const before = ids(warnings([d(locs, rels), gate, qarim, y], rule));
    assert.ok(before.length > 0, rule);
    assert.deepEqual(ids(warnings([d(front(locs, extraLoc), front(rels, extraRel)), gate, qarim, y], rule)), before, rule);
  }
  const marked = (rule: string, warningId: string) => warnings([d(locs, rels), gate, qarim, y], rule, { intended: [{ warningId }] }).some((w) => w.intended);
  assert.ok(marked('after-death', 'after-death:char-d:locations:1'), 'old stay id');
  assert.ok(marked('after-death', 'after-death:char-d:relations:0'), 'old relation id');
  assert.ok(marked('before-birth', 'before-birth:char-d:relations:0:target'), 'old killing-target id');
  assert.ok(marked('place-not-existing', 'place-not-existing:char-d:locations:0'));
  assert.ok(marked('two-places-at-once', 'two-places-at-once:char-d:locations:1|char-d:locations:2'));
});

test('bug 2: dangling-reference ids stay put when a row is added in front', () => {
  const c = (relations: unknown[]): Draft => ({ id: 'char-c', type: 'character', name: 'C', relations });
  const rels = [{ type: 'ally-of', target: 'ghost' }];
  assert.deepEqual(ids(warnings([c(rels)], 'dangling-reference')), ['dangling-reference:char-c:relations:ghost']);
  assert.deepEqual(ids(warnings([c(front(rels, { type: 'ally-of', target: 'phantom' }))], 'dangling-reference')), ['dangling-reference:char-c:relations:ghost', 'dangling-reference:char-c:relations:phantom']);
  assert.ok(warnings([c(rels)], 'dangling-reference', { intended: [{ warningId: 'dangling-reference:char-c:relations[0]:ghost' }] })[0]?.intended);
  const twice = ids(warnings([c([...rels, ...rels])], 'dangling-reference'));
  assert.equal(twice.length, 2, 'true duplicates get a number');
});

// ------------------------------------------------------------------------------- 3. story deed ids

test('bug 3: story warning ids come from the sentence, not its position in the story', () => {
  const orsan: Draft = { id: 'char-orsan', type: 'character', name: 'Orsan', born: '1740', died: '1800', status: 'dead' };
  /** Warning id -> the sentence it points at. */
  const sentenceById = (story: string) => {
    const w = world([orsan], { story });
    return new Map(storyWarnings(w).filter((x) => x.ruleId === 'after-death').map((x) => [x.id, w.story![0]!.body.slice(...x.offending.span!)]));
  };
  const two = sentenceById('Orsan rode to Qarim in 1850. Orsan rode to Saltmere in 1860.');
  assert.equal(two.size, 2);
  const three = sentenceById('Orsan rode to Zarnak in 1820. Orsan rode to Qarim in 1850. Orsan rode to Saltmere in 1860.');
  assert.equal(three.size, 3);
  for (const [id, sentence] of two) assert.equal(three.get(id), sentence, `${id} still points at "${sentence}"`);
  // Marks made before: the id had the deed's running number (here the second deed, number 1).
  const old = 'after-death:story~01-chapter-1~1:char-orsan';
  const marked = storyWarnings(world([orsan], { story: 'Orsan rode to Qarim in 1850. Orsan rode to Saltmere in 1860.', intended: [{ warningId: old }] }));
  assert.equal(marked.filter((w) => w.intended).length, 1);
  assert.equal(marked.find((w) => w.intended)?.offending.span?.[0], 29, 'the mark lands on the second sentence');
  const same = storyWarnings(world([orsan], { story: 'Orsan rode in 1850. Orsan rode in 1850.' })).filter((w) => w.ruleId === 'after-death');
  assert.equal(new Set(same.map((w) => w.id)).size, same.length, 'identical sentences get distinct ids');
});

// ------------------------------------------------------------------------------- 4. dates outside eras

test('bug 4: invalid-date flags a date outside its era', () => {
  const item = (created: string): Draft => ({ id: 'item-c', type: 'item', name: 'Compass', created });
  const msg = (created: string, opts?: Parameters<typeof world>[1]) => warnings([item(created)], 'invalid-date', opts).map((w) => w.message);
  assert.deepEqual(msg('1500 OK'), ['Compass, created: "1500 OK" is after Old Kingdom ended: its last year is 1001 OK (source: Items/Compass).']);
  assert.deepEqual(msg('0 AS'), ['Compass, created: "0 AS" is before After the Sundering began: its first year is 1 (source: Items/Compass).']);
  assert.equal(msg('-5').length, 1, 'the default era too');
  assert.equal(msg('~0 AS').length, 1);
  const shortOK = { manifest: { calendar: { ...manifest.calendar, eras: [{ id: 'OK', name: 'Old Kingdom', start: -1000, end: -900 }, { id: 'AS', name: 'After the Sundering', start: 1 }] } } };
  assert.deepEqual(msg('200 OK', shortOK), ['Compass, created: "200 OK" is after Old Kingdom ended: its last year is 101 OK (source: Items/Compass).']);
  for (const ok of ['1 OK', '1001 OK', '1 AS', '2000', '~1 AS', '12.03', 'unknown']) assert.deepEqual(msg(ok), [], ok);
  // Before the earliest era there is nothing earlier to write a year in: "-12" counts back from its start.
  const oneEra = { manifest: { calendar: { eras: [{ id: 'SR', name: 'Salt Reckoning', start: 1 }], defaultEra: 'SR' } } };
  assert.deepEqual(msg('-12', oneEra), [], 'a world with one era');
  assert.deepEqual(msg('-5 OK'), [], 'before the earliest era');
});

// --------------------------------------------------------------------------- 5, 6, 17, 18. story checks

test('bug 5: giving an existing event a date in the story checks the event', () => {
  const orsan: Draft = { id: 'char-orsan', type: 'character', name: 'Orsan', born: '1740', died: '1800', status: 'dead' };
  const qarim: Draft = { id: 'place-qarim', type: 'place', name: 'Qarim', destroyed: '1850', status: 'destroyed' };
  const battle: Draft = { id: 'evt-battle-of-qarim', type: 'event', name: 'The Battle of Qarim', place: 'place-qarim', participants: [{ id: 'char-orsan' }] };
  const ws = storyWarnings(world([orsan, qarim, battle], { story: 'The Battle of Qarim was fought in 1950.' }));
  assert.deepEqual(ws.map((w) => w.ruleId).sort(), ['after-death', 'place-not-existing']);
  for (const w of ws) assert.equal(w.offending.chapter, 'story/01-chapter-1.md');
  assert.deepEqual(ws.find((w) => w.ruleId === 'after-death')?.conflicting, { entryId: 'char-orsan', field: 'died', source: 'Characters/Orsan' });
});

test('bug 6: a later sentence that contradicts an entry is reported even when an earlier one agrees', () => {
  const camel: Draft = { id: 'char-camel', type: 'character', name: 'Camel', born: '1998', status: 'alive' };
  const ws = storyWarnings(world([camel], { story: ['Camel was born in 1998.', 'Camel was born in 1990.'] }));
  assert.deepEqual(ws.map((w) => [w.ruleId, w.offending.chapter, w.message]), [['story-contradiction', 'story/02-chapter-2.md', 'The story says Camel was born in 1990, but Characters/Camel says 1998.']]);
  const both = storyWarnings(world([camel], { story: ['Camel was born in 1990.', 'Camel was born in 1991.'] }));
  assert.deepEqual(both.map((w) => w.offending.chapter).sort(), ['story/01-chapter-1.md', 'story/02-chapter-2.md']);
  assert.deepEqual(storyWarnings(world([camel], { story: ['Camel was born in 1990.', 'Camel was born in 1990.'] })).length, 1, 'the same claim twice is one warning');
});

test('bug 6: ignoring a proposal still hides its contradiction, but not a different one', () => {
  const camel: Draft = { id: 'char-camel', type: 'character', name: 'Camel', born: '1998', status: 'alive' };
  const key = 'update:char-camel:{born:"1990"}';
  assert.deepEqual(storyWarnings(world([camel], { story: ['Camel was born in 1990.', 'Camel was born in 1990.'], ignored: [key] })), []);
  assert.deepEqual(storyWarnings(world([camel], { story: ['Camel was born in 1990.', 'Camel was born in 1991.'], ignored: [key] })).map((w) => w.offending.chapter), ['story/02-chapter-2.md']);
});

test('bug 17: a death date from the story is quoted from the story', () => {
  const camel: Draft = { id: 'char-camel', type: 'character', name: 'Camel', born: '1998', status: 'alive' };
  const ws = storyWarnings(world([camel], { story: 'Camel died in 2000. Camel fought at Qarim in 2010.' }));
  const late = ws.find((w) => w.ruleId === 'after-death');
  assert.ok(late, JSON.stringify(ws.map((w) => w.message)));
  assert.match(late.message, /Camel died in 2000 \(source: Story\/Chapter 1\)\.$/);
});

test('bug 18: a fact of a story-made entry points at the sentence that gave it', () => {
  const ws = storyWarnings(world([], { story: ['Baran was born in 1900.', 'Baran died in 1850.'] }));
  const w = ws.find((x) => x.ruleId === 'date-order');
  assert.ok(w, JSON.stringify(ws));
  assert.equal(w.offending.chapter, 'story/02-chapter-2.md', 'the death comes from chapter 2');
  assert.equal(w.conflicting?.chapter, 'story/01-chapter-1.md', 'the birth from chapter 1');
  assert.equal(w.message, 'Baran died in 1850, before Baran was born in 1900 (source: Story/Chapter 2).');
});

// ------------------------------------------------------------------------------ 8. killings as relations

test('bug 8: dead-marked-alive also sees killings written as relations', () => {
  const ws = warnings([
    { id: 'char-k', type: 'character', name: 'K', relations: [{ type: 'killed', target: 'char-v', from: '1795' }] },
    { id: 'char-v', type: 'character', name: 'V', status: 'alive' },
  ], 'dead-marked-alive');
  assert.deepEqual(ws.map((w) => w.message), ['V is marked alive, but V was killed by K in 1795 (source: Characters/K).']);
  assert.deepEqual(ws[0]?.conflicting, { entryId: 'char-k', field: 'relations[0]', source: 'Characters/K' });
});

// ----------------------------------------------------------------------------- 9, 10. file and name ids

test('bug 9: file-error ids do not depend on problems in other files', () => {
  const base = world([]);
  const a = { file: 'notes/a.md', message: 'Missing "name".' };
  const b = { file: 'notes/b.md', message: '"type" must be one of: character, place, faction, item, event, note.' };
  const withBoth: World = { ...base, issues: [a, b] };
  const onlyB: World = { ...base, issues: [b] };
  const idOfB = (w: World) => checkWorld(w, builtinRules).filter((x) => x.ruleId === 'file-error' && x.offending.source === 'notes/b.md').map((x) => x.id);
  assert.deepEqual(idOfB(withBoth), idOfB(onlyB));
  const twice: World = { ...base, issues: [b, b] };
  assert.equal(new Set(checkWorld(twice, builtinRules).map((x) => x.id)).size, 2, 'the same problem twice in one file is two warnings');
  const marked: World = { ...withBoth, intended: [{ warningId: 'file-error:notes/b.md:1' }] };
  assert.ok(checkWorld(marked, builtinRules).find((x) => x.offending.source === 'notes/b.md')?.intended, 'a mark under the old id still applies');
});

test('bug 10: duplicate-name ids do not depend on entry order', () => {
  const kadir: Draft = { id: 'char-kadir', type: 'character', name: 'Kadir', aliases: ['The Red Wind'] };
  const wind: Draft = { id: 'fac-wind', type: 'faction', name: 'The Red Wind' };
  const w = world([kadir, wind]);
  const reversed: World = { ...w, entries: [...w.entries].reverse() };
  const a = checkWorld(w, builtinRules).filter((x) => x.ruleId === 'duplicate-name').map((x) => x.id);
  const b = checkWorld(reversed, builtinRules).filter((x) => x.ruleId === 'duplicate-name').map((x) => x.id);
  assert.equal(a.length, 1);
  assert.deepEqual(a, b);
  const marked: World = { ...w, intended: [{ warningId: 'duplicate-name:the red wind:fac-wind' }] };
  assert.ok(checkWorld(marked, builtinRules).find((x) => x.ruleId === 'duplicate-name')?.intended, 'a mark under the old id still applies');
});

// ------------------------------------------------------------------------- 11, 20. two places at once

const places: Draft[] = [{ id: 'a', type: 'place', name: 'Qarim' }, { id: 'b', type: 'place', name: 'Saltmere' }];

test('bug 11: back-to-back stays that share one boundary day are not two places at once', () => {
  const c = (locations: unknown[]): Draft => ({ id: 'c', type: 'character', name: 'Kadir', locations });
  assert.deepEqual(warnings([...places, c([{ place: 'a', from: '01.01.1900', to: '12.03.1915' }, { place: 'b', from: '12.03.1915', to: '01.01.1920' }])], 'two-places-at-once'), []);
  assert.equal(warnings([...places, c([{ place: 'a', from: '01.01.1900', to: '13.03.1915' }, { place: 'b', from: '12.03.1915', to: '01.01.1920' }])], 'two-places-at-once').length, 1, 'two shared days overlap');
  const ev = (date: string): Draft => ({ id: 'e', type: 'event', name: 'Feast', date, place: 'b', participants: [{ id: 'c' }] });
  const stay = c([{ place: 'a', from: '01.01.1900', to: '12.03.1915' }]);
  assert.deepEqual(warnings([...places, stay, ev('12.03.1915')], 'two-places-at-once'), [], 'the day the stay ends');
  assert.equal(warnings([...places, stay, ev('11.03.1915')], 'two-places-at-once').length, 1, 'a day inside the stay');
});

test('bug 20: a one-day event whose end equals its date is still one day', () => {
  const c: Draft = { id: 'c', type: 'character', name: 'Kadir' };
  const ev = (id: string, place: string, extra: object = {}): Draft => ({ id, type: 'event', name: id, date: '12.03.1920', place, participants: [{ id: 'c' }], ...extra });
  assert.equal(warnings([...places, c, ev('e1', 'a', { end: '12.03.1920' }), ev('e2', 'b')], 'two-places-at-once').length, 1);
  assert.equal(warnings([...places, c, ev('e1', 'a', { end: '1920-03-12' }), ev('e2', 'b', { end: '12.03.1920' })], 'two-places-at-once').length, 1);
});

// --------------------------------------------------------------------------- 12, 13. lifespans

test('bug 12: participant-not-existing only checks factions, items and places', () => {
  const ws = warnings([
    { id: 'note-a', type: 'note', name: 'Song', date: '1900' },
    { id: 'evt-a', type: 'event', name: 'A', date: '1900' },
    { id: 'evt-b', type: 'event', name: 'B', date: '1800', participants: [{ id: 'note-a' }, { id: 'evt-a' }] },
  ], 'participant-not-existing');
  assert.deepEqual(ws, []);
});

test('bug 13: after-death uses a killing when there is no death date', () => {
  const ilsa: Draft = { id: 'char-ilsa', type: 'character', name: 'Ilsa' };
  const orsan: Draft = { id: 'char-orsan', type: 'character', name: 'Orsan' };
  const fall: Draft = { id: 'evt-fall', type: 'event', name: 'The Fall', date: '1920', actions: [{ actor: 'char-orsan', verb: 'killed', target: 'char-ilsa' }] };
  const coronation = (date: string): Draft => ({ id: 'evt-cor', type: 'event', name: 'Coronation', date, participants: [{ id: 'char-ilsa' }] });
  const [w, ...rest] = warnings([ilsa, orsan, fall, coronation('1930')], 'after-death');
  assert.equal(rest.length, 0);
  assert.equal(w?.message, `Ilsa can't take part in "Coronation" in 1930: Ilsa was killed by Orsan in 1920 (source: Events/The Fall).`);
  assert.deepEqual(w?.conflicting, { entryId: 'evt-fall', field: 'actions[0]', source: 'Events/The Fall' });
  assert.deepEqual(warnings([ilsa, orsan, fall, coronation('1920')], 'after-death'), [], 'the same year');
  const byRelation = warnings([ilsa, { ...orsan, relations: [{ type: 'killed', target: 'char-ilsa', from: '1920' }] }, coronation('1930')], 'after-death');
  assert.deepEqual(byRelation.map((x) => x.message), [`Ilsa can't take part in "Coronation" in 1930: Ilsa was killed by Orsan in 1920 (source: Characters/Orsan).`]);
  assert.deepEqual(warnings([{ ...ilsa, died: '1940' }, orsan, fall, coronation('1930')], 'after-death').map((x) => x.ruleId), [], 'a death date wins');
});

// ------------------------------------------------------------------------- 14, 15, 22. world.json values

test('bug 14: a malformed month list is a load issue, not a crash', () => {
  for (const months of ['twelve', [null], [{ name: 'Sun' }], [{ name: 'Sun', days: 30 }, 7]]) {
    const w = world([{ id: 'char-a', type: 'character', name: 'A', born: '03.1920' }], { manifest: { calendar: { ...manifest.calendar, months } as never } });
    assert.ok(w.issues.some((i) => i.file === 'world.json'), JSON.stringify(months));
    assert.doesNotThrow(() => check(w), JSON.stringify(months));
    assert.ok(checkWorld(w, builtinRules).some((x) => x.ruleId === 'file-error' && x.offending.source === 'world.json'));
  }
  const partly = world([], { manifest: { calendar: { ...manifest.calendar, months: [{ name: 'Sun', days: 30 }, null] } as never } });
  assert.deepEqual(partly.manifest.calendar.months, [{ name: 'Sun', days: 30 }], 'good months are kept');
});

test('bug 15: an unknown rule severity falls back to the default and is reported', () => {
  const X: Draft = { id: 'char-x', type: 'character', name: 'X', born: '1750', died: '1800' };
  const Y: Draft = { id: 'char-y', type: 'character', name: 'Y', born: '1890' };
  const kill: Draft = { id: 'evt-k', type: 'event', name: 'The Killing', date: '1920', actions: [{ actor: 'char-x', verb: 'killed', target: 'char-y' }] };
  const w = world([X, Y, kill], { manifest: { rules: { 'after-death': 'Off', 'before-birth': 'Error', 'duplicate-name': 'off' } as never } });
  const ws = checkWorld(w, builtinRules);
  assert.equal(ws.find((x) => x.ruleId === 'after-death')?.severity, 'error', '"Off" is not "off": the default stays');
  assert.ok(ws.every((x) => ['error', 'warning', 'info'].includes(x.severity)));
  assert.equal(w.issues.filter((i) => i.file === 'world.json').length, 2, JSON.stringify(w.issues));
  // A manifest edited in memory is checked the same way.
  const mem: World = { ...w, issues: [], manifest: { ...w.manifest, rules: { 'after-death': 'Warning' as never } } };
  assert.equal(checkWorld(mem, builtinRules).find((x) => x.ruleId === 'after-death')?.severity, 'error');
  const story = analyzeStory({ ...world([{ id: 'char-camel', type: 'character', name: 'Camel', born: '1998' }], { story: 'Camel was born in 1990.' }), manifest: { ...w.manifest, rules: { 'story-contradiction': 'Off' as never } } });
  assert.equal(story.warnings[0]?.severity, 'warning');
});

test('bug 22: a negative approxYears is reported and does not flip date ranges', () => {
  const w = world([{ id: 'char-a', type: 'character', name: 'A', born: '~1900', died: '1897' }], { manifest: { calendar: { ...manifest.calendar, approxYears: -10 } } });
  assert.ok(w.issues.some((i) => i.file === 'world.json'));
  assert.deepEqual(checkWorld(w, builtinRules).filter((x) => x.ruleId === 'date-order'), [], 'died 1897 is inside ~1900 (±5)');
  const mem: World = { ...w, manifest: { ...w.manifest, calendar: { ...w.manifest.calendar, approxYears: -10 } } };
  assert.deepEqual(checkWorld(mem, builtinRules).filter((x) => x.ruleId === 'date-order'), []);
});

// ------------------------------------------------------------------------------ 16. blank editor rows

test('bug 16: blank editor rows are not dangling references', () => {
  const base = world([{ id: 'p', type: 'place', name: 'P' }]);
  const blank: World = {
    ...base,
    entries: [
      ...base.entries,
      { id: 'char-c', type: 'character', name: 'C', relations: [{ type: 'ally-of', target: '' }], locations: [{ place: '' }], body: '' },
      { id: 'evt-e', type: 'event', name: 'E', date: '1900', place: '', participants: [{ id: '' }], actions: [{ actor: '', verb: 'killed' }], body: '' },
    ],
  };
  assert.deepEqual(checkWorld(blank, builtinRules), []);
});

// ------------------------------------------------------------------------- 19. capitalised relation types

test('bug 19: capitalised relation types count like lowercase ones', () => {
  const a: Draft = { id: 'a', type: 'character', name: 'Mira', born: '1930', relations: [{ type: 'Parent-Of', target: 'b' }] };
  const b: Draft = { id: 'b', type: 'character', name: 'Tarik', born: '1900', relations: [{ type: 'Parent-Of', target: 'a' }] };
  assert.equal(warnings([a, b], 'parent-cycle').length, 1);
  assert.equal(warnings([a, { ...b, relations: [] }], 'parent-born-after-child').length, 1);
  const k: Draft = { id: 'char-k', type: 'character', name: 'K', relations: [{ type: 'Killed', target: 'char-y', from: '1950' }] };
  const y: Draft = { id: 'char-y', type: 'character', name: 'Y', born: '1960', status: 'alive' };
  assert.deepEqual(warnings([k, y], 'before-birth').map((w) => w.message), [`Y can't be killed by K in 1950: Y was born in 1960 (source: Characters/Y).`]);
  assert.equal(warnings([k, y], 'dead-marked-alive').length, 1);
});

// ---------------------------------------------------------------------------------- 21. chapter dates

test('bug 21: unreadable story chapter dates are reported', () => {
  const files = [
    { path: 'world.json', content: JSON.stringify(manifest) },
    { path: 'story/01-a.md', content: '---\ntitle: Dawn\norder: 1\ndate: "1900 XX"\n---\nText.\n' },
    { path: 'story/02-b.md', content: '---\ntitle: Dusk\norder: 2\ndate: "45.13.1900"\n---\nText.\n' },
    { path: 'story/03-c.md', content: '---\ntitle: Noon\norder: 3\ndate: "1900"\n---\nText.\n' },
  ];
  const ws = checkWorld(parseWorld(files), builtinRules).filter((w) => w.ruleId === 'invalid-date');
  assert.deepEqual(ws.map((w) => w.message), [
    'Dawn, date: "1900 XX" uses an unknown era "XX". Known eras: OK, AS (source: Story/Dawn).',
    'Dusk, date: "45.13.1900" has month 13, but the calendar has 12 months (source: Story/Dusk).',
  ]);
  assert.deepEqual(ws[0]?.offending, { entryId: 'story:story/01-a.md', field: 'date', source: 'Story/Dawn', chapter: 'story/01-a.md' });
});

// ------------------------------------------------------------------------------------- 24. empty names

test('bug 24: an entry with an empty name loads, is reported, and keeps its data', () => {
  const files = [
    { path: 'world.json', content: JSON.stringify(manifest) },
    { path: 'characters/char-a.md', content: serializeEntry({ id: 'char-a', type: 'character', name: '', born: '1900', body: 'Text.\n' }) },
  ];
  const w = parseWorld(files);
  assert.deepEqual(w.entries.map((e) => [e.id, e.name]), [['char-a', '']]);
  const err = checkWorld(w, builtinRules).filter((x) => x.ruleId === 'file-error');
  assert.deepEqual(err.map((x) => [x.id, x.message, x.severity]), [['file-error:characters/char-a.md:name-is-empty', 'characters/char-a.md: "name" is empty.', 'error']]);
  assert.deepEqual(err[0]?.offending, { entryId: 'char-a', field: 'name', source: 'Characters/char-a' }, 'Go to opens the entry at its name');
  assert.equal(entryPath(w.entries[0]!), 'characters/char-a.md');
  // Checked live, as the editor shows it: clearing a name warns at once, filling it in again clears the warning.
  const named = world([{ id: 'char-b', type: 'character', name: 'B' }]);
  const cleared: World = { ...named, entries: named.entries.map((e) => ({ ...e, name: ' ' })) };
  assert.equal(checkWorld(cleared, builtinRules).filter((x) => x.ruleId === 'file-error').length, 1);
  assert.deepEqual(checkWorld(named, builtinRules), []);
});

// ------------------------------------------------------------------------------------- performance

test('sorting warnings by remembered rank keeps the localeCompare order', () => {
  const SEV = { error: 0, warning: 1, info: 2 } as const;
  const severities = ['error', 'warning', 'info'] as const;
  const ids = ['b:Zed', 'b:apple', 'a:x-1', 'a:x:1', 'a:x_1', 'a:X1', 'a:x10', 'a:x2', 'c:é', 'c:e', 'c:f', 'a:x#2', 'a:x@1-2', 'a:x>y', 'a:İlsa', 'a:ilsa'];
  const ws: Warning[] = ids.map((id, i) => ({
    id, ruleId: id.split(':')[0]!, severity: severities[i % 3]!, message: id, offending: { entryId: 'x', field: 'f', source: 's' },
    ...(i % 5 === 0 ? { intended: { warningId: id } } : {}),
  }));
  const reference = (list: Warning[]) => [...list].sort((a, b) => Number(!!a.intended) - Number(!!b.intended) || SEV[a.severity] - SEV[b.severity] || a.id.localeCompare(b.id)).map((w) => w.id);
  assert.deepEqual(sortWarnings([...ws].reverse()).map((w) => w.id), reference(ws), 'new ids');
  assert.deepEqual(sortWarnings([...ws].reverse()).map((w) => w.id), reference(ws), 'known ids');
  const some = ws.filter((_, i) => i % 2 === 0);
  assert.deepEqual(sortWarnings([...some].reverse()).map((w) => w.id), reference(some), 'some of the known ids');
  const marked = ws.map((w, i) => (i % 3 === 0 ? { ...w, intended: { warningId: w.id } } : w));
  assert.deepEqual(sortWarnings([...marked].reverse()).map((w) => w.id), reference(marked), 'marks changed');
});

test('parent-cycle: long chains and big cycles need no recursion', () => {
  const chain = (n: number, cycle: boolean): World => {
    const base = world([]);
    const entries = Array.from({ length: n }, (_, i) => ({ id: `c-${i}`, type: 'character' as const, name: `C ${i}`, body: '', relations: i + 1 < n || cycle ? [{ type: 'parent-of', target: `c-${(i + 1) % n}` }] : [] }));
    return { ...base, entries };
  };
  const rule = builtinRules.filter((r) => r.id === 'parent-cycle');
  assert.deepEqual(checkWorld(chain(10_000, false), rule), []);
  const t = performance.now();
  const ws = checkWorld(chain(3_000, true), rule);
  assert.equal(ws.length, 1);
  assert.ok(performance.now() - t < 1000, 'fast');
  assert.equal(ws[0]?.message, "C 0 can't be the parent of C 1: C 1 is already an ancestor of C 0 (source: Characters/C 1).");
});
