import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeStory, chapterPath, guessEntry, check, MentionMatcher, normalizeName, parseChapter, parseWorld, proposalEntry, ruleExtractor, sentences,
  serializeChapter, storyBook, type Proposal, type World,
} from '@lore-forge/core';
import { world, type Draft } from './helpers.ts';

const camel: Draft = { id: 'char-camel', type: 'character', name: 'Camel', born: '1998', status: 'alive' };
const qarim: Draft = { id: 'place-qarim', type: 'place', name: 'Qarim', status: 'standing' };

/** Open proposals for a story, as [kind, type, name, fields]. */
function proposals(story: string, drafts: Draft[] = [], ignored?: string[]): Proposal[] {
  return analyzeStory(world(drafts, { story, ...(ignored ? { ignored } : {}) })).proposals;
}
const one = (story: string, drafts: Draft[] = [], name?: string): Proposal => {
  const ps = proposals(story, drafts).filter((p) => !name || p.name === name);
  assert.ok(ps[0], `no proposal in: ${story}`);
  return ps[0];
};

// ------------------------------------------------------------------------------------------- storage

test('chapters: header, file-name fallbacks and round trip', () => {
  const { chapter, problems } = parseChapter('---\ntitle: The Salt Road\norder: 2\ndate: "1920"\nmood: dark\n---\n\nText.\n', 'story/02-the-salt-road.md');
  assert.deepEqual(problems, []);
  assert.deepEqual(chapter, { file: 'story/02-the-salt-road.md', title: 'The Salt Road', order: 2, date: '1920', body: 'Text.\n', extra: { mood: 'dark' } });
  assert.equal(parseChapter(serializeChapter(chapter), chapter.file).chapter.date, '1920', 'dates stay text');
  assert.equal(parseChapter(serializeChapter(chapter), chapter.file).chapter.body, chapter.body, 'the body round-trips, so sentence offsets stay put');
  const bare = parseChapter('Just prose.', 'story/07-into-the-dunes.md').chapter;
  assert.equal(bare.title, 'Into the dunes');
  assert.equal(bare.order, 7);
  assert.equal(chapterPath(3, 'Şafak at Qarım', ['story/03-safak-at-qarim.md']), 'story/03-safak-at-qarim-2.md');
});

test('a schemaVersion 1 world without story/ still loads, and story files load sorted', () => {
  const w = world([camel]);
  assert.equal(w.story?.length, 0);
  assert.equal(analyzeStory(w).warnings.length, 0);
  const files = [
    { path: 'world.json', content: JSON.stringify({ schemaVersion: 1, id: 'w', name: 'W', calendar: { eras: [{ id: 'Y', name: 'Year', start: 1 }], defaultEra: 'Y' } }) },
    { path: 'story/02-b.md', content: '---\ntitle: B\norder: 2\n---\nb' },
    { path: 'story/01-a.md', content: '---\ntitle: A\norder: 1\n---\na' },
    { path: 'story-ignored.json', content: '{"schemaVersion":1,"ignored":[{"key":"create:character:x"}]}' },
  ];
  const s = parseWorld(files);
  assert.deepEqual(s.story?.map((c) => c.title), ['A', 'B']);
  assert.deepEqual(s.storyIgnored, [{ key: 'create:character:x' }]);
  assert.deepEqual(s.issues, []);
});

test('sentences keep offsets and do not split dates or "c."', () => {
  const body = 'Camel was born on 12.03.1920. He died c. 1990!\nNext line';
  assert.deepEqual(sentences(body).map((s) => [s.text, body.slice(s.start, s.start + s.text.length) === s.text]), [
    ['Camel was born on 12.03.1920.', true], ['He died c. 1990!', true], ['Next line', true],
  ]);
});

// ------------------------------------------------------------------------------------------ patterns

test('born: the example sentence, with a title and a lowercase name', () => {
  const p = one('King camel born in 1998');
  assert.equal(p.kind, 'create');
  assert.equal(p.entryType, 'character');
  assert.equal(p.name, 'Camel');
  assert.deepEqual(p.fields, { born: '1998', title: 'King', aliases: ['King Camel'] });
  assert.equal(p.sourceSpan.quote, 'King camel born in 1998');
  assert.deepEqual(one('King Camel was born in 1998.').fields.born, '1998');
});

