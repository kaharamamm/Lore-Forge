import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  analyzeStory, builtinRules, BUNDLED_FONTS, calendarProblems, check, CHRONICLE_APPENDIX, CORE_TR, DATE_FORMATS_HINT, describeDate, DETAIL_FIELDS,
  DETAIL_SECTIONS, ENTRY_TYPES, familyTree, IMAGE_VIEWS, LIFECYCLE, localize, localizeDoc, LORE_AND_LEGENDS, msg, parseManifest, parseWorld, recordMessages,
  RELATION_GROUPS, RELATION_KINDS, relationWeb, searchEntries, SINGLE_CHAPTER, storyBook, storyContradiction, aiPhrasing, timelineModel, TITLE_STYLE_LABELS, toMarkdown,
  TRIMS, TYPE_LABELS, TYPE_SINGULAR, viewLabel, VISUAL_FIELDS, worldCodex, type Block, type Doc, type Warning, type World,
} from '@lore-forge/core';
import { gltfMustBeEmbedded, loadWorld } from '@lore-forge/core/node';
import { built, world } from './helpers.ts';

const ROOT = join(import.meta.dirname, '../../..');

test('msg gives exactly what a plain template literal gives', () => {
  recordMessages(false);
  const obj = { toString: () => 'object' };
  for (const v of ['Orsan', 0, -1.5, undefined, null, true, obj, '', 'a{0}b']) {
    assert.equal(msg`${v} can't be in ${v} (source: ${v}).`, `${v} can't be in ${v} (source: ${v}).`);
  }
  assert.equal(msg`no values at all`, 'no values at all');
  assert.equal(msg`${'only'}`, 'only');
  assert.equal(msg`${1}${2}${3}`, '123');
  recordMessages(true);
  assert.equal(msg`${'Orsan'} died ${msg`in ${1800}`}.`, 'Orsan died in 1800.');
  recordMessages(false);
});

test('with recording off nothing made with values is remembered; fixed texts always are', () => {
  recordMessages(false);
  const table = { 'Hello {0}': 'Merhaba {0}', 'Fixed phrase': 'Sabit söz' };
  const made = msg`Hello ${'Ayşe'}`;
  const missing: string[] = [];
  assert.equal(localize(made, table, (k) => missing.push(k)), 'Hello Ayşe');
  assert.equal(missing.length, 0, 'an unknown text is not reported missing');
  assert.equal(localize(msg`Fixed phrase`, table), 'Sabit söz');
  localize(msg`A fixed phrase without Turkish`, table, (k) => missing.push(k));
  assert.deepEqual(missing, ['A fixed phrase without Turkish']);
  recordMessages(true);
  assert.equal(localize(msg`Hello ${'Ayşe'}`, table), 'Merhaba Ayşe');
  recordMessages(false);
  assert.equal(localize('Hello Ayşe', table), 'Hello Ayşe', 'turning recording off forgets what was made');
});

test('localize: reordered and repeated placeholders, nested texts, partial translation, whole-text fallback', () => {
  recordMessages(true);
  const table = {
    '{0} died {1}.': '{0}: {1} öldü.',
    'in {0}': '{0} yılında',
    '{0} met {1}': '{1} ile {0} buluştu ({0} önce geldi)',
    died: 'öldü',
    Characters: 'Karakterler',
  };
  const when = msg`in ${1800}`;
  assert.equal(localize(msg`${'Orsan'} died ${when}.`, table), 'Orsan: 1800 yılında öldü.', 'a value made by msg is translated in place');
  assert.equal(localize(msg`${'Orsan'} met ${'Ilsa'}`, table), 'Ilsa ile Orsan buluştu (Orsan önce geldi)', 'placeholders move and repeat');
  const missing: string[] = [];
  assert.equal(localize(msg`${'Orsan'} was born ${when}.`, table, (k) => missing.push(k)), 'Orsan was born 1800 yılında.', 'no Turkish: the English template with Turkish values');
  assert.deepEqual(missing, ['{0} was born {1}.']);
  assert.equal(localize(msg`${'Orsan'} ${msg`died`}`, table), 'Orsan öldü', 'a fixed word inside a text');
  assert.equal(localize('died', table), 'öldü');
  assert.equal(localize('Characters', table), 'Karakterler', 'a static label is looked up as a whole');
  assert.equal(localize('Someone wrote this', table), 'Someone wrote this', 'other text stays as it is');
  assert.equal(localize('constructor', table), 'constructor', 'only the table’s own keys count');
  assert.equal(localize(msg`${'died'} is a name here`, { '{0} is a name here': '{0} burada bir ad', died: 'öldü' }), 'öldü burada bir ad', 'a value equal to a registered word is translated too (texts are known by their text)');
  recordMessages(false);
});

