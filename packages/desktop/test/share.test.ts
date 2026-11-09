/** A book as one file: packing it, opening it onto the shelf, and the files a book file may not write. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { bookFileArgs, bookPath, openBook, packBook, unpackBook } from '../src/main/share.ts';

const manifest = { schemaVersion: 1, id: 'salt-coast', name: 'The Salt Coast', calendar: { eras: [{ id: 'SR', name: 'Salt Reckoning', start: 1 }], defaultEra: 'SR' }, cover: { color: '#336699' } };
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'lore-share-'));
  const book = join(root, 'books', 'salt-coast');
  const put = async (rel: string, data: string | Buffer) => {
    await mkdir(dirname(join(book, rel)), { recursive: true });
    await writeFile(join(book, rel), data);
  };
  await put('world.json', JSON.stringify(manifest));
  await put('places/place-qarim.md', '---\nid: place-qarim\ntype: place\nname: Qarim\npins:\n  - map: coast\n    x: 40\n    y: 60\n---\n\nA port.\n');
  await put('images/place-qarim/establishing.png', PNG);
  await put('maps/coast.png', PNG);
  await put('story/01-the-tide.md', '---\ntitle: The Tide\norder: 1\n---\n\nIt rose.\n');
  // Never in a book file: exports, hidden files and folders, temporary files.
  await put('exports/the-salt-coast.pdf', '%PDF');
  await put('.git/HEAD', 'ref');
  await put('places/place-qarim.md.123.tmp', 'half');
  return { root, book, shelf: join(root, 'shelf') };
}

async function tree(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const d of await readdir(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...(await tree(dir, r)));
    else out.push(r);
  }
  return out.sort();
}

test('a book file holds the book under one folder, without exports, hidden or temporary files', async () => {
  const s = await setup();
  try {
    const file = join(s.root, 'The Salt Coast.loreforge');
    const r = await packBook(s.book, file);
    assert.equal(r.files, 5);
    assert.ok(r.bytes > 0);
    assert.deepEqual(Object.keys(unzipSync(readFileSync(file))).sort(), [
      'the-salt-coast/images/place-qarim/establishing.png', 'the-salt-coast/maps/coast.png', 'the-salt-coast/places/place-qarim.md',
      'the-salt-coast/story/01-the-tide.md', 'the-salt-coast/world.json',
    ]);
    assert.ok(!existsSync(`${file}.${process.pid}.tmp`), 'the file is written whole');
  } finally {
    await rm(s.root, { recursive: true, force: true });
  }
});

test('opening a book file puts the book on the shelf in a free folder, with its own id and the same cover', async () => {
  const s = await setup();
  try {
    const file = join(s.root, 'book.loreforge');
    await packBook(s.book, file);
    const first = await unpackBook(file, s.shelf);
    assert.deepEqual(first, { dir: join(s.shelf, 'the-salt-coast'), name: 'The Salt Coast' });
    assert.deepEqual(await tree(first.dir), ['images/place-qarim/establishing.png', 'maps/coast.png', 'places/place-qarim.md', 'story/01-the-tide.md', 'world.json']);
    assert.deepEqual(readFileSync(join(first.dir, 'images/place-qarim/establishing.png')), PNG);
    assert.equal(readFileSync(join(first.dir, 'places/place-qarim.md'), 'utf8'), readFileSync(join(s.book, 'places/place-qarim.md'), 'utf8'));
    const m = JSON.parse(readFileSync(join(first.dir, 'world.json'), 'utf8'));
    assert.equal(m.name, 'The Salt Coast');
    assert.equal(m.id, 'the-salt-coast');
    assert.equal(m.cover.color, '#336699');
    assert.equal(m.cover.seed, 'salt-coast', 'the cover keeps the look it had');
    // Opened again: a second book beside the first, with an id of its own.
    const second = await unpackBook(file, s.shelf);
    assert.equal(second.dir, join(s.shelf, 'the-salt-coast-2'));
    assert.equal(JSON.parse(readFileSync(join(second.dir, 'world.json'), 'utf8')).id, 'the-salt-coast-2');
  } finally {
    await rm(s.root, { recursive: true, force: true });
  }
});

test('a zip of a book folder made with another tool opens too, with world.json at the top or in one folder', async () => {
  const s = await setup();
  try {
    const flat = join(s.root, 'flat.zip');
    await writeFile(flat, zipSync({ 'world.json': strToU8(JSON.stringify({ ...manifest, name: 'Flat Book' })), 'notes/': new Uint8Array(0), 'notes/note-a.md': strToU8('---\nid: note-a\ntype: note\nname: A\n---\n') }));
    const book = await unpackBook(flat, s.shelf);
    assert.equal(book.name, 'Flat Book');
    assert.deepEqual(await tree(book.dir), ['notes/note-a.md', 'world.json']);
  } finally {
    await rm(s.root, { recursive: true, force: true });
  }
});

test('nothing is written outside the new book, and files that are not books are refused', async () => {
  const s = await setup();
  try {
    const evil = join(s.root, 'evil.loreforge');
    await writeFile(evil, zipSync({
      'b/world.json': strToU8(JSON.stringify({ ...manifest, name: 'Evil' })),
      'b/../../escaped.txt': strToU8('x'),
      'b/places/../../../escaped2.txt': strToU8('x'),
      'b/.hidden/run.sh': strToU8('x'),
      'b/C:/temp/drive.txt': strToU8('x'),
      'other/outside.txt': strToU8('x'),
      'b/places/place-ok.md': strToU8('---\nid: place-ok\ntype: place\nname: Ok\n---\n'),
    }));
    const book = await unpackBook(evil, s.shelf);
    assert.deepEqual(await tree(book.dir), ['places/place-ok.md', 'world.json']);
    assert.ok(!existsSync(join(s.root, 'escaped.txt')) && !existsSync(join(s.shelf, 'escaped.txt')) && !existsSync(join(s.root, 'escaped2.txt')));

    const noBook = join(s.root, 'photos.zip');
    await writeFile(noBook, zipSync({ 'a.png': PNG }));
    await assert.rejects(unpackBook(noBook, s.shelf), /not a Lore-Forge book: it has no world\.json/);
    const junk = join(s.root, 'junk.loreforge');
    await writeFile(junk, Buffer.from('this is not a zip file at all, just some text'.repeat(20)));
    await assert.rejects(unpackBook(junk, s.shelf), /not a Lore-Forge book/);
    const broken = join(s.root, 'broken.loreforge');
    await writeFile(broken, zipSync({ 'b/world.json': strToU8('{"name": "No calendar"}') }));
    await assert.rejects(unpackBook(broken, s.shelf), /cannot be opened: world\.json has schemaVersion/);
    assert.deepEqual((await readdir(s.shelf)).sort(), ['evil'], 'a refused file leaves no folder behind');
  } finally {
    await rm(s.root, { recursive: true, force: true });
  }
});

test('the same book file opened again gives the same book, while that book is still there', async () => {
  const { root, book, shelf } = await setup();
  try {
    const file = join(root, 'The Salt Coast.loreforge');
    await packBook(book, file);
    const known = join(root, 'data', 'book-files.json');
    const first = await openBook(file, shelf, known);
    // A copy of the file somewhere else is the same book file.
    const copy = join(root, 'Downloads', 'salt.loreforge');
    await mkdir(dirname(copy), { recursive: true });
    await writeFile(copy, readFileSync(file));
    assert.deepEqual(await openBook(copy, shelf, known), first);
    assert.equal((await readdir(shelf)).length, 1);
    // Another book file (a changed book) is a new copy; so is the same file once its book is gone.
    await writeFile(join(book, 'story', '02-the-ebb.md'), '---\ntitle: The Ebb\norder: 2\n---\n\nIt fell.\n');
    await packBook(book, file);
    const second = await openBook(file, shelf, known);
    assert.notEqual(second.dir, first.dir);
    await rm(first.dir, { recursive: true });
    const third = await openBook(copy, shelf, known);
    assert.ok(existsSync(join(third.dir, 'world.json')));
    assert.equal((await readdir(shelf)).length, 2);
    // A broken record of what was opened is only forgotten.
    await writeFile(known, '{ not json');
    assert.ok((await openBook(copy, shelf, known)).dir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('book files among the start arguments: only .loreforge files that exist, as full paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lore-args-'));
  try {
    await writeFile(join(root, 'a.loreforge'), 'x');
    await writeFile(join(root, 'B.LOREFORGE'), 'x');
    await writeFile(join(root, 'c.zip'), 'x');
    const args = ['--allow-file-access', 'a.loreforge', join(root, 'B.LOREFORGE'), 'c.zip', 'missing.loreforge', join(root, 'world')];
    assert.deepEqual(bookFileArgs(args, root), [join(root, 'a.loreforge'), join(root, 'B.LOREFORGE')]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the paths a book file may write', () => {
  assert.equal(bookPath('book/places/place-a.md', 'book/'), 'places/place-a.md');
  assert.equal(bookPath('book\\images\\a.png', 'book/'), 'images/a.png');
  assert.equal(bookPath('world.json', ''), 'world.json');
  for (const bad of ['book/', 'book/../x', 'book/a/../../x', 'book//x', 'book/./x', 'book/.git/HEAD', 'book/C:/x', 'other/x', '/etc/passwd', 'book/a\u0000b']) {
    assert.equal(bookPath(bad, 'book/'), null, bad);
  }
});
