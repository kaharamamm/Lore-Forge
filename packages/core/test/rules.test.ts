import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtinRules, RuleRegistry, type Rule } from '@lore-forge/core';
import { warnings, world } from './helpers.ts';

const X = { id: 'char-x', type: 'character', name: 'X', born: '1750', died: '1800' } as const;
const Y = { id: 'char-y', type: 'character', name: 'Y', born: '1890' } as const;
const killing = (date: string) => ({ id: 'evt-k', type: 'event', name: 'The Killing', date, actions: [{ actor: 'char-x', verb: 'killed', target: 'char-y' }] }) as const;

test('after-death: the required X-died-1800 / killed-Y-1920 message', () => {
  const [w, ...rest] = warnings([X, Y, killing('1920')], 'after-death');
  assert.equal(rest.length, 0);
  assert.equal(w!.message, "X can't kill Y in 1920: X died in 1800 (source: Characters/X).");
  assert.equal(w!.severity, 'error');
  assert.deepEqual(w!.offending, { entryId: 'evt-k', field: 'actions[0]', source: 'Events/The Killing' });
  assert.deepEqual(w!.conflicting, { entryId: 'char-x', field: 'died', source: 'Characters/X' });
});

test('after-death: also covers victims, participants, stays and dated relations', () => {
  const dead = { id: 'char-d', type: 'character', name: 'D', died: '1700', locations: [{ place: 'p', from: '1690', to: '1710' }], relations: [{ type: 'killed', target: 'char-y', from: '1950' }] } as const;
  const msgs = warnings([dead, Y, { id: 'p', type: 'place', name: 'P' }, { id: 'e', type: 'event', name: 'Feast', date: '1720', participants: [{ id: 'char-d' }] }], 'after-death').map((w) => w.message);
  assert.deepEqual(msgs.sort(), [
    `D can't be in P from 1690 to 1710: D died in 1700 (source: Characters/D).`,
    `D can't kill Y in 1950: D died in 1700 (source: Characters/D).`,
    `D can't take part in "Feast" in 1720: D died in 1700 (source: Characters/D).`,
  ]);
  const victim = warnings([{ ...X, id: 'char-v', name: 'V' }, { id: 'char-k', type: 'character', name: 'K' }, { id: 'e', type: 'event', name: 'E', date: '1850', actions: [{ actor: 'char-k', verb: 'killed', target: 'char-v' }] }], 'after-death');
  assert.equal(victim[0]?.message, "V can't be killed by K in 1850: V died in 1800 (source: Characters/V).");
});

test('after-death: no warning in the year of death, with unknown dates, or when approximate dates overlap', () => {
  assert.deepEqual(warnings([X, Y, killing('1800')], 'after-death'), []);
  assert.deepEqual(warnings([X, Y, killing('unknown')], 'after-death'), []);
  assert.deepEqual(warnings([{ ...X, died: '~1800' }, Y, killing('1804')], 'after-death'), []);
});

test('before-birth: acting before being born', () => {
  const [w] = warnings([X, { ...Y, born: '1900' }, killing('1790')], 'before-birth');
  assert.equal(w?.message, "Y can't be killed by X in 1790: Y was born in 1900 (source: Characters/Y).");
  assert.deepEqual(warnings([X, Y, killing('1795')].map((e) => (e.id === 'char-y' ? { ...e, born: '1780' } : e)), 'before-birth'), []);
});

test('participant-not-existing: factions and items outside their lifetime', () => {
  const faction = { id: 'f', type: 'faction', name: 'Guard', founded: '1930', dissolved: '1990' } as const;
  const ev = (date: string) => ({ id: `e${date}`, type: 'event', name: `Battle ${date}`, date, participants: [{ id: 'f' }] }) as const;
  assert.deepEqual(warnings([faction, ev('1920'), ev('1950'), ev('2000')], 'participant-not-existing').map((w) => w.message), [
    `Guard can't take part in "Battle 1920" in 1920: Guard was founded in 1930 (source: Factions/Guard).`,
    `Guard can't take part in "Battle 2000" in 2000: Guard was dissolved in 1990 (source: Factions/Guard).`,
  ]);
  const item = { id: 'i', type: 'item', name: 'Sword', created: '1500', destroyed: '1600' } as const;
  assert.equal(warnings([item, { id: 'e', type: 'event', name: 'Duel', date: '1650', participants: [{ id: 'i' }] }], 'participant-not-existing').length, 1);
});

