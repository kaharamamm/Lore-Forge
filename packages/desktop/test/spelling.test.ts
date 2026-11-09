/** Spell checking: the open book's words that count as spelled right, and the languages checked by default. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorld } from '@lore-forge/core';
import { bookWords } from '../src/renderer/spelling.ts';
import { defaultSpelling } from '../src/shared/spelling.ts';

test("the book's words: names and other names, eras, months and maps, each part of a hyphenated name, and possessives", () => {
  const world = parseWorld([
    { path: 'world.json', content: JSON.stringify({ schemaVersion: 1, id: 'b', name: 'B', calendar: { eras: [{ id: 'SR', name: 'Salt Reckoning', start: 1 }], defaultEra: 'SR', months: [{ name: 'Ashfall', days: 30 }] }, maps: [{ id: 'm', name: 'Qarim-by-the-Sea', image: 'maps/m.png' }] }) },
    { path: 'characters/char-a.md', content: "---\nid: char-a\ntype: character\nname: Mr Camel\naliases: [Barnaby O'Hump, X]\n---\n" },
    { path: 'places/place-q.md', content: '---\nid: place-q\ntype: place\nname: Al-Qarim\n---\n' },
  ]);
  const words = bookWords(world);
  for (const w of ['Camel', "Camel's", 'Camel’s', 'Mr', 'Barnaby', "O'Hump", 'Al', 'Qarim', 'Salt', 'Reckoning', 'Ashfall', 'by', 'Sea']) assert.ok(words.includes(w), w);
  assert.ok(!words.includes('X'), 'one letter is not a word');
  assert.ok(!words.includes("O'Hump's"), 'no possessive of a word that has an apostrophe already');
  assert.deepEqual(words, [...words].sort(), 'sorted, so the list is the same every time');
});

test('the languages checked before any are chosen follow the app language, and English as the system writes it', () => {
  assert.deepEqual(defaultSpelling('tr', 'tr-TR'), ['tr']);
  assert.deepEqual(defaultSpelling('en', 'en-GB'), ['en-GB']);
  assert.deepEqual(defaultSpelling('en', 'en_IE'), ['en-GB']);
  assert.deepEqual(defaultSpelling('en', 'en-US'), ['en-US']);
  assert.deepEqual(defaultSpelling('en', 'tr'), ['en-US'], 'English on a Turkish system');
});
