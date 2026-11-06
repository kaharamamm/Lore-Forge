/**
 * Word (.docx) export of a print Story Book. Same structure as the print PDF: the cover as a full first page, the
 * title page, the copyright page (always), the dedication and epigraph pages when the book has them, contents, then each chapter on a
 * new page with its date at the top right and a raised or dropped initial (doc.print.look), in the book's fonts,
 * sizes and colours,
 * running heads (book title left, chapter right), page numbers from the first chapter (none on openers), mirrored
 * margins with a gutter, widow/orphan control and automatic hyphenation. With right-hand chapters (doc.print.rightHand)
 * the front pages and chapters open on right-hand pages, the copyright page on the back of the title page.
 * Word fills in the contents page numbers when it opens the file (it asks to update fields).
 */
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  AlignmentType,
  Document,
  DropCapType,
  FrameAnchorType,
  FrameWrap,
  Footer,
  Header,
  HeadingLevel,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  SectionType,
  TableOfContents,
  TextRun,
  TextWrappingType,
  VerticalPositionRelativeFrom,
  type ISectionOptions,
  type ParagraphChild,
} from 'docx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { DEFAULT_LOOK, DEFAULT_TRIM, inlineRuns, splitAlpha, trimFor, type Block, type BookLook, type Doc } from '@lore-forge/core';
import { chapterParts } from './index.ts';

const MUTED = '6B6B6B';
const tw = (pt: number) => Math.round(pt * 20);
/** Word has no DejaVu: the PDF's DejaVu Serif and Sans become Georgia and Verdana; other families keep their name. */
const wordFont = (family: string): string => (family === 'DejaVu Serif' ? 'Georgia' : family === 'DejaVu Sans' ? 'Verdana' : family);
const hex = (c: string): string => splitAlpha(c)[0].replace('#', '').toUpperCase();

/** The book's look in Word units. */
interface Style {
  look: BookLook;
  font: string;
  headFont: string;
  /** Body size in half-points. */
  body: number;
  /** Line spacing, "auto" rule, in 240ths of a line: 300 for the default 1.45. */
  line: number;
  ink: string;
  accent: string;
}
function styleOf(look: BookLook): Style {
  return { look, font: wordFont(look.bodyFont), headFont: wordFont(look.chapterFont), body: Math.round(look.bodySize * 2), line: Math.round((300 * look.lineSpacing) / 1.45), ink: hex(look.bodyColor), accent: hex(look.chapterColor) };
}
let K: Style = styleOf(DEFAULT_LOOK);
/** Space above a chapter opener's label, in points, as in the PDF. */
const OPENER_SINK = 18;

type Section = { kind: 'cover' | 'front' | 'toc' | 'chapter'; role?: string; title?: string; children: Paragraph[] };

function runs(text: string, extra: { size?: number; color?: string; italics?: boolean } = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  text.split('\n').forEach((line, i) => {
    if (i > 0) out.push(new TextRun({ text: '', break: 1 }));
    for (const r of inlineRuns(line)) out.push(new TextRun({ text: r.text, bold: r.bold, italics: r.italic || extra.italics, size: extra.size, color: extra.color }));
  });
  return out;
}

