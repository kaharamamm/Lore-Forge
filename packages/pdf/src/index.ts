/// <reference path="./hyphen.d.ts" />
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import PDFDocument from 'pdfkit';
import en from 'hyphen/en-us/index.js';
import { bundledFontPath, coverFont } from './fonts.ts';
import { readPicture } from './gif.ts';
import { english, type Translate } from './words.ts';
import { bundledFont, COVER_EMBLEM, DEFAULT_LOOK, ICON_SIZE, ICONS, inlineRuns, placeOnCover, splitAlpha, toMarkdown, trimFor, type Block, type BookLook, type CoverArt, type Doc, type IconName, type MapMark, type Trim } from '@lore-forge/core';

type Pdf = PDFKit.PDFDocument;
type Heading = Extract<Block, { kind: 'heading' }>;

export interface PdfOptions {
  /** World folder; image paths in the Doc are relative to it. */
  worldDir: string;
  /** Folder with the DejaVu .ttf files. Defaults to the dejavu-fonts-ttf package. */
  fontDir?: string;
  /** Folder with the bundled cover title fonts (the desktop app's copy). Defaults to their packages. */
  coverFontDir?: string;
  /** The exporter's own words in the app's language (English without it). */
  t?: Translate;
}

export interface PdfResult {
  pdf: Buffer;
  pages: number;
  /** Things the reader should know, such as a cover font that could not be embedded. */
  notes: string[];
}

/** Story Book fonts other than DejaVu: font files for the body (upright and bold) and the chapter titles. */
interface BookFonts {
  body?: { r: string; b: string; italic: 'serif' | 'sans' };
  bodyFamily: 'serif' | 'sans';
  head?: string;
}
/** Layout options once the fonts are resolved. */
type LayoutOptions = PdfOptions & { fontDir: string; titleFont?: string; bookFonts?: BookFonts };

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

const THEMES: Record<Doc['kind'] | 'print', Theme> = {
  codex: { family: 'sans', size: 9.5, gap: 1.5, margin: 56, accent: '#1f4e79', heading: { 1: 20, 2: 14, 3: 10.5 }, justify: false },
  book: { family: 'serif', size: 11, gap: 3.5, margin: 72, accent: '#5a3d1e', heading: { 1: 22, 2: 15, 3: 12 }, justify: true },
  /** A trade-paperback interior: 10.5 pt serif on about 15 pt leading. */
  print: { family: 'serif', size: 10.5, gap: 3, margin: 54, accent: '#3d2a14', heading: { 1: 19, 2: 13, 3: 11 }, justify: true },
};

/** Soft hyphens at the break points of long words, so justified lines can hyphenate (English patterns). */
export function hyphenate(text: string): string {
  return en.hyphenateSync(text, { minWordLength: 7 });
}

/** What a printed page carries besides its text. */
type PageRole = 'front' | 'blank' | 'toc' | 'opener' | 'body';
/** "Chapter 3. The Well" -> ["Chapter 3", "The Well"]. */
export const chapterParts = (text: string): [string | undefined, string] => {
  // "Chapter 3. Title", or in Turkish "Bölüm 3. Title" (core's book heading, translated).
  const m = /^((?:Chapter|Bölüm) \d+)\.\s+(.*)$/.exec(text);
  return m ? [m[1], m[2]!] : [undefined, text];
};
const INK = '#222222';
/** Space above a chapter opener's label, in points below the top margin. */
const OPENER_SINK = 18;
const GOLD = '#e0bd6a';
const MUTED = '#6b6b6b';
/** A map's numbered places: a dark disc with a gold ring, readable on any picture. */
const PIN_FILL = '#22252d';
const PIN_RING = '#c9a24f';

/** Moved to core so the in-app preview shares it; re-exported for existing callers. */
export { inlineRuns };

const keyOf = (h: Heading, i: number): string => h.anchor ?? `h-${i}`;

/** One layout pass. Pass 1 learns the page of every TOC heading; pass 2 prints those numbers. */
class Layout {
  readonly pdf: Pdf;
  readonly pageOf = new Map<string, number>();
  private pages = 0;
  private outlineTop: PDFKit.PDFOutline | undefined;
  private t: Theme;
  /** Body text colour (the book's look, else near-black). */
  private readonly ink: string;
  private readonly look: BookLook | undefined;
  private readonly width: number;
  private readonly tocEntries: { key: string; h: Heading }[];

  private readonly doc: Doc;
  private readonly opts: LayoutOptions;
  /** The exporter's own words in the app's language. */
  private readonly say: Translate;
  private readonly numbers: Map<string, number> | undefined;
  /** Print books: trim size and mirrored margins, and what each page (1-based) carries. */
  private readonly trim: Trim | undefined;
  /** Print books for a printer: front pages and chapters open on right-hand pages, padded with blank pages. */
  private readonly rightHand: boolean;
  private readonly roles: PageRole[] = [];
  private readonly chapters: string[] = [];
  private flowRole: PageRole = 'body';
  private chapter = '';
  /** Page number of the first chapter opener: body pages are numbered from it. */
  bodyStart = 0;
  /** Previous block was a paragraph: book paragraphs after the first get a first-line indent instead of a gap. */
  private afterPara = false;

