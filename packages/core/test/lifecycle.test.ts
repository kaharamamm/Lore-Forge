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
