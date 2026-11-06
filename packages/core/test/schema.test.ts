import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { check, report, serializeStoryIgnored, snapshot } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';

const schemaDir = join(import.meta.dirname, '..', 'schemas');
const exampleDir = join(import.meta.dirname, '..', '..', '..', 'worlds', 'camelamamm');
const ajv = new Ajv2020({ allErrors: true });
for (const f of readdirSync(schemaDir)) ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, f), 'utf8')));
const base = 'https://lore-forge.local/schemas/v1/';
const valid = (schema: string, data: unknown): void => {
  const v = ajv.getSchema(base + schema)!;
  assert.ok(v(data), `${schema}: ${ajv.errorsText(v.errors)}`);
};

test('the example world files match the published JSON Schemas', async () => {
  valid('world-manifest.schema.json', JSON.parse(readFileSync(join(exampleDir, 'world.json'), 'utf8')));
  valid('intended.schema.json', JSON.parse(readFileSync(join(exampleDir, 'intended.json'), 'utf8')));
  // The schema checks date syntax only; "1750 XX" is well-formed and its unknown era is caught by the invalid-date rule.
  const w = await loadWorld(exampleDir);
  for (const { body: _body, ...front } of w.entries) valid('entry.schema.json', front);
  assert.ok(w.story?.length, 'the example has a story chapter');
  for (const ch of w.story!) valid('story-chapter.schema.json', { title: ch.title, order: ch.order, ...(ch.date ? { date: ch.date } : {}), ...ch.extra });
  valid('story-ignored.schema.json', JSON.parse(serializeStoryIgnored([{ key: 'create:character:baran', name: 'Baran', ignoredAt: '2026-10-30' }])));
});

test('lore export and lore check --json output match their schemas', async () => {
  const world = await loadWorld(exampleDir);
  valid('world-snapshot.schema.json', JSON.parse(JSON.stringify(snapshot(world))));
  valid('check-report.schema.json', JSON.parse(JSON.stringify(report(world, check(world)))));
});

test('the schema rejects a bad entry', () => {
  const v = ajv.getSchema(base + 'entry.schema.json')!;
  assert.equal(v({ id: 'a', type: 'dragon', name: 'A' }), false);
  assert.equal(v({ id: 'a', type: 'character', name: 'A', born: 'next spring' }), false);
});

test('world.json cover settings: colours with alpha, emblem, picture and title style', () => {
  const manifest = JSON.parse(readFileSync(join(exampleDir, 'world.json'), 'utf8'));
  valid('world-manifest.schema.json', { ...manifest, cover: { color: '#336699cc', color2: '#112233', icon: 'castle', iconColor: '#e0bd6a', image: 'none', titleStyle: 'serif', titleColor: '#ffcc00' } });
  const bad = ajv.getSchema(`${base}world-manifest.schema.json`)!;
  assert.equal(bad({ ...manifest, cover: { titleStyle: 'gothic' } }), false);
  assert.equal(bad({ ...manifest, cover: { color: 'red' } }), false);
});

test('world.json book settings: the right-hand chapters switch is a boolean', () => {
  const manifest = JSON.parse(readFileSync(join(exampleDir, 'world.json'), 'utf8'));
  valid('world-manifest.schema.json', { ...manifest, book: { ...manifest.book, rightHandChapters: true } });
  assert.equal(ajv.getSchema(`${base}world-manifest.schema.json`)!({ ...manifest, book: { rightHandChapters: 'yes' } }), false);
});

test('every entry in the sample world has at least one image, and every image file is there', async () => {
  const w = await loadWorld(exampleDir);
  assert.ok(w.entries.length > 0);
  const missing = w.entries.filter((e) => !e.images?.length).map((e) => e.id);
  assert.deepEqual(missing, [], `sample entries without an image: ${missing.join(', ')}`);
  for (const e of w.entries) for (const img of e.images ?? []) assert.ok(existsSync(join(exampleDir, img.file)), `${e.id}: ${img.file} is missing`);
  // The sample's cover has its own picture, so its emblem is hidden (the title stays).
  assert.equal(w.manifest.cover?.showEmblem, false);
  assert.notEqual(w.manifest.cover?.showTitle, false);
});

test('world.json book settings: page sizes, drop cap, date stamps and the look', () => {
  const manifest = JSON.parse(readFileSync(join(exampleDir, 'world.json'), 'utf8'));
  const v = ajv.getSchema(`${base}world-manifest.schema.json`)!;
  const look = { trim: 'a4', dropCap: 'none', dateStamps: false, bodyFont: 'EB Garamond', bodySize: 11, bodyColor: '#101010', chapterFont: 'Cinzel Decorative', chapterSize: 24, chapterColor: '#402010', lineSpacing: 1.6, margins: 'narrow', coverTitleColor: '#ffeecc', coverTitleSize: 120, authorSize: 90 };
  valid('world-manifest.schema.json', { ...manifest, book: { ...manifest.book, ...look } });
  valid('world-manifest.schema.json', { ...manifest, book: { ...manifest.book, trim: 'letter', dropCap: 'dropped' } });
  for (const bad of [{ dropCap: 'huge' }, { bodySize: 99 }, { bodyColor: 'red' }, { margins: 'tiny' }, { trim: 'a3' }]) assert.equal(v({ ...manifest, book: bad }), false, JSON.stringify(bad));
});