  constructor(doc: Doc, opts: LayoutOptions, numbers: Map<string, number> | undefined) {
    this.doc = doc;
    this.opts = opts;
    this.numbers = numbers;
    this.say = opts.t ?? english;
    this.look = doc.print ? doc.print.look ?? DEFAULT_LOOK : undefined;
    this.trim = doc.print ? trimFor(doc.print.trim, this.look?.margins) : undefined;
    this.rightHand = !!doc.print?.rightHand;
    this.t = THEMES[this.trim ? 'print' : doc.kind];
    this.ink = this.look?.bodyColor ?? INK;
    const tr = this.trim;
    this.pdf = new PDFDocument({
      size: tr ? [tr.width, tr.height] : 'A4',
      margins: tr ? { top: tr.top, bottom: tr.bottom, left: tr.inside, right: tr.outside } : { top: this.t.margin, bottom: this.t.margin, left: this.t.margin, right: this.t.margin },
      autoFirstPage: false,
      bufferPages: true,
      info: { Title: doc.title, Creator: 'Lore-Forge', Producer: 'Lore-Forge (pdfkit)' },
      lang: 'en',
      displayTitle: true,
    } as PDFKit.PDFDocumentOptions);
    for (const [name, file] of Object.entries(FONT_FILES)) this.pdf.registerFont(name, join(opts.fontDir, file));
    const bf = opts.bookFonts;
    if (bf?.body) { this.pdf.registerFont('book-r', bf.body.r); this.pdf.registerFont('book-b', bf.body.b); }
    if (bf?.head) this.pdf.registerFont('book-head', bf.head);
    if (this.look) {
      // The book's look: sizes, colours, family and a line gap that gives `lineSpacing` times the body size.
      const L = this.look;
      this.t = { ...this.t, family: bf?.bodyFamily ?? 'serif', size: L.bodySize, accent: L.chapterColor, heading: { 1: L.chapterSize, 2: Math.max(L.bodySize + 1.5, L.chapterSize * 13 / 19), 3: L.bodySize + 0.5 } };
      this.font('r').fontSize(L.bodySize);
      this.t.gap = Math.max(0, L.lineSpacing * L.bodySize - this.pdf.currentLineHeight(true));
    }
    this.pdf.on('pageAdded', () => {
      this.pages++;
      this.roles[this.pages] = this.flowRole;
      this.chapters[this.pages] = this.chapter;
      // Facing pages mirror the margins: everything on a left-hand (even) page shifts so the gutter is on its right.
      if (tr && this.pages % 2 === 0) this.pdf.translate(tr.outside - tr.inside, 0);
    });
    this.width = tr ? tr.width - tr.inside - tr.outside : 595.28 - 2 * this.t.margin;
    this.tocEntries = doc.blocks.flatMap((b, i) => (b.kind === 'heading' && b.toc ? [{ key: keyOf(b, i), h: b }] : []));
  }

