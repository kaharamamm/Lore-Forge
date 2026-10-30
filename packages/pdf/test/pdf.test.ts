import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storyBook, worldBible } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';
import { inlineRuns, renderPdf, sidecarPath, writePublication } from '@lore-forge/pdf';

const example = join(import.meta.dirname, '..', '..', '..', 'examples', 'shifting-sands');
const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('inline runs: bold, italic and plain text', () => {
  assert.deepEqual(inlineRuns('a **b** *c* _d_ 2 * 3'), [
    { text: 'a ', bold: false, italic: false },
    { text: 'b', bold: true, italic: false },
    { text: ' ', bold: false, italic: false },
    { text: 'c', bold: false, italic: true },
    { text: ' ', bold: false, italic: false },
    { text: 'd', bold: false, italic: true },
    { text: ' 2 * 3', bold: false, italic: false },
  ]);
});

test('sidecar path replaces .pdf with .md', () => {
  assert.equal(sidecarPath('/x/World Bible.PDF'), '/x/World Bible.md');
  assert.equal(sidecarPath('/x/book'), '/x/book.md');
});

test('renders the example World Bible and Story Book to PDF', async () => {
  const world = await loadWorld(example);
  const bible = await renderPdf(worldBible(world), { worldDir: example });
  assert.equal(bible.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bible.pages >= 15, `bible has ${bible.pages} pages`);
  const book = await renderPdf(storyBook(world), { worldDir: example });
  assert.equal(book.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(book.pages >= 5, `book has ${book.pages} pages`);
});

test('writes the PDF and a Markdown sidecar with image links relative to it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lore-pdf-'));
  try {
    const world = await loadWorld(example);
    const out = await writePublication(worldBible(world), example, join(dir, 'bible.pdf'));
    assert.equal(out.md, join(dir, 'bible.md'));
    const md = await readFile(out.md, 'utf8');
    assert.match(md, /Art brief: Kadir Humpback/);
    assert.match(md, /Şafakta İlsa'nın ışığı söndü/);
    const link = /!\[Saltmere: Establishing shot\]\(([^)]+)\)/.exec(md)?.[1];
    assert.ok(link && !link.startsWith('/') && link.endsWith('examples/shifting-sands/images/place-saltmere/establishing.png'), link);
    if (hasPdftotext) {
      const text = execFileSync('pdftotext', [out.pdf, '-'], { encoding: 'utf8' });
      assert.match(text, /Contents/);
      assert.match(text, /Şafakta İlsa'nın ışığı söndü/);
      assert.match(text, /3D turnaround brief/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an image that cannot be embedded becomes a note, not a crash', async () => {
  const world = await loadWorld(example);
  const doc = worldBible(world);
  doc.blocks.push({ kind: 'image', file: 'images/nope.webp', caption: 'x', details: [] }, { kind: 'image', file: 'images/missing.png', caption: 'y', details: [] });
  const { pdf } = await renderPdf(doc, { worldDir: example });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});
