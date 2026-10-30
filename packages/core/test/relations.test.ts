import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENTRY_TYPES, RELATION_KINDS, relationKind, relationKindsFor, relationTargets, inverseLabel } from '@lore-forge/core';
import { warnings } from './helpers.ts';

test('relation table: family types are character to character only', () => {
  for (const t of ['parent-of', 'child-of', 'spouse-of', 'sibling-of']) {
    const k = relationKind(t)!;
    assert.deepEqual([k.from, k.to], [['character'], ['character']], t);
  }
  assert.ok(!relationKindsFor('item').some((k) => k.group === 'family'));
  assert.ok(!relationKindsFor('item', 'character').some((k) => k.type === 'parent-of'));
});

test('relation table: required pairings', () => {
  const fits = (type: string, from: string, to: string) => relationKindsFor(from as never, to as never).some((k) => k.type === type);
  assert.ok(fits('member-of', 'character', 'faction'));
  assert.ok(!fits('member-of', 'character', 'place'));
  for (const [f, t] of [['character', 'place'], ['character', 'faction'], ['faction', 'place'], ['faction', 'faction']]) assert.ok(fits('rules', f!, t!), `rules ${f}->${t}`);
  assert.ok(!fits('rules', 'item', 'place'));
  assert.ok(fits('owns', 'character', 'item') && fits('wields', 'character', 'item'));
  assert.ok(!fits('wields', 'place', 'item'));
  assert.ok(fits('located-in', 'place', 'place') && fits('located-in', 'item', 'place'));
  assert.ok(fits('ally-of', 'faction', 'character') && fits('enemy-of', 'character', 'faction'));
  assert.ok(!fits('enemy-of', 'item', 'character'));
  assert.ok(fits('part-of', 'event', 'event') && !fits('part-of', 'event', 'place'));
  assert.ok(fits('took-place-at', 'event', 'place'));
  assert.equal(relationKind('allied-with')?.type, 'ally-of');
});

test('relation table: every type has a target, inverse labels, and unique type names', () => {
  const names = RELATION_KINDS.flatMap((k) => [k.type, ...(k.aliases ?? [])]);
  assert.equal(new Set(names).size, names.length);
  for (const t of ENTRY_TYPES) assert.ok(relationKindsFor(t).length > 0, t);
  assert.equal(inverseLabel('parent-of'), 'child of');
  assert.deepEqual(relationTargets('member-of', 'character'), ['faction']);
  assert.deepEqual(relationTargets('part-of', 'place'), ['place']);
  assert.deepEqual(relationTargets('wields', 'place'), []);
  assert.equal(relationTargets('my-custom', 'item').length, ENTRY_TYPES.length);
});

test('relation-kind rule flags nonsense relations and leaves good or custom ones alone', () => {
  const ws = warnings([
    { id: 'i', type: 'item', name: 'Compass', relations: [{ type: 'parent-of', target: 'c' }, { type: 'located-in', target: 'p' }, { type: 'haunts', target: 'c' }] },
    { id: 'c', type: 'character', name: 'Leyla', relations: [{ type: 'member-of', target: 'p' }, { type: 'wields', target: 'i' }] },
    { id: 'p', type: 'place', name: 'Qarim' },
  ], 'relation-kind');
  assert.deepEqual(ws.map((w) => `${w.offending.entryId}:${w.offending.field}`).sort(), ['c:relations[0]', 'i:relations[0]']);
  assert.match(ws.find((w) => w.offending.entryId === 'i')!.message, /Compass \(item\) is "parent-of" Leyla \(character\), but "parent-of" only goes from a character to a character/);
});
