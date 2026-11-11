/** A manuscript into the story: a Word file read as Markdown, and the files the import takes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { docxMarkdown, readManuscript } from '../src/main/manuscript.ts';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
// A Turkish Word: the style ids are "KonuBal" and "Balk1", the names stay "Title" and "heading 1". "Bolum" is a style
// of the writer's own, a heading only by its outline level.
const STYLES = `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}>`
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="KonuBal"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Balk1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Bolum"><w:name w:val="Bolum"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
  + '<w:style w:type="character" w:styleId="Balk1Char"><w:name w:val="Başlık 1 Char"/></w:style>'
  + '</w:styles>';
const para = (inner: string, style?: string): string => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${inner}</w:p>`;
const run = (text: string, props = ''): string => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>`
  + para(run('The Salt Roads'), 'KonuBal')
  + para(run('Chapter 1: ') + run('The Gate'), 'Balk1')
  + para(run('Nur was ') + run('very', '<w:b/>') + run(' tired ', '<w:b/>') + run('and ') + run('cold', '<w:i/><w:iCs/>') + run('. Salt &amp; sand&#x2019;s end.'))
  + para('<w:r><w:t>Line one</w:t><w:br/><w:t>line two</w:t></w:r><w:r/><w:r><w:br w:type="page"/></w:r>')
  + '<w:p/>'
  + para(run('Chapter 2'), 'Bolum')
  + para(run('It was ', '<w:b w:val="0"/>') + '<w:del><w:r><w:delText>not </w:delText></w:r></w:del><w:r><w:t>dry</w:t><w:tab/><w:t>and still.</w:t></w:r>')
  + '<w:sectPr/></w:body></w:document>';
const docx = (files: Record<string, string>): Uint8Array => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
const WORD = docx({ '[Content_Types].xml': '<Types/>', 'word/document.xml': DOCUMENT, 'word/styles.xml': STYLES });

test('a Word file as Markdown: the title, headings by style name or outline level, bold and italic, breaks', () => {
  assert.equal(docxMarkdown(WORD), [
    '# The Salt Roads',
    '## Chapter 1: The Gate',
    'Nur was **very tired** and *cold*. Salt & sand’s end.',
    'Line one\nline two',
    '## Chapter 2',
    'It was dry\tand still.',
  ].join('\n\n'));
  assert.throws(() => docxMarkdown(strToU8('not a zip')), /not a Word file/);
  assert.throws(() => docxMarkdown(docx({ 'content.xml': '<x/>' })), /not a Word file/);
});

test('reading a manuscript: Word, Markdown and text become chapters; other files are refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lore-manuscript-'));
  await writeFile(join(dir, 'salt-roads.docx'), WORD);
  const word = await readManuscript(join(dir, 'salt-roads.docx'));
  assert.equal(word.name, 'salt-roads');
  assert.deepEqual(word.chapters.map((c) => c.title), ['The Gate', 'Chapter 2']);
  assert.equal(word.chapters[0]!.body, 'Nur was **very tired** and *cold*. Salt & sand’s end.\n\nLine one\nline two');
  await writeFile(join(dir, 'notes.md'), '# One\n\nA.\n\n# Two\n\nB.\n');
  assert.deepEqual((await readManuscript(join(dir, 'notes.md'))).chapters, [{ title: 'One', body: 'A.' }, { title: 'Two', body: 'B.' }]);
  await writeFile(join(dir, 'Draft.TXT'), 'Just a story.');
  assert.deepEqual(await readManuscript(join(dir, 'Draft.TXT')), { name: 'Draft', chapters: [{ title: 'Draft', body: 'Just a story.' }] });
  await writeFile(join(dir, 'book.pdf'), '%PDF');
  await assert.rejects(readManuscript(join(dir, 'book.pdf')), /imports Word/);
  await writeFile(join(dir, 'fake.docx'), 'plain text');
  await assert.rejects(readManuscript(join(dir, 'fake.docx')), /not a Word file/);
});
