import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryPath, parseWorld, serializeEntry, serializeIntended, type Entry, type IntendedMark, type World } from '@lore-forge/core';
import { merge3, mergeKeyed, mergeLive, same } from '../src/renderer/merge.ts';

const manifest = { schemaVersion: 1, id: 'w', name: 'W', calendar: { eras: [{ id: 'AS', name: 'After', start: 1 }], defaultEra: 'AS' } };
const leyla: Entry = { id: 'char-leyla', type: 'character', name: 'Leyla', status: 'alive', summary: 'A healer.', body: 'She heals.\n' } as Entry;
const qarim: Entry = { id: 'place-qarim', type: 'place', name: 'Qarim', status: 'standing', body: '' } as Entry;

function files(entries: Entry[], intended: IntendedMark[] = []) {
  const out = entries.map((e) => ({ path: entryPath(e), content: serializeEntry(e) }));
  out.push({ path: 'world.json', content: JSON.stringify(manifest) });
  if (intended.length) out.push({ path: 'intended.json', content: serializeIntended(intended) });
  return out;
}
const worldOf = (entries: Entry[], intended: IntendedMark[] = []): World => parseWorld(files(entries, intended));
const contents = (entries: Entry[], intended: IntendedMark[] = []) => new Map(files(entries, intended).map((f) => [f.path, f.content]));

test('merge3: each side keeps what only it changed; both changed: ours', () => {
  assert.equal(merge3('a', 'a', 'b'), 'b');
  assert.equal(merge3('a', 'b', 'a'), 'b');
  assert.equal(merge3('a', 'b', 'c'), 'b');
  assert.deepEqual(merge3({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 3 }), { x: 2, y: 3 });
  assert.deepEqual(merge3({ x: 1 }, { x: 1, y: 2 }, {}), { y: 2 }, 'a key removed on one side and added on the other');
  assert.ok(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1, d: undefined }));
  assert.deepEqual(mergeKeyed([{ k: 'a' }], [{ k: 'a' }, { k: 'b' }], [{ k: 'c' }], (t) => t.k).map((t) => t.k).sort(), ['b', 'c'], 'a was removed outside, b added here, c added outside');
});

test('an entry edited here and changed outside keeps both edits and is written again', () => {
  const base = contents([leyla, qarim]);
  const cur = worldOf([leyla, qarim]);
  const typing = { ...leyla, body: 'She heals the sick of Qarim.\n' } as Entry;
  cur.entries = cur.entries.map((e) => (e.id === leyla.id ? typing : e));
  const fresh = worldOf([{ ...leyla, summary: 'The healer of Qarim.' } as Entry, qarim]);
  const path = entryPath(leyla);
  const { world, rewrite } = mergeLive(cur, fresh, new Set([path]), new Set([path]), (p) => base.get(p));
  const got = world.entries.find((e) => e.id === leyla.id)!;
  assert.equal(got.body, 'She heals the sick of Qarim.\n', 'the typing stays');
  assert.equal(got.summary, 'The healer of Qarim.', 'the outside change stays');
  assert.deepEqual(rewrite.entries.map((e) => e.id), [leyla.id]);
});

test('a file not being edited takes what is on disk; a new file appears; a deleted one goes', () => {
  const base = contents([leyla, qarim]);
  const cur = worldOf([leyla, qarim]);
  const idris = { id: 'char-idris', type: 'character', name: 'Idris', status: 'alive', body: '' } as Entry;
  const fresh = worldOf([{ ...leyla, summary: 'Changed outside.' } as Entry, idris]);
  const changed = new Set([entryPath(leyla), entryPath(qarim), entryPath(idris)]);
  const { world, rewrite } = mergeLive(cur, fresh, changed, new Set(), (p) => base.get(p));
  assert.equal(world.entries.find((e) => e.id === leyla.id)!.summary, 'Changed outside.');
  assert.deepEqual(world.entries.map((e) => e.id), ['char-idris', 'char-leyla'], 'loader order; Qarim deleted outside');
  assert.equal(world.files['char-idris'], 'characters/char-idris.md');
  assert.deepEqual(rewrite, { entries: [], chapters: [], intended: false, ignored: false });
});

test('an entry deleted outside while it is being edited stays, and is written again', () => {
  const base = contents([leyla]);
  const cur = worldOf([leyla]);
  cur.entries = [{ ...leyla, body: 'Still typing.\n' } as Entry];
  const fresh = worldOf([]);
  const path = entryPath(leyla);
  const { world, rewrite } = mergeLive(cur, fresh, new Set([path]), new Set([path]), (p) => base.get(p));
  assert.equal(world.entries[0]?.body, 'Still typing.\n');
  assert.equal(rewrite.entries[0]?.id, leyla.id);
});

test('intended marks made here and outside are both kept', () => {
  const a: IntendedMark = { warningId: 'after-death:a', markedAt: '2026-11-08' };
  const b: IntendedMark = { warningId: 'after-death:b', markedAt: '2026-11-08' };
  const base = contents([leyla]);
  const cur = worldOf([leyla]);
  cur.intended = [a];
  const fresh = worldOf([leyla], [b]);
  const { world, rewrite } = mergeLive(cur, fresh, new Set(['intended.json']), new Set(['intended.json']), (p) => base.get(p));
  assert.deepEqual(world.intended.map((m) => m.warningId).sort(), ['after-death:a', 'after-death:b']);
  assert.equal(rewrite.intended, true);
});
