import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check, docSheets, familyTree, inlineRuns, relationWeb, storyBook, timelineModel, worldBible, yearTicks, TREE_LAYOUT, SINGLE_CHAPTER, type Block } from '@lore-forge/core';
import { world } from './helpers.ts';

const fam = world([
  { id: 'g', type: 'character', name: 'Grandma', born: '1800', died: '1870', relations: [{ type: 'parent-of', target: 'm' }, { type: 'spouse-of', target: 'gp' }] },
  { id: 'gp', type: 'character', name: 'Grandpa', born: '1795' },
  { id: 'm', type: 'character', name: 'Mother', born: '1830', relations: [{ type: 'spouse-of', target: 'f' }] },
  { id: 'f', type: 'character', name: 'Father', born: '1828' },
  { id: 'k1', type: 'character', name: 'Kid One', born: '1860', relations: [{ type: 'child-of', target: 'm' }, { type: 'child-of', target: 'f' }, { type: 'sibling-of', target: 'k2' }] },
  { id: 'k2', type: 'character', name: 'Kid Two', born: '1862', status: 'dead', relations: [{ type: 'child-of', target: 'm' }] },
  { id: 'loner', type: 'character', name: 'Loner' },
  { id: 'fac', type: 'faction', name: 'Guild', relations: [{ type: 'enemy-of', target: 'm' }] },
  { id: 'sword', type: 'item', name: 'Sword', relations: [{ type: 'located-in', target: 'town' }] },
  { id: 'town', type: 'place', name: 'Town', founded: '1700' },
  { id: 'ev', type: 'event', name: 'Battle', date: '1850', place: 'town' },
]);

test('family tree: generations top-down, spouses side by side, dead marked', () => {
  const t = familyTree(fam, 'k1');
  const gen = Object.fromEntries(t.nodes.map((n) => [n.id, n.gen]));
  assert.deepEqual(gen, { g: 0, gp: 0, m: 1, f: 1, k1: 2, k2: 2 });
  assert.equal(t.generations, 3);
  const node = (id: string) => t.nodes.find((n) => n.id === id)!;
  assert.ok(node('g').y < node('m').y && node('m').y < node('k1').y);
  assert.equal(Math.abs(node('m').x - node('f').x), TREE_LAYOUT.nodeW + TREE_LAYOUT.gapX);
  assert.equal(node('g').ended, true);
  assert.equal(node('k2').ended, true);
  assert.equal(node('k1').focus, true);
  assert.equal(t.edges.filter((e) => e.kind === 'parent').length, 4);
  assert.equal(t.edges.filter((e) => e.kind === 'spouse').length, 2);
  assert.ok(!t.nodes.some((n) => n.id === 'loner'));
  // No two nodes overlap in a row.
  for (const a of t.nodes) for (const b of t.nodes) if (a !== b && a.gen === b.gen) assert.ok(Math.abs(a.x - b.x) >= TREE_LAYOUT.nodeW);
  assert.ok(t.width >= Math.max(...t.nodes.map((n) => n.x + TREE_LAYOUT.nodeW)));
});

test('family tree without a character focus shows every family; cycles still lay out', () => {
  assert.equal(familyTree(fam, 'town').nodes.length, 6);
  const cyc = world([
    { id: 'a', type: 'character', name: 'A', relations: [{ type: 'parent-of', target: 'b' }] },
    { id: 'b', type: 'character', name: 'B', relations: [{ type: 'parent-of', target: 'a' }] },
  ]);
  assert.equal(familyTree(cyc, 'a').nodes.length, 2);
});

test('relation web: focus in the middle, neighbours both directions, edges labelled', () => {
  const w = relationWeb(fam, 'm')!;
  assert.deepEqual(w.nodes.map((n) => n.id).sort(), ['f', 'fac', 'g', 'k1', 'k2', 'm']);
  const center = w.nodes[0]!;
  assert.equal(center.id, 'm');
  assert.ok(Math.abs(center.x - w.width / 2) < 1e-6);
  assert.ok(w.edges.some((e) => e.from === 'fac' && e.to === 'm' && e.label === 'enemy of' && e.groupLabel === 'Allies and enemies'));
  assert.ok(w.edges.some((e) => e.from === 'k1' && e.to === 'k2'), 'edges between neighbours are kept');
  for (const n of w.nodes) assert.ok(n.x > 0 && n.y > 0 && n.x < w.width && n.y < w.height);
  assert.equal(relationWeb(fam, 'nope'), undefined);
});

