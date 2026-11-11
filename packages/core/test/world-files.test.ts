import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { worldCoverArt } from '@lore-forge/core';
import { createWorld, deleteModel, duplicateWorld, importModel, listModels, loadWorld, readModel, renameModel } from '@lore-forge/core/node';

const sample = resolve(import.meta.dirname, '../../../worlds/camelamamm');

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'lore-files-'));
}

test('duplicateWorld copies the whole folder with a new name and id, keeping the cover', async () => {
  const parent = await tmp();
  const dir = await duplicateWorld(sample, parent, 'Camelamamm (copy)');
  assert.equal(dir, join(parent, 'camelamamm-copy'));
  const [a, b] = await Promise.all([loadWorld(sample), loadWorld(dir)]);
  assert.equal(b.manifest.id, 'camelamamm-copy');
  assert.equal(b.manifest.name, 'Camelamamm (copy)');
  const { seed, ...cover } = b.manifest.cover ?? {};
  assert.deepEqual(cover, a.manifest.cover ?? {}, 'every cover setting is kept');
  assert.equal(seed, 'camelamamm', 'the generated parts come from the original id');
  assert.deepEqual(worldCoverArt(b), worldCoverArt(a), 'the copy looks the same');
  assert.deepEqual(b.manifest.calendar, a.manifest.calendar);
  assert.equal(b.entries.length, a.entries.length);
  assert.equal(b.story?.length, a.story?.length);
  assert.deepEqual(await readdir(join(dir, 'images')), await readdir(join(sample, 'images')));
  // A second copy with the same name gets its own folder; the first is untouched.
  const again = await duplicateWorld(sample, parent, 'Camelamamm (copy)');
  assert.equal(again, join(parent, 'camelamamm-copy-2'));
  assert.equal(JSON.parse(await readFile(join(again, 'world.json'), 'utf8')).id, 'camelamamm-copy-2');
});

test('a Duplicate looks exactly like its original: set cover settings, generated colours and emblem, copies of copies', async () => {
  const root = await tmp();
  const full = join(root, 'full');
  const cover = { color: '#336699', color2: '#112233', icon: 'dragon-head', iconColor: '#ffcc00', image: 'images/cover.png', titleStyle: 'serif', titleColor: '#fbf3df', font: 'Pirata One', showTitle: false, showEmblem: false, titlePos: { x: 10, y: 90 }, emblemPos: { x: 80, y: 5 }, spineColor: '#223344', spineInk: '#eeeeee' };
  await createWorld(full, 'Full Cover', { cover });
  const plain = join(root, 'plain');
  await createWorld(plain, 'Plain Cover');
  for (const src of [full, plain]) {
    const a = await loadWorld(src);
    const copy = await loadWorld(await duplicateWorld(src, root, ''));
    assert.notEqual(copy.manifest.id, a.manifest.id);
    assert.equal(copy.manifest.name, `${a.manifest.name} (copy)`);
    const { seed, ...rest } = copy.manifest.cover ?? {};
    assert.deepEqual(rest, a.manifest.cover ?? {}, `${a.manifest.name}: every cover setting is kept`);
    assert.equal(seed, a.manifest.id);
    assert.deepEqual(worldCoverArt(copy), worldCoverArt(a), `${a.manifest.name}: same colours, emblem, picture, font, places and stars`);
    // Only the name and id change.
    const { id: _a, name: _b, cover: _c, ...others } = a.manifest;
    const { id: _d, name: _e, cover: _f, ...copyOthers } = copy.manifest;
    assert.deepEqual(copyOthers, others);
    // A copy of the copy still looks like the first one.
    const twice = await loadWorld(await duplicateWorld(join(root, copy.manifest.id), root, 'Twice'));
    assert.equal(twice.manifest.cover?.seed, a.manifest.id);
    assert.deepEqual(worldCoverArt(twice), worldCoverArt(a));
  }
  // Without the seed the id-generated cover differs, which is what the seed is for.
  const copy = await loadWorld(join(root, 'plain-cover-copy'));
  const { seed: _s, ...noSeed } = copy.manifest.cover ?? {};
  assert.notDeepEqual(worldCoverArt({ ...copy, manifest: { ...copy.manifest, cover: noSeed } }), worldCoverArt(await loadWorld(plain)));
});

test('duplicateWorld works from a read-only world and leaves it alone', async () => {
  const root = await tmp();
  const src = join(root, 'ro');
  await createWorld(src, 'Read Only');
  await writeFile(join(src, 'images', 'cover.png'), 'png');
  const before = await readFile(join(src, 'world.json'), 'utf8');
  await chmod(join(src, 'images', 'cover.png'), 0o444);
  await chmod(join(src, 'world.json'), 0o444);
  const dir = await duplicateWorld(src, join(root, 'worlds'), '  ');
  assert.equal(JSON.parse(await readFile(join(dir, 'world.json'), 'utf8')).name, 'Read Only (copy)');
  await writeFile(join(dir, 'images', 'cover.png'), 'new'); // the copy is writable
  assert.equal(await readFile(join(src, 'world.json'), 'utf8'), before);
});

