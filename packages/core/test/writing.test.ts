/** Writing help: the AI-phrasing notes on the story, and the chapter brief an AI gets before it writes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiPhrasingWarnings, analyzeStory, chapterBrief, check } from '@lore-forge/core';
import { world, type Draft } from './helpers.ts';

const pip: Draft[] = [{ id: 'char-pip', type: 'character', name: 'Pip' }];
const text = 'It was a testament to her patience. Little did they know the well was dry. The map\u2014old, torn, humming\u2014lay on the table. '
  + "It wasn't just a map. It was a promise. It's not a key, it's a song. It was not old. It was made of grey stone. A testament to nothing.";

test('AI-sounding phrasing is noted where it is in the chapter, and can be marked intended or turned off', () => {
  const w = world(pip, { story: text });
  const notes = aiPhrasingWarnings(w);
  assert.deepEqual(notes.map((n) => text.slice(...n.offending.span!)), ['a testament to', 'Little did they know', '\u2014old, torn, humming\u2014', "It wasn't just a map. It was ", "It's not a key, it's ", 'A testament to']);
  assert.ok(notes.every((n) => n.ruleId === 'ai-phrasing' && n.severity === 'info' && n.offending.chapter === w.story![0]!.file));
  // "It was not old. It was made of grey stone." describes; it is not the turn.
  assert.ok(!notes.some((n) => text.slice(...n.offending.span!).startsWith('It was not old')));
  // The same phrase twice gets two ids that do not move when text before them changes.
  assert.deepEqual(notes.filter((n) => n.id.includes('testament')).map((n) => n.id.split(':').pop()), ['1', '2']);
  const moved = aiPhrasingWarnings(world(pip, { story: `Once more. ${text}` }));
  assert.deepEqual(moved.map((n) => n.id), notes.map((n) => n.id));
  // Part of the story analysis (the Story view, check_book), with intended marks; off in world.json rules.
  assert.deepEqual(analyzeStory(w).warnings.filter((x) => x.ruleId === 'ai-phrasing').map((x) => x.id).sort(), notes.map((n) => n.id).sort());
  assert.equal(aiPhrasingWarnings(world(pip, { story: text, intended: [{ warningId: notes[0]!.id, note: 'Her voice.' }] }))[0]!.intended?.note, 'Her voice.');
  assert.deepEqual(aiPhrasingWarnings(world(pip, { story: text, manifest: { rules: { 'ai-phrasing': 'off' } } })), []);
});

test('a chapter brief: the voice, the story so far, and who is alive, where and how on the chapter\'s date', () => {
  const w = world([
    { id: 'char-camel', type: 'character', name: 'Mr Camel', born: '471', summary: 'A patient tea merchant.', locations: [{ place: 'place-town', from: '490' }], looks: [{ id: 'dusty', name: 'Dusty', after: 'The Storm', visual: { clothing: 'Sand in every fold' } }] },
    { id: 'char-ozra', type: 'character', name: 'Ozra', status: 'dead', died: '498' },
    { id: 'char-kid', type: 'character', name: 'Kid', born: '600' },
    { id: 'place-town', type: 'place', name: 'Camelamamm' },
    { id: 'place-fort', type: 'place', name: 'Old Fort', status: 'destroyed', destroyed: '300' },
    { id: 'evt-storm', type: 'event', name: 'The Storm', date: '511', place: 'place-town', summary: 'Sand buried the market.' },
    { id: 'evt-sluice', type: 'event', name: 'The Sluice', date: '513' },
  ], { manifest: { writingStyle: 'Third person, past tense. Warm and wry.' }, story: ['Mr Camel made tea.\n\nThe pot went cold.', 'Ozra was a memory now.'] });
  const brief = chapterBrief(w, { chapter: 'The Long Road', date: '512' });
  assert.match(brief, /^# Brief for a new chapter, "The Long Road", set in 512\n/);
  assert.match(brief, /## The book's voice\nThird person, past tense\. Warm and wry\./);
  assert.match(brief, /1\. \*\*Chapter 1\*\*, 8 words; with Mr Camel\.\n {3}Opens: Mr Camel made tea\.\n {3}Ends: The pot went cold\./);
  assert.match(brief, /## Where the chapter before ends\nOzra was a memory now\./);
  assert.match(brief, /## People on 512\n- Mr Camel: A patient tea merchant\. \(41 years old; lives in Camelamamm; looks as in "Dusty": clothing: Sand in every fold\)/);
  assert.match(brief, /- Not born yet: Kid \(born 600\)\./);
  assert.match(brief, /- Dead by then: Ozra \(died 498\)\./);
  assert.match(brief, /## Places on 512\n- Gone by then: Old Fort \(destroyed 300\)\./);
  assert.match(brief, /## Already happened\n- The Storm \(511, at Camelamamm\): Sand buried the market\./);
  assert.match(brief, /## Still to come \(do not let these happen early, and do not contradict them\)\n- The Sluice \(513\)/);
  // An existing chapter by number; no book voice: the chapters before set it.
  const plain = chapterBrief(world(pip, { story: ['One.', 'Two.'] }), { chapter: 2 });
  assert.match(plain, /^# Brief for chapter 2, "Chapter 2"\n/);
  assert.match(plain, /No writing style is set for this book/);
  assert.match(plain, /## This chapter now\nIt has 1 words; read_story gives its whole text\./);
});

test('entry text gets the same notes: the summary, the longer details and the body', () => {
  const w = world([{ id: 'char-nur', type: 'character', name: 'Nur', summary: 'A beacon of hope for the city.', body: 'She delved into the archives every night.', details: { personality: 'Quiet and sure; rarely laughs.' } }]);
  const notes = check(w).filter((x) => x.ruleId === 'ai-phrasing');
  assert.deepEqual(notes.map((n) => [n.offending.entryId, n.offending.field, n.severity]).sort(), [['char-nur', 'body', 'info'], ['char-nur', 'summary', 'info']]);
  assert.equal(w.entries[0]!.summary!.slice(...notes.find((n) => n.offending.field === 'summary')!.offending.span!), 'A beacon of hope');
  assert.deepEqual(check(world([{ id: 'char-nur', type: 'character', name: 'Nur', summary: 'A beacon of hope.' }], { manifest: { rules: { 'ai-phrasing': 'off' } } })).filter((x) => x.ruleId === 'ai-phrasing'), []);
});
