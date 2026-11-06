import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { bookLook, DEFAULT_LOOK, storyBook, toMarkdown, trimFor, type BookSettings, type Doc, type World } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';
import { renderDocx, renderPdf } from '@lore-forge/pdf';

const example = join(import.meta.dirname, '..', '..', '..', 'worlds', 'camelamamm');
const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const withBook = (w: World, book: BookSettings): World => ({ ...w, manifest: { ...w.manifest, book: { ...w.manifest.book, ...book } } });
const docxXml = async (doc: Doc, cover?: Uint8Array) => {
  const files = unzipSync(new Uint8Array(await renderDocx(doc, example, cover ? { cover } : {})));
  return { body: strFromU8(files['word/document.xml']!), styles: strFromU8(files['word/styles.xml']!), files };
};

test('book look: defaults, clamping and unknown values fall back', () => {
  assert.deepEqual(bookLook(), DEFAULT_LOOK);
  assert.equal(DEFAULT_LOOK.dropCap, 'raised');
  assert.equal(DEFAULT_LOOK.dateStamps, true);
  const l = bookLook({ bodySize: 40, chapterSize: 2, bodyColor: 'red', chapterColor: '#112233', bodyFont: 'eb garamond', chapterFont: 'Comic Sans', lineSpacing: 1.8, margins: 'wide', dropCap: 'dropped', dateStamps: false, coverTitleSize: 150, authorSize: 10 });
  assert.equal(l.bodySize, 16);
  assert.equal(l.chapterSize, 12);
  assert.equal(l.bodyColor, DEFAULT_LOOK.bodyColor, 'only #rrggbb colours');
  assert.equal(l.chapterColor, '#112233');
  assert.equal(l.bodyFont, 'EB Garamond', 'font names match in any case');
  assert.equal(l.chapterFont, 'EB Garamond', 'an unknown title font uses the body font');
  assert.equal(l.lineSpacing, 1.8);
  assert.equal(l.dropCap, 'dropped');
  assert.equal(l.dateStamps, false);
  assert.equal(l.coverTitleScale, 1.5);
  assert.equal(l.authorScale, 0.5);
  assert.ok(trimFor('a4', 'wide').inside > trimFor('a4').inside && trimFor('a4', 'narrow').inside < trimFor('a4').inside);
});

test('date stamps: on the opener by default, gone when hidden; drop cap none marks no paragraph', async () => {
  const world = await loadWorld(example);
  const on = storyBook(world);
  const openers = on.blocks.filter((b) => b.kind === 'heading' && b.opener && b.stamp);
  assert.equal(openers.length, 6);
  assert.match(toMarkdown(on, (f) => f), /<p align="right"><i>10\.03\.512 CR<\/i><\/p>/);
  const off = storyBook(withBook(world, { dateStamps: false }));
  assert.ok(!off.blocks.some((b) => b.kind === 'heading' && b.stamp));
  assert.ok(!JSON.stringify(off.blocks).includes('512 CR'), 'no date anywhere, chronicle pages included');
  const none = storyBook(withBook(world, { dropCap: 'none' }));
  assert.ok(!none.blocks.some((b) => b.kind === 'para' && b.dropCap));
});