test('born: partial dates, approximate dates and eras', () => {
  assert.equal(one('Leyla was born on 12.03.1920.').fields.born, '12.03.1920');
  assert.equal(one('Leyla was born in 03.1920.').fields.born, '03.1920');
  assert.equal(one('Leyla was born around 312 OK.').fields.born, '~312 OK');
  assert.equal(one('In 1900, Leyla was born.').fields.born, '1900', 'a single date elsewhere in the sentence counts');
  assert.equal(proposals('Leyla was born in 1900 XX.')[0]?.fields.born, undefined, 'no unknown eras');
});

test('died sets the death date and status', () => {
  assert.deepEqual(one('Camel died in 2050.').fields, { died: '2050', status: 'dead' });
  assert.deepEqual(one('Camel died.').fields, { status: 'dead' });
});

test('A killed B in DATE: an event plus B’s death', () => {
  const ps = proposals('Orsan killed Queen Ilsa in 1920 at Saltmere.');
  const ev = ps.find((p) => p.entryType === 'event')!;
  assert.equal(ev.name, 'The Death of Ilsa');
  assert.deepEqual(ev.fields, { date: '1920', place: 'Saltmere', actions: [{ actor: 'Orsan', verb: 'killed', target: 'Ilsa' }] });
  const ilsa = ps.find((p) => p.name === 'Ilsa')!;
  assert.deepEqual(ilsa.fields, { died: '1920', status: 'dead', title: 'Queen', aliases: ['Queen Ilsa'] });
  assert.ok(ps.find((p) => p.name === 'Orsan' && p.entryType === 'character'));
  assert.ok(ps.find((p) => p.name === 'Saltmere' && p.entryType === 'place'));
  assert.equal(proposals('Ilsa was slain by Orsan in 1920.').find((p) => p.entryType === 'event')?.fields.actions?.[0]?.actor, 'Orsan');
});

test('married and son/daughter of become relations', () => {
  assert.deepEqual(one('Leyla married Tarik in 1950.', [], 'Leyla').fields, { relations: [{ type: 'spouse-of', target: 'Tarik', from: '1950' }] });
  assert.deepEqual(one('Hadi, son of Leyla, rode north.', [], 'Hadi').fields, { relations: [{ type: 'child-of', target: 'Leyla' }] });
  assert.deepEqual(one('Mira was the daughter of Zehra.', [], 'Mira').fields, { relations: [{ type: 'child-of', target: 'Zehra' }] });
});

test('"the X of Place" gives a title and a place; titles are stripped into a title field', () => {
  const ps = proposals('Ilsa, the Salt Queen of Saltmere, ruled long.');
  assert.deepEqual(ps.find((p) => p.name === 'Ilsa')?.fields, { title: 'Salt Queen of Saltmere' });
  assert.ok(ps.find((p) => p.name === 'Saltmere' && p.entryType === 'place'));
  assert.ok(proposals('He met the Sultan of Qarim.').find((p) => p.name === 'Qarim' && p.entryType === 'place'));
  assert.deepEqual(one('Sir Tarik was born in 1900.').fields, { born: '1900', title: 'Sir', aliases: ['Sir Tarik'] });
});

test('in/at Place proposes a place, but not months, eras or people with titles', () => {
  assert.ok(proposals('They rested in Qarim.').find((p) => p.name === 'Qarim' && p.entryType === 'place'));
  const w = world([], { story: 'It rained in Highsun. They knelt at King Camel’s feet.', manifest: { calendar: { eras: [{ id: 'AS', name: 'After the Sundering', start: 1 }], defaultEra: 'AS', months: [{ name: 'Highsun', days: 30 }] } } });
  assert.deepEqual(analyzeStory(w).proposals.filter((p) => p.entryType === 'place'), []);
});

test('battle/war/siege of X in DATE is an event', () => {
  const ps = proposals('Camel fell at the Battle of Qarim in 1925.', [camel]);
  const ev = ps.find((p) => p.entryType === 'event')!;
  assert.equal(ev.name, 'The Battle of Qarim');
  assert.deepEqual(ev.fields, { date: '1925', place: 'Qarim', participants: ['char-camel'] });
  assert.equal(one('The Siege of the Bronze Gate lasted a year.', [], 'The Siege of the Bronze Gate').entryType, 'event');
  const war = proposals('The War of the Sands began in 1800.');
  assert.equal(war.find((p) => p.entryType === 'event')?.name, 'The War of the Sands');
  assert.equal(war.find((p) => p.entryType === 'place'), undefined, 'a war is not at a place');
});

