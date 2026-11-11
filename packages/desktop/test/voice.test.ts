/** The built-in voices: English text as Kokoro's phonemes, US and British, and speech from the model when it is there. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLexicon, phonemize, wordPhonemes } from '../src/voice/english.ts';
import { lettersToPhonemes } from '../src/voice/nrl.ts';
import { cardinal, numbersToWords, ordinal, year } from '../src/voice/numbers.ts';
import { Kokoro, kokoroChunks, kokoroTokens, type OrtLike } from '../src/voice/kokoro.ts';
import { KOKORO_VOICES as BUILT_IN_VOICES } from '../src/shared/voices.ts';

const ROOT = join(import.meta.dirname, '..');
const us = parseLexicon(readFileSync(join(ROOT, 'voice-data', 'en-us.txt'), 'utf8'));
const gb = parseLexicon(readFileSync(join(ROOT, 'voice-data', 'en-gb.txt'), 'utf8'));

test('numbers as words: counts, years, ordinals, money, decimals and in-world dates', () => {
  assert.equal(cardinal(1205), 'one thousand two hundred five');
  assert.equal(cardinal(-40), 'minus forty');
  assert.equal(year(1998), 'nineteen ninety-eight');
  assert.equal(year(1905), 'nineteen oh five');
  assert.equal(year(1900), 'nineteen hundred');
  assert.equal(year(2005), 'two thousand five');
  assert.equal(ordinal(21), 'twenty-first');
  assert.equal(ordinal(12), 'twelfth');
  assert.equal(ordinal(40), 'fortieth');
  assert.equal(numbersToWords('In 1920, 3 camels paid $5 for 2.5 jars, 50% of 1,500.'), 'In nineteen twenty, three camels paid five dollars for two point five jars, fifty percent of one thousand five hundred.');
  assert.equal(numbersToWords('On 10.03.512 and the 2nd day.'), 'On ten, three, five hundred twelve and the second day.');
});

test('American English: the dictionary, the small words that change with the next sound, quotes and numbers', () => {
  assert.equal(phonemize('The kettle always began to sing.', us, 'us'), 'ðə kˈɛɾᵊl ˈɔlwˌAz bəɡˈæn tə sˈɪŋ.');
  assert.equal(phonemize('the idea, to eat an apple', us, 'us'), `ði Idˈiə, tʊ ˈit ən ${us.get('apple')}`);
  assert.equal(phonemize('"Well," he said.', us, 'us'), '"wˈɛl," hi sˈɛd.');
  assert.equal(phonemize('In 1920 I saw it', us, 'us'), 'ɪn nˌIntˈin twˈɛnti ˌI sˈɔ ɪt');
  assert.equal(phonemize('A camel.', us, 'us'), 'ɐ kˈæmᵊl.');
  assert.equal(phonemize('Grade A.', us, 'us').endsWith('ˈA.'), true, 'a letter A at the end is the letter');
});

test('British English: its own dictionary, and American letter sounds made British for unknown names', () => {
  assert.equal(phonemize('The kettle was hot.', gb, 'gb'), 'ðə kˈɛtᵊl wɒz hˈɒt.');
  const name = lettersToPhonemes('Borodor');
  assert.match(name, /ɹ/, 'the letter rules give American r');
  assert.doesNotMatch(wordPhonemes('Borodor', gb, 'gb'), /ɹ$/, 'no r at the end of a British word');
});

test('words the dictionary does not have: stems, possessives, initials and names', () => {
  const lex = new Map([['camel', 'kˈæmᵊl'], ['walk', 'wˈɔk'], ['bake', 'bˈAk'], ['stop', 'stˈɑp'], ['wait', 'wˈAt'], ['cry', 'kɹˈI'], ['horse', 'hˈɔɹs'], ['quick', 'kwˈɪk']]);
  const say = (w: string) => wordPhonemes(w, lex, 'us');
  assert.deepEqual(['camels', 'horses', 'cries', 'walked', 'baked', 'stopped', 'waited', 'cried', 'walking', 'baking', 'stopping', 'quickly', "camel's", "camels'"].map(say),
    ['kˈæmᵊlz', 'hˈɔɹsɪz', 'kɹˈIz', 'wˈɔkt', 'bˈAkt', 'stˈɑpt', 'wˈAtɪd', 'kɹˈId', 'wˈɔkɪŋ', 'bˈAkɪŋ', 'stˈɑpɪŋ', 'kwˈɪkli', 'kˈæmᵊlz', 'kˈæmᵊlz']);
  assert.equal(say('CR'), 'sˈi ˈɑɹ', 'an era code is spelled out');
  // A name nobody has listed: read by its letters, stressed, and a doubled letter is one sound.
  const camelamamm = lettersToPhonemes('Camelamamm');
  assert.match(camelamamm, /ˈ/);
  assert.doesNotMatch(camelamamm, /mm/);
  assert.equal(say("Camelamamm's").endsWith('z'), true);
});

test('Kokoro tokens and runs: unknown characters are left out, long text is cut at sentence ends', () => {
  assert.deepEqual(kokoroTokens('hˈi.'), [50, 156, 51, 4]);
  assert.deepEqual(kokoroTokens('h~i'), [50, 51]);
  const sentence = 'ðə kˈɛɾᵊl ˈɔlwˌAz bəɡˈæn tə sˈɪŋ. ';
  const long = sentence.repeat(40).trim();
  const runs = kokoroChunks(long);
  assert.ok(runs.length > 1 && runs.every((r) => r.length <= 500), `${runs.length} runs`);
  assert.ok(runs.every((r) => r.endsWith('.')), 'each run ends at a sentence end');
  assert.equal(runs.join(' '), long);
});

const model = join(ROOT, 'voices', 'kokoro', 'model.onnx');
test('speech from the model, when it has been downloaded (scripts/fetch-voices.mjs)', { skip: !existsSync(model) && 'the model is not downloaded' }, async () => {
  const ort = await import('onnxruntime-node');
  const kokoro = await Kokoro.load(ort as unknown as OrtLike, model, 2);
  for (const voice of [BUILT_IN_VOICES[0]!, BUILT_IN_VOICES.find((v) => v.accent === 'gb')!]) {
    const raw = readFileSync(join(ROOT, 'voices', 'kokoro', `${voice.id}.bin`));
    const pack = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const accent = voice.accent ?? 'us';
    const audio = await kokoro.speak(phonemize('Hello there, Mr Camel.', accent === 'us' ? us : gb, accent), pack, 1);
    const seconds = audio.length / 24000;
    const rms = Math.sqrt(audio.reduce((n, x) => n + x * x, 0) / audio.length);
    assert.ok(seconds > 0.8 && seconds < 4, `${voice.id}: ${seconds.toFixed(2)} s`);
    assert.ok(rms > 0.01, `${voice.id}: not silent (${rms.toFixed(3)})`);
    const faster = await kokoro.speak(phonemize('Hello there, Mr Camel.', us, 'us'), pack, 1.5);
    assert.ok(faster.length < audio.length * 0.85, 'a higher speed is shorter');
  }
});