  private font(style: 'r' | 'b' | 'i' | 'mono', family: 'sans' | 'serif' = this.t.family): Pdf {
    const body = this.opts.bookFonts?.body;
    // A bundled body font has no italic: italics use DejaVu of the same kind.
    if (body && family === this.t.family && style !== 'mono') return this.pdf.font(style === 'r' ? 'book-r' : style === 'b' ? 'book-b' : `${body.italic}-i`);
    return this.pdf.font(style === 'mono' ? 'mono' : style === 'r' ? family : `${family}-${style}`);
  }
  /** Chapter titles, the contents title and print headings: the book's title font when it has one, else bold body. */
  private headFont(): Pdf {
    return this.opts.bookFonts?.head ? this.pdf.font('book-head') : this.font('b');
  }
  private get left(): number { return this.trim ? this.trim.inside : this.t.margin; }
  private get top(): number { return this.trim ? this.trim.top : this.t.margin; }
  private get bottom(): number { return this.pdf.page.height - this.pdf.page.margins.bottom; }
  private atTop(): boolean { return this.pdf.y <= this.top + 1; }
  /**
   * Start a new page for a front page, the contents or a chapter opener. Only a book with right-hand chapters lands
   * it on `side` (right: odd pages, left: even pages) by adding a blank page first; otherwise nothing is padded, so
   * a book read on screen has no empty pages.
   */
  private startPage(role: PageRole, side: 'right' | 'left'): void {
    this.flowRole = 'blank';
    this.pdf.addPage();
    if (this.rightHand && this.pages % 2 === (side === 'right' ? 0 : 1)) this.pdf.addPage();
    this.roles[this.pages] = role;
    this.flowRole = role === 'opener' ? 'body' : role;
  }
  private room(h: number): void {
    if (this.pdf.y + h > this.bottom && !this.atTop()) this.pdf.addPage();
  }
  /**
   * The box for centred display text (titles, dedication, epigraph) with its lines evened out: the narrowest width
   * that still needs no more lines than `width`, so no word is left alone on the last line. Set the font first.
   */
  private balanced(text: string, x: number, width: number, o: PDFKit.Mixins.TextOptions = {}): { x: number; width: number } {
    const height = (w: number) => this.pdf.heightOfString(text, { ...o, width: w });
    const target = height(width);
    let lo = width * 0.3, hi = width;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (height(mid) > target + 0.5) lo = mid;
      else hi = mid;
    }
    const w = Math.min(width, hi + 1);
    return { x: x + (width - w) / 2, width: w };
  }
  private space(pt: number): void {
    if (!this.atTop()) this.pdf.y += pt;
  }

  /** Writes text with inline bold/italic, keeping line breaks (verse). */
  private runs(text: string, o: { x?: number; y?: number; width?: number; size?: number; color?: string; italic?: boolean; align?: 'left' | 'center' | 'right' | 'justify'; indent?: number } = {}): void {
    const x = o.x ?? this.left;
    const width = o.width ?? this.width;
    const size = o.size ?? this.t.size;
    this.pdf.fontSize(size).fillColor(o.color ?? this.ink);
    let first = true;
    for (const line of text.split('\n')) {
      const runs = inlineRuns(line);
      if (!runs.length) runs.push({ text: ' ', bold: false, italic: false });
      runs.forEach((r, i) => {
        this.font(r.bold ? 'b' : r.italic || o.italic ? 'i' : 'r');
        const opts = { width, continued: i < runs.length - 1, lineGap: this.t.gap, align: o.align ?? 'left', ...(first && i === 0 && o.indent ? { indent: o.indent } : {}) };
        if (i === 0) this.pdf.text(r.text, x, first && o.y !== undefined ? o.y : this.pdf.y, opts);
        else this.pdf.text(r.text, opts);
      });
      first = false;
    }
    this.pdf.x = this.left;
  }

  /** Block after the current top-level one, so a print heading is not left alone at the foot of a page. */
  private next: Block | undefined;

  private keepWith(): number {
    if (!this.trim) return 0;
    if (this.next?.kind === 'heading') return 50;
    if (this.next?.kind === 'image') return this.pdf.page.height * 0.3;
    return 0;
  }

  private heading(b: Heading, key: string): void {
    this.afterPara = false;
    if (this.trim && b.opener) return this.opener(b, key);
    const size = this.t.heading[b.level];
    if (b.newPage && !this.atTop()) this.pdf.addPage();
    else this.room(size * 2 + 50 + this.keepWith());
    if (b.level === 1 && this.doc.kind === 'book') this.pdf.y += 90;
    else this.space(b.level === 3 ? 6 : 10);
    if (b.toc) {
      this.pageOf.set(key, this.pages);
      if (this.numbers) {
        const item = b.level === 1 || !this.outlineTop ? this.pdf.outline.addItem(b.text) : this.outlineTop.addItem(b.text);
        if (b.level === 1) this.outlineTop = item;
      }
    }
    const color = b.level === 3 ? this.ink : this.t.accent;
    const face = () => (this.trim ? this.headFont() : this.font('b'));
    const iconW = b.icon ? size * 1.3 : 0;
    const markW = b.mark ? size * 1.2 : 0;
    const width = this.width - iconW - markW;
    const y0 = this.pdf.y;
    face().fontSize(size).fillColor(color);
    if (b.icon) this.icon(b.icon, this.left, y0 + size * 0.05, size * 0.95, color);
    if (b.mark) this.icon(b.mark, this.left + iconW + Math.min(this.pdf.widthOfString(b.text), width) + size * 0.3, y0 + size * 0.05, size * 0.9, MUTED);
    face().fontSize(size).fillColor(color);
    this.pdf.text(b.text, this.left + iconW, y0, { width, lineGap: 2, ...(b.toc ? { destination: key } : {}) });
    if (b.level === 1) {
      const y = this.pdf.y + 3;
      this.pdf.moveTo(this.left, y).lineTo(this.left + this.width, y).lineWidth(0.8).strokeColor(this.t.accent).stroke();
      this.pdf.y = y + 10;
    } else this.pdf.y += 3;
    this.pdf.x = this.left;
  }

  /**
   * Print chapter opening: a new page (right-hand with right-hand chapters), the label, title and a short rule at the
   * top of the text area, no running head or page number.
   */
  private opener(b: Heading, key: string): void {
    const [label, title] = chapterParts(b.text);
    this.chapter = title;
    this.startPage('opener', 'right');
    this.chapters[this.pages] = title;
    if (!this.bodyStart) this.bodyStart = this.pages;
    if (b.toc) {
      this.pageOf.set(key, this.pages);
      if (this.numbers) this.outlineTop = this.pdf.outline.addItem(b.text);
    }
    // A small sink only: the chapter starts where the reader looks first, not a fifth of the way down.
    if (b.stamp) {
      // The chapter's date, small at the top right of the opening page.
      this.font('i').fontSize(8.5).fillColor(MUTED).text(b.stamp, this.left, this.top - 6, { width: this.width, align: 'right', lineBreak: false });
    }
    this.pdf.y = this.top + OPENER_SINK;
    if (label) {
      this.font('r').fontSize(9.5).fillColor(MUTED).text(label.toUpperCase(), this.left, this.pdf.y, { width: this.width, align: 'center', characterSpacing: 2.2 });
      this.pdf.y += 8;
    }
    this.headFont().fontSize(this.t.heading[1]).fillColor(this.t.accent);
    const box = this.balanced(title, this.left, this.width, { lineGap: 2 });
    this.pdf.text(title, box.x, this.pdf.y, { width: box.width, align: 'center', lineGap: 2, ...(b.toc ? { destination: key } : {}) });
    const y = this.pdf.y + 12;
    const mid = this.left + this.width / 2;
    this.pdf.moveTo(mid - 28, y).lineTo(mid + 28, y).lineWidth(0.7).strokeColor(this.t.accent).stroke();
    this.pdf.y = y + 30;
    this.pdf.x = this.left;
  }

  /**
   * Front matter: each page on its own. With right-hand chapters they open on right-hand pages, except the copyright
   * page on the back of the title page.
   */
  private front(b: Extract<Block, { kind: 'front' }>): void {
    if (!this.trim) {
      // Without a print layout these are plain centered lines.
      for (const l of b.lines) this.runs(l, { align: 'center', italic: b.role !== 'title' });
      this.pdf.y += 10;
      return;
    }
    this.startPage('front', b.role === 'copyright' ? 'left' : 'right');
    const h = this.pdf.page.height;
    const center = (text: string, size: number, style: 'r' | 'b' | 'i' | 'h', color = this.ink, gap = 6) => {
      (style === 'h' ? this.headFont() : this.font(style)).fontSize(size).fillColor(color);
      const box = this.balanced(text, this.left, this.width, { lineGap: 2 });
      this.pdf.text(text, box.x, this.pdf.y, { width: box.width, align: 'center', lineGap: 2 });
      this.pdf.y += gap;
    };
    const [first, ...rest] = b.lines;
    switch (b.role) {
      case 'title': {
        this.pdf.y = h * 0.24;
        center(first ?? '', Math.max(26, this.t.heading[1] * 1.35), 'h', this.t.accent, 10);
        const [subtitle, author, publisher] = rest;
        if (subtitle) center(subtitle, 13, 'i', this.ink, 10);
        if (author) { this.pdf.y = h * 0.5; center(author, 13 * (this.look?.authorScale ?? 1), 'r'); }
        if (publisher) { this.pdf.y = h - this.trim.bottom - 30; center(publisher, 10, 'r', MUTED); }
        break;
      }
      case 'copyright': {
        this.font('r').fontSize(8.5);
        const text = b.lines.join('\n');
        const height = this.pdf.heightOfString(text, { width: this.width, lineGap: 2.5 });
        this.pdf.y = h - this.trim.bottom - height - 6 * b.lines.length;
        for (const l of b.lines) { this.runs(l, { size: 8.5 }); this.pdf.y += 6; }
        break;
      }
      case 'dedication':
        this.pdf.y = h * 0.3;
        for (const l of b.lines) center(l, 11.5, 'i');
        break;
      case 'epigraph': {
        this.pdf.y = h * 0.3;
        const quote = first ?? '';
        this.font('i').fontSize(11);
        const box = this.balanced(inlineRuns(quote.replace(/\n/g, ' ')).map((r) => r.text).join(''), this.left, this.width, { lineGap: this.t.gap });
        this.runs(quote, { x: box.x, width: box.width, italic: true, align: 'center', size: 11 });
        this.pdf.y += 8;
        // The source sits under the quote's right edge, or the page's when it is wider than the quote.
        for (const l of rest) {
          this.font('r').fontSize(10);
          const fits = this.pdf.widthOfString(l) <= box.width;
          this.runs(l, { x: fits ? box.x : this.left, width: fits ? box.width : this.width, align: 'right', size: 10, color: MUTED });
        }
        break;
      }
    }
    this.pdf.x = this.left;
  }

  /** Book paragraph: widow and orphan control (never one line of a paragraph alone at a page's foot or head). */
  private bookPara(text: string, indent: number): void {
    const opts = { width: this.width, lineGap: this.t.gap, align: 'justify' as const, indent };
    this.font('r').fontSize(this.t.size);
    const line = this.pdf.heightOfString('X', opts);
    const plain = inlineRuns(text.replace(/\n/g, ' ')).map((r) => r.text).join('');
    const lines = Math.round(this.pdf.heightOfString(plain, opts) / line);
    const fit = Math.floor((this.bottom - this.pdf.y) / line + 0.01);
    if (lines > fit && !this.atTop()) {
      if (fit < 2 || (lines - fit === 1 && fit - 1 < 2)) this.pdf.addPage();
      else if (lines - fit === 1) {
        // Leave a widow? Break one line earlier, so two lines go over.
        const page = this.pdf.page;
        page.margins.bottom += line;
        this.runs(text, { align: 'justify', indent });
        page.margins.bottom -= line;
        return;
      }
    }
    this.runs(text, { align: 'justify', indent });
  }

  /** The current font's ascender and cap height, in points at `size`. */
  private metrics(size: number): { asc: number; cap: number } {
    const f = (this.pdf as unknown as { _font: { ascender: number; capHeight?: number } })._font;
    return { asc: (f.ascender / 1000) * size, cap: ((f.capHeight || 700) / 1000) * size };
  }

  /**
   * Chapter's first paragraph with a big initial: "raised" sets it on the first line's baseline and only the first
   * line runs beside it; "dropped" sinks it two lines, its top level with the first line's capitals. The lines beside
   * the letter are fitted by hand (pdfkit cannot flow text around a shape); the rest continues as normal text.
   */
  private dropCap(text: string): void {
    const mode = this.look?.dropCap ?? 'raised';
    if (mode === 'none') return this.bookPara(hyphenate(text), 0);
    const clean = text.replace(/\u00ad/g, '');
    const runs = inlineRuns(clean.replace(/\n/g, ' '));
    const lead = /^([“"‘']*)(\p{L})/u.exec(runs[0]?.text ?? '');
    if (!lead) return this.bookPara(text, 0);
    const cap = lead[2]!;
    runs[0] = { ...runs[0]!, text: runs[0]!.text.slice(lead[0].length) };
    if (lead[1]) runs[0].text = lead[1] + runs[0].text;
    const S = this.t.size;
    this.font('r').fontSize(S);
    const line = this.pdf.heightOfString('X', { width: this.width, lineGap: this.t.gap });
    const body = this.metrics(S);
    this.font('b').fontSize(100);
    const capRatio = this.metrics(1).cap;
    const dropped = mode === 'dropped';
    // Dropped: from the first line's cap height down to the second baseline. Raised: about two and a half lines tall.
    const capSize = dropped ? (line + body.cap) / capRatio : S * 2.6;
    this.room(line * 3 + (dropped ? 0 : capSize));
    const y0 = this.pdf.y;
    this.font('b').fontSize(capSize);
    const capM = this.metrics(capSize);
    const base = dropped ? y0 + body.asc + line : y0 + capM.cap + (body.asc - body.cap);
    // Flush: a raised initial is part of its word; a dropped one keeps a small even gap to the lines beside it.
    const capW = this.pdf.widthOfString(cap) + (dropped ? S * 0.3 : S * 0.04);
    this.pdf.fillColor(this.t.accent).text(cap, this.left, base - capM.asc, { lineBreak: false });
    // Words with their style, measured in their own font.
    type Word = { text: string; bold: boolean; italic: boolean; w: number };
    const words: Word[] = runs.flatMap((r) => r.text.split(/(?<=\s)/).filter((t) => t !== '').map((t) => ({ text: t, bold: r.bold, italic: r.italic, w: 0 })));
    const measure = (wd: Word, t = wd.text) => { this.font(wd.bold ? 'b' : wd.italic ? 'i' : 'r').fontSize(S); return this.pdf.widthOfString(t); };
    for (const wd of words) wd.w = measure(wd);
    const avail = this.width - capW;
    const rows = dropped ? 2 : 1;
    const firstTop = dropped ? y0 : base - body.asc;
    let i = 0;
    for (let row = 0; row < rows && i < words.length; row++) {
      const start = i;
      let w = 0;
      while (i < words.length && (i === start || w + measure(words[i]!, words[i]!.text.trimEnd()) <= avail)) { w += words[i]!.w; i++; }
      const lineWords = words.slice(start, i);
      const natural = lineWords.reduce((n, wd, k) => n + (k === lineWords.length - 1 ? measure(wd, wd.text.trimEnd()) : wd.w), 0);
      const gaps = lineWords.filter((wd, k) => k < lineWords.length - 1 && /\s$/.test(wd.text)).length;
      const extra = i < words.length && gaps ? (avail - natural) / gaps : 0;
      let x = this.left + capW;
      const y = firstTop + row * line;
      lineWords.forEach((wd, k) => {
        const t = k === lineWords.length - 1 ? wd.text.trimEnd() : wd.text;
        this.font(wd.bold ? 'b' : wd.italic ? 'i' : 'r').fontSize(S).fillColor(this.ink).text(t, x, y, { lineBreak: false });
        x += measure(wd, t) + (/\s$/.test(wd.text) ? extra : 0);
      });
    }
    this.pdf.x = this.left;
    this.pdf.y = firstTop + rows * line;
    const rest = words.slice(i).map((wd) => (wd.bold ? `**${wd.text.trim()}** ` : wd.italic ? `*${wd.text.trim()}* ` : wd.text)).join('').trim();
    if (rest) this.bookPara(hyphenate(rest), 0);
  }

  /** A game-icons.net icon as vector paths, `size` points square, top-left at (x, y). */
  private icon(name: IconName, x: number, y: number, size: number, color: string): void {
    this.pdf.save().translate(x, y).scale(size / ICON_SIZE);
    for (const d of ICONS[name]) this.pdf.path(d).fill(color);
    this.pdf.restore();
  }

  private toc(): void {
    this.afterPara = false;
    if (this.trim) {
      this.startPage('toc', 'right');
      this.pdf.y = this.top + 40;
      this.headFont().fontSize(this.t.heading[1]).fillColor(this.t.accent).text(this.say('Contents'), this.left, this.pdf.y, { width: this.width, align: 'center' });
      this.pdf.y += 18;
    } else this.pdf.addPage();
    if (this.trim) return this.tocLines();
    this.font('b').fontSize(this.t.heading[1]).fillColor(this.t.accent).text(this.say('Contents'), this.left, this.pdf.y, { width: this.width });
    this.pdf.y += 12;
    this.tocLines();
  }

  private tocLines(): void {
    for (const { key, h } of this.tocEntries) {
      const indent = (h.level - 1) * 16;
      const size = h.level === 1 ? this.t.size + 1 : this.t.size;
      this.room(size * 2);
      if (h.level === 1) this.pdf.y += 4;
      const y = this.pdf.y;
      const n = this.numbers?.get(key);
      this.font(h.level === 1 ? 'b' : 'r').fontSize(size).fillColor(this.ink);
      // Print books even out an entry that wraps, so a chapter title does not leave one word on its own line.
      const room = this.width - indent - 44;
      const width = this.trim ? this.balanced(h.text, 0, room, { lineGap: 1.5 }).width : room;
      this.pdf.text(h.text, this.left + indent, y, { width, lineGap: 1.5, ...(this.numbers ? { goTo: key } : {}) });
      const after = this.pdf.y;
      this.pdf.text(n === undefined ? '' : String(n), this.left + this.width - 40, y, { width: 40, align: 'right', lineBreak: false });
      this.pdf.y = after;
    }
    this.pdf.x = this.left;
  }

  private facts(rows: [string, string][]): void {
    const labelW = this.doc.kind === 'codex' ? 118 : 100;
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
    type Img = { width: number; height: number };
    let img: Img | undefined;
    // PNG and JPEG go in as they are, a GIF as its first frame.
    const pic = readPicture(join(this.opts.worldDir, b.file));
    if ('problem' in pic) {
      if (pic.problem === 'type') this.note(this.say('[Image not embedded: {file}. PDF export embeds PNG, JPEG and GIF only.]', { file: b.file }));
      else if (pic.problem === 'missing') this.note(this.say('[Image file missing: {file}]', { file: b.file }));
      else this.note(this.say('[Image could not be read: {file}]', { file: b.file }));
    } else {
      try {
        img = (this.pdf as unknown as { openImage(src: Buffer): Img }).openImage(pic.data);
      } catch (e) {
        this.note(this.say('[Image could not be read: {file} ({error})]', { file: b.file, error: (e as Error).message }));
      }
    }
    if (img) {
      // A map is as large as the page allows, so its numbered places can be told apart.
      const map = !!b.pins;
      const maxW = map ? this.width : this.width * (this.trim ? 1 : this.doc.kind === 'book' ? 0.9 : 0.55);
      const maxH = map ? (this.bottom - this.top) * 0.66 : this.trim ? this.pdf.page.height * 0.42 : this.doc.kind === 'book' ? 300 : 220;
      const s = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * s;
      const h = img.height * s;
      this.room(h + 40);
      this.space(4);
      const x = this.left + (this.width - w) / 2;
      const y = this.pdf.y;
      this.pdf.image(img as unknown as Buffer, x, y, { width: w, height: h });
      for (const p of b.pins ?? []) this.pin(x + (w * p.x) / 100, y + (h * p.y) / 100, p.n);
      this.pdf.x = this.left;
      this.pdf.y = y + h + 4;
    }
    if (!b.pins) this.runs(b.caption, { size: this.t.size - 1, italic: true, align: 'center', color: INK });
    for (const d of b.details) this.runs(d, { size: this.t.size - 1.5, color: MUTED, align: 'center' });
    if (b.pins?.length) this.legend(b.pins);
    this.pdf.y += 8;
  }

  /** A numbered place: the number in a disc centred on (cx, cy), the same on the map and in its list. */
  private pin(cx: number, cy: number, n: number): void {
    const label = String(n);
    const size = label.length > 2 ? 5.6 : 6.8;
    const r = label.length > 1 ? 7 : 6;
    this.pdf.circle(cx, cy, r).lineWidth(1.1).fillAndStroke(PIN_FILL, PIN_RING);
    this.font('b', 'sans').fontSize(size).fillColor('#ffffff').text(label, cx - r, cy - size * 0.56, { width: r * 2, align: 'center', lineBreak: false });
  }

  /** A map's places by number, row by row in columns, each number in the disc it has on the map. */
  private legend(pins: MapMark[]): void {
    const cols = Math.max(1, Math.min(3, Math.floor(this.width / 140)));
    const colW = this.width / cols;
    const size = this.t.size - 0.5;
    const lineH = Math.max(size + 6, 16);
    this.space(4);
    for (let i = 0; i < pins.length; i += cols) {
      this.room(lineH);
      const y = this.pdf.y;
      pins.slice(i, i + cols).forEach((p, j) => {
        const x = this.left + j * colW;
        this.pin(x + 8, y + lineH / 2, p.n);
        this.font('r').fontSize(size).fillColor(INK).text(p.name, x + 20, y + lineH / 2 - size * 0.62, { width: colW - 26, height: size + 2, ellipsis: true });
      });
      this.pdf.x = this.left;
      this.pdf.y = y + lineH;
    }
    this.pdf.y += 2;
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
      case 'front': return this.front(b);
      case 'para':
        if (this.trim && !b.style) {
          const indent = this.afterPara ? this.t.size * 1.4 : 0;
          if (b.dropCap) this.dropCap(b.text);
          else this.bookPara(hyphenate(b.text), indent);
          this.afterPara = true;
          return;
        }
        this.afterPara = false;
        this.room(this.t.size * 3);
        if (b.style === 'muted') return this.note(b.text);
        this.runs(b.text, { ...(b.style === 'lead' ? { italic: true, size: this.t.size + 0.5 } : {}), align: this.t.justify ? 'justify' : 'left' });
        this.pdf.y += this.doc.kind === 'book' ? 7 : 5;
        return;
      case 'facts': this.afterPara = false; return this.facts(b.rows);
      case 'list': this.afterPara = false; return this.list(b.items);
      case 'image': this.afterPara = false; return this.image(b);
      case 'prompt': return this.prompt(b);
      case 'box': return this.box(b);
    }
  }

  /**
   * The world's cover art as a full page, the same drawing as the app's covers (gradient, picture, glow, stars, gold
   * frame, emblem) with the title in the chosen lettering, then the subtitle and cover lines.
   */
  private artCover(art: CoverArt): void {
    const c = this.doc.cover;
    const pdf = this.pdf;
    const W = pdf.page.width, H = pdf.page.height;
    const k = W / 240; // the app draws covers on a 240 x 320 canvas
    const fill = (hex: string): [string, number] => splitAlpha(hex);
    pdf.save();
    const [top, topA] = fill(art.top), [bottom, bottomA] = fill(art.bottom);
    const g = pdf.linearGradient(0, 0, W * 0.4, H);
    g.stop(0, top, topA).stop(1, bottom, bottomA);
    pdf.rect(0, 0, W, H).fill(g);
    const pic = art.image ? readPicture(join(this.opts.worldDir, art.image)) : null;
    if (pic && 'data' in pic) {
      try {
        pdf.save();
        pdf.rect(0, 0, W, H).clip();
        pdf.opacity(art.imageOpacity);
        const img = (pdf as unknown as { openImage(src: Buffer): { width: number; height: number } }).openImage(pic.data);
        const s = Math.max(W / img.width, H / img.height);
        pdf.image(img as unknown as Buffer, (W - img.width * s) / 2, (H - img.height * s) / 2, { width: img.width * s, height: img.height * s });
        pdf.restore();
      } catch { pdf.restore(); /* an unreadable picture leaves the plain gradient */ }
    }
    const [glow, glowA] = fill(art.glow);
    const r = pdf.radialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.6);
    r.stop(0, glow, glowA).stop(1, glow, 0);
    pdf.rect(0, 0, W, H).fill(r);
    const sk = Math.max(W / 240, H / 320), ox = (W - 240 * sk) / 2, oy = (H - 320 * sk) / 2;
    art.stars.forEach(([x, y, rr], i) => pdf.circle(ox + x * sk, oy + y * sk, rr * sk * 0.8).fillOpacity(0.25 + (i % 4) * 0.12).fill('#ffffff'));
    pdf.fillOpacity(1);
    pdf.roundedRect(10 * k, 10 * k, W - 20 * k, H - 20 * k, 6 * k).lineWidth(1.5).strokeOpacity(0.75).stroke(GOLD);
    pdf.roundedRect(16 * k, 16 * k, W - 32 * k, H - 32 * k, 4 * k).lineWidth(1).strokeOpacity(0.35).stroke(GOLD);
    pdf.strokeOpacity(1);
    if (art.icon && art.showEmblem) {
      const size = 72 * k;
      const [ink, inkA] = fill(art.iconColor);
      pdf.save();
      // A chosen place is measured in the room inside the frame, like the app's covers; else centred near the top.
      const at = art.emblemPos ? placeOnCover(art.emblemPos, size, size, W, H) : { x: W / 2 - size / 2, y: H * (COVER_EMBLEM.y / 320) };
      pdf.translate(at.x, at.y).scale(size / ICON_SIZE);
      for (const d of ICONS[art.icon]) pdf.path(d).fillOpacity(0.9 * inkA).fill(ink);
      pdf.restore();
    }
    pdf.restore();
    const [ink, inkA] = fill(art.titleColor);
    const pad = 28 * k;
    const font = art.titleStyle === 'serif' ? 'serif-i' : art.titleStyle === 'sans' ? 'sans-b' : 'serif-b';
    const title = art.titleStyle === 'display' ? c.title.toUpperCase() : c.title;
    if (art.showTitle) {
      const o = { align: 'center' as const, characterSpacing: art.titleStyle === 'display' ? 1.5 : 0 };
      pdf.font(this.opts.titleFont ?? font).fontSize(Math.min(30, 13 * k) * (this.look?.coverTitleScale ?? 1)).fillOpacity(inkA).fillColor(ink);
      const box = this.balanced(title, pad, W - 2 * pad, o);
      if (art.titlePos) {
        // A chosen place: the title's own box goes there, never outside the frame; the subtitle and the cover lines
        // stay where they always are.
        const at = placeOnCover(art.titlePos, box.width, pdf.heightOfString(title, { ...o, width: box.width }), W, H);
        pdf.text(title, at.x, at.y, { ...o, width: box.width });
        pdf.y = H * 0.56;
      } else pdf.text(title, box.x, H * 0.56, { ...o, width: box.width });
    } else pdf.y = H * 0.56;
    pdf.fillOpacity(1);
    pdf.y += 6;
    pdf.font('serif').fontSize(Math.min(16, 7 * k)).fillColor('#efe3c4').text(c.subtitle, pad, pdf.y, { width: W - 2 * pad, align: 'center' });
    pdf.y += 14;
    // A print book's cover has only the author under the subtitle, set large enough to read on a shelf.
    const lineSize = (this.trim ? Math.min(13, 5.6 * k) : Math.min(10, 4.4 * k)) * (this.look?.authorScale ?? 1);
    for (const l of c.lines) {
      if (pdf.y > H - 40 * k) break;
      pdf.font('serif').fontSize(lineSize).fillColor(this.trim ? '#efe3c4' : '#d9ccad').text(l.replace(/\*\*/g, ''), pad + 10 * k, pdf.y, { width: W - 2 * pad - 20 * k, align: 'center' });
      pdf.y += 4;
    }
  }

  private cover(): void {
    const c = this.doc.cover;
    this.pdf.addPage();
    if (c.art) return this.artCover(c.art);
    this.pdf.y = this.pdf.page.height * 0.3;
    this.font('b').fontSize(30 * (this.look?.coverTitleScale ?? 1)).fillColor(this.look?.coverTitleColor ?? this.t.accent).text(c.title, this.left, this.pdf.y, { width: this.width, align: 'center' });
    this.pdf.y += 8;
    this.font('r').fontSize(16).fillColor(this.ink).text(c.subtitle, { width: this.width, align: 'center' });
    this.pdf.y += 40;
    for (const l of c.lines) {
      this.runs(l, { size: (this.t.size + 0.5) * (this.look?.authorScale ?? 1), color: MUTED, align: 'center' });
      this.pdf.y += 6;
    }
  }

  /** Print books: running heads (book title on left pages, chapter on right pages) and page numbers, on body pages only. */
  private printMarks(): void {
    const range = this.pdf.bufferedPageRange();
    const tr = this.trim!;
    for (let i = range.start; i < range.start + range.count; i++) {
      const n = i + 1;
      if (this.roles[n] !== 'body' || !this.bodyStart || n < this.bodyStart) continue;
      this.pdf.switchToPage(i);
      const margins = this.pdf.page.margins;
      const bottom = margins.bottom;
      margins.bottom = 0;
      const head = (n % 2 === 0 ? this.doc.title : this.chapters[n] ?? '').toUpperCase();
      this.font('r').fontSize(7.5).fillColor(MUTED).text(head, this.left, tr.top - 26, { width: this.width, align: 'center', characterSpacing: 1.4, lineBreak: false, height: 12, ellipsis: true });
      this.font('r').fontSize(9).fillColor(INK).text(String(n - this.bodyStart + 1), this.left, this.pdf.page.height - tr.bottom + 22, { width: this.width, align: 'center', lineBreak: false });
      margins.bottom = bottom;
    }
  }

  private footers(): void {
    if (this.trim) return this.printMarks();
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
    if (!this.trim) this.cover();
    else if (this.doc.cover.art) {
      // Print books: the front cover first, then the title page (on page 3 with right-hand chapters).
      this.flowRole = 'blank';
      this.pdf.addPage();
      this.artCover(this.doc.cover.art);
    }
    this.doc.blocks.forEach((b, i) => {
      this.next = this.doc.blocks[i + 1];
      this.block(b, i);
    });
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

type HasGlyph = (codePoint: number) => boolean;

/** A font file's glyph check, via pdfkit's own fontkit font. */
function glyphCheck(file: string): HasGlyph {
  const probe = new PDFDocument({ autoFirstPage: false });
  probe.font(file);
  const font = (probe as unknown as { _font: { font: { hasGlyphForCodePoint(c: number): boolean } } })._font.font;
  return (c) => font.hasGlyphForCodePoint(c);
}

/**
 * Text the PDF fonts can draw: characters DejaVu has no glyph for (colour emoji, rare symbols) are dropped,
 * together with emoji joiners and variation selectors, so a PDF never shows empty boxes. The word next to an
 * emoji always stays, because the app never uses an emoji alone.
 */
export function printable(text: string, has: HasGlyph): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f) || c === 0x20e3 || (c >= 0x1f3fb && c <= 0x1f3ff)) continue;
    if (c < 0x80 || ch === '\n' || has(c)) out += ch;
  }
  return out === text ? text : out.replace(/[ \t]{2,}/g, ' ').replace(/^ | $/gm, '');
}