const saltmere: Draft = { id: 'place-saltmere', type: 'place', name: 'Saltmere', status: 'standing' };

test('a deed at a place is an event: "Hadi fought at Saltmere in 1920, the night the salt queen fell."', () => {
  const ps = proposals('Hadi fought at Saltmere in 1920, the night the salt queen fell.', [saltmere]);
  const ev = ps.find((p) => p.entryType === 'event');
  assert.ok(ev, 'an event');
  assert.equal(ev.name, 'The Battle of Saltmere');
  assert.equal(ev.fields.place, 'Saltmere', 'the existing place');
  assert.equal(ev.fields.date, '1920');
  assert.deepEqual(ev.fields.participants, ['Hadi']);
  assert.ok(ev.confidence >= 0.6, 'a known place and a date make it sure');
  assert.ok(ps.some((p) => p.entryType === 'character' && p.name === 'Hadi'), 'the participant');
  assert.ok(!ps.some((p) => p.entryType === 'place' && p.kind === 'create'), 'Saltmere already exists');
  assert.ok(!ps.some((p) => /salt queen/i.test(p.name)), 'no noise from the lowercase clause');
  const siege = one('Tarik besieged Qarim in 1801.', [], 'The Siege of Qarim');
  assert.deepEqual(siege.fields, { place: 'Qarim', date: '1801', participants: ['Tarik'] });
  assert.ok(siege.confidence < ev.confidence, 'an unknown place is less sure');
  assert.equal(one('The raid on Qarim failed.', [qarim], 'The Raid on Qarim').fields.place, 'Qarim');
  assert.ok(!proposals('Leyla attacked Tarik.').some((p) => p.entryType === 'event'), 'a deed against a person is no event');
  assert.ok(!proposals('They fought at dawn. They fought at Hollow.').some((p) => p.entryType === 'event'), 'no event without a sign it is a place');
});

test('places from motion and description, less sure when ambiguous', () => {
  const rode = one('They rode to Zarnak.', [], 'Zarnak');
  assert.equal(rode.entryType, 'place');
  const port = one('Qarim, a port on the salt sea, burned.', [], 'Qarim');
  assert.equal(port.entryType, 'place');
  assert.ok(port.confidence > rode.confidence, '"X, a port" is surer than "rode to X"');
  assert.equal(one('Smoke rose over the walls of Dunmar.', [], 'Dunmar').entryType, 'place');
  assert.ok(!proposals('He walked to the market. She went home.').length);
  assert.ok(!proposals('Leyla rode to Camel.', [camel]).some((p) => p.entryType === 'place'), 'a known character is not a place');
});

test('items and weapons: named things and more weapon words', () => {
  const blade = one('Leyla drew a sword called Dawnbreaker.', [], 'Dawnbreaker');
  assert.equal(blade.entryType, 'item');
  assert.ok(blade.confidence >= 0.8);
  assert.equal(one('Tarik wielded the Obsidian Scimitar.', [], 'The Obsidian Scimitar').entryType, 'item');
  assert.deepEqual(one('Tarik wielded the Obsidian Scimitar.', [], 'Tarik').fields.relations, [{ type: 'wields', target: 'The Obsidian Scimitar' }]);
  assert.ok(!proposals('She sharpened her sword and slept.').length, 'a plain weapon is no item');
});

test('factions: group words, House/Clan names and membership', () => {
  assert.equal(one('Hadi joined the Order of the Silver Flame.', [], 'The Order of the Silver Flame').entryType, 'faction');
  assert.deepEqual(one('Hadi joined the Order of the Silver Flame.', [], 'Hadi').fields.relations, [{ type: 'member-of', target: 'The Order of the Silver Flame' }]);
  assert.equal(one('House Varr ruled the north.', [], 'House Varr').entryType, 'faction');
  assert.deepEqual(one('Mira, a member of the Thieves\' Guild, laughed.', [], 'Mira').fields.relations, [{ type: 'member-of', target: 'The Thieves\' Guild' }]);
  assert.equal(one('Hadi led the Sand Clans.', [], 'Hadi').fields.relations?.[0]?.type, 'leader-of');
  assert.ok(!proposals('The Order was silent. The guard slept.').length, 'one group word is too unsure');
});

