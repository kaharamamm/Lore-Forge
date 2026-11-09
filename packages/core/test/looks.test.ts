/** Looks: an entry's other looks over time, with their own pictures and 3D models, and the checks that keep them straight. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  artBrief, CORE_TR, imageLook, timelineModel, localize, lookAt, lookImages, lookSpan, lookVisual, lookWhen, newLookId, parseEntry, recordMessages, serializeEntry, worldCodex,
  WorldIndex, type Entry,
} from '@lore-forge/core';
import { importModel, listModels, moveModels, renameModel } from '@lore-forge/core/node';
import { warnings, world, type Draft } from './helpers.ts';

const camel: Draft = {
  id: 'char-camel', type: 'character', name: 'Mr Camel', born: '471', died: '600',
  visual: { appearance: 'Honey-brown fur', clothing: 'Cream linen waistcoat' },
  looks: [
    { id: 'caravan-days', name: 'Caravan days', reason: 'Read maps for the caravans', from: '490', to: '498', visual: { clothing: 'Dusty travel robes' } },
    { id: 'after-the-war', name: 'After the war', reason: 'Lost an eye at the Battle of Gate', after: 'evt-gate', visual: { features: 'An eye patch' } },
    { id: 'old-age', name: 'Old age', from: '560' },
  ],
  images: [
    { file: 'images/char-camel/front.png', view: 'front' },
    { file: 'images/char-camel/after-the-war/front-war.png', view: 'front', look: 'after-the-war' },
  ],
};
const gate: Draft = { id: 'evt-gate', type: 'event', name: 'Battle of Gate', date: '520', participants: [{ id: 'char-camel' }] };
const ids = (ws: { id: string }[]) => ws.map((w) => w.id).sort();

test('looks are read and written as the file has them; half-filled ones stay and their ids never change', () => {
  const text = serializeEntry({ ...camel, body: '' } as unknown as Entry);
  assert.match(text, /looks:\n {2}- id: caravan-days\n {4}name: Caravan days/);
  assert.match(text, /from: "490"/, 'look dates are quoted like every date');
  assert.match(text, /look: after-the-war/);
  const back = parseEntry(text).entry!;
  assert.deepEqual(back.looks, (camel as unknown as Entry).looks);
  assert.equal(back.images?.[1]?.look, 'after-the-war');
  // Written by hand: no id (made from the name), the same name twice, a look not placed in time yet, an unquoted date.
  const hand = parseEntry('---\nid: char-x\ntype: character\nname: X\nlooks:\n  - name: Royal robes\n  - name: Royal robes\n    from: 03.1920\n  - name: ""\n---\n').entry!;
  assert.deepEqual(hand.looks?.map((l) => l.id), ['royal-robes', 'royal-robes-2', 'look']);
  assert.equal(hand.looks?.[1]?.from, '03.1920', 'a date typed without quotes is read as written');
  assert.equal(newLookId(hand, 'Royal robes'), 'royal-robes-3');
  assert.equal(newLookId(hand, 'Kılık değiştirmiş'), 'kilik-degistirmis');
});

test('when a look applies, and which look an entry has on a date', () => {
  const w = world([camel, gate]);
  const ix = new WorldIndex(w);
  const e = ix.resolve('char-camel')!;
  const at = (d: string) => lookAt(e, ix.date(d)!, ix)?.id;
  assert.equal(at('480'), undefined, 'before any look: the Default look');
  assert.equal(at('495'), 'caravan-days');
  assert.equal(at('510'), undefined, 'between the caravan days and the war');
  assert.equal(at('525'), 'after-the-war');
  assert.equal(at('580'), 'old-age', 'a later look takes over from one without an end');
  const span = lookSpan(e.looks![0]!, ix)!;
  assert.ok(span.lo! < span.hi!);
  assert.equal(lookSpan({ id: 'x', name: 'Disguise' }, ix), undefined, 'a look without a time');
  assert.deepEqual(lookVisual(e, e.looks![0]), { appearance: 'Honey-brown fur', clothing: 'Dusty travel robes' });
  assert.equal(lookWhen(e.looks![1]!, ix), 'after Battle of Gate');
  assert.equal(lookWhen(e.looks![0]!, ix), 'from 490 to 498');
  assert.deepEqual(lookImages(e, undefined).map((i) => i.file), ['images/char-camel/front.png']);
  assert.deepEqual(lookImages(e, e.looks![1]).map((i) => i.file), ['images/char-camel/after-the-war/front-war.png']);
  assert.equal(imageLook(e, { file: 'x.png', view: 'front', look: 'gone' }), undefined, 'a picture of a look that is gone shows with the Default look');
  const era = world([{ ...camel, looks: [{ id: 'kingdom', name: 'Kingdom', era: 'OK' }] }]);
  const ex = new WorldIndex(era);
  assert.equal(lookAt(ex.resolve('char-camel')!, ex.date('10 AS')!, ex), undefined, 'outside the era');
  assert.equal(lookAt(ex.resolve('char-camel')!, ex.date('300 OK')!, ex)?.id, 'kingdom');
});

test('a sound set of looks raises no warning', () => {
  assert.deepEqual(warnings([camel, gate]).filter((w) => w.ruleId.startsWith('look-') || w.ruleId === 'invalid-date'), []);
});

test('look-time: unknown era, missing or undated entry, a look that ends before it starts, a picture of no look', () => {
  const bad: Draft = {
    id: 'char-bad', type: 'character', name: 'Bad', born: '400',
    looks: [
      { id: 'era', name: 'Era', era: 'XX' },
      { id: 'missing', name: 'Missing', after: 'evt-nowhere' },
      { id: 'undated', name: 'Undated', before: 'evt-undated' },
      { id: 'backwards', name: 'Backwards', from: '520', to: '510' },
    ],
    images: [{ file: 'images/char-bad/front.png', view: 'front', look: 'gone' }],
  };
  const undated: Draft = { id: 'evt-undated', type: 'event', name: 'Undated' };
  assert.deepEqual(ids(warnings([bad, undated], 'look-time')), [
    'look-time:char-bad:backwards:order', 'look-time:char-bad:era:era', 'look-time:char-bad:images/char-bad/front.png:look',
    'look-time:char-bad:missing:after', 'look-time:char-bad:undated:before',
  ]);
  assert.deepEqual(ids(warnings([{ ...bad, looks: [{ id: 'd', name: 'D', from: '1.2.3.4' }], images: undefined }], 'invalid-date')), ['invalid-date:char-bad:d.from'], 'look dates are checked like every date');
});

test('look-outside-life: a look that starts after death, or before birth', () => {
  const ghost: Draft = { ...camel, looks: [{ id: 'ghost', name: 'Ghost', from: '650' }, { id: 'child', name: 'Child', from: '400', to: '420' }, { id: 'young', name: 'Young', to: '460' }] };
  const found = warnings([ghost, gate], 'look-outside-life');
  assert.deepEqual(ids(found), ['look-outside-life:char-camel:child:before-start', 'look-outside-life:char-camel:ghost:after-end', 'look-outside-life:char-camel:young:before-start']);
  assert.match(found.find((w) => w.id.endsWith('ghost:after-end'))!.message, /^Mr Camel: the look "Ghost" starts in 650, after Mr Camel died in 600/);
  // A look of an era that began before birth is fine: it applies while the entry lives in it.
  assert.deepEqual(warnings([{ ...camel, looks: [{ id: 'k', name: 'Kingdom', era: 'AS' }] }], 'look-outside-life'), []);
});

test('look-overlap: looks that start together, or one that runs on into the next; a look without an end just gives way', () => {
  const clash: Draft = {
    ...camel,
    looks: [
      { id: 'a', name: 'A', from: '500' }, { id: 'b', name: 'B', from: '500', to: '505' },
      { id: 'c', name: 'C', from: '520', to: '540' }, { id: 'd', name: 'D', from: '530' },
    ],
  };
  assert.deepEqual(ids(warnings([clash], 'look-overlap')), ['look-overlap:char-camel:a+b', 'look-overlap:char-camel:c+d']);
  assert.deepEqual(warnings([camel, gate], 'look-overlap'), [], 'after the war, then old age: a change, not a clash');
});

test('a look before an event ends as it begins, and one after it starts once it is over: the two never clash', () => {
  const pair: Draft = { ...camel, images: undefined, looks: [{ id: 'young', name: 'Young', before: 'evt-gate' }, { id: 'scarred', name: 'Scarred', after: 'evt-gate' }] };
  const war: Draft = { ...gate, date: '520', end: '523' };
  assert.deepEqual(warnings([pair, war]).filter((w) => w.ruleId.startsWith('look-')), []);
  const ix = new WorldIndex(world([pair, war]));
  const e = ix.resolve('char-camel')!;
  const at = (d: string) => lookAt(e, ix.date(d)!, ix)?.id ?? 'default';
  assert.deepEqual(['519', '520', '523', '524'].map(at), ['young', 'default', 'default', 'scarred'], 'during the war itself: neither');
  // One day: the look after it starts the next day, even when the event is dated by the year.
  const day = new WorldIndex(world([pair, { ...gate, date: '12.03.520' }]));
  const d = day.resolve('char-camel')!;
  assert.deepEqual(['11.03.520', '12.03.520', '13.03.520'].map((x) => lookAt(d, day.date(x)!, day)?.id ?? 'default'), ['young', 'default', 'scarred']);
  // A look from a date and after an event starts at the later of the two.
  const both = new WorldIndex(world([{ ...camel, looks: [{ id: 'x', name: 'X', from: '519', after: 'evt-gate' }] }, gate]));
  assert.equal(lookAt(both.resolve('char-camel')!, both.date('520')!, both), undefined);
  assert.equal(lookAt(both.resolve('char-camel')!, both.date('521')!, both)?.id, 'x');
});

test('the World Codex shows each look with its pictures and its own art brief; an event brief uses the look of its day', () => {
  const w = world([camel, gate]);
  const doc = worldCodex(w);
  const texts = doc.blocks.flatMap((b) => ('text' in b ? [b.text] : b.kind === 'box' ? [b.title] : b.kind === 'facts' ? b.rows.flat() : b.kind === 'image' ? [b.caption] : []));
  for (const t of ['Look: Caravan days', 'Look: After the war', 'from 490 to 498', 'Dusty travel robes', 'Art brief: Mr Camel (After the war)', 'Mr Camel: Front (After the war)']) assert.ok(texts.includes(t), t);
  const ix = new WorldIndex(w);
  const brief = artBrief(ix.resolve('evt-gate')!, ix)!;
  assert.doesNotMatch(brief.prompt, /as in "/, 'the battle itself shows the look he had going in: the new one starts once it is over');
  const later: Draft = { id: 'evt-feast', type: 'event', name: 'Victory Feast', date: '525', participants: [{ id: 'char-camel' }] };
  const w2 = world([camel, gate, later]);
  const ix2 = new WorldIndex(w2);
  assert.match(artBrief(ix2.resolve('evt-feast')!, ix2)!.prompt, /Mr Camel as in "After the war" \(Lost an eye at the Battle of Gate\): distinguishing features: An eye patch\./);
  assert.match(artBrief(ix2.resolve('char-camel')!, ix2, ix2.resolve('char-camel')!.looks![0])!.prompt, /As they look in "Caravan days": Read maps for the caravans\..*Clothing: Dusty travel robes\./s);
});

test('looks read in Turkish: every warning and Codex line about them has its translation', () => {
  recordMessages(true);
  try {
    const missing: string[] = [];
    const bad: Draft = { ...camel, looks: [{ id: 'g', name: 'Ghost', from: '650' }, { id: 'x', name: 'X', era: 'XX', after: 'evt-nowhere' }, { id: 'a', name: 'A', from: '500' }, { id: 'b', name: 'B', from: '500', to: '505' }] };
    const found = warnings([bad, gate]).filter((w) => w.ruleId.startsWith('look-'));
    assert.ok(found.length >= 4);
    for (const w of found) localize(w.message, CORE_TR, (k) => missing.push(k));
    const tr = localize(found.find((w) => w.ruleId === 'look-outside-life')!.message, CORE_TR);
    assert.equal(tr, 'Mr Camel: “Ghost” görünüşü 650 yılında başlıyor, oysa Mr Camel 600 yılında öldü (kaynak: Karakterler/Mr Camel).');
    const doc = worldCodex(world([camel, gate]));
    for (const b of doc.blocks) for (const t of 'text' in b ? [b.text] : b.kind === 'facts' ? b.rows.flat() : []) localize(t, CORE_TR, (k) => missing.push(k));
    assert.deepEqual([...new Set(missing)], []);
  } finally {
    recordMessages(false);
  }
});

test('3D models of a look live in their own folder, and go back to the Default look when the look is deleted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lore-looks-'));
  try {
    const src = join(dir, 'cube.glb');
    await writeFile(src, 'glTF');
    await mkdir(join(dir, 'models'), { recursive: true });
    assert.equal(await importModel(dir, 'char-camel', src, 'Plain'), 'models/char-camel/Plain.glb');
    assert.equal(await importModel(dir, 'char-camel', src, 'Plain', 'after-the-war'), 'models/char-camel/after-the-war/Plain.glb');
    assert.deepEqual((await listModels(dir, 'char-camel')).map((m) => m.file), ['models/char-camel/Plain.glb'], 'a look folder is not a Default model');
    assert.deepEqual((await listModels(dir, 'char-camel', 'after-the-war')).map((m) => m.file), ['models/char-camel/after-the-war/Plain.glb']);
    assert.equal(await renameModel(dir, 'models/char-camel/after-the-war/Plain.glb', 'Patched'), 'models/char-camel/after-the-war/Patched.glb');
    await moveModels(dir, 'char-camel', 'after-the-war');
    assert.deepEqual((await listModels(dir, 'char-camel')).map((m) => m.name), ['Patched', 'Plain']);
    assert.ok(!existsSync(join(dir, 'models', 'char-camel', 'after-the-war')), 'the empty look folder goes');
    await assert.rejects(() => listModels(dir, 'char-camel', '../x'), /Not a look id/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the timeline shows each look on the lane of its entry, clipped to the lane', () => {
  const model = timelineModel(world([camel, gate]), [])!;
  const lane = model.groups.find((g) => g.type === 'character')!.lanes.find((l) => l.entry.id === 'char-camel')!;
  const perYear = model.daysPerYear;
  assert.deepEqual(lane.looks.map((l) => [l.id, l.name, l.when]), [
    ['caravan-days', 'Caravan days', 'from 490 to 498'],
    ['after-the-war', 'After the war', 'after Battle of Gate'],
    ['old-age', 'Old age', 'from 560'],
  ]);
  const [caravan, war, old] = lane.looks;
  assert.equal(caravan!.from, 490 * perYear);
  assert.equal(caravan!.to, 499 * perYear - 1);
  assert.equal(war!.from, 521 * perYear, 'after the battle: the day after it ends');
  assert.equal(old!.to, lane.to, 'a look without an end runs to the end of the lane (died 600)');
  assert.equal(lane.to, 601 * perYear - 1);
  assert.deepEqual(model.groups.find((g) => g.type === 'event')!.lanes[0]!.looks, [], 'a moment has no looks');
});