test('timeline model: lanes by type, points for events, open ends, eras, warnings', () => {
  const ws = check(fam);
  const m = timelineModel(fam, ws)!;
  assert.deepEqual(m.groups.map((g) => g.type), ['character', 'place', 'event']);
  const lane = (id: string) => m.groups.flatMap((g) => g.lanes).find((l) => l.entry.id === id)!;
  assert.equal(lane('ev').point, true);
  assert.equal(lane('m').openEnd, true);
  assert.equal(lane('g').openEnd, false);
  assert.equal(lane('g').ended, true);
  assert.equal(lane('g').dates, '1800 – 1870');
  assert.ok(m.min < lane('town').from && m.max > lane('m').from);
  assert.deepEqual(m.eras.map((e) => e.id), ['AS']);
  const ticks = yearTicks(m, 2);
  assert.ok(ticks.length > 2 && ticks.every((t) => t.years === 50));
  const bad = world([{ id: 'x', type: 'character', name: 'X', born: '1900', died: '1800' }]);
  const tm = timelineModel(bad, check(bad))!;
  assert.equal(tm.groups[0]!.lanes[0]!.worst, 'error');
  assert.equal(timelineModel(world([{ id: 'n', type: 'note', name: 'N' }]), []), undefined);
});

test('bible options: types and warnings appendix; book grouping options', () => {
  const full = worldBible(fam);
  const heads = (d: typeof full) => d.blocks.filter((b) => b.kind === 'heading' && b.level === 1).map((b) => (b as { text: string }).text);
  assert.ok(heads(full).includes('Appendix: consistency warnings'));
  const slim = worldBible(fam, { types: ['character'], warnings: false, artBriefs: false });
  assert.ok(!heads(slim).includes('Appendix: consistency warnings'));
  assert.ok(heads(slim).includes('Characters') && !heads(slim).includes('Places'));
  assert.ok(!slim.blocks.some((b) => b.kind === 'box'));
  assert.ok(full.blocks.some((b) => b.kind === 'box'));
  const w = world([
    { id: 'a', type: 'event', name: 'A', date: '1850' },
    { id: 'b', type: 'event', name: 'B', date: '1920' },
    { id: 'c', type: 'note', name: 'C' },
  ]);
  const chapters = (d: ReturnType<typeof storyBook>) => d.blocks.filter((b) => b.kind === 'heading' && b.level === 1).map((b) => (b as { text: string }).text);
  assert.deepEqual(chapters(storyBook(w)), ['Chapter 1. After the Sundering', 'Chapter 2. Lore & Legends']);
  assert.deepEqual(chapters(storyBook(w, { grouping: 'years', chapterYears: 50 })), ['Chapter 1. After the Sundering, 1850–1899', 'Chapter 2. After the Sundering, 1900–1949', 'Chapter 3. Lore & Legends']);
  assert.deepEqual(chapters(storyBook(w, { grouping: 'single' })), [`Chapter 1. ${SINGLE_CHAPTER}`, 'Chapter 2. Lore & Legends']);
});

test('bible lists where an entry is mentioned by plain name', () => {
  const w = world([
    { id: 't', type: 'character', name: 'Tarik', body: 'Tarik, a salt miner. Zehra is mad.' },
    { id: 'z', type: 'character', name: 'Zehra' },
  ]);
  const blocks = worldBible(w).blocks;
  const i = blocks.findIndex((b) => b.kind === 'heading' && b.text === 'Mentioned in');
  assert.ok(i > 0);
  assert.deepEqual(blocks[i + 1], { kind: 'para', text: 'Tarik' });
});

test('preview sheets split at new-page headings and keep every block once', () => {
  const blocks: Block[] = [
    { kind: 'toc' },
    { kind: 'heading', level: 1, text: 'Characters', newPage: true, toc: true },
    { kind: 'para', text: 'a' },
    { kind: 'heading', level: 2, text: 'Leyla', toc: true },
    { kind: 'heading', level: 1, text: 'Places', newPage: true, toc: true },
    { kind: 'para', text: 'b' },
  ];
  const sheets = docSheets(blocks);
  assert.deepEqual(sheets.map((s) => s.length), [1, 3, 2]);
  assert.deepEqual(sheets.flat(), blocks);
  // A leading new-page heading does not leave an empty sheet.
  assert.equal(docSheets(blocks.slice(1)).length, 2);
  assert.deepEqual(docSheets([]), []);
  // The preview's inline formatting is the PDF's.
  assert.deepEqual(inlineRuns('a **b**').map((r) => r.bold), [false, true]);
});
