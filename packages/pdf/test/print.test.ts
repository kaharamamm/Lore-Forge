import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { docSheets, storyBook, type Doc, type World } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';
import { hyphenate, renderDocx, renderPdf } from '@lore-forge/pdf';

const example = join(import.meta.dirname, '..', '..', '..', 'worlds', 'camelamamm');
const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const withBook = (w: World, book: NonNullable<World['manifest']['book']>): World => ({ ...w, manifest: { ...w.manifest, book: { ...w.manifest.book, ...book } } });

test('the Story Book has a cover, front matter without a half-title, chapter openers with a drop cap, and a print trim', async () => {
  const world = await loadWorld(example);
  const doc = storyBook(world, { year: 2026 });
  // The cover: title, subtitle and author only; the stats and the credit are not on it.
  assert.equal(doc.cover.title, 'Mr Camel and the Singing Well');
  assert.equal(doc.cover.subtitle, 'A story of Camelamamm');
  assert.deepEqual(doc.cover.lines, ['by Ahmet Kadir Zengin']);
  assert.ok(doc.cover.art);
  // The sample has no copyright text and no publisher: no copyright page (a front page is never printed empty).
  const kinds = doc.blocks.slice(0, 5).map((b) => (b.kind === 'front' ? b.role : b.kind));
  assert.deepEqual(kinds, ['title', 'dedication', 'epigraph', 'toc', 'heading']);
  const withCopyright = storyBook(withBook(world, { copyright: 'Text © 2026 Ahmet.' }), { year: 2026 });
  const copyright = withCopyright.blocks[1];
  assert.ok(copyright?.kind === 'front' && copyright.role === 'copyright' && copyright.lines[0] === 'Text © 2026 Ahmet.');
  assert.ok(copyright.lines.some((l) => /^Assembled by /.test(l)), 'the credit is on the copyright page');
  const publisherOnly = storyBook(withBook(world, { publisher: 'Well Press' }), { year: 2026 }).blocks[1];
  assert.ok(publisherOnly?.kind === 'front' && publisherOnly.role === 'copyright' && publisherOnly.lines[0]?.startsWith('Copyright © 2026') && publisherOnly.lines.includes('Published by Well Press'));
  const opener = doc.blocks.find((b) => b.kind === 'heading' && b.opener);
  assert.ok(opener && opener.kind === 'heading' && opener.text === 'Chapter 1. The Morning the Well Went Quiet');
  // The chapter date is the opener's stamp (top right), not a line under the title.
  assert.equal(opener.stamp, '10.03.512 CR');
  assert.ok(!doc.blocks.some((b) => b.kind === 'para' && b.text === '10.03.512 CR'));
  assert.ok(doc.blocks.some((b) => b.kind === 'para' && b.dropCap));
  const print = (d: Doc) => ({ trim: d.print?.trim, rightHand: d.print?.rightHand ?? false });
  assert.deepEqual(print(doc), { trim: '6x9', rightHand: false });
  assert.deepEqual(print(storyBook(world, { trim: 'a5' })), { trim: 'a5', rightHand: false });
  assert.deepEqual(print(storyBook(world, { trim: 'a4' })), { trim: 'a4', rightHand: false });
  assert.deepEqual(print(storyBook(world, { rightHandChapters: true })), { trim: '6x9', rightHand: true });
  const fromWorld = withBook(world, { trim: '5.5x8.5', rightHandChapters: true });
  assert.deepEqual(print(storyBook(fromWorld)), { trim: '5.5x8.5', rightHand: true });
  assert.deepEqual(print(storyBook(fromWorld, { rightHandChapters: false })), { trim: '5.5x8.5', rightHand: false }, 'the option wins over world.json');
  // Preview sheets: each front page, the contents and every chapter on a sheet of its own, the chapter heading first.
  const sheets = docSheets(doc.blocks);
  assert.deepEqual(sheets.slice(0, 4).map((s) => s.length), [1, 1, 1, 1]);
  const chapters = sheets.filter((s) => s[0]?.kind === 'heading' && s[0].opener);
  assert.equal(chapters.length, doc.blocks.filter((b) => b.kind === 'heading' && b.opener).length);
});

test('hyphenation adds soft hyphens to long words only', () => {
  const out = hyphenate('The caravan crossed extraordinary distances.');
  assert.match(out, /extra\u00ADor\u00ADdi\u00ADnary|ex\u00ADtra/);
  assert.equal(out.replace(/\u00AD/g, ''), 'The caravan crossed extraordinary distances.');
});