test('named events without "of": "the Great Fire"', () => {
  const fire = one('The Great Fire took the city.', [], 'The Great Fire');
  assert.equal(fire.entryType, 'event');
  assert.ok(fire.confidence < 0.6, 'a name alone is a guess');
});

test('guessEntry: a picked name gets a type from the world, the sentence or its words', () => {
  const w = world([qarim, camel]);
  assert.equal(guessEntry(w, 'qarim')?.existing?.id, 'place-qarim', 'an existing entry, any case');
  assert.equal(guessEntry(w, 'Camel')?.existing?.id, 'char-camel');
  assert.equal(guessEntry(w, 'Saltmere', 'Hadi fought at Saltmere in 1920.')?.type, 'place', 'the sentence decides');
  assert.equal(guessEntry(w, 'Dawnbreaker', 'Leyla drew a sword called Dawnbreaker.')?.type, 'item');
  assert.equal(guessEntry(w, 'the Order of the Silver Flame')?.type, 'faction');
  assert.equal(guessEntry(w, 'the Order of the Silver Flame')?.name, 'The Order of the Silver Flame');
  assert.equal(guessEntry(w, 'Battle of Reeds')?.type, 'event');
  assert.equal(guessEntry(w, 'Mira')?.type, 'character');
  assert.equal(guessEntry(w, 'an old song about salt')?.type, 'note');
  assert.equal(guessEntry(w, '   '), undefined);
});

test('"the Capitalised Item" with item words', () => {
  assert.deepEqual(proposals('She found the Glass Compass and the Crown of Thorns, but not the Crown.').filter((p) => p.entryType === 'item').map((p) => p.name), ['The Crown of Thorns', 'The Glass Compass']);
});

test('any new capitalised name is proposed: "Keller the grand magus created the scepter. he was a very good wizard."', () => {
  const ps = proposals('Keller the grand magus created the scepter. he was a very good wizard.');
  const keller = ps.find((p) => p.name === 'Keller');
  assert.equal(keller?.kind, 'create');
  assert.equal(keller?.entryType, 'character');
  assert.ok(/magus|wizard/i.test(`${keller?.fields.title} ${keller?.fields.occupation}`), 'title or occupation from the appositive');
  assert.equal(keller?.fields.title, 'Grand Magus');
  assert.equal(keller?.fields.occupation, 'magus');
  assert.equal(keller?.fields.gender, 'male', '"he" on a lowercase sentence start');
  assert.deepEqual(keller?.fields.relations, [{ type: 'made', target: 'The Scepter' }], 'creator of the scepter');
  const scepter = ps.find((p) => p.entryType === 'item');
  assert.equal(scepter?.name, 'The Scepter');
  assert.equal(ps.length, 2);
  const e = proposalEntry(keller!, world([]), new Set(), new Map([['scepter', 'item-the-scepter']]));
  assert.deepEqual([e.details, e.relations], [{ title: 'Grand Magus', occupation: 'magus', gender: 'male' }, [{ type: 'made', target: 'item-the-scepter' }]]);
});

test('names: roles, item deeds, pronouns and places from context', () => {
  assert.deepEqual(one('Leyla, the healer, rode north.', [], 'Leyla').fields, { occupation: 'healer' });
  assert.deepEqual(one('Keller the Grand Magus forged the Ruby Scepter of Dawn.', [], 'Keller').fields.relations, [{ type: 'made', target: 'The Ruby Scepter of Dawn' }]);
  assert.deepEqual(proposals('Tarik stole the Glass Compass.').map((p) => [p.entryType, p.name]), [['character', 'Tarik'], ['item', 'The Glass Compass']]);
  assert.equal(one('Mira walked home. She was the queen.', [], 'Mira').fields.gender, 'female');
  assert.equal(one('They rode across Zarnak.', [], 'Zarnak').entryType, 'place');
  assert.equal(one('Tobias laughed.').name, 'Tobias');
  // A pronoun after two people is unclear, and a bare pronoun never changes an existing entry.
  assert.equal(proposals('Leyla met Tarik. He was a smith.').some((p) => p.fields.occupation), false);
  assert.deepEqual(proposals('Camel rode north. He was tired.', [camel]), []);
  assert.deepEqual(one('Camel rode north. He was a smith.', [camel]).fields, { occupation: 'smith', gender: 'male' });
  assert.deepEqual(proposals('Mira the healer was born in 1900.', [{ id: 'char-mira', type: 'character', name: 'Mira', born: '1900', details: { occupation: 'scribe' } } as Draft]), [], 'occupation only fills a gap');
});