test('localizeDoc translates core’s words and leaves the author’s text alone', () => {
  recordMessages(true);
  const doc: Doc = {
    kind: 'codex',
    title: msg`${'The Sands'}: World Codex`,
    cover: { title: 'The Sands', subtitle: msg`World Codex`, lines: ['Written by the author.', msg`${3} entries · ${0} reference images · ${1} open warnings`] },
    blocks: [
      { kind: 'heading', level: 1, text: msg`Timeline`, toc: true },
      { kind: 'heading', level: 2, text: 'Orsan the Grey' },
      { kind: 'para', text: 'Orsan walked to the well.' },
      { kind: 'facts', rows: [[msg`Born`, '1800 AS'], ['Favourite tea', 'Mint']] },
      { kind: 'list', items: [msg`${'Orsan'}: alias of ${'The Grey'}`, 'A list item of the author'] },
      { kind: 'image', file: 'images/a.png', caption: msg`${'Orsan'}: ${viewLabel('front')}`, details: [msg`File: ${'images/a.png'}`] },
      { kind: 'box', title: msg`Art brief: ${'Orsan'}`, blocks: [{ kind: 'prompt', label: msg`Image prompt`, text: 'Full-body character concept art of Orsan.' }] },
      { kind: 'toc' },
    ],
  };
  const tr = localizeDoc(doc, CORE_TR);
  assert.equal(tr.title, 'The Sands: Dünya Kodeksi');
  assert.deepEqual(tr.cover, { title: 'The Sands', subtitle: 'Dünya Kodeksi', lines: ['Written by the author.', '3 kayıt · 0 referans görsel · 1 açık uyarı'] });
  assert.deepEqual(tr.blocks, [
    { kind: 'heading', level: 1, text: 'Zaman çizelgesi', toc: true },
    { kind: 'heading', level: 2, text: 'Orsan the Grey' },
    { kind: 'para', text: 'Orsan walked to the well.' },
    { kind: 'facts', rows: [['Doğum', '1800 AS'], ['Favourite tea', 'Mint']] },
    { kind: 'list', items: ['Orsan: The Grey için diğer ad', 'A list item of the author'] },
    { kind: 'image', file: 'images/a.png', caption: 'Orsan: Ön', details: ['Dosya: images/a.png'] },
    { kind: 'box', title: 'Sanatçı özeti: Orsan', blocks: [{ kind: 'prompt', label: 'Görsel istemi', text: 'Full-body character concept art of Orsan.' }] },
    { kind: 'toc' },
  ]);
  assert.equal(doc.blocks[0]!.kind === 'heading' && doc.blocks[0]!.text, 'Timeline', 'the English document is not changed');
  recordMessages(false);
});

/** Every text in a document. */
function docTexts(doc: Doc): string[] {
  const out = [doc.title, doc.cover.title, doc.cover.subtitle, ...doc.cover.lines];
  const walk = (b: Block): void => {
    if (b.kind === 'heading') out.push(b.text, ...(b.stamp ? [b.stamp] : []));
    else if (b.kind === 'para') out.push(b.text);
    else if (b.kind === 'front') out.push(...b.lines);
    else if (b.kind === 'facts') out.push(...b.rows.flat());
    else if (b.kind === 'list') out.push(...b.items);
    else if (b.kind === 'image') out.push(b.caption, ...b.details);
    else if (b.kind === 'prompt') out.push(b.label);
    else if (b.kind === 'box') { out.push(b.title); b.blocks.forEach(walk); }
  };
  doc.blocks.forEach(walk);
  return out;
}

