/** The Story Book as an e-book (EPUB 3): how readers find it, its pages, contents, cover and pictures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { storyBook } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';
import { renderEpub } from '@lore-forge/pdf';

const sample = join(import.meta.dirname, '..', '..', '..', 'worlds', 'camelamamm');
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);

/** Tags open and close in order (XHTML is XML: a reader refuses a page that is not). */
function wellFormed(xml: string, name: string): void {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)) {
    const [, close, tag, , self] = m;
    if (self) continue;
    if (close) assert.equal(stack.pop(), tag, `${name}: </${tag}> closes the wrong element`);
    else stack.push(tag!);
  }
  assert.deepEqual(stack, [], `${name}: elements left open`);
  assert.doesNotMatch(xml, /&(?!amp;|lt;|gt;|quot;|#\d+;)/, `${name}: a bare &`);
}

test('the Story Book as an EPUB: mimetype first and stored, contents, cover, chapters, pictures, and every page well formed', async () => {
  const world = await loadWorld(sample);
  const doc = storyBook(world);
  const r = await renderEpub(doc, sample, { cover: PNG, lang: 'en', id: world.manifest.id, author: 'Ahmet Kadir Zengin' });
  // The first file is "mimetype", stored (compression method 0), so readers know the file at a glance.
  const head = Buffer.from(r.bytes.subarray(0, 64));
  assert.equal(head.readUInt32LE(0), 0x04034b50);
  assert.equal(head.readUInt16LE(8), 0, 'mimetype is stored');
  assert.equal(head.subarray(30, 30 + head.readUInt16LE(26)).toString(), 'mimetype');
  const files = unzipSync(r.bytes);
  assert.equal(strFromU8(files['mimetype']!), 'application/epub+zip');
  assert.match(strFromU8(files['META-INF/container.xml']!), /full-path="OEBPS\/content\.opf"/);

  const opf = strFromU8(files['OEBPS/content.opf']!);
  assert.match(opf, /<dc:identifier id="bookid">urn:lore-forge:camelamamm<\/dc:identifier>/);
  assert.match(opf, /<dc:title>Camelamamm<\/dc:title>|<dc:title>[^<]+<\/dc:title>/);
  assert.match(opf, /<dc:creator>Ahmet Kadir Zengin<\/dc:creator>/);
  assert.match(opf, /<dc:language>en<\/dc:language>/);
  assert.match(opf, /<meta property="dcterms:modified">\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/meta>/);
  assert.match(opf, /properties="cover-image"/);
  assert.match(opf, /<spine toc="ncx">\n<itemref idref="cover"\/>/);
  // Every file the package names is in the zip.
  for (const m of opf.matchAll(/href="([^"]+)"/g)) assert.ok(files[`OEBPS/${m[1]}`], `missing OEBPS/${m[1]}`);

  // The contents list each chapter, in reading order: the sample's six and its chronicle.
  const nav = strFromU8(files['OEBPS/nav.xhtml']!);
  const titles = [...nav.matchAll(/<li><a href="text\/s\d+\.xhtml">([^<]+)<\/a><\/li>/g)].map((m) => m[1]);
  const chapters = doc.blocks.filter((b) => b.kind === 'heading' && (b.opener || b.newPage || b.level === 1)).length;
  assert.equal(r.chapters, chapters);
  assert.equal(titles.length, chapters);
  assert.ok(titles.some((t) => /The Morning the Well Went Quiet/.test(t!)), titles.join(' | '));
  assert.ok(strFromU8(files['OEBPS/toc.ncx']!).includes('<navPoint id="n1" playOrder="1">'));

  // A chapter: its title, its date, its first paragraph with the initial, and names as written.
  const first = Object.entries(files).find(([k, v]) => k.startsWith('OEBPS/text/') && strFromU8(v).includes('The Morning the Well Went Quiet</h1>'));
  assert.ok(first, 'the first chapter has a page of its own');
  const page = strFromU8(first![1]);
  assert.match(page, /<h1 class="chapter"><span class="label">Chapter 1<\/span>The Morning the Well Went Quiet<\/h1>/);
  assert.match(page, /<p class="stamp">[^<]*512[^<]*<\/p>/);
  assert.match(page, /<p class="first">Every morning in Camelamamm began with a song/);
  // The sample's pictures go in once each, and every page is well formed.
  assert.ok(r.pictures > 0 && Object.keys(files).filter((k) => k.startsWith('OEBPS/images/') && k !== 'OEBPS/images/cover.png').length === r.pictures);
  for (const [k, v] of Object.entries(files)) if (/\.(xhtml|opf|ncx|xml)$/.test(k)) wellFormed(strFromU8(v), k);
  assert.deepEqual(r.notes, []);
});

test('without a cover picture the e-book starts at the title page, and a missing picture becomes a note', async () => {
  const world = await loadWorld(sample);
  const doc = storyBook(world);
  doc.blocks.push({ kind: 'image', file: 'images/nowhere/gone.png', caption: 'Gone', details: [] }, { kind: 'image', file: 'images/x/model.bmp', caption: 'Old', details: [] });
  const r = await renderEpub(doc, sample, {});
  const files = unzipSync(r.bytes);
  assert.ok(!files['OEBPS/cover.xhtml'] && !strFromU8(files['OEBPS/content.opf']!).includes('cover-image'));
  assert.match(strFromU8(files['OEBPS/content.opf']!), /<dc:language>en<\/dc:language>/);
  assert.deepEqual(r.notes, ['[Image file missing: images/nowhere/gone.png]', '[Image not embedded: images/x/model.bmp. The e-book takes PNG, JPEG, GIF and WebP pictures.]']);
});
