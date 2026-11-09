/** Book history: snapshots, what changed since one, restoring the book or one file, versions, and undoing an AI task. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BookHistory, frontName, KEEP_SNAPSHOTS } from '../src/main/history.ts';

const entry = (name: string, summary: string) => `---\nid: char-${name.toLowerCase()}\ntype: character\nname: ${name}\nsummary: ${summary}\n---\n\nText.\n`;

async function book() {
  const root = await mkdtemp(join(tmpdir(), 'lore-history-'));
  const dir = join(root, 'book');
  const put = async (rel: string, data: string | Buffer) => {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), data);
  };
  await put('world.json', '{"id":"b","name":"Book"}');
  await put('characters/char-ann.md', entry('Ann', 'A baker.'));
  await put('images/char-ann/front.png', Buffer.from([137, 80, 78, 71, 1, 2, 3]));
  // Never kept: exports, hidden files and folders, temporary files.
  await put('exports/book.pdf', '%PDF');
  await put('.git/HEAD', 'ref');
  await put('characters/char-ann.md.123.tmp', 'half');
  const read = (rel: string) => (existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), 'utf8') : null);
  return { root, dir, put, read, history: new BookHistory(dir, join(root, 'history')) };
}

test('snapshots keep the book files (not exports, hidden or temporary ones) and skip when nothing changed', async () => {
  const b = await book();
  try {
    const first = await b.history.snapshot('open');
    assert.equal(first?.count, 3);
    assert.equal(await b.history.snapshot('open'), null, 'nothing changed: no second snapshot');
    await b.put('characters/char-ann.md', entry('Ann', 'A baker and a spy.'));
    const second = await b.history.snapshot('auto');
    assert.ok(second && second.id !== first!.id);
    assert.ok(await b.history.snapshot('manual', 'Kept by hand'), 'a snapshot asked for is kept even without a change');
    assert.deepEqual((await b.history.list()).map((s) => s.reason), ['manual', 'auto', 'open']);
    assert.equal(await b.history.read(first!.id, 'characters/char-ann.md'), entry('Ann', 'A baker.'));
    assert.equal(await b.history.read(first!.id, 'exports/book.pdf'), null);
  } finally {
    await rm(b.root, { recursive: true, force: true });
  }
});

test('what changed since a snapshot, and restoring the whole book or one file (the book before is kept first)', async () => {
  const b = await book();
  try {
    const first = (await b.history.snapshot('open'))!;
    await b.put('characters/char-ann.md', entry('Ann', 'Changed.'));
    await b.put('characters/char-bo.md', entry('Bo', 'New.'));
    await rm(join(b.dir, 'images/char-ann/front.png'));
    const changes = await b.history.changes(first.id);
    assert.deepEqual(changes, [
      { path: 'characters/char-ann.md', state: 'changed', name: 'Ann' },
      { path: 'characters/char-bo.md', state: 'added', name: 'Bo' },
      { path: 'images/char-ann/front.png', state: 'removed' },
    ]);
    // One file only.
    assert.deepEqual(await b.history.restore(first.id, ['characters/char-ann.md'], 'Ann'), ['characters/char-ann.md']);
    assert.equal(b.read('characters/char-ann.md'), entry('Ann', 'A baker.'));
    assert.equal(b.read('characters/char-bo.md'), entry('Bo', 'New.'), 'the other files stay as they are');
    // The whole book: what came later goes, what was deleted comes back.
    const changed = await b.history.restore(first.id, undefined, 'the whole book');
    assert.deepEqual(changed.sort(), ['characters/char-bo.md', 'images/char-ann/front.png']);
    assert.equal(b.read('characters/char-bo.md'), null);
    assert.ok(existsSync(join(b.dir, 'images/char-ann/front.png')));
    assert.deepEqual(await b.history.restore(first.id), [], 'nothing left to change');
    // Each restore kept the book as it was first, so a restore can be taken back too.
    const list = await b.history.list();
    assert.deepEqual(list.map((s) => s.reason), ['restore', 'restore', 'open']);
    await b.history.restore(list[0]!.id);
    assert.equal(b.read('characters/char-bo.md'), entry('Bo', 'New.'));
  } finally {
    await rm(b.root, { recursive: true, force: true });
  }
});

test("a file's versions: each snapshot where it differs, and when it was gone", async () => {
  const b = await book();
  try {
    await b.history.snapshot('open');
    await b.put('characters/char-bo.md', entry('Bo', 'One.'));
    await b.history.snapshot('auto');
    await b.put('world.json', '{"id":"b","name":"Book 2"}');
    await b.history.snapshot('auto');
    await b.put('characters/char-bo.md', entry('Bo', 'Two.'));
    await b.history.snapshot('auto');
    await rm(join(b.dir, 'characters/char-bo.md'));
    await b.history.snapshot('auto');
    const versions = await b.history.versions('characters/char-bo.md');
    assert.deepEqual(versions.map((v) => v.exists), [false, true, true], 'newest first; no versions from before it existed');
    assert.equal(await b.history.read(versions[1]!.id, 'characters/char-bo.md'), entry('Bo', 'Two.'));
    assert.equal(await b.history.read(versions[2]!.id, 'characters/char-bo.md'), entry('Bo', 'One.'));
  } finally {
    await rm(b.root, { recursive: true, force: true });
  }
});

test('an Ask AI task: its changes are recorded (not what the app saved meanwhile) and can be undone', async () => {
  const b = await book();
  try {
    await b.put('characters/char-bo.md', entry('Bo', 'Here.'));
    await b.put('characters/char-cy.md', entry('Cy', 'Mine.'));
    const p = await b.history.begin();
    // The AI changes Ann, deletes Bo and adds Dee (in a new folder); the person edits Cy in the app meanwhile.
    await b.put('characters/char-ann.md', entry('Ann', 'Rewritten by the AI.'));
    await rm(join(b.dir, 'characters/char-bo.md'));
    await b.put('images/char-dee/young/front.png', Buffer.from([1, 2, 3]));
    await b.put('characters/char-cy.md', entry('Cy', 'Edited by me.'));
    p.app.add('characters/char-cy.md');
    const task = (await b.history.finish(p, 'Rewrite Ann, remove Bo, add a picture'))!;
    assert.deepEqual(task.files.map((f) => [f.path, !!f.before, !!f.after]), [
      ['characters/char-ann.md', true, true],
      ['characters/char-bo.md', true, false],
      ['images/char-dee/young/front.png', false, true],
    ]);
    assert.deepEqual(task.names, { 'characters/char-ann.md': 'Ann', 'characters/char-bo.md': 'Bo' }, 'names, also of the deleted entry');
    const ask = (await b.history.list()).find((s) => s.reason === 'ask')!;
    assert.equal(ask.label, 'Rewrite Ann, remove Bo, add a picture');
    assert.equal(ask.at, p.at, 'dated when the task began');
    const r = await b.history.undo(task.id);
    assert.deepEqual(r.conflicts, []);
    assert.equal(b.read('characters/char-ann.md'), entry('Ann', 'A baker.'));
    assert.equal(b.read('characters/char-bo.md'), entry('Bo', 'Here.'));
    assert.ok(!existsSync(join(b.dir, 'images/char-dee')), 'the folder it made is gone with its file');
    assert.equal(b.read('characters/char-cy.md'), entry('Cy', 'Edited by me.'), "the person's own edit stays");
    assert.deepEqual(await b.history.undo(task.id), { conflicts: [], changed: [] }, 'undone once');
    assert.equal((await b.history.list())[0]!.reason, 'undo', 'the book before the undo is kept');
    // Nothing changed: no task.
    assert.equal(await b.history.finish(await b.history.begin(), 'Just a question'), null);
  } finally {
    await rm(b.root, { recursive: true, force: true });
  }
});

test('undoing a task whose file changed again since asks first (a conflict), unless forced', async () => {
  const b = await book();
  try {
    const p = await b.history.begin();
    await b.put('characters/char-ann.md', entry('Ann', 'By the AI.'));
    const task = (await b.history.finish(p, 'Change Ann'))!;
    await b.put('characters/char-ann.md', entry('Ann', 'Then by me.'));
    assert.deepEqual(await b.history.undo(task.id), { conflicts: ['characters/char-ann.md'], changed: [] });
    assert.equal(b.read('characters/char-ann.md'), entry('Ann', 'Then by me.'), 'nothing changed yet');
    assert.deepEqual((await b.history.undo(task.id, true)).changed, ['characters/char-ann.md']);
    assert.equal(b.read('characters/char-ann.md'), entry('Ann', 'A baker.'));
  } finally {
    await rm(b.root, { recursive: true, force: true });
  }
});

test('old snapshots go past the limit, with the contents only they used; contents a task needs stay', async () => {
  const b = await book();
  try {
    const p = await b.history.begin();
    await b.put('characters/char-ann.md', entry('Ann', 'Task'));
    const task = (await b.history.finish(p, 'Task'))!;
    for (let i = 0; i < KEEP_SNAPSHOTS + 12; i++) {
      await b.put('characters/char-ann.md', entry('Ann', `Version ${i}`));
      await b.history.snapshot('auto');
    }
    const list = await b.history.list();
    assert.ok(list.length <= KEEP_SNAPSHOTS + 10 && list.length >= KEEP_SNAPSHOTS, `kept ${list.length}`);
    const blobs = readdirSync(join(b.root, 'history', 'blobs')).flatMap((d) => readdirSync(join(b.root, 'history', 'blobs', d)));
    assert.ok(blobs.length < KEEP_SNAPSHOTS + 12, `old contents were swept (${blobs.length} left)`);
    // The task's "before" contents were kept, so it can still be undone.
    await b.put('characters/char-ann.md', entry('Ann', 'Task'));
    assert.deepEqual((await b.history.undo(task.id)).changed, ['characters/char-ann.md']);
    assert.equal(b.read('characters/char-ann.md'), entry('Ann', 'A baker.'));
  } finally {
    await rm(b.root, { recursive: true, force: true });
  }
});

test('front matter names', () => {
  assert.equal(frontName(entry('Ann', 'x')), 'Ann');
  assert.equal(frontName('---\ntitle: "The Storm"\norder: 1\n---\n\nText'), 'The Storm');
  assert.equal(frontName('no front matter'), undefined);
});
