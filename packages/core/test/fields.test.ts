/** The book's own fields: world.json "fields", the values in entry files, the check, the Codex and game data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { customFields, fieldKey, parseEntry, parseManifest, serializeEntry, snapshot, worldCodex, type Block, type CustomField } from '@lore-forge/core';
import { warnings, world, type Draft } from './helpers.ts';

const FIELDS: Record<string, CustomField[]> = {
  character: [{ key: 'hp', name: 'HP', kind: 'number' }, { key: 'playable', name: 'Playable', kind: 'yes-no' }],
  item: [{ key: 'rarity', name: 'Rarity', kind: 'choice', choices: ['common', 'rare'] }, { key: 'maker', name: 'Maker', kind: 'text' }],
};
const base = '{"schemaVersion":1,"id":"a","name":"A","calendar":{"eras":[{"id":"Y","name":"Year","start":1}],"defaultEra":"Y"}';

test('world.json fields: usable fields kept, the rest set aside with an issue', () => {
  const r = parseManifest(`${base},"fields":{"character":[{"key":"hp","name":"HP","kind":"number"},{"key":"mood","name":"Mood"},{"key":"HP","name":"Again","kind":"number"},{"name":"No key"},{"key":"x","name":"X","kind":"colour"}],"item":[{"key":"rarity","name":"Rarity","kind":"choice","choices":["common"," rare ","common",""],"note":"kept"},{"key":"size","name":"Size","kind":"choice"}],"dragon":[],"place":"x"}}`);
  assert.deepEqual(r.manifest?.fields, {
    character: [{ key: 'hp', name: 'HP', kind: 'number' }, { key: 'mood', name: 'Mood', kind: 'text' }],
    item: [{ key: 'rarity', name: 'Rarity', kind: 'choice', choices: ['common', 'rare'], note: 'kept' }],
  });
  assert.equal(r.issues.length, 6, r.issues.join('\n'));
  assert.match(r.issues.join('\n'), /has the key of an earlier field \("HP"\)/);
  assert.match(r.issues.join('\n'), /"Size" in "fields.item" needs its "choices"/);
  assert.match(r.issues.join('\n'), /"dragon", which is not a type of entry/);
  assert.equal(parseManifest(`${base},"fields":[1]}`).issues.length, 1);
  assert.equal(parseManifest(`${base}}`).manifest?.fields, undefined);
});

test('values in an entry file: text, numbers and true or false; they are written back as they were read', () => {
  const file = '---\nid: char-a\ntype: character\nname: A\nfields:\n  hp: 30\n  code: "12"\n  playable: false\n  empty:\n  bad: [1, 2]\n---\n\nText.\n';
  const { entry, problems } = parseEntry(file);
  assert.deepEqual(entry?.fields, { hp: 30, code: '12', playable: false });
  assert.deepEqual(problems, ['"fields.bad" should be text, a number, or true or false.']);
  const again = parseEntry(serializeEntry(entry!)).entry!;
  assert.deepEqual(again.fields, { hp: 30, code: '12', playable: false }, 'the number stays a number and "12" stays text');
  assert.match(serializeEntry(entry!), /fields:\n {2}hp: 30\n {2}code: "12"\n {2}playable: false\n/);
  assert.deepEqual(parseEntry('---\nid: a\ntype: item\nname: A\nfields: 5\n---\n').problems, ['"fields" should be a set of "key: value" lines.']);
});

test('a key for a new field', () => {
  assert.equal(fieldKey('Hit points'), 'hitPoints');
  assert.equal(fieldKey('HP'), 'hp');
  assert.equal(fieldKey('Can puanı'), 'canPuani');
  assert.equal(fieldKey('Güç'), 'guc');
  assert.equal(fieldKey('2nd skill'), 'field2ndSkill');
  assert.equal(fieldKey('!!!'), 'field');
  assert.equal(fieldKey('HP', ['hp', 'HP2']), 'hp3');
});

test('field-value: a value that does not fit its field', () => {
  const drafts: Draft[] = [
    { id: 'char-a', type: 'character', name: 'Aras', fields: { hp: 'lots', playable: 'maybe', notes: 'not a field here' } },
    { id: 'char-b', type: 'character', name: 'Bora', fields: { hp: 12, playable: true } },
    { id: 'item-c', type: 'item', name: 'Crown', fields: { rarity: 'Legendary', maker: 42 } },
    { id: 'item-d', type: 'item', name: 'Dagger', fields: { rarity: 'rare' } },
  ];
  const found = warnings(drafts, 'field-value', { manifest: { fields: FIELDS } });
  assert.deepEqual(found.map((w) => [w.id, w.offending.field, w.severity]), [
    ['field-value:char-a:hp', 'fields.hp', 'warning'],
    ['field-value:char-a:playable', 'fields.playable', 'warning'],
    ['field-value:item-c:rarity', 'fields.rarity', 'warning'],
  ]);
  assert.deepEqual(found.map((w) => w.message), [
    'Aras: "HP" should be a number, not "lots" (source: Characters/Aras).',
    'Aras: "Playable" should be yes or no, not "maybe" (source: Characters/Aras).',
    'Crown: "Rarity" should be one of common, rare, not "Legendary" (source: Items/Crown).',
  ]);
  assert.deepEqual(warnings(drafts, 'field-value'), [], 'no fields in world.json: nothing to check');
});

test('the World Codex lists the fields in their order; game data has the fields and the values', () => {
  const w = world([
    { id: 'char-a', type: 'character', name: 'Aras', fields: { playable: true, hp: 30 } },
    { id: 'item-c', type: 'item', name: 'Crown', fields: { rarity: 'rare' } },
  ], { manifest: { fields: FIELDS } });
  assert.deepEqual(customFields(w.manifest, 'item').map((f) => f.key), ['rarity', 'maker']);
  const facts = (name: string): [string, string][] => {
    const blocks = worldCodex(w).blocks;
    const at = blocks.findIndex((b) => b.kind === 'heading' && b.text === name);
    return (blocks.slice(at).find((b) => b.kind === 'facts') as Extract<Block, { kind: 'facts' }>).rows;
  };
  const aras = facts('Aras');
  assert.deepEqual(aras.filter(([k]) => k === 'HP' || k === 'Playable'), [['HP', '30'], ['Playable', 'Yes']]);
  assert.equal(aras.findIndex(([k]) => k === 'HP') + 1, aras.findIndex(([k]) => k === 'Playable'), 'next to each other, in the order of world.json');
  assert.deepEqual(facts('Crown').filter(([k]) => k === 'Rarity' || k === 'Maker'), [['Rarity', 'rare']], 'an empty field is left out');
  const snap = snapshot(w);
  assert.deepEqual(snap.manifest.fields, FIELDS);
  assert.deepEqual(snap.entries.find((e) => e.entry.id === 'char-a')!.entry.fields, { playable: true, hp: 30 });
  // The published schemas take both.
  const dir = join(import.meta.dirname, '..', 'schemas');
  const ajv = new Ajv2020({ allErrors: true });
  for (const f of ['world-manifest', 'entry']) ajv.addSchema(JSON.parse(readFileSync(join(dir, `${f}.schema.json`), 'utf8')));
  const valid = (schema: string, data: unknown): void => {
    const v = ajv.getSchema(`https://lore-forge.local/schemas/v1/${schema}.schema.json`)!;
    assert.ok(v(data), `${schema}: ${ajv.errorsText(v.errors)}`);
  };
  valid('world-manifest', JSON.parse(JSON.stringify(w.manifest)));
  for (const { body: _b, ...front } of w.entries) valid('entry', front);
});