test('place-not-existing: events and stays at a place that is gone or not built yet', () => {
  const place = { id: 'p', type: 'place', name: 'Gate', founded: '1500', destroyed: '1850' } as const;
  const msgs = warnings([
    place,
    { id: 'e', type: 'event', name: 'Toll', date: '1900', place: 'p' },
    { id: 'e2', type: 'event', name: 'Fine', date: '1600', place: 'p' },
    { id: 'c', type: 'character', name: 'C', locations: [{ place: 'Gate', from: '1400', to: '1450' }] },
  ], 'place-not-existing').map((w) => w.message);
  assert.deepEqual(msgs.sort(), [
    `"Toll" can't happen at Gate in 1900: Gate was destroyed in 1850 (source: Places/Gate).`,
    `C can't be in Gate from 1400 to 1450: Gate was founded in 1500 (source: Places/Gate).`,
  ]);
});

test('two-places-at-once: same day, different places; not for nested places or vague dates', () => {
  const places = [
    { id: 'region', type: 'place', name: 'Dunes' },
    { id: 'a', type: 'place', name: 'Qarim', partOf: 'region' },
    { id: 'b', type: 'place', name: 'Saltmere' },
  ] as const;
  const c = { id: 'c', type: 'character', name: 'Kadir' } as const;
  const ev = (id: string, date: string, place: string) => ({ id, type: 'event', name: id, date, place, participants: [{ id: 'c' }] }) as const;
  const [w, ...more] = warnings([...places, c, ev('e1', '1920-03-12', 'a'), ev('e2', '1920-03-12', 'b')], 'two-places-at-once');
  assert.equal(more.length, 0);
  assert.equal(w?.message, `Kadir can't take part in "e1" at Qarim on 12.03.1920 and also take part in "e2" at Saltmere on 12.03.1920: those overlap in time (source: Events/e2).`);
  assert.equal(w?.severity, 'warning');
  assert.deepEqual(warnings([...places, c, ev('e1', '1920-03-12', 'a'), ev('e2', '1920-03-12', 'region')], 'two-places-at-once'), []);
  assert.deepEqual(warnings([...places, c, ev('e1', '1920', 'a'), ev('e2', '1920', 'b')], 'two-places-at-once'), []);
  const stays = { ...c, locations: [{ place: 'a', from: '1900', to: '1915' }, { place: 'b', from: '1910', to: '1920' }] };
  assert.equal(warnings([...places, stays], 'two-places-at-once').length, 1);
});

test('dangling-reference: fields and text links that point nowhere', () => {
  const msgs = warnings([
    { id: 'n', type: 'note', name: 'Songs', body: 'Of [[The Lost Oasis]], [[n|itself]] and @nobody, mail a@b.com.' },
    { id: 'c', type: 'character', name: 'C', relations: [{ type: 'ally-of', target: 'ghost' }] },
  ], 'dangling-reference').map((w) => w.message);
  assert.deepEqual(msgs, [
    `C mentions "ghost" (relations[0]), but no entry has that id or name (source: Characters/C).`,
    `Songs mentions "nobody" (in the text), but no entry has that id or name (source: Notes/Songs).`,
    `Songs mentions "The Lost Oasis" (in the text), but no entry has that id or name (source: Notes/Songs).`,
  ]);
});

test('duplicate-name: names and aliases shared by two entries, ignoring case', () => {
  const [w, ...rest] = warnings([
    { id: 'c', type: 'character', name: 'Kadir', aliases: ['The Red Wind'] },
    { id: 'f', type: 'faction', name: 'the red wind' },
    { id: 'c2', type: 'character', name: 'Ilsa', aliases: ['Ilsa'] },
  ], 'duplicate-name');
  assert.equal(rest.length, 0);
  assert.equal(w?.message, `"the red wind" names both Factions/the red wind and Characters/Kadir (source: Characters/Kadir).`);
});

