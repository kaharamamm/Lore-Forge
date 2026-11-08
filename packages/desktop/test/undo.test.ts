import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Entry } from '@lore-forge/core';
import { caretAfter, changedPaths, EMPTY_HISTORY, MERGE_MS, record, redo, undo } from '../src/renderer/undo.ts';

const camel = (patch: Record<string, unknown> = {}): Entry => ({ id: 'char-mr-camel', type: 'character', name: 'Mr Camel', body: '', status: 'alive', ...patch }) as unknown as Entry;

test('a status change is undone and redone', () => {
  const a = camel();
  const b = camel({ status: 'dead', died: '512' });
  let h = record(EMPTY_HISTORY, a, b, 0);
  assert.deepEqual(h.undo[0]!.paths.sort(), ['died', 'status']);
  const u = undo(h, b)!;
  assert.equal((u.entry as unknown as { status: string }).status, 'alive');
  assert.ok(!('died' in u.entry), 'a field the step added goes away again');
  h = u.history;
  assert.equal(h.undo.length, 0);
  const r = redo(h, u.entry)!;
  assert.equal((r.entry as unknown as { status: string }).status, 'dead');
  assert.equal((r.entry as unknown as { died: string }).died, '512');
  assert.equal(redo(r.history, r.entry), null, 'nothing more to redo');
});

test('typing in one field is one step until a pause; another field is another step', () => {
  let e = camel();
  let h = EMPTY_HISTORY;
  let t = 0;
  for (const s of ['T', 'Te', 'Tea', 'Tea ', 'Tea m']) {
    const next = { ...e, summary: s } as Entry;
    h = record(h, e, next, (t += 100));
    e = next;
  }
  assert.equal(h.undo.length, 1, 'quick typing is one step');
  const later = { ...e, summary: 'Tea merchant' } as Entry;
  h = record(h, e, later, t + MERGE_MS + 1);
  e = later;
  assert.equal(h.undo.length, 2, 'typing after a pause is a new step');
  const named = { ...e, name: 'Barnaby' } as Entry;
  h = record(h, e, named, t + MERGE_MS + 50);
  assert.equal(h.undo.length, 3, 'another field is another step');
  let u = undo(h, named)!;
  assert.equal(u.entry.name, 'Mr Camel');
  u = undo(u.history, u.entry)!;
  assert.equal((u.entry as unknown as { summary: string }).summary, 'Tea m');
  u = undo(u.history, u.entry)!;
  assert.ok(!('summary' in u.entry));
});

test('typing back to where the step began leaves no step', () => {
  const a = camel({ summary: 'Kind' });
  const b = { ...a, summary: 'Kindl' } as Entry;
  let h = record(EMPTY_HISTORY, a, b, 0);
  h = record(h, b, a, 100);
  assert.equal(h.undo.length, 0);
});

test('fields inside details are undone one by one and keep their place', () => {
  const a = camel({ details: { gender: 'Male', occupation: 'Tea merchant', goals: 'Keep the kettle warm' } });
  const b = camel({ details: { gender: 'Male', goals: 'Keep the kettle warm' } });
  assert.deepEqual(changedPaths(a, b), ['details.occupation']);
  const h = record(EMPTY_HISTORY, a, b, 0);
  const u = undo(h, b)!;
  assert.deepEqual(Object.keys((u.entry as unknown as { details: object }).details), ['gender', 'occupation', 'goals'], 'the field comes back in its old place');
  const c = camel({ details: { gender: 'Genderless' } });
  const d = camel();
  const v = undo(record(EMPTY_HISTORY, c, d, 0), d)!;
  assert.deepEqual((v.entry as unknown as { details: object }).details, { gender: 'Genderless' });
  const w = undo(record(EMPTY_HISTORY, d, c, 0), c)!;
  assert.ok(!('details' in w.entry), 'an empty details object goes');
});

test('a change made outside the app since is never undone', () => {
  const a = camel({ summary: 'Patient', status: 'alive' });
  const b = { ...a, summary: 'Patient tea merchant' } as Entry;
  const h = record(EMPTY_HISTORY, a, b, 0);
  // An AI assistant rewrote the summary after that edit.
  const outside = { ...b, summary: 'Written by an assistant' } as Entry;
  assert.equal(undo(h, outside), null, 'the step no longer applies');
  // A step that touched two fields puts back only the one still as it left it.
  const c = { ...a, summary: 'Changed', status: 'dead' } as Entry;
  const h2 = record(EMPTY_HISTORY, a, c, 0);
  const now = { ...c, summary: 'Outside' } as Entry;
  const u = undo(h2, now)!;
  assert.deepEqual(u.paths, ['status']);
  assert.equal((u.entry as unknown as { summary: string }).summary, 'Outside');
  assert.equal((u.entry as unknown as { status: string }).status, 'alive');
});

test('a new edit after an undo clears redo', () => {
  const a = camel();
  const b = camel({ status: 'dead' });
  const u = undo(record(EMPTY_HISTORY, a, b, 0), b)!;
  assert.equal(u.history.redo.length, 1);
  const c = { ...u.entry, name: 'Barnaby' } as Entry;
  const h = record(u.history, u.entry, c, 5000);
  assert.equal(h.redo.length, 0);
});

test('the caret goes to the end of what came back, or where text was taken out', () => {
  assert.equal(caretAfter('Tea merchant', 'Tea'), 3);
  assert.equal(caretAfter('Tea', 'Tea merchant'), 12);
  assert.equal(caretAfter('A kind camel', 'A camel'), 2);
  assert.equal(caretAfter('A camel', 'A kind camel'), 7);
  assert.equal(caretAfter('same', 'same'), 4);
});
