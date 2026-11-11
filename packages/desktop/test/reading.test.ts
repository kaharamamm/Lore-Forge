/** Reading a chapter aloud: what is said, from where, and with which voice. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confidentLanguage, pickVoice, readParts, readRange, speakable, textLanguage } from '../src/renderer/reading.ts';

test('what is said: no Markdown marks or link brackets; links by their label or name', () => {
  const names: Record<string, string> = { 'char-nur': 'Nur', 'place-qarim': 'Qarim' };
  const nameOf = (ref: string) => names[ref] ?? ref;
  assert.equal(speakable('She was **very** *tired* at [[place-qarim]].', nameOf), 'She was very tired at Qarim.');
  assert.equal(speakable('[[char-nur|the girl]] met @char-nur (@place-qarim).', nameOf), 'the girl met Nur (Qarim).');
  assert.equal(speakable('## The Gate'), 'The Gate');
  assert.equal(speakable('> An old saying,\n> told twice.'), 'An old saying, told twice.');
  assert.equal(speakable('me@example.com'), 'me@example.com', 'an @ inside a word is not a link');
});

test('the parts to read: sentence by sentence, cut to the part chosen, scene breaks left out', () => {
  const body = 'Nur waited. The caravan came!\n\n* * *\n\nIt was night.';
  assert.deepEqual(readParts(body).map((p) => p.say), ['Nur waited.', 'The caravan came!', 'It was night.']);
  assert.deepEqual(readParts(body).map((p) => body.slice(p.start, p.end)), ['Nur waited.', 'The caravan came!', 'It was night.']);
  const from = body.indexOf('caravan');
  assert.deepEqual(readParts(body, from, body.indexOf('!')).map((p) => p.say), ['caravan came']);
});

test('where reading starts: the part chosen, the sentence with the caret, or the start', () => {
  const body = 'One two. Three four. Five.';
  assert.deepEqual(readRange(body, 9, 20), { from: 9, to: 20 });
  assert.deepEqual(readRange(body, 15, 15), { from: 9, to: body.length }, 'from the start of the caret sentence');
  assert.deepEqual(readRange(body, body.length, body.length), { from: 0, to: body.length }, 'a caret at the end reads it all');
  assert.deepEqual(readRange(body, 0, 0), { from: 0, to: body.length });
});

test('the book language marks its titles only when its text says so', () => {
  assert.equal(confidentLanguage('Su derindi ve kuyu şarkı söylüyordu. Işıklar yanıyordu.'), 'tr');
  // Too little text to tell: a short Turkish text may have none of ğ, ş, ı ("Dilek Gece Yolu").
  assert.equal(confidentLanguage('Dilek Gece Yolu'), undefined);
  assert.equal(confidentLanguage(''), undefined);
  const english = 'Every morning in Camelamamm began with a song, and every morning Mr Camel was awake to hear it. '.repeat(5);
  assert.equal(confidentLanguage(english), 'en');
  assert.equal(confidentLanguage(`${english} Nur waited at the gate of Kadıköy.`), 'en');
});

test('the voice: the text language picks it, a voice chosen before wins', () => {
  assert.equal(textLanguage('Su derindi ve kuyu şarkı söylüyordu. Işıklar yanıyordu.'), 'tr');
  assert.equal(textLanguage('Nur waited at the gate of Kadıköy until dusk, and the caravan came.'), 'en');
  const voices = [
    { name: 'Microsoft David', lang: 'en-US', default: false },
    { name: 'Microsoft Tolga', lang: 'tr-TR', default: true },
    { name: 'Microsoft Zira', lang: 'en-US', default: false },
  ];
  assert.equal(pickVoice(voices, 'en')?.name, 'Microsoft David');
  assert.equal(pickVoice(voices, 'tr')?.name, 'Microsoft Tolga');
  assert.equal(pickVoice(voices, 'en', 'Microsoft Zira')?.name, 'Microsoft Zira');
  assert.equal(pickVoice(voices, 'de')?.name, 'Microsoft Tolga', 'no German voice: the default');
  assert.equal(pickVoice([], 'en'), undefined);
});
