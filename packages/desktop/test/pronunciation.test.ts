/** A name's pronunciation, as its author writes it, in the sounds the built-in voices speak. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phonemize } from '../src/voice/english.ts';
import { piperPhonemes } from '../src/voice/ipa.ts';
import { englishRespelling, spokenNames, turkishRespelling } from '../src/voice/respell.ts';
import { turkishPhonemes, turkishWord } from '../src/voice/turkish.ts';

test('English: syllables with hyphens, the stress on the one in capitals, guide spellings for the sounds', () => {
  assert.deepEqual(englishRespelling('KAM-eh-la-mam'), ['kˈæmɛlæmæm']);
  assert.deepEqual(englishRespelling('ah-RAH-kis'), ['ɑɹˈɑkɪs']);
  assert.deepEqual(englishRespelling('MY-kəl'), ['mˈIkəl']);
  assert.deepEqual(englishRespelling('uh-BUV'), ['əbˈʌv'], 'uh is weak without the stress');
  assert.deepEqual(englishRespelling('thee-OH-dor'), ['θiˈOdɔɹ']);
  assert.deepEqual(englishRespelling('zhah-SHEE'), ['ʒɑʃˈi']);
  assert.deepEqual(englishRespelling('mis-ter KAM-el'), ['mˈɪstəɹ', 'kˈæmɛl'], 'without capitals the first syllable is stressed');
});

test('IPA between slashes: as it is, in Misaki’s notation for English and as written for Turkish', () => {
  assert.deepEqual(englishRespelling('/ˈkæm.ə.lə.mæm/'), ['kˈæmələmæm']);
  assert.deepEqual(englishRespelling('/ˈdʒeɪk/'), ['ʤˈAk']);
  assert.deepEqual(turkishRespelling('/kameˈɫamam/'), ['kameˈɫamam']);
});

test('Turkish: read as Turkish, with the stress where the capitals say', () => {
  assert.deepEqual(turkishRespelling('ka-me-LA-mam'), ['kameˈɫamam']);
  assert.deepEqual(turkishRespelling('ka-me-la-mam'), ['kameɫaˈmam'], 'without capitals, Turkish stress');
  assert.deepEqual(turkishRespelling('AN-ka-ra'), ['ˈankaɾa']);
  assert.equal(turkishWord('ankara', 0), 'ˈankaɾa');
  assert.equal(turkishWord('lerin', 'none'), 'leɾin');
});

test('the book’s names as a voice’s words: a part for each word of a name, or one word written in parts', () => {
  assert.deepEqual([...spokenNames([{ name: 'Camelamamm', say: 'KAM-eh-la-mam' }], 'en')], [['camelamamm', 'kˈæmɛlæmæm']]);
  assert.deepEqual([...spokenNames([{ name: 'Camelamamm', say: 'KAM eh la mam' }], 'en')], [['camelamamm', 'kˈæmɛlæmæm']]);
  assert.deepEqual([...spokenNames([{ name: 'Mr Camel', say: 'mis-ter KAM-el' }], 'en')], [['mr', 'mˈɪstəɹ'], ['camel', 'kˈæmɛl']]);
  assert.deepEqual([...spokenNames([{ name: 'Mr Camel', say: 'KAM-el' }], 'en')], [], 'two words and one part: left to the dictionary');
  assert.deepEqual([...spokenNames([{ name: 'İlsa', say: 'İL-sa' }, { name: 'Empty', say: ' ' }], 'tr')], [['ilsa', 'ˈilsa']]);
});

test('names come before the dictionary, with possessives and Turkish endings', () => {
  const lex = new Map([['well', 'wˈɛl'], ['camelamamm', 'kəmˈɛləmæm']]);
  const names = spokenNames([{ name: 'Camelamamm', say: 'KAM-eh-la-mam' }], 'en');
  assert.equal(phonemize("Camelamamm's well.", lex, 'us', names), 'kˈæmɛlæmæmz wˈɛl.');
  assert.equal(phonemize('Camelamamm.', lex, 'us'), 'kəmˈɛləmæm.', 'without names, the dictionary as before');
  assert.equal(piperPhonemes('Camelamamm.', 'en', lex, names), 'kˈæmɛlæmæm.');
  const tr = spokenNames([{ name: 'Kamelamam', say: 'ka-me-LA-mam' }], 'tr');
  assert.equal(turkishPhonemes("Kamelamam'ın kuyusu.", tr), 'kameˈɫamamɯn kujuˈsu.');
  assert.equal(piperPhonemes("Kamelamam'ın kuyusu.", 'tr', undefined, tr), 'kameˈɫamamɯn kujuˈsu.');
});