function printableDoc(doc: Doc, has: HasGlyph): Doc {
  const t = (s: string) => printable(s, has);
  const block = (b: Block): Block => {
    switch (b.kind) {
      case 'heading': case 'para': return { ...b, text: t(b.text) };
      case 'facts': return { ...b, rows: b.rows.map(([k, v]) => [t(k), t(v)]) };
      case 'list': return { ...b, items: b.items.map(t) };
      case 'image': return { ...b, caption: t(b.caption), details: b.details.map(t) };
      case 'prompt': return { ...b, label: t(b.label), text: t(b.text) };
      case 'box': return { ...b, title: t(b.title), blocks: b.blocks.map(block) };
      case 'toc': return b;
      case 'front': return { ...b, lines: b.lines.map(t) };
    }
  };
  return { ...doc, title: t(doc.title), cover: { ...doc.cover, title: t(doc.cover.title), subtitle: t(doc.cover.subtitle), lines: doc.cover.lines.map(t) }, blocks: doc.blocks.map(block) };
}

/** Every character of a Doc's text, once. */
function docChars(doc: Doc): Set<string> {
  const out = new Set<string>();
  const add = (t: string) => { for (const ch of t) if (ch.trim()) out.add(ch); };
  const block = (b: Block): void => {
    switch (b.kind) {
      case 'heading': add(b.text); if (b.stamp) add(b.stamp); break;
      case 'para': add(b.text); break;
      case 'facts': b.rows.forEach(([k, v]) => { add(k); add(v); }); break;
      case 'list': b.items.forEach(add); break;
      case 'image': add(b.caption); b.details.forEach(add); break;
      case 'prompt': add(b.label); add(b.text); break;
      case 'box': add(b.title); b.blocks.forEach(block); break;
      case 'front': b.lines.forEach(add); break;
      case 'toc': break;
    }
  };
  doc.blocks.forEach(block);
  return out;
}

