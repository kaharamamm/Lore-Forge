import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorld } from '@lore-forge/core/node';
import { builtinRules } from '@lore-forge/core';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
/** The test world that breaks canon on purpose (every rule fires once); see its README. Not on the app's shelf. */
const example = join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'test', 'fixtures', 'shifting-sands');
/** The sample world that ships in worlds/: a written story with a chronicle appendix. */
const camelamamm = join(import.meta.dirname, '..', '..', '..', 'worlds', 'camelamamm');
const lore = (...args: string[]) => spawnSync(process.execPath, ['--conditions=source', main, ...args], { encoding: 'utf8' });

test('lore check on the example world prints every starter rule and exits 1', () => {
  const r = lore('check', example);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /Orsan the Grey can't kill Queen Ilsa in 1920: Orsan the Grey died in 1800 \(source: Characters\/Orsan the Grey\)\./);
  for (const rule of builtinRules) assert.match(r.stdout, new RegExp(`\\[${rule.id}\\]`), `rule ${rule.id} should fire on the example world`);
  assert.match(r.stdout, /INTENDED \[after-death\] Nur the Twice-Born/);
  assert.match(r.stdout, /10 errors, 9 warnings, 2 info, 1 marked intended/);
  assert.match(r.stdout, /\[story-contradiction\] The story says Orsan the Grey was born in 1745, but Characters\/Orsan the Grey says 1740\.\n\s+at Story\/The Salt Road \(story\/01-the-salt-road\.md\): "Orsan the Grey was born in 1745/);
});

test('lore check --json prints a versioned report', () => {
  const r = lore('check', example, '--json');
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(report.counts, { error: 10, warning: 9, info: 2, intended: 1 });
  // Every starter rule fires once in the example, plus the story check (story/01-the-salt-road.md).
  assert.equal(new Set(report.warnings.map((w: { ruleId: string }) => w.ruleId)).size, builtinRules.length + 1);
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
  const codex = lore('codex', camelamamm, '-o', join(dir, 'codex.pdf'));
  assert.equal(codex.status, 0, codex.stdout + codex.stderr);
  assert.match(codex.stdout, /codex\.pdf \(\d+ pages\)\nWrote .*codex\.md/);
  const alias = lore('bible', camelamamm, '-o', join(dir, 'old-name.pdf'));
  assert.equal(alias.status, 0, 'lore bible still works');
  assert.match(readFileSync(join(dir, 'old-name.md'), 'utf8'), /World Codex/);
  assert.equal(readFileSync(join(dir, 'codex.pdf')).subarray(0, 5).toString(), '%PDF-');
  assert.match(readFileSync(join(dir, 'codex.md'), 'utf8'), /3D turnaround brief/);
  const book = lore('book', camelamamm, '--out', join(dir, 'book.pdf'));
  assert.equal(book.status, 0, book.stdout + book.stderr);
  assert.ok(existsSync(join(dir, 'book.pdf')));
  assert.match(readFileSync(join(dir, 'book.md'), 'utf8'), /## Chapter 1\. The Morning the Well Went Quiet[\s\S]*## Appendix: Chronicle[\s\S]*#### The Passing of Ozra/);
  assert.equal(lore('book', camelamamm, '-o').status, 2);
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

test('lore duplicate copies a world with a new name and id', () => {
  const into = mkdtempSync(join(tmpdir(), 'lore-dup-'));
  const r = lore('duplicate', camelamamm, 'Camel Copy', '--into', into);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Duplicated .* as "Camel Copy" \(id camel-copy\)/);
  const manifest = JSON.parse(readFileSync(join(into, 'camel-copy', 'world.json'), 'utf8'));
  assert.equal(manifest.id, 'camel-copy');
  assert.ok(existsSync(join(into, 'camel-copy', 'images', 'cover.png')));
  const again = lore('duplicate', join(into, 'camel-copy'));
  assert.equal(again.status, 0, again.stdout);
  assert.equal(JSON.parse(readFileSync(join(into, 'camel-copy-copy', 'world.json'), 'utf8')).name, 'Camel Copy (copy)');
  assert.equal(lore('duplicate', camelamamm, 'a', 'b').status, 2);
});

test('lore mcp serves the Lore-Forge tools over stdin/stdout and writes books into the library', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const home = mkdtempSync(join(tmpdir(), 'lore-mcp-cli-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--conditions=source', main, 'mcp'],
    env: { ...(process.env as Record<string, string>), LORE_FORGE_DATA: join(home, 'data'), LORE_FORGE_WORLDS: join(home, 'worlds') },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'cli-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, 'lore-forge');
    assert.ok((await client.listTools()).tools.some((t) => t.name === 'write_chapter'));
    const made = await client.callTool({ name: 'create_book', arguments: { name: 'Stdio Book' } });
    assert.ok(!made.isError, JSON.stringify(made.content));
    assert.ok(existsSync(join(home, 'worlds', 'stdio-book', 'world.json')));
    const ch = await client.callTool({ name: 'write_chapter', arguments: { book: 'Stdio Book', title: 'One', text: 'Queen Mira was born in 12.' } });
    assert.match((ch.content as { text: string }[])[0]!.text, /"name": "Mira"/);
  } finally {
    await client.close();
    rmSync(home, { recursive: true, force: true });
  }
});