function frontPage(b: Extract<Block, { kind: 'front' }>, pageH: number): Paragraph[] {
  const centered = (text: string, o: { size: number; before?: number; bold?: boolean; italics?: boolean; color?: string; after?: number }) =>
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: o.before ?? 0, after: o.after ?? 120 }, children: [new TextRun({ text, size: o.size, bold: o.bold, italics: o.italics, color: o.color, font: o.bold ? K.headFont : K.font })] });
  const [first = '', ...rest] = b.lines.filter((l) => l !== '');
  switch (b.role) {
    case 'title': {
      // Title, subtitle, author, publisher (empty when unset), sized as on the PDF title page.
      const [title = '', subtitle = '', author = '', publisher = ''] = b.lines;
      return [
        centered(title, { size: Math.round(Math.max(26, K.look.chapterSize * 1.35) * 2), bold: true, before: tw(pageH * 0.2), color: K.accent, after: 240 }),
        ...(subtitle ? [centered(subtitle, { size: 26, italics: true, after: tw(pageH * 0.18) })] : []),
        ...(author ? [centered(author, { size: Math.round(26 * K.look.authorScale) })] : []),
        ...(publisher ? [centered(publisher, { size: 20, color: MUTED, before: tw(pageH * 0.25) })] : []),
      ];
    }
    case 'copyright':
      return b.lines.map((l, i) => new Paragraph({ spacing: { before: i === 0 ? tw(pageH * 0.55) : 0, after: 120 }, children: [new TextRun({ text: l, size: 16, color: MUTED })] }));
    case 'dedication':
      return b.lines.map((l, i) => centered(l, { size: 23, italics: true, before: i === 0 ? tw(pageH * 0.3) : 0 }));
    case 'epigraph':
      return [
        centered(first, { size: 22, italics: true, before: tw(pageH * 0.3) }),
        ...rest.map((l) => new Paragraph({ alignment: AlignmentType.RIGHT, indent: { right: 720 }, children: [new TextRun({ text: l, size: 19 })] })),
      ];
  }
}

function image(b: Extract<Block, { kind: 'image' }>, worldDir: string, maxW: number, maxH: number): Paragraph[] {
  const path = join(worldDir, b.file);
  const ext = extname(b.file).toLowerCase();
  const note = (t: string) => [new Paragraph({ children: [new TextRun({ text: t, italics: true, color: MUTED, size: 19 })] })];
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return note(`[Image not embedded: ${b.file}. Export embeds PNG and JPEG only.]`);
  if (!existsSync(path)) return note(`[Image file missing: ${b.file}]`);
  const data = readFileSync(path);
  const size = imageSize(data, ext);
  if (!size) return note(`[Image could not be read: ${b.file}]`);
  const s = Math.min(maxW / size.w, maxH / size.h);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 }, children: [new ImageRun({ type: ext === '.png' ? 'png' : 'jpg', data, transformation: { width: Math.round(size.w * s), height: Math.round(size.h * s) }, altText: { name: b.caption, description: b.caption, title: b.caption } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: b.caption, italics: true, size: 18, color: MUTED })] }),
  ];
}

/** Pixel size from the PNG IHDR or the JPEG SOF marker. */
export function imageSize(data: Buffer, ext: string): { w: number; h: number } | undefined {
  if (ext === '.png') return data.length > 24 ? { w: data.readUInt32BE(16), h: data.readUInt32BE(20) } : undefined;
  for (let i = 2; i + 9 < data.length; ) {
    if (data[i] !== 0xff) return undefined;
    const marker = data[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: data.readUInt16BE(i + 7), h: data.readUInt16BE(i + 5) };
    i += 2 + data.readUInt16BE(i + 2);
  }
  return undefined;
}

