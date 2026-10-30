import assert from 'node:assert/strict';
import { test } from 'node:test';
import { endFieldVisible, isEnded, parseEntry, serializeEntry, type Entry } from '@lore-forge/core';
import { warnings } from './helpers.ts';

const ent = (x: Record<string, unknown>) => ({ body: '', ...x }) as unknown as Entry;

test('end-date field shows only for ended status, or when no status hides it and a value exists', () => {
  assert.equal(endFieldVisible(ent({ id: 'a', type: 'character', name: 'A', status: 'alive', died: '1890' })), false);
  assert.equal(endFieldVisible(ent({ id: 'a', type: 'character', name: 'A', status: 'dead' })), true);
  assert.equal(endFieldVisible(ent({ id: 'a', type: 'character', name: 'A' })), false);
  assert.equal(endFieldVisible(ent({ id: 'a', type: 'character', name: 'A', died: '1890' })), true);
  assert.equal(endFieldVisible(ent({ id: 'p', type: 'place', name: 'P', status: 'standing', destroyed: '1650' })), false);
  assert.equal(endFieldVisible(ent({ id: 'p', type: 'place', name: 'P', status: 'destroyed' })), true);
  assert.equal(endFieldVisible(ent({ id: 'f', type: 'faction', name: 'F', status: 'dissolved' })), true);
  assert.equal(endFieldVisible(ent({ id: 'i', type: 'item', name: 'I', status: 'lost' })), false);
  assert.equal(endFieldVisible(ent({ id: 'e', type: 'event', name: 'E' })), false);
  assert.equal(isEnded(ent({ id: 'a', type: 'character', name: 'A', died: '1890' })), true);
  assert.equal(isEnded(ent({ id: 'a', type: 'character', name: 'A', status: 'alive', died: '1890' })), false);
});

test('a hidden end date stays in the file', () => {
  const e = ent({ id: 'p', type: 'place', name: 'P', status: 'standing', destroyed: '1650' });
  const back = parseEntry(serializeEntry(e));
  assert.deepEqual(back.problems, []);
  assert.equal((back.entry as { destroyed?: string }).destroyed, '1650');
});

test('status values are checked per type', () => {
  assert.deepEqual(parseEntry('---\nid: p\ntype: place\nname: P\nstatus: alive\n---\n').problems, ['"status" must be standing, destroyed or unknown.']);
  assert.deepEqual(parseEntry('---\nid: i\ntype: item\nname: I\nstatus: lost\n---\n').problems, []);
});

test('dead-marked-alive covers standing places, active factions and intact items with an end date', () => {
  const ws = warnings([
    { id: 'p', type: 'place', name: 'Watchtower', status: 'standing', destroyed: '1650' },
    { id: 'f', type: 'faction', name: 'Court', status: 'active', dissolved: '1920' },
    { id: 'i', type: 'item', name: 'Compass', status: 'lost', destroyed: '1900' },
    { id: 'c', type: 'character', name: 'Zehra', status: 'alive', died: '1890' },
  ], 'dead-marked-alive');
  assert.deepEqual(ws.map((w) => w.offending.entryId).sort(), ['c', 'f', 'p']);
  assert.match(ws.find((w) => w.offending.entryId === 'p')!.message, /Watchtower is marked standing, but was destroyed in 1650/);
});

test('status is never empty: a file without one reads as unknown; dead shows a tombstone', async () => {
  const { statusOf, statusLabel, LIFECYCLE } = await import('@lore-forge/core');
  const c = { id: 'c', type: 'character', name: 'C', body: '' } as const;
  assert.equal(statusOf(c), 'unknown');
  assert.equal(statusLabel(c), 'Unknown');
  assert.equal(statusOf({ ...c, type: 'event' } as never), undefined);
  assert.equal(LIFECYCLE.character!.endedMark, '🪦');
});

test('race: parsed, saved, suggested from the world first', async () => {
  const { parseEntry, serializeEntry, raceSuggestions } = await import('@lore-forge/core');
  const text = '---\nid: char-a\ntype: character\nname: A\nrace: ghoul\n---\n';
  const r = parseEntry(text) as { entry?: { race?: string; extra?: unknown } };
  assert.equal(r.entry?.race, 'ghoul');
  assert.equal(r.entry?.extra, undefined);
  assert.match(serializeEntry(r.entry as never), /^race: ghoul$/m);
  const s = raceSuggestions([r.entry as never]);
  assert.equal(s[0], 'ghoul');
  assert.ok(s.includes('vampire') && s.includes('human'));
});

test('every status, race and type has a game-icon', async () => {
  const { ICONS, LIFECYCLE, TYPE_ICON, RELATION_GROUPS, raceIcon, DEFAULT_RACES } = await import('@lore-forge/core');
  for (const lc of Object.values(LIFECYCLE)) {
    for (const s of lc!.statuses) assert.ok(ICONS[s.icon], s.value);
    assert.ok(ICONS[lc!.endedIcon]);
  }
  assert.equal(LIFECYCLE.character!.statuses.find((s) => s.value === 'dead')!.icon, 'tombstone');
  for (const i of [...Object.values(TYPE_ICON), ...Object.values(RELATION_GROUPS).map((g) => g.icon), ...DEFAULT_RACES.map(raceIcon)]) assert.ok(ICONS[i], i);
  assert.equal(raceIcon('Vampires'), 'vampire-dracula');
  assert.equal(raceIcon('sand-wyrm'), 'hood');
});