/** Word boxes of one PDF page via pdftotext -bbox. */
async function words(doc: Doc, page: number): Promise<{ text: string; x0: number; y0: number; x1: number; y1: number }[]> {
  const { pdf } = await renderPdf(doc, { worldDir: example });
  const dir = await mkdtemp(join(tmpdir(), 'lore-look-'));
  try {
    const file = join(dir, 'b.pdf');
    await writeFile(file, pdf);
    const xml = execFileSync('pdftotext', ['-f', String(page), '-l', String(page), '-bbox', file, '-'], { encoding: 'utf8' });
    return [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({ x0: +m[1]!, y0: +m[2]!, x1: +m[3]!, y1: +m[4]!, text: m[5]! }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
/** DejaVu's ascent share of its line box: a word's baseline from its pdftotext box. */
const baseline = (w: { y0: number; y1: number }) => w.y0 + (w.y1 - w.y0) * (0.928 / 1.164);

test('PDF drop cap: raised sits on the first baseline flush with its word, dropped spans two lines, none is plain', { skip: !hasPdftotext }, async () => {
  const world = await loadWorld(example);
  const page = 6; // cover, title, copyright, dedication, epigraph, contents: chapter 1 opens on page 7
  const at = async (dropCap: BookSettings['dropCap']) => {
    const ws = await words(storyBook(withBook(world, { dropCap })), page + 1);
    const i = ws.findIndex((w) => w.text === 'E' || w.text === 'Every');
    return { cap: ws[i]!, next: ws[i + 1]!, after: ws.slice(i + 1) };
  };
  const raised = await at('raised');
  assert.equal(raised.cap.text, 'E');
  assert.equal(raised.next.text, 'very');
  assert.ok(Math.abs(baseline(raised.cap) - baseline(raised.next)) < 1, `raised cap on the first baseline (${baseline(raised.cap)} vs ${baseline(raised.next)})`);
  assert.ok(raised.next.x0 - raised.cap.x1 < 2, 'no gap between the raised cap and the rest of its word');
  assert.ok(raised.cap.y1 - raised.cap.y0 > 2 * (raised.next.y1 - raised.next.y0), 'the raised cap is big');
  const secondLine = raised.after.find((w) => w.y0 > raised.next.y1)!;
  assert.ok(secondLine.x0 <= raised.cap.x0 + 0.5, 'only the first line runs beside a raised cap');

  const dropped = await at('dropped');
  const line2 = dropped.after.find((w) => w.y0 > dropped.next.y1)!;
  assert.ok(Math.abs(baseline(dropped.cap) - baseline(line2)) < 1, 'a dropped cap sits on the second baseline');
  assert.ok(line2.x0 > dropped.cap.x1, 'the second line runs beside a dropped cap');
  const line3 = dropped.after.find((w) => w.y0 > line2.y1)!;
  assert.ok(line3.x0 < dropped.cap.x1, 'the third line no longer runs beside the cap');
  assert.ok(dropped.next.x0 - dropped.cap.x1 < 6, 'a small even gap after a dropped cap');

  const none = await at('none');
  assert.equal(none.cap.text, 'Every', 'no separate initial');
});

test('PDF follows the look: A4 and Letter pages, the chosen fonts embedded, the date at the top right', async () => {
  const world = await loadWorld(example);
  const a4 = await renderPdf(storyBook(world, { trim: 'a4' }), { worldDir: example });
  assert.match(a4.pdf.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
  const letter = await renderPdf(storyBook(world, { trim: 'letter' }), { worldDir: example });
  assert.match(letter.pdf.toString('latin1'), /\/MediaBox \[0 0 612 792\]/);
  const styled = await renderPdf(storyBook(withBook(world, { bodyFont: 'Liberation Serif', chapterFont: 'Cinzel Decorative' })), { worldDir: example });
  const raw = styled.pdf.toString('latin1');
  assert.match(raw, /\/BaseFont \/[A-Z]{6}\+LiberationSerif/);
  assert.match(raw, /\/BaseFont \/[A-Z]{6}\+CinzelDecorative/);
  if (!hasPdftotext) return;
  const ws = await words(storyBook(world), 7);
  const stamp = ws.find((w) => w.text === 'CR')!;
  const label = ws.find((w) => w.text === 'CHAPTER')!;
  assert.ok(stamp.y1 <= label.y0, 'the date is above the chapter label');
  // Chapter 1 is a right-hand page: the date ends at the page width minus the outside margin.
  const edge = trimFor('a4').width - trimFor('a4').outside;
  assert.ok(Math.abs(stamp.x1 - edge) < 1, `the date ends at the A4 right margin (${stamp.x1} vs ${edge})`);
});

test('Word follows the look: cover as a full first page, fonts, sizes, colours, drop cap modes, no empty front pages', async () => {
  const world = await loadWorld(example);
  const styled = storyBook(withBook(world, { trim: 'a4', bodyFont: 'EB Garamond', bodySize: 12, bodyColor: '#203040', chapterFont: 'Cinzel Decorative', chapterSize: 26, chapterColor: '#602010', dropCap: 'dropped' }));
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  const { body, styles, files } = await docxXml(styled, png);
  assert.match(body, /<w:pgSz w:w="11906" w:h="16838"/, 'A4');
  // The cover: a picture anchored to the page, page-sized, behind the text, in the first section (before the title page).
  const firstBreak = body.indexOf('</w:p>', body.indexOf('<w:sectPr')); // the first section ends with the paragraph holding its sectPr
  const anchor = body.indexOf('<wp:anchor');
  assert.ok(anchor > 0 && anchor < firstBreak, 'the cover picture is on the first page');
  assert.match(body.slice(anchor, firstBreak), /behindDoc="1"/);
  assert.match(body.slice(anchor, firstBreak), /<wp:positionH relativeFrom="page"><wp:posOffset>0<\/wp:posOffset>/);
  assert.match(body.slice(anchor, firstBreak), /<wp:extent cx="7560310" cy="10692130"\/>|<wp:extent cx="75\d{5}" cy="106\d{5}"\/>/, 'as big as an A4 page');
  assert.ok(Object.keys(files).some((f) => f.startsWith('word/media/')), 'the cover picture is in the file');
  assert.ok(body.indexOf('>Mr Camel and the Singing Well</w:t>') > firstBreak, 'the title page follows the cover');
  assert.match(styles, /w:ascii="EB Garamond"/);
  assert.match(styles, /w:ascii="Cinzel Decorative"/);
  assert.match(styles, /<w:sz w:val="24"\/>/, 'body 12 pt');
  assert.match(styles, /<w:sz w:val="52"\/>/, 'chapter titles 26 pt');
  assert.match(styles, /<w:color w:val="203040"\/>/);
  assert.match(styles, /<w:color w:val="602010"\/>/);
  assert.match(body, /w:dropCap="drop" w:lines="2"/, 'dropped: a two-line Word drop cap');
  assert.match(body, /10\.03\.512 CR/);
  assert.match(body, /<w:jc w:val="right"\/>[\s\S]{0,400}10\.03\.512 CR/, 'the date is right-aligned');
  assert.match(body, /Copyright ©/, 'the copyright page is included even when the field is empty');

  const raisedDoc = storyBook(world);
  const capHalfPoints = Math.round(raisedDoc.print!.look!.bodySize * 2.6 * 2);
  const raised = (await docxXml(raisedDoc)).body;
  assert.doesNotMatch(raised, /w:dropCap=/);
  assert.match(raised, new RegExp(`<w:sz w:val="${capHalfPoints}"/>[\\s\\S]{0,200}<w:t xml:space="preserve">E</w:t>|<w:sz w:val="${capHalfPoints}"/>[\\s\\S]{0,200}<w:t>E</w:t>`), 'raised: a big E in the first line');
  assert.match(raised, /<wp:anchor[\s\S]*?behindDoc="1"/, 'without an app cover picture, the world picture fills the cover page');
  const noStamp = (await docxXml(storyBook(withBook(world, { dateStamps: false })))).body;
  assert.doesNotMatch(noStamp, /512 CR/);
  const copyright = (await docxXml(storyBook(withBook(world, { copyright: 'Text © 2026 Ahmet.' })))).body;
  assert.match(copyright, /Text © 2026 Ahmet\./);
});