test('names: no proposals for common words, pronouns, months or plain sentences', () => {
  for (const t of ['The caravan left before dawn.', 'Later, they rested.', 'Suddenly the stars went out.', 'Nobody spoke. Night fell.', 'I am here. Yes.', 'In March the wells ran dry.', 'He met the Sultan.', 'Dawn came. dawn came again.']) {
    assert.deepEqual(proposals(t).map((p) => p.name), [], t);
  }
  assert.deepEqual(proposals('Leyla was born in 1900 XX.').map((p) => p.name), ['Leyla'], 'short capitals are not names');
});

test('names: none for contractions, questions, commands, numbers or plurals at the start of a sentence', () => {
  const story = [
    'Hadiya rang the bell. Bells clanked and fell quiet. The old camel lay down. Camels never hurry.',
    '"Remember the smell," said Hadiya. "Are you sure?" asked Zahra. Four days later they rested.',
    '"I\'m here. We\'ll go. Don\'t stop. You’ve seen it." Sit down. Much later the wind came. Let\'s go. Will you sing? Zahra sang.',
    'She said, "Are we there?" *Camels never get lost.* "*Follow the dunes,*" sang Zahra. He asked, \'Can you hear it?\'',
    'A fox cannot fly. Foxes dig. Flying is mostly falling. Near the top she stopped. Stories travel. It was a good story.',
  ].join(' ');
  assert.deepEqual([...new Set(proposals(story).map((p) => p.name))], ['Hadiya', 'Zahra']);
  // A name whose letters only look like a plain form stays a name.
  assert.deepEqual(proposals('A jam jar fell. James laughed. Irving ran in. Rivers sang.').map((p) => p.name), ['James', 'Irving', 'Rivers']);
  assert.deepEqual(proposals('Hadiya waited for Will. Will came at dusk.').map((p) => p.name), ['Hadiya', 'Will'], 'a name in the middle of a sentence still counts');
});

/** The new entries a story proposes, as { name: type }. */
const kinds = (story: string) => Object.fromEntries(proposals(story).filter((p) => p.kind === 'create').map((p) => [p.name, p.entryType]));

test('names: the last word of a name says what it is', () => {
  assert.deepEqual(kinds('The smoke drifted over Hollin Wood.'), { 'Hollin Wood': 'place' });
  assert.deepEqual(kinds('Coombe Farm lay quiet.'), { 'Coombe Farm': 'place' });
  assert.deepEqual(kinds('They fished in the Mirror Tarn.'), { 'Mirror Tarn': 'place' }, 'a tarn, not a mirror');
  assert.deepEqual(kinds('The Seven Founders built the town.'), { 'The Seven Founders': 'faction' });
  assert.deepEqual(kinds('Wren carried the Copper Paddle.'), { Wren: 'character', 'The Copper Paddle': 'item' });
  assert.deepEqual(kinds('Crown Prince Arek laughed.'), { 'Crown Prince Arek': 'character' }, 'a prince, not a crown');
  assert.deepEqual(kinds('The Great Rockfall buried the road.'), { 'The Great Rockfall': 'event' });
  assert.deepEqual(kinds('The Hero Trials of 527 began at noon.'), { 'The Hero Trials': 'event' });
  // A surname that is also a place or thing word stays a person without "the" or a place word before it.
  assert.deepEqual(kinds('Edmund Hall rode north.'), { 'Edmund Hall': 'character' });
  assert.deepEqual(kinds('Ayla Reyes met Ayla Stone.'), { 'Ayla Reyes': 'character', 'Ayla Stone': 'character' });
  assert.deepEqual(kinds('They feasted in the Great Hall.'), { 'Great Hall': 'place' });
  assert.deepEqual(kinds("Zahra wore Hadiya's Bell."), { Zahra: 'character', "Hadiya's Bell": 'item' }, 'named by its owner, without "The"');
  // A group's name is never a person: Lady Mira is the one born here.
  const mira = proposals('Lady Mira of House Tarn was born in 1180.');
  assert.deepEqual(Object.fromEntries(mira.map((p) => [p.name, p.entryType])), { 'House Tarn': 'faction', Mira: 'character' });
  assert.equal(mira.find((p) => p.name === 'Mira')?.fields.born, '1180');
});