test('parent-cycle: A parent of B and B parent of A, child-of counts too, and self-parenting', () => {
  const a = { id: 'a', type: 'character', name: 'Mira', relations: [{ type: 'parent-of', target: 'b' }] } as const;
  const b = { id: 'b', type: 'character', name: 'Tarik', relations: [{ type: 'parent-of', target: 'a' }] } as const;
  const [w, ...rest] = warnings([a, b], 'parent-cycle');
  assert.equal(rest.length, 0, 'one warning per cycle');
  assert.equal(w?.message, "Mira can't be the parent of Tarik: Tarik is already the parent of Mira (source: Characters/Tarik).");
  const grand = warnings([a, { id: 'b', type: 'character', name: 'Tarik' }, { id: 'c', type: 'character', name: 'C', relations: [{ type: 'child-of', target: 'b' }, { type: 'parent-of', target: 'a' }] }], 'parent-cycle');
  assert.equal(grand.length, 1);
  assert.match(grand[0]!.message, /is already an ancestor of/);
  assert.equal(warnings([{ id: 's', type: 'character', name: 'S', relations: [{ type: 'parent-of', target: 's' }] }], 'parent-cycle')[0]?.message, "S can't be their own parent (source: Characters/S).");
  assert.deepEqual(warnings([a, { id: 'b', type: 'character', name: 'Tarik' }], 'parent-cycle'), []);
});

test('parent-born-after-child', () => {
  const [w] = warnings([
    { id: 'h', type: 'character', name: 'Hadi', born: '1930', relations: [{ type: 'parent-of', target: 'l' }] },
    { id: 'l', type: 'character', name: 'Leyla', born: '1900' },
  ], 'parent-born-after-child');
  assert.equal(w?.message, "Hadi can't be the parent of Leyla: Hadi was born in 1930, after Leyla was born in 1900 (source: Characters/Leyla).");
  assert.deepEqual(warnings([{ id: 'h', type: 'character', name: 'Hadi', born: '1870', relations: [{ type: 'parent-of', target: 'l' }] }, { id: 'l', type: 'character', name: 'Leyla', born: '1900' }], 'parent-born-after-child'), []);
});

test('dead-marked-alive: from a death date or from being killed', () => {
  assert.equal(warnings([{ id: 'z', type: 'character', name: 'Zehra', died: '1890', status: 'alive' }], 'dead-marked-alive')[0]?.message, 'Zehra is marked alive, but Zehra died in 1890 (source: Characters/Zehra).');
  const killed = warnings([X, { ...Y, status: 'alive' }, killing('1795')], 'dead-marked-alive');
  assert.equal(killed[0]?.message, 'Y is marked alive, but Y was killed by X in 1795 (source: Events/The Killing).');
  assert.deepEqual(warnings([{ id: 'z', type: 'character', name: 'Zehra', status: 'alive' }], 'dead-marked-alive'), []);
});

test('invalid-date and date-order', () => {
  assert.equal(warnings([{ id: 'i', type: 'item', name: 'Compass', created: '1750 XX' }], 'invalid-date')[0]?.message, `Compass, created: "1750 XX" uses an unknown era "XX". Known eras: OK, AS (source: Items/Compass).`);
  assert.deepEqual(warnings([{ id: 'p', type: 'place', name: 'Tower', founded: '1700', destroyed: '1650' }, { id: 'c', type: 'character', name: 'C', relations: [{ type: 'ally-of', target: 'p', from: '1900', to: '1800' }] }], 'date-order').map((w) => w.message), [
    `C's "ally-of" Tower ends in 1800, before it starts in 1900 (source: Characters/C).`,
    'Tower was destroyed in 1650, before Tower was founded in 1700 (source: Places/Tower).',
  ]);
});

test('file-error: unreadable files are reported, the rest still loads', () => {
  const w = world([X]);
  w.issues.push({ file: 'notes/broken.md', message: 'Missing "name".' });
  const ws = new RuleRegistry(builtinRules).check(w).filter((x) => x.ruleId === 'file-error');
  assert.equal(ws[0]?.message, 'notes/broken.md: Missing "name".');
});

