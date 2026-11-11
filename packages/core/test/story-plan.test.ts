import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRename, chapterCast, chapterStatus, parseChapter, planRename, serializeChapter, type StoryChapter } from '@lore-forge/core';
import { world } from './helpers.ts';

test('a chapter keeps its point of view, status and summary in its header, in that order', () => {
  const { chapter, problems } = parseChapter('---\ntitle: The Salt Road\norder: 2\nsummary: Pip finds a map in the tea house.\nstatus: revised\npov: char-pip\nmood: hopeful\n---\n\nPip ran.\n', 'story/02-the-salt-road.md');
  assert.deepEqual(problems, []);
  assert.equal(chapter.pov, 'char-pip');
  assert.equal(chapter.status, 'revised');
  assert.equal(chapter.summary, 'Pip finds a map in the tea house.');
  assert.deepEqual(chapter.extra, { mood: 'hopeful' });
  assert.equal(serializeChapter(chapter), '---\ntitle: The Salt Road\norder: 2\npov: char-pip\nstatus: revised\nsummary: Pip finds a map in the tea house.\nmood: hopeful\n---\n\nPip ran.\n');
  // A summary over several lines stays as written.
  const long = { ...chapter, summary: 'Pip finds a map.\nHe hides it.' };
  assert.equal(parseChapter(serializeChapter(long), long.file).chapter.summary, 'Pip finds a map.\nHe hides it.');
});

test('a status Lore-Forge does not know is said once and stays in the file as written', () => {
  const { chapter, problems } = parseChapter('---\ntitle: One\nstatus: polishing\n---\n\nText.\n', 'story/01-one.md');
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /idea, draft, revised or done/);
  assert.equal(chapter.status, undefined);
  assert.match(serializeChapter(chapter), /\nstatus: polishing\n/);
});

test('without a status, a chapter is an idea until it has text, then a draft', () => {
  const base: StoryChapter = { file: 'story/01-a.md', title: 'A', order: 1, body: '' };
  assert.equal(chapterStatus(base), 'idea');
  assert.equal(chapterStatus({ ...base, body: '  \n' }), 'idea');
  assert.equal(chapterStatus({ ...base, body: 'Once.' }), 'draft');
  assert.equal(chapterStatus({ ...base, body: 'Once.', status: 'done' }), 'done');
  assert.equal(chapterStatus({ ...base, status: 'revised' }), 'revised');
});

/** Twelve written chapters and one still to write, with who is in each. */
function cast() {
  const people: Record<string, number[]> = {
    Mira: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
    Pip: [1, 2, 3, 4, 5, 6],
    Tam: [1, 2],
    Ozra: [1, 2, 3],
    Lin: [5],
  };
  const story = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    const named = Object.entries(people).filter(([, at]) => at.includes(n)).map(([name]) => name);
    // Chapter 7 names Mira by @id, chapters 9 and 10 name Tam by a link with its own words.
    if (n === 7) named.push('@char-mira');
    if (n === 9 || n === 10) named.push('[[char-tam|the tinker]]');
    return `${named.join(' and ')} walked on.`;
  });
  const w = world([
    { id: 'char-mira', type: 'character', name: 'Mira' },
    { id: 'char-pip', type: 'character', name: 'Pip' },
    { id: 'char-tam', type: 'character', name: 'Tam' },
    { id: 'char-ozra', type: 'character', name: 'Ozra', status: 'dead' },
    { id: 'char-lin', type: 'character', name: 'Lin' },
    { id: 'place-well', type: 'place', name: 'The Well' },
  ], { story: [...story, ''] });
  return w;
}

test('chapterCast: who is in which chapter, the most present first, with long absences', () => {
  const w = cast();
  const chapters = w.story!;
  const rows = chapterCast(w, chapters);
  assert.deepEqual(rows.map((r) => `${r.id} ${r.count}`), ['char-mira 12', 'char-pip 6', 'char-tam 4', 'char-ozra 3', 'char-lin 1']);
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.equal(by.get('char-mira')!.in.length, 13);
  assert.equal(by.get('char-mira')!.gap, undefined);
  // Not seen after chapter 6; the chapter still to write at the end does not count.
  assert.deepEqual(by.get('char-pip')!.gap, { from: 6, to: 11, last: true });
  // Away from chapter 3 to 8, back in 9 and 10 by a link; chapters 11 and 12 are too short a gap.
  assert.deepEqual(by.get('char-tam')!.gap, { from: 2, to: 7, last: false });
  // The dead are expected to be gone.
  assert.equal(by.get('char-ozra')!.gap, undefined);
  // In one chapter only: not a recurring character.
  assert.equal(by.get('char-lin')!.gap, undefined);
  // Places, when asked.
  assert.deepEqual(chapterCast(w, chapters, { type: 'place' }), []);
});

test('chapterCast counts a chapter told from a character\'s point of view, even one not written yet', () => {
  const w = cast();
  const chapters = w.story!.map((c, i) => (i === 12 ? { ...c, pov: 'Pip' } : c));
  const pip = chapterCast(w, chapters).find((r) => r.id === 'char-pip')!;
  assert.equal(pip.count, 7);
  assert.equal(pip.in[12], true);
  // Back at the end, so the absence is a gap in the middle now.
  assert.deepEqual(pip.gap, { from: 6, to: 11, last: false });
});

test('rename everywhere changes a chapter\'s point of view and summary when they use the old name', () => {
  const w = world([{ id: 'char-kadir', type: 'character', name: 'Murat' }], { story: ['Kadir sat.', 'Rain.'] });
  w.story = w.story!.map((c, i) => (i === 0 ? { ...c, pov: 'Kadir', summary: 'Kadir waits for the rain.' } : { ...c, pov: 'char-kadir' }));
  const seen = planRename(w, 'char-kadir', 'Kadir', 'Murat').map((h) => `${h.owner} ${h.field}: ${h.old} → ${h.new}`);
  assert.deepEqual(seen, [
    'story:story/01-chapter-1.md pov: Kadir → Murat',
    'story:story/01-chapter-1.md summary: Kadir → Murat',
    'story:story/01-chapter-1.md body: Kadir → Murat',
  ]);
  const r = applyRename(w, 'char-kadir', 'Kadir', 'Murat');
  assert.equal(r.chapters.length, 1);
  assert.equal(r.chapters[0]!.pov, 'Murat');
  assert.equal(r.chapters[0]!.summary, 'Murat waits for the rain.');
});
