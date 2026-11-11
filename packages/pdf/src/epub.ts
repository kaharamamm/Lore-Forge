/**
 * An e-book (EPUB 3) of a Story Book, for phones and e-readers: Apple Books, Google Play Books, Kobo, Calibre, and a
 * Kindle through Send to Kindle. The same document as the PDF and the Word file: the cover, the front pages, then
 * each chapter as a file of its own with its title, date and text, and the pictures in it. The text flows to the
 * reader's screen and font, so there are no page numbers, running heads or hyphens. A table of contents for EPUB 3
 * readers and an NCX for older ones.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { inlineRuns, type Block, type Doc } from '@lore-forge/core';
import { chapterParts } from './index.ts';
import { english, type Translate } from './words.ts';

export interface EpubOptions {
  /** The cover as a PNG (the app draws it like the PDF's); without it, the cover page is the title in text. */
  cover?: Uint8Array;
  /** The language of the book's text (BCP 47, e.g. "en" or "tr"). Default "en". */
  lang?: string;
  /** A stable id for the book, e.g. the world id: an e-reader then knows a new export is the same book. */
  id?: string;
  author?: string;
  /** The exporter's own words ("Contents", "Cover") in the app's language. */
  t?: Translate;
}

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Text with **bold** and *italic*, its line breaks kept. */
const inline = (s: string): string => s.split('\n').map((line) => inlineRuns(line).map((r) => (r.bold ? `<strong>${esc(r.text)}</strong>` : r.italic ? `<em>${esc(r.text)}</em>` : esc(r.text))).join('')).join('<br/>');

