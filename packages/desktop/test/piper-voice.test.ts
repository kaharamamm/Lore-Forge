/** Voices made with the Voice Studio (Piper): Turkish and English phonemes in Piper's IPA, ids, and a voice's folder. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLexicon } from '../src/voice/english.ts';
import { misakiToIpa, piperPhonemes } from '../src/voice/ipa.ts';
import { piperIds } from '../src/voice/piper.ts';
import { turkishNumber, turkishNumbersToWords, turkishOrdinal, turkishPhonemes, turkishWord } from '../src/voice/turkish.ts';
import { piperVoice } from '../src/shared/voices.ts';

test('Turkish numbers: counts, ordinals with vowel harmony, percentages, decimals and dates', () => {
  assert.equal(turkishNumber(1205), 'bin iki yüz beş');
  assert.equal(turkishNumber(1000), 'bin');
  assert.equal(turkishNumber(2000000), 'iki milyon');
  assert.equal(turkishNumber(0), 'sıfır');
  assert.deepEqual([1, 3, 4, 6, 9, 10, 40, 100].map(turkishOrdinal), ['birinci', 'üçüncü', 'dördüncü', 'altıncı', 'dokuzuncu', 'onuncu', 'kırkıncı', 'yüzüncü']);
  assert.equal(turkishNumbersToWords('3. bölüm, %50 ve 2,5 kilo; 10.03.512'), 'üçüncü bölüm, yüzde elli ve iki virgül beş kilo; on, üç, beş yüz on iki');
  assert.equal(turkishNumbersToWords('Bölüm 3: 1920 yılında 1.500 kişi'), 'Bölüm üç: bin dokuz yüz yirmi yılında bin beş yüz kişi');
});

test('Turkish words: palatal k and g, dark l, ğ, long vowels, and the stress on the last syllable', () => {
  assert.equal(turkishWord('kedi'), 'ceˈdi');
  assert.equal(turkishWord('kitap'), 'ciˈtap');
  assert.equal(turkishWord('göz'), 'ɟøz');
  assert.equal(turkishWord('kal'), 'kaɫ');
  assert.equal(turkishWord('gel'), 'ɟel');
  assert.equal(turkishWord('dağ'), 'daː');
  assert.equal(turkishWord('değil'), 'deˈjil');
  assert.equal(turkishWord('ağaç'), 'ˈaːtʃ', 'two a around ğ are one long a');
  assert.equal(turkishWord('doğru'), 'doːˈɾu');
  assert.equal(turkishWord('Işık'), 'ɯˈʃɯk', 'a capital I is ı');
  assert.equal(turkishWord('İstanbul'), 'istanˈbuɫ', 'a capital İ is i');
  assert.equal(turkishWord('çarşı'), 'tʃaɾˈʃɯ');
  assert.equal(turkishWord('ve'), 've', 'one syllable: no stress');
  assert.equal(turkishWord('için'), 'itʃin', 'a small word leans on the next and has no stress');
});

test('Turkish text: punctuation kept, era codes spelled, abbreviations said', () => {
  assert.equal(turkishPhonemes('Merhaba, kitap ve kalem.'), 'meɾhaˈba, ciˈtap ve kaˈlem.');
  assert.equal(turkishPhonemes('MS 512'), 'me se beʃ jyz on iˈci');
  assert.match(turkishPhonemes('Dr. Ali geldi.'), /^dokˈtoɾ aˈli ɟelˈdi\.$/);
});

test('English for a Piper voice: Misaki phonemes in IPA, with the dictionary', () => {
  assert.equal(misakiToIpa('ðə kˈɛɾᵊl ˈɔlwˌAz bəɡˈæn tə sˈɪŋ'), 'ðə kˈɛɾəl ˈɔːlwˌeɪz bəɡˈæn tə sˈɪŋ');
  assert.equal(misakiToIpa('hɜɹ wˈɔɾəɹ — Idˈiə ʤˈʌʧ…'), 'hɜː wˈɔːɾɚ, aɪdˈiːə dʒˈʌtʃ.');
  assert.equal(misakiToIpa('ˈOn ˈYl'), 'ˈoʊn ˈɔɪl', 'a diphthong gets no length mark');
  const us = parseLexicon(readFileSync(join(import.meta.dirname, '..', 'voice-data', 'en-us.txt'), 'utf8'));
  assert.equal(piperPhonemes('The kettle sang.', 'en', us), 'ðə kˈɛɾəl sˈæŋ.');
  assert.equal(piperPhonemes('Kedi geldi.', 'tr'), 'ceˈdi ɟelˈdi.');
  assert.throws(() => piperPhonemes('Hello.', 'en'), /dictionary/);
});

test('Piper ids: start, pad, each phoneme then a pad, end; unknown symbols left out, letters decomposed', () => {
  const map = { _: [0], '^': [1], $: [2], ' ': [3], a: [14], b: [15], ˈ: [120], c: [16], '̧': [140] };
  assert.deepEqual(piperIds('ab', map), [1, 0, 14, 0, 15, 0, 2]);
  assert.deepEqual(piperIds('a?b', map), [1, 0, 14, 0, 15, 0, 2]);
  assert.deepEqual(piperIds('ç', map), [1, 0, 16, 0, 140, 0, 2], 'ç is c and its cedilla, as Piper reads it');
});

test('a Voice Studio voice from its folder: lore-forge.json says its name, language and gender', () => {
  assert.deepEqual(piperVoice('ahmet-tr', { name: 'Ahmet', language: 'tr', gender: 'male' }), { id: 'ahmet-tr', name: 'Ahmet', language: 'tr', gender: 'male', engine: 'piper' });
  assert.deepEqual(piperVoice('ahmet-en', { name: ' Ahmet ', language: 'en' }), { id: 'ahmet-en', name: 'Ahmet', language: 'en', accent: 'us', gender: 'male', engine: 'piper' });
  assert.equal(piperVoice('x', { name: 'X', language: 'de' }), undefined);
  assert.equal(piperVoice('x', null), undefined);
});