function sections(doc: Doc, worldDir: string, pageH: number, textW: number): Section[] {
  const out: Section[] = [];
  const cur = () => out[out.length - 1]!;
  let afterPara = false;
  for (const b of doc.blocks) {
    const sec = out.length ? cur() : undefined;
    if (b.kind === 'front') {
      out.push({ kind: 'front', role: b.role, children: frontPage(b, pageH) });
      continue;
    }
    if (b.kind === 'toc') {
      out.push({ kind: 'toc', children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: tw(pageH * 0.12), after: 360 }, children: [new TextRun({ text: 'Contents', size: Math.round(K.look.chapterSize * 2), color: K.accent, font: K.headFont })] }), new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }) as unknown as Paragraph] });
      continue;
    }
    if (b.kind === 'heading' && (b.opener || (b.level === 1 && b.newPage))) {
      const [label, title] = chapterParts(b.text);
      out.push({
        kind: 'chapter',
        title,
        children: [
          // The chapter's date at the top right of the opening page, as in the PDF.
          ...(b.stamp ? [new Paragraph({ alignment: AlignmentType.RIGHT, keepNext: true, spacing: { before: 0, after: 0 }, children: [new TextRun({ text: b.stamp, size: 17, italics: true, color: MUTED })] })] : []),
          ...(label ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: tw(b.stamp ? OPENER_SINK - 8 : OPENER_SINK), after: 120 }, keepNext: true, children: [new TextRun({ text: label.toUpperCase(), size: 19, characterSpacing: 40, color: MUTED })] })] : []),
          new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: label ? 0 : tw(OPENER_SINK), after: 600 }, children: [new TextRun({ text: title })] }),
        ],
      });
      afterPara = false;
      continue;
    }
    const target = sec && sec.kind === 'chapter' ? sec : (out.push({ kind: 'chapter', title: doc.title, children: [] }), cur());
    const push = (...p: Paragraph[]) => target.children.push(...p);
    switch (b.kind) {
      case 'heading':
        push(new Paragraph({ heading: b.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, keepNext: true, keepLines: true, children: [new TextRun({ text: b.text })] }));
        afterPara = false;
        break;
      case 'para': {
        if (b.style === 'muted') {
          push(new Paragraph({ keepNext: true, spacing: { after: 120 }, children: runs(b.text, { size: 18, color: MUTED, italics: true }) }));
          afterPara = false;
          break;
        }
        const letter = b.dropCap && K.look.dropCap !== 'none' ? /^\p{L}/u.exec(b.text)?.[0] : undefined;
        if (letter && K.look.dropCap === 'dropped') {
          // Word's own drop cap, two lines deep: its top level with the first line's capitals, as in the PDF.
          const lineTw = (K.line / 240) * K.look.bodySize * 1.164 * 20;
          const capPt = (lineTw / 20 + 0.72 * K.look.bodySize) / 0.72;
          push(new Paragraph({ frame: { type: 'absolute', position: { x: 0, y: 0 }, width: 0, height: 0, anchor: { horizontal: FrameAnchorType.TEXT, vertical: FrameAnchorType.TEXT }, wrap: FrameWrap.AROUND, dropCap: DropCapType.DROP, lines: 2 } as never, spacing: { line: Math.round(lineTw * 2), lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: letter, size: Math.round(capPt * 2), color: K.accent, bold: true })] }));
          push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, widowControl: true, children: runs(b.text.slice(letter.length)) }));
          afterPara = true;
          break;
        }
        if (letter) {
          // Raised: a big first letter on the first line's baseline; only that line grows.
          push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, widowControl: true, children: [new TextRun({ text: letter, size: Math.round(K.look.bodySize * 2.6 * 2), color: K.accent, bold: true }), ...runs(b.text.slice(letter.length))] }));
          afterPara = true;
          break;
        }
        push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, widowControl: true, indent: afterPara ? { firstLine: tw(K.look.bodySize * 1.4) } : undefined, children: runs(b.text) }));
        afterPara = true;
        break;
      }
      case 'image':
        push(...image(b, worldDir, textW, pageH * 0.42));
        afterPara = false;
        break;
      case 'list':
        push(...b.items.map((t) => new Paragraph({ indent: { left: 360, hanging: 240 }, children: [new TextRun({ text: '• ' }), ...runs(t)] })));
        afterPara = false;
        break;
      case 'facts':
        push(...b.rows.map(([l, v]) => new Paragraph({ children: [new TextRun({ text: `${l}: `, bold: true }), ...runs(v)] })));
        afterPara = false;
        break;
      case 'prompt':
        push(new Paragraph({ children: [new TextRun({ text: b.label, bold: true })] }), new Paragraph({ children: [new TextRun({ text: b.text, font: 'Courier New', size: 17 })] }));
        afterPara = false;
        break;
      case 'box':
        push(new Paragraph({ keepNext: true, children: [new TextRun({ text: b.title, bold: true })] }));
        for (const inner of b.blocks) if (inner.kind === 'para') push(new Paragraph({ children: runs(inner.text) }));
        afterPara = false;
        break;
    }
  }
  return out;
}