test('names: "the" names after place words are places, not people or nothing', () => {
  assert.deepEqual(kinds('The caravan crossed the Red Erg.'), { 'Red Erg': 'place' });
  assert.deepEqual(kinds('The sun set behind The Snowcrown.'), { Snowcrown: 'place' });
  assert.deepEqual(kinds('They rode from the Broken Tooth.'), { 'Broken Tooth': 'place' });
  assert.deepEqual(kinds('Wren swam into the Millpond.'), { Wren: 'character', Millpond: 'place' });
  assert.deepEqual(kinds('In the Red Erg, the caravan rested.'), { 'Red Erg': 'place' }, 'a sentence opening "In the ..."');
  assert.deepEqual(kinds('They rode out of Highgate at dawn.'), { Highgate: 'place' });
  assert.deepEqual(kinds('The wolves of the Greywood howled.'), { Greywood: 'place' });
  assert.deepEqual(kinds('He drew water from the shaft of the Moon Well.'), { 'Moon Well': 'place' }, '"Well" is a stop word, but not inside a name');
  assert.deepEqual(kinds('They gathered in the Hall of Heroes.'), { 'The Hall of Heroes': 'place' });
  assert.deepEqual(kinds('Lanterns hung in The Square of Bells.'), { 'The Square of Bells': 'place' });
  assert.deepEqual(kinds('They met in the Night Market.'), { 'Night Market': 'place' });
  assert.deepEqual(kinds('Everyone remembered the Ringing of the Bell.'), { 'The Ringing of the Bell': 'event' });
  assert.deepEqual(kinds('Rhys carried the Sunblade, a sword forged in Edda.'), { Rhys: 'character', 'The Sunblade': 'item', Edda: 'place' });
  // ... but people and titles stay people
  assert.deepEqual(kinds('She looked back at Yusuf.'), { Yusuf: 'character' }, 'looked at a person');
  assert.deepEqual(kinds('Glen asked for water.'), { Glen: 'character' });
  assert.deepEqual(kinds('Mira turned toward the Steward.'), { Mira: 'character' }, 'a title, not a place');
  assert.deepEqual(kinds('Above the Hall rose a tower.'), {}, '"the Hall" alone is too vague');
});

test('names: no proposals for signs, commands, plain plurals or owners', () => {
  for (const t of ['"Hang it on the bell," she said.', 'The sign said I RING FOR THE HERO.', 'Children were hanging lanterns.', 'Carpenters were building a wall.', 'Flower of the market!', "It has been in the Heralds' vault ever since."]) {
    assert.deepEqual(kinds(t), {}, t);
  }
  assert.deepEqual(kinds('"Ring the Hero\'s Bell?" she asked.'), { "The Hero's Bell": 'item' }, 'the command is not part of the name');
  assert.deepEqual(kinds("'Engines are ready,' said Teo."), { Teo: 'character' });
});

test('names: a first name alone is the one new person whose full name starts with it', () => {
  assert.deepEqual(kinds('Rhys Varn rode north. Rhys was tired.'), { 'Rhys Varn': 'character' });
  assert.deepEqual(kinds('Ayla Reyes met Ayla Stone. Ayla smiled.'), { 'Ayla Reyes': 'character', 'Ayla Stone': 'character', Ayla: 'character' }, 'two Aylas: unclear, so kept apart');
});

test('the extraction of an unchanged chapter is reused; new names or new text read it again', () => {
  const story = 'Leyla rode to Qarim. Tobias waited.';
  const w = world([], { story });
  const first = ruleExtractor.extract({ world: w, chapters: w.story! });
  const again = ruleExtractor.extract({ world: { ...w, entries: [...w.entries] }, chapters: w.story! });
  assert.equal(again.proposals[0], first.proposals[0], 'same chapter and names: the same result objects');
  assert.equal(kinds(story)['Qarim'], 'place', 'Qarim is new without an entry');
  const known = world([qarim], { story });
  assert.equal(analyzeStory(known).proposals.some((p) => p.name === 'Qarim'), false, 'with a Qarim entry the chapter is read again and Qarim is known');
  const edited = { ...w, story: [{ ...w.story![0]!, body: 'Leyla rode to Saltmere.' }] };
  assert.deepEqual(analyzeStory(edited).proposals.map((p) => p.name).sort(), ['Leyla', 'Saltmere']);
});

