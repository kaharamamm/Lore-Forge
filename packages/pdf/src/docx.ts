/**
 * Word (.docx) export of a print Story Book. Same structure as the print PDF: half-title, title page,
 * copyright page, optional dedication and epigraph, contents, then each chapter on a right-hand page with a
 * drop cap, running heads (book title left, chapter right), page numbers from the first chapter (none on
 * openers), mirrored margins with a gutter, widow/orphan control and automatic hyphenation.
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
  ImageRun,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  SectionType,
  TableOfContents,
  TextRun,
  type ISectionOptions,
  type ParagraphChild,
} from 'docx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { DEFAULT_TRIM, inlineRuns, TRIMS, type Block, type Doc } from '@lore-forge/core';
import { chapterParts } from './index.ts';

const FONT = 'Georgia';
const BODY = 21; // half-points: 10.5pt, as in the PDF
const LINE = 300; // twips: 15pt leading
const MUTED = '6B6B6B';
const ACCENT = '3D2A14';
const tw = (pt: number) => Math.round(pt * 20);

type Section = { kind: 'front' | 'toc' | 'chapter'; title?: string; children: Paragraph[] };

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
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: o.before ?? 0, after: o.after ?? 120 }, children: [new TextRun({ text, size: o.size, bold: o.bold, italics: o.italics, color: o.color, font: FONT })] });
  const [first = '', ...rest] = b.lines.filter((l) => l !== '');
  switch (b.role) {
    case 'half-title':
      return [centered(first, { size: 32, before: tw(pageH * 0.28), color: ACCENT })];
    case 'title': {
      const [subtitle, ...tail] = rest;
      return [
        centered(first, { size: 52, bold: true, before: tw(pageH * 0.2), color: ACCENT, after: 240 }),
        ...(subtitle ? [centered(subtitle, { size: 24, italics: true, after: tw(pageH * 0.18) })] : []),
        ...tail.map((l) => centered(l, { size: 24 })),
      ];
    }
    case 'copyright':
      return b.lines.map((l, i) => new Paragraph({ spacing: { before: i === 0 ? tw(pageH * 0.55) : 0, after: 120 }, children: [new TextRun({ text: l, size: 16, color: MUTED })] }));
    case 'dedication':
      return b.lines.map((l, i) => centered(l, { size: BODY, italics: true, before: i === 0 ? tw(pageH * 0.3) : 0 }));
    case 'epigraph':
      return [
        centered(first, { size: BODY, italics: true, before: tw(pageH * 0.3) }),
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
      out.push({ kind: 'front', children: frontPage(b, pageH) });
      continue;
    }
    if (b.kind === 'toc') {
      out.push({ kind: 'toc', children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: tw(pageH * 0.12), after: 360 }, children: [new TextRun({ text: 'Contents', size: 38, color: ACCENT })] }), new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }) as unknown as Paragraph] });
      continue;
    }
    if (b.kind === 'heading' && (b.opener || (b.level === 1 && b.newPage))) {
      const [label, title] = chapterParts(b.text);
      out.push({
        kind: 'chapter',
        title,
        children: [
          ...(label ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: tw(pageH * 0.18), after: 120 }, keepNext: true, children: [new TextRun({ text: label.toUpperCase(), size: 19, characterSpacing: 40, color: MUTED })] })] : []),
          new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: label ? 0 : tw(pageH * 0.18) + 400, after: 600 }, children: [new TextRun({ text: title })] }),
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
        if (b.dropCap) {
          const letter = /^\p{L}/u.exec(b.text)?.[0];
          if (letter) {
            push(new Paragraph({ frame: { type: 'absolute', position: { x: 0, y: 0 }, width: 0, height: 0, anchor: { horizontal: FrameAnchorType.TEXT, vertical: FrameAnchorType.TEXT }, wrap: FrameWrap.AROUND, dropCap: DropCapType.DROP, lines: 3 } as never, spacing: { line: LINE * 3 - 40, lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: letter, size: 86, color: ACCENT, bold: true })] }));
            push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, widowControl: true, children: runs(b.text.slice(letter.length)) }));
            afterPara = true;
            break;
          }
        }
        push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, widowControl: true, indent: afterPara ? { firstLine: 300 } : undefined, children: runs(b.text) }));
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

/** Render a Story Book Doc to .docx bytes. Uses the doc's print trim (default 6x9). */
export async function renderDocx(doc: Doc, worldDir: string): Promise<Buffer> {
  const trim = TRIMS[doc.print?.trim ?? DEFAULT_TRIM];
  const textW = trim.width - trim.inside - trim.outside;
  const page = {
    size: { width: tw(trim.width), height: tw(trim.height) },
    margin: { top: tw(trim.top), bottom: tw(trim.bottom), left: tw(trim.outside), right: tw(trim.outside), gutter: tw(trim.inside - trim.outside), header: tw(trim.top * 0.5), footer: tw(trim.bottom * 0.45) },
  };
  const empty = { default: new Header({ children: [] }), first: new Header({ children: [] }), even: new Header({ children: [] }) };
  const emptyFoot = { default: new Footer({ children: [] }), first: new Footer({ children: [] }), even: new Footer({ children: [] }) };
  const head = (text: string) => new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: text.toUpperCase(), size: 15, characterSpacing: 30, color: MUTED })] })] });
  const folio = () => new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] });
  let firstChapter = true;
  const secs: ISectionOptions[] = sections(doc, worldDir, trim.height, textW).map((s) => {
    if (s.kind !== 'chapter') return { properties: { type: SectionType.ODD_PAGE, page }, headers: empty, footers: emptyFoot, children: s.children };
    const start = firstChapter;
    firstChapter = false;
    return {
      properties: { type: SectionType.ODD_PAGE, titlePage: true, page: { ...page, ...(start ? { pageNumbers: { start: 1 } } : {}) } },
      headers: { default: head(s.title ?? doc.title), even: head(doc.title), first: new Header({ children: [] }) },
      footers: { default: folio(), even: folio(), first: new Footer({ children: [] }) },
      children: s.children,
    };
  });
  // The copyright page sits on the back of the title page, not on the next right-hand page.
  const blocks = doc.blocks.filter((b) => b.kind === 'front');
  blocks.forEach((b, i) => {
    if (b.kind === 'front' && b.role === 'copyright' && secs[i]) secs[i] = { ...secs[i]!, properties: { ...secs[i]!.properties, type: SectionType.NEXT_PAGE } };
  });
  const file = new Document({
    title: doc.title,
    creator: 'Lore-Forge',
    evenAndOddHeaderAndFooters: true,
    features: { updateFields: true },
    hyphenation: { autoHyphenation: true },
    styles: {
      default: {
        document: { run: { font: FONT, size: BODY }, paragraph: { spacing: { line: LINE, lineRule: LineRuleType.AUTO, after: 0 } } },
        heading1: { run: { font: FONT, size: 38, color: ACCENT }, paragraph: { spacing: { after: 600 } } },
        heading2: { run: { font: FONT, size: 26, bold: true, color: ACCENT }, paragraph: { spacing: { before: 360, after: 120 } } },
        heading3: { run: { font: FONT, size: 22, bold: true }, paragraph: { spacing: { before: 240, after: 80 } } },
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
  files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml']!).replace(/<w:framePr w:dropCap="drop"[^>]*\/>/g, '<w:framePr w:dropCap="drop" w:lines="3" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/>'));
  const xml = strFromU8(files['word/settings.xml']!);
  if (!xml.includes('<w:mirrorMargins')) files['word/settings.xml'] = strToU8(xml.replace(/(<w:settings[^>]*>)((?:<w:(?:writeProtection|view|zoom|removePersonalInformation|removeDateAndTime|doNotDisplayPageBoundaries|displayBackgroundShape)\b[^>]*\/>)*)/, '$1$2<w:mirrorMargins/>'));
  return Buffer.from(zipSync(files));
}

export async function writeDocx(doc: Doc, worldDir: string, path: string): Promise<{ docx: string }> {
  await writeFile(path, await renderDocx(doc, worldDir));
  return { docx: path };
}