export interface DocxOptions {
  /**
   * The front cover as a picture (PNG), drawn by the app exactly as in the preview and the PDF; it fills the first
   * page. Without it the first page gets the cover picture (when the world has one) with the title, subtitle and author.
   */
  cover?: Uint8Array;
}

const px = (pt: number) => Math.round((pt * 96) / 72);
/** A picture that fills the page, behind any text. */
function fullPage(data: Uint8Array, type: 'png' | 'jpg', w: number, h: number, name: string): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    children: [new ImageRun({
      type,
      data,
      transformation: { width: px(w), height: px(h) },
      floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 }, behindDocument: true, allowOverlap: true, lockAnchor: true, wrap: { type: TextWrappingType.NONE } },
      altText: { name, description: name, title: name },
    })],
  });
}

/** The cover page: the app's cover picture, else the world's picture with the cover text over it. */
function coverPage(doc: Doc, worldDir: string, w: number, h: number, png: Uint8Array | undefined): Paragraph[] {
  const c = doc.cover;
  if (png) return [fullPage(png, 'png', w, h, `Cover: ${c.title}`)];
  const out: Paragraph[] = [];
  const art = c.art;
  const file = art?.image && join(worldDir, art.image);
  const ext = file ? extname(file).toLowerCase() : '';
  if (file && ['.png', '.jpg', '.jpeg'].includes(ext) && existsSync(file)) {
    const data = readFileSync(file);
    const size = imageSize(data, ext);
    if (size) {
      // Cover the page like the PDF does (centre crop is Word's to do: scale to fill, overflow is clipped by the page).
      const s = Math.max(w / size.w, h / size.h);
      out.push(fullPage(data, ext === '.png' ? 'png' : 'jpg', size.w * s, size.h * s, `Cover: ${c.title}`));
    }
  }
  const color = K.look.coverTitleColor ? hex(K.look.coverTitleColor) : art ? hex(art.titleColor) : K.accent;
  const text = (t: string, size: number, o: { before?: number; italics?: boolean; bold?: boolean; color?: string } = {}) =>
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: o.before ?? 0, after: 160 }, children: [new TextRun({ text: t, size, bold: o.bold, italics: o.italics, color: o.color ?? color, font: K.headFont })] });
  const k = w / 240;
  out.push(text(art?.titleStyle === 'display' ? c.title.toUpperCase() : c.title, Math.round(Math.min(30, 13 * k) * K.look.coverTitleScale * 2), { before: tw(h * 0.45), bold: true }));
  out.push(text(c.subtitle, Math.round(Math.min(16, 7 * k) * 2), { italics: true }));
  for (const l of c.lines) out.push(text(l.replace(/\*\*/g, ''), Math.round(Math.min(13, 5.6 * k) * K.look.authorScale * 2)));
  return out;
}