const xhtml = (lang: string, title: string, body: string, css = '../style.css'): string => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="${css}"/>
</head>
<body>
${body}
</body>
</html>
`;

const CSS = `body { margin: 0 5%; line-height: 1.5; }
h1, h2, h3 { line-height: 1.25; page-break-after: avoid; break-after: avoid; }
h1.chapter { margin: 2.5em 0 1.2em; text-align: center; font-size: 1.5em; }
h1.chapter .label { display: block; margin-bottom: 0.4em; font-size: 0.6em; font-weight: normal; letter-spacing: 0.15em; text-transform: uppercase; }
p { margin: 0; text-indent: 1.3em; }
p.first, h1 + p, h2 + p, h3 + p, figure + p { text-indent: 0; }
p.first::first-letter { float: left; font-size: 3em; line-height: 0.85; padding: 0.05em 0.08em 0 0; }
p.stamp { margin: -0.6em 0 1.5em; text-align: center; text-indent: 0; font-size: 0.85em; font-style: italic; }
figure { margin: 1.2em 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
figure img { max-width: 100%; max-height: 80vh; }
figcaption { font-size: 0.85em; font-style: italic; }
.front { margin-top: 20%; text-align: center; }
.front p { text-indent: 0; margin: 0.4em 0; }
.front .book-title { font-size: 2em; margin: 0 0 0.4em; }
.front-copyright { margin-top: 40%; font-size: 0.8em; text-align: left; }
.front-dedication, .front-epigraph { font-style: italic; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { max-width: 100%; max-height: 100vh; }
ul, ol { margin: 0.6em 0 0.6em 1.4em; padding: 0; }
dl { margin: 0.6em 0; }
dt { font-weight: bold; }
dd { margin: 0 0 0.4em 1.2em; }
`;

interface Section {
  id: string;
  file: string;
  title: string;
  /** A chapter (in the contents), or a front page. */
  chapter: boolean;
  body: string[];
}

/** The EPUB file of a Story Book, as bytes. `worldDir` is where its pictures are. */
export async function renderEpub(doc: Doc, worldDir: string, options: EpubOptions = {}): Promise<{ bytes: Uint8Array; chapters: number; pictures: number; notes: string[] }> {
  const say = options.t ?? english;
  const lang = options.lang?.trim() || 'en';
  const notes: string[] = [];
  const pictures = new Map<string, { name: string; type: string; data: Uint8Array }>();

  /** A picture of the book, once, under a name fit for the e-book. */
  const picture = async (file: string): Promise<string | undefined> => {
    const known = pictures.get(file);
    if (known) return known.name;
    const type = IMAGE_TYPES[extname(file).toLowerCase()];
    if (!type) {
      notes.push(say('[Image not embedded: {file}. The e-book takes PNG, JPEG, GIF and WebP pictures.]', { file }));
      return undefined;
    }
    let data: Uint8Array;
    try {
      data = new Uint8Array(await readFile(join(worldDir, file)));
    } catch {
      notes.push(say('[Image file missing: {file}]', { file }));
      return undefined;
    }
    const name = `${pictures.size + 1}-${file.split('/').pop()!.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`;
    pictures.set(file, { name, type, data });
    return name;
  };

  const sections: Section[] = [];
  const start = (title: string, chapter: boolean): Section => {
    const n = String(sections.length + 1).padStart(2, '0');
    const s: Section = { id: `s${n}`, file: `text/s${n}.xhtml`, title, chapter, body: [] };
    sections.push(s);
    return s;
  };
  let at: Section | undefined;
  const add = (html: string): void => {
    at ??= start(doc.title, true);
    at.body.push(html);
  };
  const block = async (b: Block): Promise<void> => {
    switch (b.kind) {
      case 'toc': return;
      case 'front': {
        const lines = b.lines.filter((l) => l !== '');
        if (!lines.length) return;
        at = start(b.role === 'title' ? lines[0]! : '', false);
        const inner = b.role === 'title'
          ? lines.map((l, i) => (i === 0 ? `<h1 class="book-title">${inline(l)}</h1>` : `<p>${inline(l)}</p>`)).join('\n')
          : lines.map((l) => `<p>${inline(l)}</p>`).join('\n');
        const type = b.role === 'title' ? 'titlepage' : b.role === 'copyright' ? 'copyright-page' : b.role;
        at.body.push(`<section class="front front-${b.role}" epub:type="${type}">\n${inner}\n</section>`);
        at = undefined;
        return;
      }
      case 'heading': {
        if (b.opener || b.newPage || b.level === 1) {
          at = start(b.text, true);
          const [label, title] = chapterParts(b.text);
          at.body.push(`<h1 class="chapter">${label ? `<span class="label">${esc(label)}</span>` : ''}${esc(title)}</h1>`);
          if (b.stamp) at.body.push(`<p class="stamp">${esc(b.stamp)}</p>`);
          return;
        }
        add(`<h${b.level + 1}>${esc(b.text)}</h${b.level + 1}>`);
        return;
      }
      case 'para': add(`<p${b.dropCap ? ' class="first"' : ''}>${inline(b.text)}</p>`); return;
      case 'list': add(`<ul>${b.items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); return;
      case 'facts': add(`<dl>${b.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${inline(v)}</dd>`).join('')}</dl>`); return;
      case 'image': {
        const name = await picture(b.file);
        if (name) add(`<figure><img src="../images/${name}" alt="${esc(b.caption)}"/>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`);
        return;
      }
      case 'prompt': add(`<p><strong>${esc(b.label)}</strong></p><p>${inline(b.text)}</p>`); return;
      case 'box':
        add(`<h3>${esc(b.title)}</h3>`);
        for (const x of b.blocks) await block(x);
        return;
    }
  };
  for (const b of doc.blocks) await block(b);

  const title = doc.cover.title || doc.title;
  const author = options.author?.trim();
  const id = `urn:lore-forge:${(options.id ?? title).toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const chapters = sections.filter((s) => s.chapter);
  const contents = say('Contents');

  const files: Zippable = {};
  // The mimetype comes first and is stored as it is: that is how a reader knows the file.
  files['mimetype'] = [strToU8('application/epub+zip'), { level: 0 }];
  files['META-INF/container.xml'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`);
  files['OEBPS/style.css'] = strToU8(CSS);
  if (options.cover) {
    files['OEBPS/images/cover.png'] = [options.cover, { level: 0 }];
    files['OEBPS/cover.xhtml'] = strToU8(xhtml(lang, title, `<section class="cover" epub:type="cover"><img src="images/cover.png" alt="${esc(title)}"/></section>`, 'style.css'));
  }
  for (const s of sections) files[`OEBPS/${s.file}`] = strToU8(xhtml(lang, s.title || title, s.body.join('\n')));
  for (const p of pictures.values()) files[`OEBPS/images/${p.name}`] = [p.data, { level: 0 }];
  files['OEBPS/nav.xhtml'] = strToU8(xhtml(lang, contents, `<nav epub:type="toc" id="toc">
<h1>${esc(contents)}</h1>
<ol>
${chapters.map((s) => `<li><a href="${s.file}">${esc(s.title)}</a></li>`).join('\n')}
</ol>
</nav>
<nav epub:type="landmarks" hidden="">
<ol>
${options.cover ? `<li><a epub:type="cover" href="cover.xhtml">${esc(say('Cover'))}</a></li>\n` : ''}${chapters[0] ? `<li><a epub:type="bodymatter" href="${chapters[0].file}">${esc(chapters[0].title)}</a></li>` : ''}
</ol>
</nav>`, 'style.css'));
  files['OEBPS/toc.ncx'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${esc(lang)}">
<head><meta name="dtb:uid" content="${esc(id)}"/></head>
<docTitle><text>${esc(title)}</text></docTitle>
<navMap>
${chapters.map((s, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(s.title)}</text></navLabel><content src="${s.file}"/></navPoint>`).join('\n')}
</navMap>
</ncx>
`);
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...(options.cover ? ['<item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>', '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>'] : []),
    ...sections.map((s) => `<item id="${s.id}" href="${s.file}" media-type="application/xhtml+xml"/>`),
    ...[...pictures.values()].map((p, i) => `<item id="img${i + 1}" href="images/${p.name}" media-type="${p.type}"/>`),
  ];
  const spine = [...(options.cover ? ['<itemref idref="cover"/>'] : []), ...sections.map((s) => `<itemref idref="${s.id}"/>`)];
  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${esc(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${esc(id)}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
${author ? `<dc:creator>${esc(author)}</dc:creator>\n` : ''}<dc:language>${esc(lang)}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
${options.cover ? '<meta name="cover" content="cover-image"/>\n' : ''}</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${spine.join('\n')}
</spine>
</package>
`);
  return { bytes: zipSync(files, { level: 6 }), chapters: chapters.length, pictures: pictures.size, notes };
}

/** Writes the Story Book's EPUB to `path`. */
export async function writeEpub(doc: Doc, worldDir: string, path: string, options: EpubOptions = {}): Promise<{ epub: string; chapters: number; pictures: number; notes: string[] }> {
  const r = await renderEpub(doc, worldDir, options);
  await writeFile(path, r.bytes);
  return { epub: path, chapters: r.chapters, pictures: r.pictures, notes: r.notes };
}