/**
 * The Story Book's body and chapter title fonts as files. DejaVu needs none. A bundled font that lacks a letter the
 * book uses (the bundled web fonts carry Latin only, not ş or ğ) falls back to DejaVu, with a note.
 */
function resolveBookFonts(doc: Doc, look: BookLook, fontDir: string, dir: string | undefined, notes: string[], say: Translate): BookFonts {
  const chars = [...docChars(doc)];
  const usable = (family: string, bold: boolean): string | undefined => {
    const b = bundledFont(family);
    const file = b && bundledFontPath(b, bold, dir);
    if (!file) return undefined;
    const has = glyphCheck(file);
    const missing = chars.find((ch) => ch.codePointAt(0)! > 0x7f && !has(ch.codePointAt(0)!));
    if (missing) { notes.push(say('The font “{font}” has no “{letter}”, so the PDF uses DejaVu for that text instead.', { font: family, letter: missing })); return undefined; }
    return file;
  };
  const kind = (family: string): 'serif' | 'sans' => (/sans|carlito/i.test(family) ? 'sans' : 'serif');
  const out: BookFonts = { bodyFamily: kind(look.bodyFont) };
  if (!/^DejaVu /.test(look.bodyFont)) {
    const r = usable(look.bodyFont, false);
    if (r) out.body = { r, b: usable(look.bodyFont, true) ?? r, italic: kind(look.bodyFont) };
  }
  const dejavuBold = join(fontDir, FONT_FILES[kind(look.chapterFont) === 'sans' ? 'sans-b' : 'serif-b']);
  out.head = /^DejaVu /.test(look.chapterFont) ? dejavuBold : usable(look.chapterFont, true) ?? dejavuBold;
  return out;
}

