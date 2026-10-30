import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorld } from '@lore-forge/core/node';
import { builtinRules } from '@lore-forge/core';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const example = join(import.meta.dirname, '..', '..', '..', 'examples', 'shifting-sands');
const lore = (...args: string[]) => spawnSync(process.execPath, ['--conditions=source', main, ...args], { encoding: 'utf8' });

test('lore check on the example world prints every starter rule and exits 1', () => {
  const r = lore('check', example);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /Orsan the Grey can't kill Queen Ilsa in 1920: Orsan the Grey died in 1800 \(source: Characters\/Orsan the Grey\)\./);
  for (const rule of builtinRules) assert.match(r.stdout, new RegExp(`\\[${rule.id}\\]`), `rule ${rule.id} should fire on the example world`);
  assert.match(r.stdout, /INTENDED \[after-death\] Nur the Twice-Born/);
  assert.match(r.stdout, /10 errors, 4 warnings, 1 info, 1 marked intended/);
});

test('lore check --json prints a versioned report', () => {
  const r = lore('check', example, '--json');
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(report.counts, { error: 10, warning: 4, info: 1, intended: 1 });
  assert.equal(new Set(report.warnings.map((w: { ruleId: string }) => w.ruleId)).size, builtinRules.length);
});

test('lore export writes one deterministic snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lore-'));
  const out = join(dir, 'snap.json');
  const r = lore('export', example, '--out', out);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const snap = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(snap.format, 'lore-forge.world-snapshot');
  assert.equal(snap.schemaVersion, 1);
  assert.equal(snap.entries.length, 28);
  assert.equal(snap.entries.find((e: { entry: { id: string } }) => e.entry.id === 'char-orsan').dates.died.year, 1800);
  assert.equal(lore('export', example).stdout, readFileSync(out, 'utf8'), 'stdout and file output are identical');
});

test('lore codex and lore book write a PDF and a Markdown sidecar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lore-'));
  const codex = lore('codex', example, '-o', join(dir, 'codex.pdf'));
  assert.equal(codex.status, 0, codex.stdout + codex.stderr);
  assert.match(codex.stdout, /codex\.pdf \(\d+ pages\)\nWrote .*codex\.md/);
  const alias = lore('bible', example, '-o', join(dir, 'old-name.pdf'));
  assert.equal(alias.status, 0, 'lore bible still works');
  assert.match(readFileSync(join(dir, 'old-name.md'), 'utf8'), /World Codex/);
  assert.equal(readFileSync(join(dir, 'codex.pdf')).subarray(0, 5).toString(), '%PDF-');
  assert.match(readFileSync(join(dir, 'codex.md'), 'utf8'), /3D turnaround brief/);
  const book = lore('book', example, '--out', join(dir, 'book.pdf'));
  assert.equal(book.status, 0, book.stdout + book.stderr);
  assert.ok(existsSync(join(dir, 'book.pdf')));
  assert.match(readFileSync(join(dir, 'book.md'), 'utf8'), /## Chapter 4\. The Fall of Saltmere/);
  assert.equal(lore('book', example, '-o').status, 2);
});

test('a clean new world exits 0; bad usage and non-worlds exit 2', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lore-'));
  await createWorld(dir, 'Empty World');
  const ok = lore('check', dir);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /0 errors, 0 warnings/);
  assert.equal(lore('check').status, 2);
  const notWorld = lore('check', tmpdir());
  assert.equal(notWorld.status, 2);
  assert.match(notWorld.stdout, /no world.json/);
});
