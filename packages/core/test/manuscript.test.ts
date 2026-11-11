/** A manuscript from elsewhere, split into chapters at its chapter headings. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bareChapterTitle, chapterTitle, splitManuscript } from '@lore-forge/core';

test('Markdown: one "#" title over "##" chapters splits at the "##"; titles lose "Chapter 3:"', () => {
  const md = '# The Salt Roads\n\nBy Nur.\n\n## Chapter 1: The Gate\n\nNur waited.\n\nShe was **tired**.\n\n## Chapter 2\n\nThe caravan came.\n';
  assert.deepEqual(splitManuscript(md, 'salt-roads'), [
    { title: 'salt-roads', body: 'By Nur.' },
    { title: 'The Gate', body: 'Nur waited.\n\nShe was **tired**.' },
    { title: 'Chapter 2', body: 'The caravan came.' },
  ]);
  // Several "#" headings: those are the chapters, and "##" stay inside them.
  assert.deepEqual(splitManuscript('# One\n\nA.\n\n## A scene\n\nB.\n\n# Two\n\nC.', 'x').map((c) => [c.title, c.body]), [['One', 'A.\n\n## A scene\n\nB.'], ['Two', 'C.']]);
});

test('plain text: "Chapter" and "Bölüm" lines, a prologue before them, one paragraph per line, and Windows line breaks', () => {
  const txt = 'Prologue\r\n\r\nLong ago.\r\n\r\nCHAPTER ONE\r\n\r\nIt began.\r\nIt went on.\r\nIt ended.\r\n\r\nBölüm 2: Kuyu\r\n\r\nSu şarkı söyledi.';
  assert.deepEqual(splitManuscript(txt, 'draft'), [
    { title: 'Prologue', body: 'Long ago.' },
    { title: 'CHAPTER ONE', body: 'It began.\nIt went on.\nIt ended.' },
    { title: 'Kuyu', body: 'Su şarkı söyledi.' },
  ]);
  // No blank lines at all: each line is a paragraph.
  assert.equal(splitManuscript('One.\nTwo.\nThree.', 'notes')[0]!.body, 'One.\n\nTwo.\n\nThree.');
  // No headings: one chapter named after the file; nothing at all: no chapter.
  assert.deepEqual(splitManuscript('Just a story.', 'my story'), [{ title: 'my story', body: 'Just a story.' }]);
  assert.deepEqual(splitManuscript('\n\n  \n', 'empty'), []);
});

test('a bare "Chapter 1" takes its name from the next line; bold and Turkish headings; prose is not a heading', () => {
  const txt = 'CHAPTER ONE\n\nThe Boy Who Lived\n\nMr. Dursley was proud.\n\nCHAPTER TWO\n\n"Up!" she said.\n\nPart one of the plan was simple.';
  assert.deepEqual(splitManuscript(txt, 'x'), [
    { title: 'The Boy Who Lived', body: 'Mr. Dursley was proud.' },
    // A line that ends like a sentence is not a name, and prose that starts like a heading stays prose.
    { title: 'CHAPTER TWO', body: '"Up!" she said.\n\nPart one of the plan was simple.' },
  ]);
  // From Word: headings set in bold, and a Markdown name under a bare "##" heading.
  assert.deepEqual(splitManuscript('**Chapter 1**\n\n**The Well**\n\nIt was deep.\n\n**Chapter 2**\n\nIt was dry.', 'x').map((c) => c.title), ['The Well', 'Chapter 2']);
  assert.deepEqual(splitManuscript('## Chapter 1\n\n### The Gate\n\nA.\n\n## Chapter 2\n\nB.', 'x').map((c) => c.title), ['The Gate', 'Chapter 2']);
  // Turkish: the number first, in capitals with a dotted İ.
  assert.deepEqual(splitManuscript('BİRİNCİ BÖLÜM\n\nKuyu\n\nSu derindi.\n\n2. Bölüm: Çöl\n\nKum.', 'x'), [
    { title: 'Kuyu', body: 'Su derindi.' },
    { title: 'Çöl', body: 'Kum.' },
  ]);
});

test('a chapter title from a heading', () => {
  assert.equal(bareChapterTitle('Chapter 3'), true);
  assert.equal(bareChapterTitle('CHAPTER THREE.'), true);
  assert.equal(bareChapterTitle('Birinci Bölüm'), true);
  assert.equal(bareChapterTitle('Chapter 3: The Well'), false);
  assert.equal(bareChapterTitle('The Third Chapter'), false);
  assert.equal(chapterTitle('Chapter 12. The **Long** Night'), 'The Long Night');
  assert.equal(chapterTitle('Chapter IV - Ash'), 'Ash');
  assert.equal(chapterTitle('Bölüm 3) Çöl'), 'Çöl');
  assert.equal(chapterTitle('Chapter 5'), 'Chapter 5');
  assert.equal(chapterTitle('The Chapter of Bones'), 'The Chapter of Bones');
});
