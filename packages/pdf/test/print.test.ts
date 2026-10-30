import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { storyBook, type World } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';
import { hyphenate, renderDocx, renderPdf } from '@lore-forge/pdf';

const example = join(import.meta.dirname, '..', '..', '..', 'worlds', 'shifting-sands');
const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const withFront = (w: World): World => ({
  ...w,
  manifest: { ...w.manifest, book: { ...w.manifest.book, dedication: 'For the caravans.', epigraph: 'The sand remembers.', epigraphSource: 'Desert saying' } },
});

test('the Story Book has front matter, chapter openers with a drop cap, and a print trim', async () => {
  const world = withFront(await loadWorld(example));
  const doc = storyBook(world, { year: 2026 });
  const kinds = doc.blocks.slice(0, 6).map((b) => (b.kind === 'front' ? b.role : b.kind));
  assert.deepEqual(kinds, ['half-title', 'title', 'copyright', 'dedication', 'epigraph', 'toc']);
  const copyright = doc.blocks[2];
  assert.ok(copyright?.kind === 'front' && copyright.lines[0]?.startsWith('Copyright © 2026'));
  const opener = doc.blocks.find((b) => b.kind === 'heading' && b.opener);
  assert.ok(opener && opener.kind === 'heading' && /The Salt Road/.test(opener.text));
  assert.ok(doc.blocks.some((b) => b.kind === 'para' && b.dropCap));
  assert.deepEqual(doc.print, { trim: '6x9' });
  assert.deepEqual(storyBook(world, { trim: 'a5' }).print, { trim: 'a5' });
  const fromWorld = { ...world, manifest: { ...world.manifest, book: { trim: '5.5x8.5' as const } } };
  assert.deepEqual(storyBook(fromWorld).print, { trim: '5.5x8.5' });
});

test('hyphenation adds soft hyphens to long words only', () => {
  const out = hyphenate('The caravan crossed extraordinary distances.');
  assert.match(out, /extra\u00ADor\u00ADdi\u00ADnary|ex\u00ADtra/);
  assert.equal(out.replace(/\u00AD/g, ''), 'The caravan crossed extraordinary distances.');
});

test('print PDF: trim size, right-hand chapter openers without page numbers, running heads', async () => {
  const world = await loadWorld(example);
  const { pdf, pages } = await renderPdf(storyBook(world), { worldDir: example });
  assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 432 648\]/);
  if (!hasPdftotext) return;
  const dir = await mkdtemp(join(tmpdir(), 'lore-print-'));
  try {
    const file = join(dir, 'book.pdf');
    await writeFile(file, pdf);
    const page = (n: number) => execFileSync('pdftotext', ['-f', String(n), '-l', String(n), '-layout', file, '-'], { encoding: 'utf8' });
    const all = Array.from({ length: pages }, (_, i) => page(i + 1));
    const opener = all.findIndex((t) => /CHAPTER 1/.test(t)) + 1;
    assert.equal(opener % 2, 1, 'chapter 1 opens on a right-hand page');
    assert.doesNotMatch(all[opener - 1]!, /^\s*\d+\s*$/m, 'no page number on the opener');
    const folio = (t: string) => /^\s*(\d+)\s*$/m.exec(t)?.[1];
    const numbered = all.map((t, i) => ({ n: i + 1, folio: folio(t), text: t })).filter((p) => p.folio);
    assert.ok(numbered.length > 0);
    for (const p of numbered) assert.equal(Number(p.folio), p.n - opener + 1, `page ${p.n} is numbered from the first chapter`);
    const verso = numbered.find((p) => p.n % 2 === 0);
    assert.match(verso!.text.replace(/(\S) (?=\S)/g, '$1'), /TALESOFTHESHIFTINGSANDS/, 'left-hand running head is the book title');
    assert.ok(all.every((t) => !/CHAPTER 1/.test(t) || !folio(t)));
    assert.doesNotMatch(all.join(''), /\u00AD/, 'soft hyphens never print');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Word export has the same book structure: mirrored margins, odd-page chapters, headers, drop cap', async () => {
  const world = withFront(await loadWorld(example));
  const files = unzipSync(new Uint8Array(await renderDocx(storyBook(world, { trim: 'a5' }), example)));
  const settings = strFromU8(files['word/settings.xml']!);
  const body = strFromU8(files['word/document.xml']!);
  for (const tag of ['<w:mirrorMargins/>', '<w:evenAndOddHeaders/>', '<w:autoHyphenation/>', '<w:updateFields/>']) assert.ok(settings.includes(tag), tag);
  assert.match(body, /<w:pgSz w:w="8391" w:h="11906"/);
  assert.match(body, /w:gutter="340"/);
  assert.match(body, /<w:type w:val="oddPage"\/>/);
  assert.match(body, /<w:pgNumType w:start="1"\/>/);
  assert.match(body, /<w:titlePg\/>/);
  assert.match(body, /w:dropCap="drop" w:lines="3"/);
  assert.match(body, /For the caravans\./);
  assert.match(body, /TOC \\h \\o/);
});