/** Renders a World Codex or Story Book Doc to PDF bytes. */
export async function renderPdf(source: Doc, options: PdfOptions): Promise<PdfResult> {
  const fontDir = options.fontDir ?? defaultFontDir();
  const doc = printableDoc(source, glyphCheck(join(fontDir, FONT_FILES.sans)));
  const notes: string[] = [];
  const say = options.t ?? english;
  const art = doc.cover.art;
  let titleFont: string | undefined;
  if (art?.font && art.showTitle) {
    const found = await coverFont(art.font, art.titleStyle !== 'serif', options.coverFontDir);
    if (found.note) notes.push(say(found.note, { font: art.font.trim() }));
    const title = art.titleStyle === 'display' ? doc.cover.title.toUpperCase() : doc.cover.title;
    const has = found.file ? glyphCheck(found.file) : undefined;
    if (has && [...title].some((ch) => ch.trim() && !has(ch.codePointAt(0)!))) notes.push(say('The cover font “{font}” has no letters for some of the title, so the PDF cover title uses DejaVu.', { font: art.font }));
    else if (found.file) titleFont = found.file;
  }
  const bookFonts = doc.print?.look ? resolveBookFonts(doc, doc.print.look, fontDir, options.coverFontDir, notes, say) : undefined;
  const opts: LayoutOptions = { ...options, fontDir, ...(titleFont ? { titleFont } : {}), ...(bookFonts ? { bookFonts } : {}) };
  const first = new Layout(doc, opts, undefined);
  first.run();
  await finish(first.pdf);
  // Print books number their pages from the first chapter; the contents shows those numbers.
  const shift = first.bodyStart ? first.bodyStart - 1 : 0;
  const second = new Layout(doc, opts, new Map([...first.pageOf].map(([k, n]) => [k, n - shift])));
  const pages = second.run();
  return { pdf: await finish(second.pdf), pages, notes };
}