// ---------------------------------------------------------------------------------------- matching

test('existing entries match by name or alias, case-insensitive: a match without news is a link, not a proposal', () => {
  const a = analyzeStory(world([camel], { story: 'King Camel was born in 1998.' }));
  assert.deepEqual(a.proposals.filter((p) => p.entryType === 'character').map((p) => [p.kind, p.name, p.fields]), [['update', 'Camel', { title: 'King', aliases: ['King Camel'] }]]);
  const b = analyzeStory(world([{ ...camel, aliases: ['King Camel'], extra: { title: 'King' } } as Draft], { story: 'king camel was born in 1998.' }));
  assert.deepEqual(b.proposals, []);
  assert.deepEqual(b.links.map((l) => l.entryId), ['char-camel'], 'shown as "already exists"');
});

test('a match that adds or changes a field is an update, with the old value', () => {
  const p = one('Camel was born in 1990.', [camel]);
  assert.equal(p.kind, 'update');
  assert.equal(p.matchedExistingId, 'char-camel');
  assert.deepEqual(p.fields, { born: '1990' });
  assert.deepEqual(p.previous, { born: '1998' });
  assert.deepEqual(one('Camel died in 2050.', [camel]).fields, { died: '2050', status: 'dead' });
});

test('a bare name finds the one character it starts, so no look-alike duplicates', () => {
  const kadir: Draft = { id: 'char-kadir', type: 'character', name: 'Kadir Humpback' };
  const ilsa: Draft = { id: 'char-ilsa', type: 'character', name: 'Queen Ilsa', died: '1920', status: 'dead' };
  assert.equal(one('Kadir was born in 1890.', [kadir, ilsa]).matchedExistingId, 'char-kadir');
  assert.deepEqual(analyzeStory(world([kadir, ilsa], { story: 'Ilsa died in 1920.' })).links.map((l) => l.entryId), ['char-ilsa']);
});

test('a name that exists as another type is a link; the same name twice is one proposal', () => {
  const a = analyzeStory(world([qarim], { story: 'Qarim was born in 1900.' }));
  assert.deepEqual(a.proposals, []);
  const ps = proposals('Baran was born in 1872. Baran died in 1950.');
  assert.equal(ps.length, 1);
  assert.deepEqual(ps[0]!.fields, { born: '1872', died: '1950', status: 'dead' });
  assert.equal(ps[0]!.alsoAt?.length, 1);
});

test('Turkish İ/ı folding: names match across dotted and dotless i', () => {
  assert.equal(normalizeName('İLSA'), normalizeName('ılsa'));
  assert.equal(normalizeName('Işık'), normalizeName('işik'));
  const ilsa: Draft = { id: 'char-ilsa', type: 'character', name: 'Ilsa', born: '1880' };
  assert.equal(one('İlsa died in 1920.', [ilsa]).matchedExistingId, 'char-ilsa');
  const isik: Draft = { id: 'char-isik', type: 'character', name: 'Işık' };
  assert.equal(one('İşık was born in 1900.', [isik]).matchedExistingId, 'char-isik');
  assert.equal(one('Leyla was born 1900.').fields.born, '1900', '"in" is optional right after the verb');
  const m = new MentionMatcher(world([ilsa]).entries);
  assert.deepEqual(m.find('Then İlsa and ılsa spoke.').map((x) => x.text), ['İlsa'], 'case still counts, dots do not');
});

test('ignored proposals stay hidden and come back when they change', () => {
  const key = one('Baran was born in 1872.').key;
  assert.equal(key, 'create:character:baran');
  assert.deepEqual(proposals('Baran was born in 1872.', [], [key]), []);
  const upd = one('Camel was born in 1990.', [camel]).key;
  assert.deepEqual(proposals('Camel was born in 1990.', [camel], [upd]), []);
  assert.equal(proposals('Camel was born in 1991.', [camel], [upd]).length, 1);
});

test('the rule extractor is deterministic', () => {
  const w = world([camel], { story: ['King Camel was born in 1998. Orsan killed Ilsa in 1920.', 'Leyla married Tarik.'] });
  const input = { world: w, chapters: w.story! };
  assert.deepEqual(ruleExtractor.extract(input), ruleExtractor.extract(input));
});

