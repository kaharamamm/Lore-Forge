import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storyBook, worldCodex } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';
import { BUNDLED_FONTS, bundledFontFile, bundledFontPath, defaultFontDir, inlineRuns, printable, renderPdf, sidecarPath, writePublication } from '@lore-forge/pdf';

const example = join(import.meta.dirname, '..', '..', '..', 'worlds', 'camelamamm');
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
  assert.equal(sidecarPath('/x/World Codex.PDF'), '/x/World Codex.md');
  assert.equal(sidecarPath('/x/book'), '/x/book.md');
});

test('renders the example World Codex and Story Book to PDF', async () => {
  const world = await loadWorld(example);
  const codex = await renderPdf(worldCodex(world), { worldDir: example });
  assert.equal(codex.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(codex.pages >= 15, `codex has ${codex.pages} pages`);
  const book = await renderPdf(storyBook(world), { worldDir: example });
  assert.equal(book.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(book.pages >= 5, `book has ${book.pages} pages`);
});

test('writes the PDF and a Markdown sidecar with image links relative to it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lore-pdf-'));
  try {
    const world = await loadWorld(example);
    const doc = worldCodex(world);
    // Turkish letters (DejaVu has them) and an image link; the example world has no pictures of its own.
    doc.blocks.push({ kind: 'para', text: "Şafakta İlsa'nın ışığı söndü." }, { kind: 'image', file: 'images/place-singing-well/establishing.png', caption: 'The Singing Well: Establishing shot', details: [] });
    const out = await writePublication(doc, example, join(dir, 'codex.pdf'));
    assert.equal(out.md, join(dir, 'codex.md'));
    const md = await readFile(out.md, 'utf8');
    assert.match(md, /Art brief: Mr Camel/);
    assert.match(md, /Şafakta İlsa'nın ışığı söndü/);
    const link = /!\[The Singing Well: Establishing shot\]\(([^)]+)\)/.exec(md)?.[1];
    assert.ok(link && !link.startsWith('/') && link.endsWith('worlds/camelamamm/images/place-singing-well/establishing.png'), link);
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
  const doc = worldCodex(world);
  doc.blocks.push({ kind: 'image', file: 'images/nope.webp', caption: 'x', details: [] }, { kind: 'image', file: 'images/missing.png', caption: 'y', details: [] });
  const { pdf } = await renderPdf(doc, { worldDir: example });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('no empty boxes: emoji the PDF font cannot draw are dropped, the words stay', async () => {
  const has = (c: number) => c < 0x2000 || c === 0x2694; // DejaVu-like: Latin and the crossed swords
  assert.equal(printable('🧑 Character', has), 'Character');
  assert.equal(printable('Zehra 🪦 dead', has), 'Zehra dead');
  assert.equal(printable('👨‍👩‍👧 Family ⚔️', has), 'Family ⚔');
  assert.equal(printable('Şafak İlsa ışık', has), 'Şafak İlsa ışık');
  const world = await loadWorld(example);
  const doc = worldCodex(world);
  doc.blocks.push({ kind: 'heading', level: 2, text: '🧑 Character 🪦 Tombstone 🐪 Camel' }, { kind: 'para', text: 'Notes 📜 here ✨' });
  const { pdf } = await renderPdf(doc, { worldDir: example });
  if (hasPdftotext) {
    const dir = await mkdtemp(join(import.meta.dirname, 'tmp-'));
    try {
      const file = join(dir, 'e.pdf');
      await (await import('node:fs/promises')).writeFile(file, pdf);
      const text = execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' });
      assert.match(text, /Character Tombstone Camel/);
      assert.match(text, /Notes here/);
      assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}\uFFFD]/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  assert.ok(defaultFontDir());
});

test('cover fonts: a bundled font is embedded, a missing one falls back to DejaVu with a note, hidden titles skip it', async () => {
  const world = await loadWorld(example);
  const withCover = (cover: Record<string, unknown>) => ({ ...world, manifest: { ...world.manifest, cover: { ...world.manifest.cover, ...cover } } });
  const names = (pdf: Buffer) => [...pdf.toString('latin1').matchAll(/\/BaseFont \/[A-Z]{6}\+([\w-]+)/g)].map((m) => m[1]);
  for (const [family, face] of [['Pirata One', 'PirataOne'], ['Liberation Serif', 'LiberationSerif-Bold'], ['UnifrakturMaguntia', 'UnifrakturMaguntia']] as const) {
    const r = await renderPdf(worldCodex(withCover({ font: family })), { worldDir: example });
    assert.deepEqual(r.notes, [], family);
    assert.ok(names(r.pdf).some((n) => n?.startsWith(face)), `${family}: ${names(r.pdf).join(', ')}`);
  }
  const missing = await renderPdf(worldCodex(withCover({ font: 'No Such Font 123' })), { worldDir: example });
  assert.match(missing.notes[0] ?? '', /No Such Font 123.*DejaVu/);
  const hidden = await renderPdf(worldCodex(withCover({ font: 'Pirata One', showTitle: false })), { worldDir: example });
  assert.ok(!names(hidden.pdf).some((n) => n?.startsWith('PirataOne')));
});

test('bundled cover fonts embed as .woff or .ttf, never .woff2 (pdfkit draws WOFF2 glyphs as nothing)', () => {
  for (const f of BUNDLED_FONTS) {
    for (const bold of [false, true]) {
      const file = bundledFontFile(f, bold);
      assert.match(file, /\.(woff|ttf)$/, file);
      assert.ok(bundledFontPath(f, bold), `${f.family} ${bold ? 'bold' : 'regular'}: ${file} is in its package`);
    }
  }
});