// A world that sets off every rule and every kind of message, on top of the ones the rule and story tests build.
const EVERYTHING = (): World => world([
  { id: 'char-x', type: 'character', name: 'Orsan', born: '1750', died: '1800', status: 'alive', race: 'human, elf', gender: 'male', title: 'King', languages: ['Old Tongue'], home: 'place-gate', affiliations: ['fac-guard'], possessions: ['item-sword'], personality: 'Calm',
    visual: { appearance: 'Tall', custom: 'odd' }, images: [{ file: 'images/x/front.png', view: 'front' }, { file: 'images/x/odd.png', view: 'frnt', provenance: { tool: 'T', prompt: 'P', date: '2026-01-01', sources: ['a'], rights: 'R' } }],
    relations: [{ type: 'parent-of', target: 'char-y' }, { type: 'ally-of', target: 'fac-guard', from: '1790', to: '1780' }, { type: 'trains-with', target: 'char-y', from: '1760' }, { type: 'killed', target: 'char-y', from: '1950' }, { type: 'rules', target: 'place-gate', from: '1900' }, { type: 'member-of', target: 'fac-guard', from: '1960' }, { type: 'parent-of', target: 'item-sword' }, { type: 'owns', target: 'place-gate', from: '1990' }, { type: 'serves', target: 'fac-guard', from: '1991' }, { type: 'enemy-of', target: 'Nobody' }],
    locations: [{ place: 'place-gate', from: '1400', to: '1450' }, { place: 'place-gate', from: '1795', to: '1790' }, { place: 'Nowhere', from: '1700' }, { place: 'place-gate', from: '1760', to: '1770' }, { place: 'place-qarim', from: '1765', to: '1768' }],
    body: 'Orsan met [[Nobody]] and @ghost and Ilsa.' },
  { id: 'char-y', type: 'character', name: 'Ilsa', born: '1890', status: 'alive', title: 'Queen', relations: [{ type: 'parent-of', target: 'char-z' }, { type: 'spouse-of', target: 'char-x' }] },
  { id: 'char-z', type: 'character', name: 'Zeyd', born: '~1700', died: '12.03.1650', relations: [{ type: 'parent-of', target: 'char-x' }, { type: 'parent-of', target: 'char-z' }] },
  { id: 'char-w', type: 'character', name: 'Wren', born: '03.1720', died: '~03.1790', status: 'alive' },
  { id: 'char-d', type: 'character', name: 'Dara', born: '13.13.1800', died: '31.02.1800', relations: [{ type: 'enemy-of', target: 'char-x', from: '5 XX', to: '0 AS' }] },
  { id: 'char-e', type: 'character', name: 'Emre', born: 'soon', died: '1500 OK', status: 'dead' },
  { id: 'char-v', type: 'character', name: 'Vala', status: 'alive' },
  { id: 'char-k', type: 'character', name: 'Kerem', relations: [{ type: 'killed', target: 'char-v' }] },
  { id: 'char-a', type: 'character', name: 'Aras', relations: [{ type: 'parent-of', target: 'char-b' }] },
  { id: 'char-b', type: 'character', name: 'Bora', relations: [{ type: 'parent-of', target: 'char-c' }] },
  { id: 'char-c', type: 'character', name: 'Cem', relations: [{ type: 'parent-of', target: 'char-a' }] },
  { id: 'char-alias', type: 'character', name: 'Gate', aliases: ['Guard'] },
  { id: 'char-blank', type: 'character', name: '' },
  { id: 'place-gate', type: 'place', name: 'Gate', status: 'standing', founded: '1500', destroyed: '1850', partOf: 'place-qarim', kind: 'city', ruler: 'char-x', images: [{ file: 'images/g.png', view: 'establishing' }] },
  { id: 'place-qarim', type: 'place', name: 'Qarim', status: 'standing', founded: '~1200' },
  { id: 'place-oasis', type: 'place', name: 'Oasis', status: 'standing', pins: [{ map: 'land', x: 40, y: 60 }, { map: 'nowhere', x: 10, y: 20 }] },
  { id: 'char-t', type: 'character', name: 'Tarık', locations: [{ place: 'place-oasis', from: '01.01.1900', to: '30.01.1900' }] },
  { id: 'evt-t', type: 'event', name: 'Market Day', date: '15.01.1900', place: 'place-qarim', participants: [{ id: 'char-t' }] },
  { id: 'fac-guard', type: 'faction', name: 'Guard', status: 'active', founded: '1930', dissolved: '1990', leader: 'char-x', relations: [{ type: 'parent-of', target: 'char-x' }, { type: 'part-of', target: 'place-gate' }, { type: 'involved-in', target: 'char-x' }] },
  { id: 'fac-old', type: 'faction', name: 'Old Order', status: 'active', dissolved: 'unknown' },
  { id: 'item-sword', type: 'item', name: 'Sword', status: 'intact', created: '1500', destroyed: '1600', images: [{ file: 'images/s.png', view: 'blade' }] },
  { id: 'evt-a', type: 'event', name: 'Battle of Gate', date: '1920', place: 'place-gate', participants: [{ id: 'fac-guard', role: 'defender' }, { id: 'char-x' }, { id: 'item-sword' }], actions: [{ actor: 'char-x', verb: 'killed', target: 'char-y' }, { actor: 'char-y', verb: 'blessed', target: 'char-x' }, { actor: 'char-x', verb: 'married', target: 'char-z' }] },
  { id: 'evt-b', type: 'event', name: 'Siege', date: '12.03.1765', place: 'place-qarim', participants: [{ id: 'char-x' }] },
  { id: 'evt-b2', type: 'event', name: 'Feast at Gate', date: '12.03.1765', place: 'place-gate', participants: [{ id: 'char-x' }] },
  { id: 'evt-c', type: 'event', name: 'Long War', date: '1600', end: '1500', place: 'place-gate', actions: [{ actor: 'char-x', verb: 'sang' }, { actor: 'char-x', verb: 'captured', target: 'place-qarim' }] },
  { id: 'evt-d', type: 'event', name: 'Feast', date: '~1720', participants: [{ id: 'char-x' }, { id: 'char-w' }] },
  { id: 'evt-e', type: 'event', name: 'Coronation', date: '03.1960', actions: [{ actor: 'char-y', verb: 'crowned', target: 'char-x' }, { actor: 'char-x', verb: 'slew', target: 'char-v' }, { actor: 'char-x', verb: 'betrayed', target: 'fac-guard' }] },
  { id: 'note-a', type: 'note', name: 'Lore of Gate', date: '1900', relations: [{ type: 'about', target: 'char-x' }], body: 'Some lore.' },
  { id: 'note-b', type: 'note', name: 'Yearless', date: '~12.03', body: 'x' },
  { id: 'note-c', type: 'note', name: 'Unreadable', date: 'zz', body: 'x' },
], {
  manifest: { maps: [{ id: 'land', name: 'The Land', image: 'maps/land.png', place: 'char-x' }, { id: 'lost', name: 'Lost Isles', image: 'maps/lost.png', place: 'Atlantis' }], calendar: { eras: [{ id: 'OK', name: 'Old Kingdom', start: -1000, end: -500 }, { id: 'AS', name: 'After the Sundering', start: 1 }], defaultEra: 'AS' }, book: { title: 'Tales', author: 'Ayşe', publisher: 'Pub', dedication: 'For you', epigraph: 'Words', epigraphSource: 'Someone' } },
  story: [
    'Orsan was born in 1700. Ilsa died in 1991. Orsan was dead.',
    'Orsan fought at Qarim in 1930. Ilsa killed Orsan in 1999. Ilsa, the Empress of Qarim, smiled. Siege happened in 1766.',
  ],
});

