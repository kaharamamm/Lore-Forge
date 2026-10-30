import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { check, report, snapshot } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';

const schemaDir = join(import.meta.dirname, '..', 'schemas');
const exampleDir = join(import.meta.dirname, '..', '..', '..', 'examples', 'shifting-sands');
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
  for (const { body: _body, ...front } of (await loadWorld(exampleDir)).entries) valid('entry.schema.json', front);
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