test('proposalEntry builds a real entry: title, alias, status and quote', () => {
  const p = one('King camel born in 1998');
  const w = world([]);
  const e = proposalEntry(p, w, new Set());
  assert.deepEqual({ ...e }, { id: 'char-camel', type: 'character', name: 'Camel', body: '> King camel born in 1998\n', status: 'unknown', details: { title: 'King' }, aliases: ['King Camel'], born: '1998' });
  assert.equal(proposalEntry(p, w, new Set(['char-camel'])).id, 'char-camel-2');
});

// -------------------------------------------------------------------------------------------- warnings

const storyWarnings = (w: World) => check(w).filter((x) => x.offending.entryId.startsWith('story:'));

test('story warnings: a deed before the birth the story itself proposes', () => {
  const w = world([], { story: 'King Camel was born in 1998. Camel fought at Qarim in 1990.' });
  const [x, ...rest] = storyWarnings(w);
  assert.equal(rest.length, 0);
  assert.equal(x!.ruleId, 'before-birth');
  assert.equal(x!.message, "Camel can't fight in 1990: Camel was born in 1998 (source: Story/Chapter 1).");
  assert.deepEqual(x!.offending, { entryId: 'story:story/01-chapter-1.md', field: 'body', source: 'Story/Chapter 1', chapter: 'story/01-chapter-1.md', span: [29, 59] });
  assert.equal(w.story![0]!.body.slice(...x!.offending.span!), 'Camel fought at Qarim in 1990.');
});

test('story warnings: deeds against existing entries, and after death', () => {
  const dead: Draft = { id: 'char-orsan', type: 'character', name: 'Orsan', born: '1740', died: '1800', status: 'dead' };
  const [x] = storyWarnings(world([dead], { story: 'Orsan rode to Qarim in 1850.' }));
  assert.equal(x?.ruleId, 'after-death');
  assert.deepEqual(x?.conflicting, { entryId: 'char-orsan', field: 'died', source: 'Characters/Orsan' });
  const [k] = storyWarnings(world([camel], { story: 'Orsan killed Camel in 1990.' }));
  assert.equal(k?.ruleId, 'before-birth', 'the proposed killing happens before Camel was born');
});

test('story warnings: the story contradicts an entry', () => {
  const [x] = storyWarnings(world([camel], { story: 'Camel was born in 1990.' }));
  assert.equal(x?.ruleId, 'story-contradiction');
  assert.equal(x?.message, 'The story says Camel was born in 1990, but Characters/Camel says 1998.');
  assert.equal(x?.severity, 'warning');
  assert.deepEqual(storyWarnings(world([camel], { story: 'Camel was born in 1990.', manifest: { rules: { 'story-contradiction': 'off' } } })), []);
});

test('story warnings: none for a story that agrees, none for ignored proposals, and intended marks apply', () => {
  assert.deepEqual(storyWarnings(world([camel], { story: 'Camel was born in 1998. Camel fought in 2020.' })), []);
  const key = 'update:char-camel:{born:"1990"}';
  assert.equal(one('Camel was born in 1990.', [camel]).key, key);
  assert.deepEqual(storyWarnings(world([camel], { story: 'Camel was born in 1990.', ignored: [key] })), []);
  const id = 'story-contradiction:char-camel:born:1990';
  assert.ok(storyWarnings(world([camel], { story: 'Camel was born in 1990.', intended: [{ warningId: id }] }))[0]?.intended);
});

test('Story Book: manuscript chapters as prose, the chronicle as appendix', () => {
  const ev: Draft = { id: 'evt-a', type: 'event', name: 'The Toll Dispute', date: '1900', body: 'Chronicle text.' };
  const doc = storyBook(world([ev], { story: ['The road was long.', ''] }));
  const heads = doc.blocks.filter((b) => b.kind === 'heading').map((b) => (b as { text: string }).text);
  // The chapter is titled "Chapter 1" (the app's name for a new one): the heading is that number once.
  assert.deepEqual(heads, ['Chapter 1', 'Appendix: Chronicle', 'After the Sundering', 'The Toll Dispute']);
  const noAppendix = storyBook(world([ev], { story: 'The road was long.' }), { appendix: false });
  assert.equal(noAppendix.blocks.some((b) => b.kind === 'heading' && b.text === 'Appendix: Chronicle'), false);
  const old = storyBook(world([ev]));
  assert.equal(old.blocks.some((b) => b.kind === 'heading' && b.text === 'Chapter 1. After the Sundering'), true, 'no story: same book as before');
});
