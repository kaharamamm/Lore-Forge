import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import PDFDocument from 'pdfkit';
import { inlineRuns, toMarkdown, type Block, type Doc } from '@lore-forge/core';

type Pdf = PDFKit.PDFDocument;
type Heading = Extract<Block, { kind: 'heading' }>;

export interface PdfOptions {
  /** World folder; image paths in the Doc are relative to it. */
  worldDir: string;
  /** Folder with the DejaVu .ttf files. Defaults to the dejavu-fonts-ttf package. */
  fontDir?: string;
}

export interface PdfResult {
  pdf: Buffer;
  pages: number;
}

const FONT_FILES = {
  sans: 'DejaVuSans.ttf',
  'sans-b': 'DejaVuSans-Bold.ttf',
  'sans-i': 'DejaVuSans-Oblique.ttf',
  serif: 'DejaVuSerif.ttf',
  'serif-b': 'DejaVuSerif-Bold.ttf',
  'serif-i': 'DejaVuSerif-Italic.ttf',
  mono: 'DejaVuSansMono.ttf',
} as const;

/** The bundled DejaVu fonts cover Latin Extended (ş ğ İ ı), Greek and Cyrillic. */
export function defaultFontDir(): string {
  const req = typeof require === 'function' ? require : createRequire(import.meta.url);
  return dirname(req.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf'));
}

interface Theme {
  family: 'sans' | 'serif';
  size: number;
  gap: number;
  margin: number;
  accent: string;
  heading: Record<1 | 2 | 3, number>;
  justify: boolean;
}

const THEMES: Record<Doc['kind'], Theme> = {
  bible: { family: 'sans', size: 9.5, gap: 1.5, margin: 56, accent: '#1f4e79', heading: { 1: 20, 2: 14, 3: 10.5 }, justify: false },
  book: { family: 'serif', size: 11, gap: 3.5, margin: 72, accent: '#5a3d1e', heading: { 1: 22, 2: 15, 3: 12 }, justify: true },
};
const INK = '#222222';
const MUTED = '#6b6b6b';

/** Moved to core so the in-app preview shares it; re-exported for existing callers. */
export { inlineRuns };

const keyOf = (h: Heading, i: number): string => h.anchor ?? `h-${i}`;

/** One layout pass. Pass 1 learns the page of every TOC heading; pass 2 prints those numbers. */
class Layout {
  readonly pdf: Pdf;
  readonly pageOf = new Map<string, number>();
  private pages = 0;
  private outlineTop: PDFKit.PDFOutline | undefined;
  private readonly t: Theme;
  private readonly width: number;
  private readonly tocEntries: { key: string; h: Heading }[];

  private readonly doc: Doc;
  private readonly opts: PdfOptions & { fontDir: string };
  private readonly numbers: Map<string, number> | undefined;

  constructor(doc: Doc, opts: PdfOptions & { fontDir: string }, numbers: Map<string, number> | undefined) {
    this.doc = doc;
    this.opts = opts;
    this.numbers = numbers;
    this.t = THEMES[doc.kind];
    this.pdf = new PDFDocument({
      size: 'A4',
      margin: this.t.margin,
      autoFirstPage: false,
      bufferPages: true,
      info: { Title: doc.title, Creator: 'Lore-Forge', Producer: 'Lore-Forge (pdfkit)' },
      lang: 'en',
      displayTitle: true,
    } as PDFKit.PDFDocumentOptions);
    for (const [name, file] of Object.entries(FONT_FILES)) this.pdf.registerFont(name, join(opts.fontDir, file));
    this.pdf.on('pageAdded', () => this.pages++);
    this.width = 595.28 - 2 * this.t.margin;
    this.tocEntries = doc.blocks.flatMap((b, i) => (b.kind === 'heading' && b.toc ? [{ key: keyOf(b, i), h: b }] : []));
  }

  private font(style: 'r' | 'b' | 'i' | 'mono', family: 'sans' | 'serif' = this.t.family): Pdf {
    return this.pdf.font(style === 'mono' ? 'mono' : style === 'r' ? family : `${family}-${style}`);
  }
  private get left(): number { return this.t.margin; }
  private get bottom(): number { return this.pdf.page.height - this.t.margin; }
  private atTop(): boolean { return this.pdf.y <= this.t.margin + 1; }
  private room(h: number): void {
    if (this.pdf.y + h > this.bottom && !this.atTop()) this.pdf.addPage();
  }
  private space(pt: number): void {
    if (!this.atTop()) this.pdf.y += pt;
  }

  /** Writes text with inline bold/italic, keeping line breaks (verse). */
  private runs(text: string, o: { x?: number; y?: number; width?: number; size?: number; color?: string; italic?: boolean; align?: 'left' | 'center' | 'justify' } = {}): void {
    const x = o.x ?? this.left;
    const width = o.width ?? this.width;
    const size = o.size ?? this.t.size;
    this.pdf.fontSize(size).fillColor(o.color ?? INK);
    let first = true;
    for (const line of text.split('\n')) {
      const runs = inlineRuns(line);
      if (!runs.length) runs.push({ text: ' ', bold: false, italic: false });
      runs.forEach((r, i) => {
        this.font(r.bold ? 'b' : r.italic || o.italic ? 'i' : 'r');
        const opts = { width, continued: i < runs.length - 1, lineGap: this.t.gap, align: o.align ?? 'left' };
        if (i === 0) this.pdf.text(r.text, x, first && o.y !== undefined ? o.y : this.pdf.y, opts);
        else this.pdf.text(r.text, opts);
      });
      first = false;
    }
    this.pdf.x = this.left;
  }

  private heading(b: Heading, key: string): void {
    const size = this.t.heading[b.level];
    if (b.newPage && !this.atTop()) this.pdf.addPage();
    else this.room(size * 2 + 50);
    if (b.level === 1 && this.doc.kind === 'book') this.pdf.y += 90;
    else this.space(b.level === 3 ? 6 : 10);
    if (b.toc) {
      this.pageOf.set(key, this.pages);
      if (this.numbers) {
        const item = b.level === 1 || !this.outlineTop ? this.pdf.outline.addItem(b.text) : this.outlineTop.addItem(b.text);
        if (b.level === 1) this.outlineTop = item;
      }
    }
    this.font('b').fontSize(size).fillColor(b.level === 3 ? INK : this.t.accent);
    this.pdf.text(b.text, this.left, this.pdf.y, { width: this.width, lineGap: 2, ...(b.toc ? { destination: key } : {}) });
    if (b.level === 1) {
      const y = this.pdf.y + 3;
      this.pdf.moveTo(this.left, y).lineTo(this.left + this.width, y).lineWidth(0.8).strokeColor(this.t.accent).stroke();
      this.pdf.y = y + 10;
    } else this.pdf.y += 3;
    this.pdf.x = this.left;
  }

  private toc(): void {
    this.pdf.addPage();
    this.font('b').fontSize(this.t.heading[1]).fillColor(this.t.accent).text('Contents', this.left, this.pdf.y, { width: this.width });
    this.pdf.y += 12;
    for (const { key, h } of this.tocEntries) {
      const indent = (h.level - 1) * 16;
      const size = h.level === 1 ? this.t.size + 1 : this.t.size;
      this.room(size * 2);
      if (h.level === 1) this.pdf.y += 4;
      const y = this.pdf.y;
      const n = this.numbers?.get(key);
      this.font(h.level === 1 ? 'b' : 'r').fontSize(size).fillColor(INK);
      this.pdf.text(h.text, this.left + indent, y, { width: this.width - indent - 44, lineGap: 1.5, ...(this.numbers ? { goTo: key } : {}) });
      const after = this.pdf.y;
      this.pdf.text(n === undefined ? '' : String(n), this.left + this.width - 40, y, { width: 40, align: 'right', lineBreak: false });
      this.pdf.y = after;
    }
    this.pdf.x = this.left;
  }

  private facts(rows: [string, string][]): void {
    const labelW = this.doc.kind === 'bible' ? 118 : 100;
    const valueW = this.width - labelW - 8;
    for (const [k, v] of rows) {
      this.font('r').fontSize(this.t.size);
      this.room(Math.min(this.pdf.heightOfString(v, { width: valueW, lineGap: this.t.gap }), 120) + 2);
      const y = this.pdf.y;
      const page = this.pages;
      this.font('b').fontSize(this.t.size - 0.5).fillColor(MUTED).text(k, this.left, y, { width: labelW, lineGap: this.t.gap });
      const labelEnd = this.pdf.y;
      this.runs(v, { x: this.left + labelW + 8, y, width: valueW });
      this.pdf.y = (this.pages === page ? Math.max(labelEnd, this.pdf.y) : this.pdf.y) + 2;
    }
    this.pdf.y += 4;
  }

  private list(items: string[]): void {
    for (const item of items) {
      this.room(this.t.size * 2);
      const y = this.pdf.y;
      this.font('r').fontSize(this.t.size).fillColor(this.t.accent).text('•', this.left + 2, y, { width: 10, lineBreak: false });
      this.runs(item, { x: this.left + 14, y, width: this.width - 14 });
      this.pdf.y += 2;
    }
    this.pdf.y += 4;
  }

  private note(text: string): void {
    this.room(this.t.size * 2);
    this.runs(text, { size: this.t.size - 1, color: MUTED, italic: true });
    this.pdf.y += 6;
  }

  private image(b: Extract<Block, { kind: 'image' }>): void {
    const path = join(this.opts.worldDir, b.file);
    const ext = extname(b.file).toLowerCase();
    type Img = { width: number; height: number };
    let img: Img | undefined;
    if (!['.png', '.jpg', '.jpeg'].includes(ext)) this.note(`[Image not embedded: ${b.file}. PDF export embeds PNG and JPEG only.]`);
    else if (!existsSync(path)) this.note(`[Image file missing: ${b.file}]`);
    else {
      try {
        img = (this.pdf as unknown as { openImage(src: Buffer): Img }).openImage(readFileSync(path));
      } catch (e) {
        this.note(`[Image could not be read: ${b.file} (${(e as Error).message})]`);
      }
    }
    if (img) {
      const maxW = this.width * (this.doc.kind === 'book' ? 0.9 : 0.55);
      const maxH = this.doc.kind === 'book' ? 300 : 220;
      const s = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * s;
      const h = img.height * s;
      this.room(h + 40);
      this.space(4);
      this.pdf.image(img as unknown as Buffer, this.left + (this.width - w) / 2, this.pdf.y, { width: w, height: h });
      this.pdf.y += h + 4;
    }
    this.runs(b.caption, { size: this.t.size - 1, italic: true, align: 'center', color: INK });
    for (const d of b.details) this.runs(d, { size: this.t.size - 1.5, color: MUTED, align: 'center' });
    this.pdf.y += 8;
  }

  private prompt(b: Extract<Block, { kind: 'prompt' }>): void {
    const size = this.t.size - 1;
    this.room(60);
    this.font('b').fontSize(size).fillColor(INK).text(b.label, this.left, this.pdf.y, { width: this.width });
    this.pdf.y += 2;
    this.font('mono').fontSize(size - 0.5);
    const h = this.pdf.heightOfString(b.text, { width: this.width - 16, lineGap: 1.5 });
    this.room(h + 12);
    const y = this.pdf.y;
    if (y + h + 12 <= this.bottom) this.pdf.rect(this.left, y, this.width, h + 12).fill('#f2f3f5');
    this.font('mono').fontSize(size - 0.5).fillColor(INK).text(b.text, this.left + 8, y + 6, { width: this.width - 16, lineGap: 1.5 });
    this.pdf.x = this.left;
    this.pdf.y += 12;
  }

  private box(b: Extract<Block, { kind: 'box' }>): void {
    this.room(110);
    this.space(8);
    const y = this.pdf.y;
    this.pdf.moveTo(this.left, y).lineTo(this.left + this.width, y).lineWidth(1.5).strokeColor(this.t.accent).stroke();
    this.pdf.y = y + 6;
    this.font('b').fontSize(this.t.size + 1.5).fillColor(this.t.accent).text(b.title, this.left, this.pdf.y, { width: this.width });
    this.pdf.y += 4;
    b.blocks.forEach((inner, i) => this.block(inner, i));
    this.pdf.y += 6;
  }

  private block(b: Block, i: number): void {
    switch (b.kind) {
      case 'toc': return this.toc();
      case 'heading': return this.heading(b, keyOf(b, i));
      case 'para':
        this.room(this.t.size * 3);
        if (b.style === 'muted') return this.note(b.text);
        this.runs(b.text, { ...(b.style === 'lead' ? { italic: true, size: this.t.size + 0.5 } : {}), align: this.t.justify ? 'justify' : 'left' });
        this.pdf.y += this.doc.kind === 'book' ? 7 : 5;
        return;
      case 'facts': return this.facts(b.rows);
      case 'list': return this.list(b.items);
      case 'image': return this.image(b);
      case 'prompt': return this.prompt(b);
      case 'box': return this.box(b);
    }
  }

  private cover(): void {
    const c = this.doc.cover;
    this.pdf.addPage();
    this.pdf.y = this.pdf.page.height * 0.3;
    this.font('b').fontSize(30).fillColor(this.t.accent).text(c.title, this.left, this.pdf.y, { width: this.width, align: 'center' });
    this.pdf.y += 8;
    this.font('r').fontSize(16).fillColor(INK).text(c.subtitle, { width: this.width, align: 'center' });
    this.pdf.y += 40;
    for (const l of c.lines) {
      this.runs(l, { size: this.t.size + 0.5, color: MUTED, align: 'center' });
      this.pdf.y += 6;
    }
  }

  private footers(): void {
    const range = this.pdf.bufferedPageRange();
    for (let i = range.start + 1; i < range.start + range.count; i++) {
      this.pdf.switchToPage(i);
      const margins = this.pdf.page.margins;
      const bottom = margins.bottom;
      margins.bottom = 0;
      const y = this.pdf.page.height - this.t.margin / 2 - 6;
      this.font('r').fontSize(8).fillColor(MUTED);
      if (this.doc.kind === 'book') this.pdf.text(String(i + 1), this.left, y, { width: this.width, align: 'center', lineBreak: false });
      else {
        this.pdf.text(this.doc.title, this.left, y, { width: this.width - 60, lineBreak: false });
        this.pdf.text(`page ${i + 1}`, this.left + this.width - 60, y, { width: 60, align: 'right', lineBreak: false });
      }
      margins.bottom = bottom;
    }
  }

  run(): number {
    this.cover();
    this.doc.blocks.forEach((b, i) => this.block(b, i));
    this.footers();
    return this.pages;
  }
}

function finish(pdf: Pdf): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => ok(Buffer.concat(chunks)));
    pdf.on('error', fail);
    pdf.end();
  });
}

