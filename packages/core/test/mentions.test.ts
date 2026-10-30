import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MentionMatcher, references, WorldIndex, type Entry } from '@lore-forge/core';
import { warnings, world } from './helpers.ts';

const e = (id: string, name: string, aliases?: string[]): Entry => ({ id, type: 'character', name, body: '', ...(aliases ? { aliases } : {}) }) as Entry;
const texts = (m: MentionMatcher, s: string, exclude?: string) => m.find(s, { exclude }).map((x) => `${x.text}:${x.ids.join('+')}`);

test('plain names and aliases are found as whole words, case-sensitive', () => {
  const m = new MentionMatcher([e('t', 'Tarik'), e('z', 'Zehra', ['the Weaver'])]);
  assert.deepEqual(texts(m, 'Tarik, a salt miner. Zehra is mad at the Weaver.'), ['Tarik:t', 'Zehra:z', 'the Weaver:z']);
  assert.deepEqual(texts(m, 'tarik and ZEHRA'), []);
  assert.deepEqual(texts(m, 'Tariky and Zehras'), []);
});

test('longest name wins over a shorter one inside it', () => {
  const m = new MentionMatcher([e('k', 'Kadir'), e('kh', 'Kadir Humpback')]);
  const found = m.find('Kadir Humpback met Kadir.');
  assert.deepEqual(found.map((x) => [x.text, x.ids, x.start]), [['Kadir Humpback', ['kh'], 0], ['Kadir', ['k'], 19]]);
  assert.deepEqual(texts(m, 'Kadir\nHumpback'), ['Kadir:k']);
  assert.deepEqual(texts(m, 'Kadir  Humpback'), ['Kadir  Humpback:kh']);
});

test('Turkish letters are word characters; apostrophe suffixes still match', () => {
  const m = new MentionMatcher([e('i', 'İlsa'), e('s', 'Şafak'), e('a', 'Ali')]);
  assert.deepEqual(texts(m, "İlsa'nın kılıcı Şafak'ta. Aliş geldi, Alişan değil; Ali geldi."), ['İlsa:i', 'Şafak:s', 'Ali:a']);
  assert.deepEqual(texts(m, 'Şafakı gördü ve Alığ.'), []);
  assert.deepEqual(texts(m, 'çİlsa'), []);
});

test('shared names are ambiguous; own entry can be excluded', () => {
  const m = new MentionMatcher([e('f', 'The Red Wind'), e('k', 'Kadir', ['The Red Wind'])]);
  assert.deepEqual(texts(m, 'The Red Wind rides.'), ['The Red Wind:f+k']);
  assert.deepEqual(texts(m, 'The Red Wind rides.', 'k'), ['The Red Wind:f']);
});

test('explicit links, @mentions and code are not matched twice; one-letter names are ignored', () => {
  const m = new MentionMatcher([e('t', 'Tarik'), e('x', 'X')]);
  assert.deepEqual(texts(m, '[[Tarik]] and [[t|Tarik]] and @Tarik and `Tarik` and X, but Tarik'), ['Tarik:t']);
});

test('implicit mentions count as references and never dangle', () => {
  const drafts = [
    { id: 'char-t', type: 'character' as const, name: 'Tarik', body: 'Tarik, a salt miner. Zehra is mad. Ghost is not here.' },
    { id: 'char-z', type: 'character' as const, name: 'Zehra' },
  ];
  const w = world(drafts);
  const ix = new WorldIndex(w);
  const t = w.entries.find((x) => x.id === 'char-t')!;
  assert.deepEqual(references(t, ix), [{ ref: 'char-z', field: 'body', implicit: true }]);
  assert.deepEqual(references(t), []);
  assert.equal(warnings(drafts, 'dangling-reference').length, 0);
});