describe('the rule and story tests, run again to collect the worlds they build', () => {
  before(() => recordMessages(true));
  built.worlds = [];
  return (async () => {
    await import('./rules.test.ts');
    await import('./rule-fixes.test.ts');
    await import('./story.test.ts');
  })();
});

describe('every text core shows has Turkish', () => {
  const missing = new Map<string, string>();
  const note = (where: string) => (key: string) => { if (!missing.has(key)) missing.set(key, where); };
  const has = (text: string, where: string) => { if (!Object.hasOwn(CORE_TR, text)) note(where)(text); };
  /** [English, Turkish, rule]: up to three messages per rule from the world with every kind of problem. */
  const samples: [string, string, string][] = [];
  before(() => recordMessages(true));
  after(() => recordMessages(false));

  const cover = (w: World, name: string, docs: boolean): void => {
    const warnings: Warning[] = [...check(w), ...(w.story?.length ? analyzeStory(w).warnings : [])];
    for (const x of warnings) {
      const tr = localize(x.message, CORE_TR, note(`${name}: ${x.ruleId}`));
      if (name === 'everything' && samples.filter(([, , rule]) => rule === x.ruleId).length < 3) samples.push([x.message, tr, x.ruleId]);
      localize(x.offending.source, CORE_TR, note(`${name}: source`));
      if (x.conflicting) localize(x.conflicting.source, CORE_TR, note(`${name}: source`));
    }
    for (const g of timelineModel(w, warnings)?.groups ?? []) for (const lane of g.lanes) localize(lane.dates, CORE_TR, note(`${name}: timeline`));
    for (const n of familyTree(w).nodes) localize(n.dates, CORE_TR, note(`${name}: family tree`));
    if (!docs) return;
    for (const e of w.entries.slice(0, 12)) for (const ed of relationWeb(w, e.id)?.edges ?? []) { localize(ed.label, CORE_TR, note(`${name}: web`)); has(ed.groupLabel, 'web'); }
    for (const doc of [worldCodex(w), storyBook(w, { year: 2026 }), storyBook(w, { year: 2026, grouping: 'single', appendix: false }), storyBook(w, { year: 2026, grouping: 'years', chapterYears: 50 })]) {
      const tr = localizeDoc(doc, CORE_TR, note(`${name}: ${doc.kind}`));
      assert.equal(docTexts(tr).length, docTexts(doc).length);
      toMarkdown(tr, undefined, (s) => (has(s, 'markdown'), localize(s, CORE_TR)));
    }
  };

  test('the sample world, the test fixture and a world with every kind of problem', async () => {
    cover(await loadWorld(join(ROOT, 'worlds/camelamamm')), 'camelamamm', true);
    cover(await loadWorld(join(ROOT, 'packages/core/test/fixtures/shifting-sands')), 'shifting-sands', true);
    cover(EVERYTHING(), 'everything', true);
    const broken = parseWorld([
      { path: 'world.json', content: JSON.stringify({ schemaVersion: 1, id: 'b', name: 'B', calendar: { eras: [{ id: 'Y', name: 'Year', start: 1 }], defaultEra: 'Y', months: 'x', approxYears: -1 }, rules: { 'after-death': 'Off' }, maps: [{ id: 'a', name: 'A', image: 'a.png' }, { id: 'A', name: 'B', image: 'b.png' }, { name: 'C' }] }) },
      { path: 'intended.json', content: '{}' },
      { path: 'story-ignored.json', content: 'x' },
      { path: 'characters/a.md', content: 'no front matter' },
      { path: 'characters/b.md', content: '---\nid: b\nname: B\n' },
      { path: 'characters/c.md', content: '---\nid: [\n---\n' },
      { path: 'characters/d.md', content: '---\n- a\n---\n' },
      { path: 'characters/e.md', content: '---\nname: E\ntype: character\n---\n' },
      { path: 'characters/f.md', content: '---\nid: f\nname: F\ntype: wizard\n---\n' },
      { path: 'characters/g.md', content: '---\nid: g\nname: G\ntype: character\nstatus: Zombie\naliases: 5\nrelations: x\nlocations: [3]\nimages: [{file: a.png}]\nbookOrder: x\nvisual: 4\npicture: {color: red}\nlanguages: [{a: 1}]\ngender: [1]\n---\n' },
      { path: 'places/h.md', content: '---\nid: f\nname: Twice\ntype: place\n---\n' },
      { path: 'places/i.md', content: '---\nid: i\nname: Misplaced\ntype: item\n---\n' },
      { path: 'places/j.md', content: '---\nid: j\nname: Pinned\ntype: place\npins: [{map: a, x: 200, y: 5}, {x: 1, y: 2}, {map: a, x: wide, y: 1}, {map: a, y: 3}]\n---\n' },
      { path: 'story/01-bad.md', content: '---\ntitle: [1]\norder: x\ndate: 99 ZZ\n---\nBody' },
      { path: 'story/02-bad.md', content: '---\n- x\n---\nBody' },
    ]);
    cover(broken, 'broken files', false);
    for (const t of ['x', '[]', '{"schemaVersion":2}', '{"schemaVersion":1,"id":"a","name":"b","calendar":{"eras":[{"id":1}],"defaultEra":"A"}}', '{"schemaVersion":1,"id":"a","name":"b","calendar":{"eras":[{"id":"B","name":"b","start":1}],"defaultEra":"A"}}']) {
      for (const p of parseManifest(t).problems) localize(p, CORE_TR, note('world.json'));
    }
    for (const i of parseManifest('{"schemaVersion":1,"id":"a","name":"b","calendar":{"eras":[{"id":"B","name":"b","start":1}],"defaultEra":"B"},"maps":5}').issues) localize(i, CORE_TR, note('world.json maps'));
    for (const files of [[], [{ path: 'world.json', content: '{}' }]]) assert.throws(() => parseWorld(files), (e: Error) => (localize(e.message, CORE_TR, note('parseWorld')), true));
    for (const json of ['x', '{"buffers":[{"uri":"a.bin"}]}']) assert.throws(() => gltfMustBeEmbedded(json), (e: Error) => (localize(e.message, CORE_TR, note('3D models')), true));
    const cal = { eras: [{ id: 'OK', name: 'Old', start: -1000 }, { id: 'AS', name: 'After', start: 1 }], defaultEra: 'AS', months: [{ name: 'Ashfall', days: 30 }] };
    for (const t of ['1800', '~1800', '01.1920', '~01.1920', '12.01.1920', '~12.01.1920', '12.01', '~12.01', '312 OK', 'unknown', 'x', '13.1800', '31.01.1800', '5 ZZ']) localize(describeDate(t, cal), CORE_TR, note('describeDate'));
    for (const c of [
      { eras: [], defaultEra: 'X' },
      { eras: [{ id: '', name: '', start: 1.5, end: 0, color: 'red' }, { id: '1A', name: 'B', start: 1 }, { id: 'aa', name: 'A', start: 1 }, { id: 'AA', name: '', start: 1 }, { id: 'C', name: 'C', start: 5, end: 100 }, { id: 'D', name: 'D', start: 50 }], defaultEra: 'Q', months: 'x' },
      { eras: [{ id: 'A', name: 'A', start: 1 }], defaultEra: 'A', months: [{ name: '', days: 0 }, { name: 'M', days: 1.5 }] },
    ]) for (const p of calendarProblems(c as never)) localize(p, CORE_TR, note('calendar'));
  });

  test('the worlds the rule and story tests built', () => {
    assert.ok((built.worlds?.length ?? 0) > 50, 'the replayed tests built their worlds');
    for (const w of built.worlds ?? []) cover(w, 'test world', w.entries.length <= 200);
  });

  test('labels and rule texts the app shows on their own', () => {
    for (const r of [...builtinRules, storyContradiction, aiPhrasing]) { has(r.title, 'rule title'); has(r.description, 'rule description'); }
    for (const t of ENTRY_TYPES) { has(TYPE_LABELS[t], 'types'); has(TYPE_SINGULAR[t], 'types'); }
    for (const lc of Object.values(LIFECYCLE)) { has(lc.endLabel, 'lifecycle'); has(lc.endedWord, 'lifecycle'); for (const s of lc.statuses) has(s.label, 'statuses'); }
    for (const fields of Object.values(DETAIL_FIELDS)) for (const f of fields) { has(f.label, 'details'); if (f.hint) has(f.hint, 'details'); for (const s of f.suggest ?? []) has(s, 'suggestions'); }
    for (const s of Object.values(DETAIL_SECTIONS)) has(s, 'sections');
    for (const fields of Object.values(VISUAL_FIELDS)) for (const f of fields) { has(f.label, 'visual'); has(f.hint, 'visual'); }
    for (const v of Object.values(IMAGE_VIEWS).flat()) has(viewLabel(v), 'views');
    for (const k of RELATION_KINDS) { has(k.label, 'relations'); has(k.inverse, 'relations'); }
    for (const g of Object.values(RELATION_GROUPS)) has(g.label, 'relation groups');
    for (const s of Object.values(TITLE_STYLE_LABELS)) has(s, 'title styles');
    for (const f of BUNDLED_FONTS) has(f.kind, 'font kinds');
    for (const t of Object.values(TRIMS)) has(t.label, 'trims');
    for (const s of [DATE_FORMATS_HINT, LORE_AND_LEGENDS, CHRONICLE_APPENDIX, SINGLE_CHAPTER]) has(s, 'constants');
    // Search results name the field they matched in: core's own field names, or a detail or visual field's label.
    const labels = new Set(['Name', 'Alias', 'Type', 'Race', 'Status', 'Born', 'Died', 'Founded', 'Destroyed', 'Dissolved', 'Created', 'Date', 'End', 'Place', 'Part of', 'Tag', 'Summary', 'Participant', 'Relation', 'Text',
      ...Object.values(DETAIL_FIELDS).flat().map((f) => f.label), ...Object.values(VISUAL_FIELDS).flat().map((f) => f.label)]);
    const w = EVERYTHING();
    for (const q of ['a', 'e', 'o', 'gate', 'calm', 'tall', '1800', 'king', 'old']) for (const hit of searchEntries(w, q)) if (hit.field !== 'Custom') assert.ok(labels.has(hit.field), hit.field);
    for (const f of labels) has(f, 'search');
  });

  test('nothing is missing, and the Turkish reads like this', () => {
    assert.deepEqual([...missing].map(([key, where]) => `${where}: ${key}`), []);
    assert.ok(samples.length >= 14, 'one message of almost every rule');
    for (const [en, tr] of samples) console.log(`EN: ${en}\nTR: ${tr}\n`);
  });
});