/** Render a Story Book Doc to .docx bytes. Uses the doc's print trim (default 6x9) and look. */
export async function renderDocx(doc: Doc, worldDir: string, options: DocxOptions = {}): Promise<Buffer> {
  K = styleOf(doc.print?.look ?? DEFAULT_LOOK);
  const trim = trimFor(doc.print?.trim ?? DEFAULT_TRIM, K.look.margins);
  const textW = trim.width - trim.inside - trim.outside;
  const page = {
    size: { width: tw(trim.width), height: tw(trim.height) },
    margin: { top: tw(trim.top), bottom: tw(trim.bottom), left: tw(trim.outside), right: tw(trim.outside), gutter: tw(trim.inside - trim.outside), header: tw(trim.top * 0.5), footer: tw(trim.bottom * 0.45) },
  };
  const empty = { default: new Header({ children: [] }), first: new Header({ children: [] }), even: new Header({ children: [] }) };
  const emptyFoot = { default: new Footer({ children: [] }), first: new Footer({ children: [] }), even: new Footer({ children: [] }) };
  const head = (text: string) => new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: text.toUpperCase(), size: 15, characterSpacing: 30, color: MUTED })] })] });
  const folio = () => new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] });
  // Every section starts a new page; only a book for a printer starts them on right-hand (odd) pages.
  const opens = doc.print?.rightHand ? SectionType.ODD_PAGE : SectionType.NEXT_PAGE;
  let firstChapter = true;
  const parts: Section[] = [{ kind: 'cover', children: coverPage(doc, worldDir, trim.width, trim.height, options.cover) }, ...sections(doc, worldDir, trim.height, textW)];
  const secs: ISectionOptions[] = parts.map((s, i) => {
    // The cover is the first page; the copyright page sits on the back of the title page, not on the next right-hand page.
    const type = i === 0 ? undefined : s.role === 'copyright' ? SectionType.NEXT_PAGE : opens;
    if (s.kind !== 'chapter') return { properties: { ...(type ? { type } : {}), page }, headers: empty, footers: emptyFoot, children: s.children };
    const start = firstChapter;
    firstChapter = false;
    return {
      properties: { type: opens, titlePage: true, page: { ...page, ...(start ? { pageNumbers: { start: 1 } } : {}) } },
      headers: { default: head(s.title ?? doc.title), even: head(doc.title), first: new Header({ children: [] }) },
      footers: { default: folio(), even: folio(), first: new Footer({ children: [] }) },
      children: s.children,
    };
  });
  const file = new Document({
    title: doc.title,
    creator: 'Lore-Forge',
    evenAndOddHeaderAndFooters: true,
    features: { updateFields: true },
    hyphenation: { autoHyphenation: true },
    styles: {
      default: {
        document: { run: { font: K.font, size: K.body, color: K.ink }, paragraph: { spacing: { line: K.line, lineRule: LineRuleType.AUTO, after: 0 } } },
        heading1: { run: { font: K.headFont, size: Math.round(K.look.chapterSize * 2), color: K.accent }, paragraph: { spacing: { after: 600 } } },
        heading2: { run: { font: K.headFont, size: Math.round(Math.max(K.look.bodySize + 1.5, (K.look.chapterSize * 13) / 19) * 2), bold: true, color: K.accent }, paragraph: { spacing: { before: 360, after: 120 } } },
        heading3: { run: { font: K.font, size: K.body + 1, bold: true }, paragraph: { spacing: { before: 240, after: 80 } } },
      },
    },
    sections: secs,
  });
  return finishDocx(await Packer.toBuffer(file));
}

/**
 * Two things the docx package cannot write: <w:mirrorMargins/> in word/settings.xml, and a drop-cap frame
 * without fixed position or size (Word sizes and places a drop cap itself).
 */
export function finishDocx(buf: Buffer): Buffer {
  const files = unzipSync(new Uint8Array(buf));
  files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml']!).replace(/<w:framePr w:dropCap="drop"[^>]*\/>/g, '<w:framePr w:dropCap="drop" w:lines="2" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/>'));
  const xml = strFromU8(files['word/settings.xml']!);
  if (!xml.includes('<w:mirrorMargins')) files['word/settings.xml'] = strToU8(xml.replace(/(<w:settings[^>]*>)((?:<w:(?:writeProtection|view|zoom|removePersonalInformation|removeDateAndTime|doNotDisplayPageBoundaries|displayBackgroundShape)\b[^>]*\/>)*)/, '$1$2<w:mirrorMargins/>'));
  return Buffer.from(zipSync(files));
}

export async function writeDocx(doc: Doc, worldDir: string, path: string, options: DocxOptions = {}): Promise<{ docx: string }> {
  await writeFile(path, await renderDocx(doc, worldDir, options));
  return { docx: path };
}
