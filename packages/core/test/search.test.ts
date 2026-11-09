import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarProblems, eraEnds, eraUsage, foldSearch, searchChapters, searchEntries, searchMaps, timelineModel, type Calendar, type World } from '@lore-forge/core';
import { manifest, world } from './helpers.ts';

const w = world([
  { id: 'humbert', type: 'character', name: 'Humbert', race: 'camel-folk', summary: 'A trader.' },
  { id: 'nur', type: 'character', name: 'Nur', race: 'human', occupation: 'scribe', summary: 'Keeps the salt ledgers.' },
  { id: 'zehra', type: 'character', name: 'Zehra', race: 'Human', visual: { appearance: 'Tall, with a human face and a jackal shadow' }, body: 'She was born **human** long ago.' },
  { id: 'oasis', type: 'place', name: 'Iron Oasis', summary: 'A well that only humans may drink from.' },
  { id: 'ledger', type: 'item', name: 'The Salt Ledger', aliases: ['İlk Defter'], body: 'Written by [[nur]] in the [[oasis|old oasis]].' },
]);
const names = (q: string) => searchEntries(w, q).map((h) => h.entry.name);

test('search finds chapters by title, then by text, and maps by name', () => {
  const book = {
    story: [
      { file: 'story/02-salt.md', title: 'The Salt Road', order: 2, body: 'They left at dawn.\nThe well sang\r\nall night.' },
      { file: 'story/01-well.md', title: 'Arrival', order: 1, body: 'Nobody had heard the well sing before.' },
      { file: 'story/03-ilk.md', title: 'İlk Işık', order: 3, body: '' },
    ],
    manifest: { ...manifest, maps: [{ id: 'sunsea', name: 'The Sunsea', image: 'maps/sunsea.jpg' }, { id: 'city', name: 'Camelamamm', image: 'maps/city.png', place: 'place-camelamamm' }] },
  } as unknown as World;
  assert.deepEqual(searchChapters(book, 'salt').map((h) => [h.title, h.field]), [['The Salt Road', 'Title']]);
  // In reading order among text matches; the snippet is one line and the span points into the text as written.
  const sang = searchChapters(book, 'well');
  assert.deepEqual(sang.map((h) => h.title), ['Arrival', 'The Salt Road']);
  const road = sang[1]!;
  assert.equal(road.snippet, 'They left at dawn. The well sang  all night.');
  assert.equal(road.snippet.slice(road.start, road.end), 'well');
  assert.equal(book.story![0]!.body.slice(...road.span!), 'well');
  assert.equal(searchChapters(book, 'well sang')[0]?.title, 'The Salt Road');
  assert.equal(searchChapters(book, 'ilk ışık')[0]?.field, 'Title');
  assert.deepEqual(searchChapters(book, '  '), []);
  assert.deepEqual(searchMaps(book.manifest, 'sun').map((m) => m.id), ['sunsea']);
  assert.deepEqual(searchMaps(book.manifest, 'the').map((m) => m.id), ['sunsea']);
  assert.deepEqual(searchMaps(book.manifest, 'xyz'), []);
});

test('search ranks names, then basic facts, then summary, then details, then text', () => {
  // "hum": Humbert by name; Nur and Zehra by race; the Iron Oasis by its summary.
  assert.deepEqual(names('hum'), ['Humbert', 'Nur', 'Zehra', 'Iron Oasis']);
  const [nur, zehra] = searchEntries(w, 'human');
  assert.equal(nur?.field, 'Race');
  assert.equal(zehra?.field, 'Race');
  assert.equal(searchEntries(w, 'jackal')[0]?.field, 'Appearance');
  assert.equal(searchEntries(w, 'scribe')[0]?.tier, 1);
  assert.equal(searchEntries(w, 'ledgers')[0]?.field, 'Summary');
});

test('search reads the body as shown: link labels and names, no Markdown', () => {
  const [hit] = searchEntries(w, 'old oasis');
  assert.equal(hit?.entry.id, 'ledger');
  assert.equal(hit?.field, 'Text');
  assert.equal(hit?.snippet, 'Written by Nur in the old oasis.');
  assert.equal(hit?.snippet.slice(hit.start, hit.end), 'old oasis');
  assert.equal(searchEntries(w, 'by nur')[0]?.entry.id, 'ledger');
});

test('search ignores case and folds Turkish I, ı and İ', () => {
  assert.equal(foldSearch('İlk IRMAK ılık'), 'ilk irmak ilik');
  assert.deepEqual(names('ilk defter'), ['The Salt Ledger']);
  assert.equal(searchEntries(w, 'ILK')[0]?.field, 'Alias');
  assert.deepEqual(names('iron'), ['Iron Oasis']);
});

test('every word must match somewhere, and snippets stay short around the match', () => {
  assert.deepEqual(names('salt scribe'), ['Nur']);
  assert.deepEqual(names('qzxv'), []);
  const long = world([{ id: 'a', type: 'note', name: 'A', body: `${'word '.repeat(60)}needle ${'more '.repeat(60)}` }]);
  const [hit] = searchEntries(long, 'needle');
  assert.ok(hit && hit.snippet.length < 110 && hit.snippet.startsWith('…') && hit.snippet.endsWith('…'));
  assert.equal(hit.snippet.slice(hit.start, hit.end), 'needle');
});

test('calendar problems: overlapping eras, bad codes, a missing default and bad months', () => {
  const ok = manifest.calendar;
  assert.deepEqual(calendarProblems(ok), []);
  const bad: Calendar = { eras: [{ id: 'OK', name: 'Old Kingdom', start: -1000, end: 5 }, { id: '1x', name: 'After', start: 1 }], defaultEra: 'ZZ', months: [{ name: '', days: 0 }] };
  const p = calendarProblems(bad);
  assert.ok(p.some((s) => s.includes('may not overlap')));
  assert.ok(p.some((s) => s.includes('abbreviation must start with a letter')));
  assert.ok(p.some((s) => s.includes('default era')));
  assert.ok(p.some((s) => s.includes('Month 1 needs a name')));
  assert.deepEqual(calendarProblems({ eras: [{ id: 'A', name: 'A', start: 1 }, { id: 'a', name: 'B', start: 1 }], defaultEra: 'A' }).length, 2);
  assert.deepEqual([...eraEnds(ok)], [['OK', 0], ['AS', undefined]]);
});

test('era usage counts dates per era; era end and colour reach the timeline', () => {
  const dated = world([
    { id: 'a', type: 'character', name: 'A', born: '312 OK', died: '20' },
    { id: 'b', type: 'event', name: 'B', date: '~5 AS' },
  ], { manifest: { calendar: { ...manifest.calendar, eras: [{ id: 'OK', name: 'Old Kingdom', start: -1000, end: -10, color: '#7a2e2e' }, { id: 'AS', name: 'After', start: 1 }] } } });
  assert.deepEqual([...eraUsage(dated)], [['OK', 1], ['AS', 2]]);
  const band = timelineModel(dated, [])!.eras.find((e) => e.id === 'OK')!;
  assert.equal(band.color, '#7a2e2e');
  assert.ok(band.to < 0);
});