/** Renders a World Bible or Story Book Doc to PDF bytes. */
export async function renderPdf(doc: Doc, options: PdfOptions): Promise<PdfResult> {
  const opts = { ...options, fontDir: options.fontDir ?? defaultFontDir() };
  const first = new Layout(doc, opts, undefined);
  first.run();
  await finish(first.pdf);
  const second = new Layout(doc, opts, first.pageOf);
  const pages = second.run();
  return { pdf: await finish(second.pdf), pages };
}

/** Markdown sidecar path for a PDF path: book.pdf -> book.md. */
export function sidecarPath(pdfPath: string): string {
  return pdfPath.replace(/\.pdf$/i, '') + '.md';
}

/** Writes the PDF and its Markdown sidecar (image links relative to the sidecar). */
export async function writePublication(doc: Doc, worldDir: string, pdfPath: string, fontDir?: string): Promise<{ pdf: string; md: string; pages: number }> {
  const out = resolve(pdfPath);
  const md = sidecarPath(out);
  const { pdf, pages } = await renderPdf(doc, { worldDir, ...(fontDir ? { fontDir } : {}) });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, pdf);
  const href = (file: string) => relative(dirname(md), join(resolve(worldDir), file)).split(sep).join('/');
  await writeFile(md, toMarkdown(doc, href));
  return { pdf: out, md, pages };
}
