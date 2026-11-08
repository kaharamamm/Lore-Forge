/** Regression tests for audited bugs in the file parser and serializer. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtinRules, checkWorld, parseChapter, parseEntry, parseManifest, parseWorld, serializeEntry, type Entry } from '@lore-forge/core';
import { manifest } from './helpers.ts';

const front = (yaml: string, body = '') => `---\n${yaml}\n---\n${body}`;

// ------------------------------------------------------------------------- 7. unquoted dotted dates

test('bug 7: unquoted dotted dates in hand-written YAML keep their text', () => {
  const { entry, problems } = parseEntry(front([
    'id: char-a', 'type: character', 'name: A', 'born: 03.1920', 'died: 05.2000',
    'locations:', '  - place: p', '    from: 12.10', '    to: 10.1900',
    'relations:', '  - type: ally-of', '    target: b', '    from: 0050', '    to: 1800',
    'bookOrder: 1.50', 'mood: 3.10',
  ].join('\n')));
  assert.deepEqual(problems, []);
  assert.ok(entry?.type === 'character');
  assert.equal(entry.born, '03.1920');
  assert.equal(entry.died, '05.2000');
  assert.deepEqual(entry.locations, [{ place: 'p', from: '12.10', to: '10.1900' }]);
  assert.deepEqual(entry.relations, [{ type: 'ally-of', target: 'b', from: '0050', to: '1800' }]);
  assert.equal(entry.bookOrder, 1.5, 'real numbers stay numbers');
  assert.deepEqual(entry.extra, { mood: 3.1 }, 'unknown keys are not dates');
  assert.match(serializeEntry(entry), /^born: "03\.1920"$/m, 'saving writes the text back');
});

test('bug 7: every date field of every type, and story chapter dates', () => {
  const read = (type: string, yaml: string) => parseEntry(front(`id: x\ntype: ${type}\nname: X\n${yaml}`)).entry as unknown as Record<string, unknown>;
  assert.deepEqual([read('place', 'founded: 03.1920\ndestroyed: 12.10').founded, read('place', 'destroyed: 12.10').destroyed], ['03.1920', '12.10']);
  assert.deepEqual([read('faction', 'founded: 10.1900').founded, read('faction', 'dissolved: 10.1900').dissolved], ['10.1900', '10.1900']);
  assert.deepEqual([read('item', 'created: 05.2000').created, read('item', 'destroyed: 05.2000').destroyed], ['05.2000', '05.2000']);
  assert.deepEqual([read('event', 'date: 10.1900\nend: 12.10').date, read('event', 'end: 12.10').end], ['10.1900', '12.10']);
  assert.equal(read('note', 'date: 03.1920').date, '03.1920');
  assert.equal(read('character', 'born: 1800').born, '1800');
  const { chapter } = parseChapter('---\ntitle: T\norder: 2\ndate: 03.1920\n---\nText.\n', 'story/02-t.md');
  assert.equal(chapter.date, '03.1920');
  assert.equal(chapter.order, 2);
});

test('bug 7: a dotted date that YAML would shorten is not a false invalid-date', () => {
  const w = parseWorld([
    { path: 'world.json', content: JSON.stringify(manifest) },
    { path: 'characters/a.md', content: front('id: a\ntype: character\nname: A\nborn: 10.1900\ndied: 12.10') },
  ]);
  assert.deepEqual(w.issues, []);
  assert.deepEqual(checkWorld(w, builtinRules), []);
});

// ------------------------------------------------------------------------------ 23. half-filled rows

test('bug 23: half-filled list rows from the editor survive a load and a save', () => {
  const entries: Entry[] = [
    {
      id: 'evt-e', type: 'event', name: 'E',
      participants: [{ id: '', role: 'witness' }],
      actions: [{ actor: '', verb: 'killed', target: 'char-x' }, { actor: 'char-y', verb: '' }],
      relations: [{ type: 'ally-of', target: '', from: '1900', to: '1910', note: 'old friends' }],
      body: '',
    },
    { id: 'char-c', type: 'character', name: 'C', locations: [{ place: '', from: '1900', to: '1910', note: 'somewhere' }], body: '' },
  ];
  for (const e of entries) {
    const text = serializeEntry(e);
    const { entry, problems } = parseEntry(text);
    assert.deepEqual(problems, [], e.id);
    assert.deepEqual(entry, e, e.id);
    assert.equal(serializeEntry(entry!), text, `${e.id} is written back unchanged`);
  }
});

test('bug 23: hand-written rows without the reference key are kept too', () => {
  const { entry, problems } = parseEntry(front('id: a\ntype: character\nname: A\nrelations:\n  - type: ally-of\n    note: x\nlocations:\n  - from: "1900"'));
  assert.deepEqual(problems, []);
  assert.ok(entry?.type === 'character');
  assert.deepEqual(entry.relations, [{ type: 'ally-of', target: '', note: 'x' }]);
  assert.deepEqual(entry.locations, [{ place: '', from: '1900' }]);
});

// ------------------------------------------------------------------------------------ 24. empty names

test('bug 24: an empty name is written and read back', () => {
  const e: Entry = { id: 'char-a', type: 'character', name: '', born: '1900', body: 'Text.\n' };
  const text = serializeEntry(e);
  assert.match(text, /^name: ""$/m);
  const { entry, problems } = parseEntry(text);
  assert.deepEqual(entry, e);
  assert.deepEqual(problems, [], 'the file-error rule reports it, live (see rule-fixes)');
  assert.equal(parseEntry('---\nid: a\ntype: note\nname:\n---\n').entry?.name, '', 'a bare "name:" is an empty name');
  assert.deepEqual(parseEntry('---\nid: a\ntype: note\n---\n').problems, ['Missing "name".'], 'a file with no name line at all is still broken');
});

// ------------------------------------------------------------------------- 14, 15, 22. world.json

test('bugs 14, 15, 22: unusable world.json values are reported and do not break the world', () => {
  const m = (extra: object, calendar: object = {}) => parseManifest(JSON.stringify({ ...manifest, ...extra, calendar: { ...manifest.calendar, ...calendar } }));
  const twelve = m({}, { months: 'twelve' });
  assert.equal(twelve.issues.length, 1);
  assert.equal(twelve.manifest?.calendar.months, undefined, 'the default months are used');
  const holes = m({}, { months: [{ name: 'Sun', days: 30 }, null, { name: 'Moon' }, { name: 'Star', days: 0 }] });
  assert.deepEqual(holes.manifest?.calendar.months, [{ name: 'Sun', days: 30 }]);
  assert.equal(holes.issues.length, 3);
  const approx = m({}, { approxYears: -10 });
  assert.equal(approx.issues.length, 1);
  assert.equal(approx.manifest?.calendar.approxYears, undefined);
  assert.deepEqual(m({}, { approxYears: 0 }).issues, []);
  const rules = m({ rules: { 'after-death': 'Off', 'duplicate-name': 'off', 'image-view': 'info' } });
  assert.equal(rules.issues.length, 1);
  assert.match(rules.issues[0]!, /after-death/);
  assert.deepEqual(rules.manifest?.rules, { 'after-death': 'Off', 'duplicate-name': 'off', 'image-view': 'info' }, 'the file keeps what was written');
  assert.deepEqual(m({}).issues, []);
  const w = parseWorld([{ path: 'world.json', content: JSON.stringify({ ...manifest, rules: { 'after-death': 'Off' } }) }]);
  assert.deepEqual(w.issues.map((i) => i.file), ['world.json']);
});