/** Text of every page of a rendered PDF, via pdftotext. */
async function pageTexts(doc: Doc): Promise<string[]> {
  const { pdf, pages } = await renderPdf(doc, { worldDir: example });
  const dir = await mkdtemp(join(tmpdir(), 'lore-print-'));
  try {
    const file = join(dir, 'book.pdf');
    await writeFile(file, pdf);
    return Array.from({ length: pages }, (_, i) => execFileSync('pdftotext', ['-f', String(i + 1), '-l', String(i + 1), '-layout', file, '-'], { encoding: 'utf8' }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const squash = (t: string) => t.replace(/\s+/g, '');

test('print PDF: cover, front matter and chapters each on a new page with no blank pages, page numbers, running heads', async () => {
  const world = await loadWorld(example);
  const { pdf } = await renderPdf(storyBook(world), { worldDir: example });
  assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 432 648\]/);
  if (!hasPdftotext) return;
  const all = await pageTexts(storyBook(world, { year: 2026 }));
  assert.match(squash(all[0]!), /MRCAMELANDTHESINGINGWELL/i, 'the cover has the title');
  assert.match(squash(all[0]!), /byAhmetKadirZengin/);
  assert.doesNotMatch(all[0]!, /Assembled by|words/, 'no credit or stats on the cover');
  assert.match(squash(all[1]!), /MrCamelandtheSingingWell.*AstoryofCamelamamm.*byAhmetKadirZengin/s, 'page 2 is the title page');
  assert.doesNotMatch(all.join('\n'), /Copyright ©/, 'no copyright page without copyright text');
  assert.match(all[2]!, /waited for the kettle/);
  assert.match(all[3]!, /Water remembers the way home/);
  assert.match(all[4]!, /Contents/);
  assert.match(all[5]!, /CHAPTER 1/);
  assert.match(squash(all[5]!), /TheMorningtheWellWentQuiet/);
  // The date stamp is the opener's first line, at the right; the label comes after it.
  const firstLine = all[5]!.split('\n').find((l) => l.trim() !== '')!;
  assert.match(firstLine, /^\s{20,}10\.03\.512 CR\s*$/, 'the date sits at the top right');
  assert.equal(all.filter((t) => /MrCamelandtheSingingWell/.test(squash(t))).length, 1, 'the title page is not repeated (no half-title)');
  assert.ok(all.every((t, i) => t.trim() !== '' || i === 0), 'no blank pages');
  const opener = 6;
  assert.doesNotMatch(all[opener - 1]!, /^\s*\d+\s*$/m, 'no page number on the opener');
  const folio = (t: string) => /^\s*(\d+)\s*$/m.exec(t)?.[1];
  const numbered = all.map((t, i) => ({ n: i + 1, folio: folio(t), text: t })).filter((p) => p.folio);
  assert.ok(numbered.length > 0);
  for (const p of numbered) assert.equal(Number(p.folio), p.n - opener + 1, `page ${p.n} is numbered from the first chapter`);
  const verso = numbered.find((p) => p.n % 2 === 0);
  assert.match(squash(verso!.text), /MRCAMELANDTHESINGINGWELL/, 'left-hand running head is the book title');
  // Every chapter starts at the top of a new page: its label is the page's first line.
  const openers = all.flatMap((t, i) => (/CHAPTER \d+/.test(t) ? [i] : []));
  assert.equal(openers.length, 6);
  for (const i of openers) assert.match(all[i]!.trimStart(), /^(\d+\.\d+\.\d+ CR\s+)?CHAPTER \d+/, `page ${i + 1} opens with its date and chapter label`);
  assert.ok(openers.some((i) => (i + 1) % 2 === 0), 'chapters are not forced onto right-hand pages');
  assert.doesNotMatch(all.join(''), /\u00AD/, 'soft hyphens never print');
});

test('print PDF with right-hand chapters: copyright on the back of the title page, every chapter on an odd page', async () => {
  if (!hasPdftotext) return;
  const all = await pageTexts(storyBook(withBook(await loadWorld(example), { rightHandChapters: true, copyright: 'Text © 2026 Ahmet.' })));
  // Page numbers here are 1-based; the cover (page 1) also has the subtitle, so the title page is looked for after it.
  const first = (re: RegExp) => all.findIndex((t, i) => i > 0 && re.test(t)) + 1;
  assert.equal(first(/A story of Camelamamm/), 3, 'the title page is page 3');
  assert.equal(first(/Text © 2026/), 4, 'the copyright page is on its back');
  assert.equal(first(/CHAPTER 1/) % 2, 1, 'chapter 1 opens on a right-hand page');
  const openers = all.flatMap((t, i) => (/CHAPTER \d+/.test(t) ? [i + 1] : []));
  assert.ok(openers.length === 6 && openers.every((n) => n % 2 === 1), `chapters on odd pages: ${openers.join(', ')}`);
  assert.ok(all.some((t) => t.trim() === ''), 'blank pages pad the book');
});

test('Word export has the same book structure: mirrored margins, chapters on new pages, headers, drop cap', async () => {
  const world = await loadWorld(example);
  const files = unzipSync(new Uint8Array(await renderDocx(storyBook(world, { trim: 'a5' }), example)));
  const settings = strFromU8(files['word/settings.xml']!);
  const body = strFromU8(files['word/document.xml']!);
  for (const tag of ['<w:mirrorMargins/>', '<w:evenAndOddHeaders/>', '<w:autoHyphenation/>', '<w:updateFields/>']) assert.ok(settings.includes(tag), tag);
  assert.match(body, /<w:pgSz w:w="8391" w:h="11906"/);
  assert.match(body, /w:gutter="340"/);
  assert.match(body, /<w:type w:val="nextPage"\/>/);
  assert.doesNotMatch(body, /<w:type w:val="oddPage"\/>/, 'no blank pages by default');
  assert.match(body, /<w:pgNumType w:start="1"\/>/);
  assert.match(body, /<w:titlePg\/>/);
  assert.doesNotMatch(body, /w:dropCap=/, 'the default initial is raised, not a Word drop cap');
  assert.doesNotMatch(body, /Copyright ©/, 'no copyright page without copyright text');
  assert.match(body, /For everyone who has ever waited for the kettle to sing\./);
  assert.match(body, /TOC \\h \\o/);
  const printed = strFromU8(unzipSync(new Uint8Array(await renderDocx(storyBook(world, { rightHandChapters: true }), example)))['word/document.xml']!);
  assert.match(printed, /<w:type w:val="oddPage"\/>/, 'right-hand chapters start on odd pages');
});