test('a warning marked intended stays visible, is flagged, and sorts last', () => {
  const id = 'after-death:evt-k:char-x';
  const ws = warnings([X, Y, killing('1920'), { id: 'z', type: 'character', name: 'Z', died: '1', status: 'alive' }], undefined, { intended: [{ warningId: id, note: 'Resurrection' }] });
  assert.equal(ws.at(-1)?.id, id);
  assert.deepEqual(ws.at(-1)?.intended, { warningId: id, note: 'Resurrection' });
  assert.equal(ws[0]?.intended, undefined);
});

test('world.json can change a rule severity or turn it off', () => {
  const drafts = [X, Y, killing('1920')];
  assert.equal(warnings(drafts, 'after-death', { manifest: { rules: { 'after-death': 'warning' } } })[0]?.severity, 'warning');
  assert.deepEqual(warnings(drafts, 'after-death', { manifest: { rules: { 'after-death': 'off' } } }), []);
});

test('custom rules can be registered; ids must be unique', () => {
  const noSecrets: Rule = {
    id: 'no-secret-tag', title: 'No secrets', description: 'Entries tagged secret get an info note.', severity: 'info',
    check: ({ ix }) => ix.entries.filter((e) => e.tags?.includes('secret')).map((e) => ({ key: e.id, message: `${e.name} is secret.`, offending: ix.fact(e, 'tags') })),
  };
  const reg = new RuleRegistry(builtinRules).register(noSecrets);
  const ws = reg.check(world([{ id: 'n', type: 'note', name: 'Plot', tags: ['secret'] }]));
  assert.deepEqual(ws.map((w) => [w.id, w.severity]), [['no-secret-tag:n', 'info']]);
  assert.throws(() => reg.register(noSecrets), /already registered/);
});

test('a clean world has no warnings', () => {
  assert.deepEqual(warnings([X, Y, { id: 'e', type: 'event', name: 'Met', date: '1795', participants: [{ id: 'char-x' }] }]), []);
});

test('image-view: an unusual view label is info, usual views for the type are fine', () => {
  const ws = warnings([
    { id: 'item-a', type: 'item', name: 'A', images: [{ file: 'a.png', view: 'top' }, { file: 'b.png', view: 'a-pose' }] },
    { id: 'char-b', type: 'character', name: 'B', images: [{ file: 'c.png', view: 'a-pose' }, { file: 'd.png', view: 'fornt' }] },
    { id: 'place-c', type: 'place', name: 'C', images: [{ file: 'e.png', view: 'establishing' }] },
  ], 'image-view');
  assert.deepEqual(ws.map((w) => [w.id, w.severity]), [['image-view:char-b:1', 'info'], ['image-view:item-a:1', 'info']].sort());
  assert.match(ws.find((w) => w.id === 'image-view:item-a:1')!.message, /"a-pose", which is not a usual view for an item \(usual: Front, Back, Side, Top, Detail, Concept\)/);
});

test('a dated note is checked like any other date', () => {
  assert.equal(warnings([{ id: 'note-a', type: 'note', name: 'A', date: '1750 XX' }], 'invalid-date').length, 1);
});

test('partial dates: warn only when the known parts prove the conflict', () => {
  const dead = (died: string) => ({ ...X, died });
  assert.deepEqual(warnings([dead('1800'), Y, killing('12.03.1800')], 'after-death'), [], 'died some time in 1800');
  assert.deepEqual(warnings([dead('05.1800'), Y, killing('1800')], 'after-death'), []);
  const [w] = warnings([dead('05.1800'), Y, killing('12.06.1800')], 'after-death');
  assert.equal(w?.message, "X can't kill Y on 12.06.1800: X died in 05.1800 (source: Characters/X).");
  assert.deepEqual(warnings([dead('12.03'), Y, killing('1920')], 'after-death'), [], 'a day and month without a year proves nothing');
  assert.deepEqual(warnings([dead('12.03')], 'invalid-date'), []);
  assert.equal(warnings([{ ...X, born: '20.05.1800', died: '19.05.1800' }], 'date-order').length, 1);
  assert.equal(warnings([{ ...X, born: '05.1800', died: '1800' }], 'date-order').length, 0);
});