/** Markdown sidecar path for a PDF path: book.pdf -> book.md. */
export function sidecarPath(pdfPath: string): string {
  return pdfPath.replace(/\.pdf$/i, '') + '.md';
}

/** Writes the PDF and its Markdown sidecar (image links relative to the sidecar). */
export async function writePublication(doc: Doc, worldDir: string, pdfPath: string, fontDir?: string, coverFontDir?: string, t?: Translate): Promise<{ pdf: string; md: string; pages: number; notes: string[] }> {
  const out = resolve(pdfPath);
  const md = sidecarPath(out);
  const { pdf, pages, notes } = await renderPdf(doc, { worldDir, ...(fontDir ? { fontDir } : {}), ...(coverFontDir ? { coverFontDir } : {}), ...(t ? { t } : {}) });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, pdf);
  const href = (file: string) => relative(dirname(md), join(resolve(worldDir), file)).split(sep).join('/');
  await writeFile(md, toMarkdown(doc, href, t ?? ((s) => s)));
  return { pdf: out, md, pages, notes };
}

export { renderDocx, writeDocx, type DocxOptions } from './docx.ts';
export { BUNDLED_FONTS } from '@lore-forge/core';
export { bundledFontFile, bundledFontPath, coverFont, systemFontFamilies, systemFonts, type SystemFont } from './fonts.ts';
export { encodePng, gifFirstFrame, gifToPng, readPicture, type Frame, type Picture } from './gif.ts';
export { english, type Translate } from './words.ts';