test('models live in models/<entry-id>/, are optional, and can be renamed and deleted', async () => {
  const dir = await tmp();
  await createWorld(dir, 'Models');
  assert.deepEqual(await listModels(dir, 'char-pip'), []);
  const src = join(await tmp(), 'Pip Statue.GLB');
  await writeFile(src, 'glTF');
  const file = await importModel(dir, 'char-pip', src);
  assert.equal(file, 'models/char-pip/Pip Statue.glb');
  assert.equal(await importModel(dir, 'char-pip', src), 'models/char-pip/Pip Statue 2.glb');
  assert.deepEqual((await listModels(dir, 'char-pip')).map((m) => [m.name, m.bytes]), [['Pip Statue', 4], ['Pip Statue 2', 4]]);
  assert.equal((await readModel(dir, file)).toString(), 'glTF');
  const renamed = await renameModel(dir, file, '../Pip: bronze');
  assert.equal(renamed, 'models/char-pip/Pip bronze.glb');
  assert.ok(!existsSync(join(dir, file)));
  await deleteModel(dir, renamed);
  assert.deepEqual((await listModels(dir, 'char-pip')).map((m) => m.file), ['models/char-pip/Pip Statue 2.glb']);
});

test('model helpers refuse other files and paths outside models/', async () => {
  const dir = await tmp();
  await createWorld(dir, 'Guard');
  const txt = join(dir, 'notes.txt');
  await writeFile(txt, 'x');
  await assert.rejects(importModel(dir, 'char-pip', txt), /3D models must be/);
  await assert.rejects(importModel(dir, '../evil', join(dir, 'a.glb')), /Not an entry id/);
  await assert.rejects(deleteModel(dir, 'world.json'), /Not a model file/);
  await assert.rejects(readModel(dir, 'models/../world.json'), /Not a model file/);
  await mkdir(join(dir, 'models', 'char-pip'), { recursive: true });
  await writeFile(join(dir, 'models', 'char-pip', 'readme.txt'), 'x');
  assert.deepEqual(await listModels(dir, 'char-pip'), []);
});

test('a .gltf must carry its buffers inside; one pointing at other files is refused', async () => {
  const dir = await tmp();
  await createWorld(join(dir, 'w'), 'W');
  const ok = join(dir, 'ok.gltf');
  await writeFile(ok, JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'data:application/octet-stream;base64,AAAA', byteLength: 3 }] }));
  assert.equal(await importModel(join(dir, 'w'), 'char-a', ok), 'models/char-a/ok.gltf');
  const split = join(dir, 'split.gltf');
  await writeFile(split, JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'split.bin', byteLength: 3 }] }));
  await assert.rejects(importModel(join(dir, 'w'), 'char-a', split), /separate file \(split\.bin\).*\.glb/);
  await writeFile(split, 'not json');
  await assert.rejects(importModel(join(dir, 'w'), 'char-a', split), /not valid glTF/);
  assert.deepEqual((await listModels(join(dir, 'w'), 'char-a')).map((m) => m.name), ['ok']);
});

test('a new world from a template: its calendar, writing and picture style and fields; a bad calendar or field is refused', async () => {
  const root = await tmp();
  const dir = join(root, 'game');
  const calendar = { eras: [{ id: 'AL', name: 'Age of Legends', start: 1, end: 1000 }, { id: 'AH', name: 'Age of Heroes', start: 1001 }], defaultEra: 'AH' };
  const fields = { item: [{ key: 'damage', name: 'Damage', kind: 'number' as const }] };
  await createWorld(dir, 'Game', { calendar, writingStyle: ' Fast. ', artStyle: 'Pixel art', fields, cover: { color: '#2f5d3a' } });
  const w = await loadWorld(dir);
  assert.deepEqual(w.manifest.calendar, calendar);
  assert.equal(w.manifest.writingStyle, 'Fast.');
  assert.equal(w.manifest.artStyle, 'Pixel art');
  assert.deepEqual(w.manifest.fields, fields);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(dir, 'world.json'), 'utf8'))), ['schemaVersion', 'id', 'name', 'artStyle', 'writingStyle', 'calendar', 'fields', 'cover']);
  await assert.rejects(createWorld(join(root, 'bad'), 'Bad', { calendar: { eras: [{ id: '1A', name: 'X', start: 1 }], defaultEra: '1A' } }), /abbreviation must start with a letter/);
  await assert.rejects(createWorld(join(root, 'bad2'), 'Bad', { fields: { item: [{ key: 'size', name: 'Size', kind: 'choice' }] } }), /needs its "choices"/);
  assert.equal(existsSync(join(root, 'bad')) || existsSync(join(root, 'bad2')), false, 'nothing is written for a refused start');
});
