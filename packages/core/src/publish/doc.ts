/**
 * A small, renderer-neutral document model shared by the World Codex and the Story Book.
 * The same Doc becomes Markdown (toMarkdown, here in core) and PDF (@lore-forge/pdf).
 * Inline text may use **bold** and *italic*; single newlines are kept as line breaks.
 */
import { formatDate, formatYearless, parseDate, type ParsedDate } from '../dates.ts';
import type { IconName } from '../icons.ts';
import type { CoverArt } from '../cover.ts';
import type { Calendar, TrimSize } from '../types.ts';
import type { WorldIndex } from '../world-index.ts';

export type Block =
  /**
   * `toc` headings appear in the table of contents and the PDF outline. `icon` is drawn before the text and
   * `mark` after it (e.g. a tombstone); both are optional decorations, the text alone says everything.
   */
  /**
   * `opener`: a chapter opening in a print book: starts at the top of a new page (a right-hand one when the book asks
   * for right-hand chapters), without running head or page number.
   */
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; anchor?: string; toc?: boolean; newPage?: boolean; opener?: boolean; icon?: IconName; mark?: IconName }
  /** `dropCap`: the first paragraph of a chapter, set with a large initial letter. */
  | { kind: 'para'; text: string; style?: 'lead' | 'muted'; dropCap?: boolean }
  /** A front-matter page of a print book, always on its own page. */
  | { kind: 'front'; role: FrontRole; lines: string[] }
  | { kind: 'facts'; rows: [label: string, value: string][] }
  | { kind: 'list'; items: string[] }
  /** `file` is relative to the world folder. */
  | { kind: 'image'; file: string; caption: string; details: string[] }
  /** Ready-to-copy text such as an image prompt; monospace in the PDF, a code block in Markdown. */
  | { kind: 'prompt'; label: string; text: string }
  | { kind: 'box'; title: string; blocks: Block[] }
  | { kind: 'toc' };

/**
 * Front matter, in book order, each on its own page: title page (title, subtitle, author, publisher), copyright
 * page, then the optional dedication and epigraph (lines: quote, then "— source"). There is no half-title: the
 * cover already carries the title alone, and a second title page right after it read as a repeat.
 */
export type FrontRole = 'title' | 'copyright' | 'dedication' | 'epigraph';

/** Page sizes in PDF points (1/72 in) and margins: `inside` is the gutter (binding) side, mirrored on facing pages. */
export interface Trim { id: TrimSize; label: string; width: number; height: number; inside: number; outside: number; top: number; bottom: number }
export const TRIMS: Record<TrimSize, Trim> = {
  '6x9': { id: '6x9', label: '6 × 9 in (trade paperback)', width: 432, height: 648, inside: 63, outside: 45, top: 54, bottom: 58 },
  '5.5x8.5': { id: '5.5x8.5', label: '5.5 × 8.5 in (digest)', width: 396, height: 612, inside: 60, outside: 42, top: 52, bottom: 56 },
  a5: { id: 'a5', label: 'A5 (148 × 210 mm)', width: 419.53, height: 595.28, inside: 60, outside: 43, top: 52, bottom: 56 },
};
export const DEFAULT_TRIM: TrimSize = '6x9';

export interface Doc {
  kind: 'codex' | 'book';
  /** Used in PDF metadata, running footers and the Markdown title. */
  title: string;
  /** Cover page: big title, subtitle, then small lines (the Story Book: the author only), drawn over the world's cover art when `art` is set. */
  cover: { title: string; subtitle: string; lines: string[]; art?: CoverArt };
  blocks: Block[];
  /**
   * Print layout (the Story Book): trim size, mirrored margins and front matter after the cover; running heads show
   * `title` on left pages and the chapter on right pages. Every front page and chapter starts a new page; with
   * `rightHand` (for printed books) they start on right-hand pages, with blank pages added where needed.
   */
  print?: { trim: TrimSize; rightHand?: boolean };
}

export interface InlineRun { text: string; bold: boolean; italic: boolean }

/** Splits **bold**, *italic* and _italic_ spans. */
export function inlineRuns(line: string): InlineRun[] {
  return line
    .split(/(\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/)
    .filter((s) => s !== '')
    .map((s) =>
      s.startsWith('**') && s.endsWith('**') && s.length > 4
        ? { text: s.slice(2, -2), bold: true, italic: false }
        : (s.startsWith('*') && s.endsWith('*')) || (s.startsWith('_') && s.endsWith('_'))
          ? { text: s.slice(1, -1), bold: false, italic: true }
          : { text: s, bold: false, italic: false },
    );
}

/** Split blocks into page-like sheets for an on-screen preview: a new sheet at every `newPage` heading, front-matter page and contents. */
export function docSheets(blocks: readonly Block[]): Block[][] {
  const out: Block[][] = [[]];
  let alone = false;
  for (const b of blocks) {
    const starts = (b.kind === 'heading' && b.newPage) || b.kind === 'front' || b.kind === 'toc';
    if ((starts || alone) && out[out.length - 1]!.length) out.push([]);
    out[out.length - 1]!.push(b);
    alone = b.kind === 'front';
  }
  return out.filter((s) => s.length);
}

/** First unstyled paragraph after each chapter opener gets the drop cap (sub-headings and date lines may come first). */
export function markDropCaps(blocks: Block[]): Block[] {
  let waiting = false;
  return blocks.map((b) => {
    if (b.kind === 'heading' && b.level === 1) { waiting = !!b.opener; return b; }
    if (waiting && b.kind === 'para' && !b.style && /^\p{L}/u.test(b.text.replace(/^[*_“"‘']+/, ''))) { waiting = false; return { ...b, dropCap: true }; }
    if (waiting && (b.kind === 'list' || b.kind === 'box' || b.kind === 'facts')) waiting = false;
    return b;
  });
}

export const anchorOf = (entryId: string): string => `entry-${entryId}`;

/** Replace [[id]], [[Name]], [[id|label]] and @id with display names. Unknown targets keep their written text. */
export function resolveLinks(text: string, ix: WorldIndex): string {
  return text
    .replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g, (_m, ref: string, label?: string) => label?.trim() || ix.resolve(ref.trim())?.name || ref.trim())
    .replace(/(^|[\s(])@([A-Za-z0-9][\w-]*)/g, (m, pre: string, id: string) => {
      const e = ix.resolve(id);
      return e ? `${pre}${e.name}` : m;
    });
}

/** Markdown body -> blocks: paragraphs, `#` headings (level 3), `-`/`*` lists. Links resolved to names. */
export function bodyBlocks(body: string, ix: WorldIndex): Block[] {
  const out: Block[] = [];
  for (const chunk of resolveLinks(body, ix).replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const text = chunk.replace(/^\n+|\s+$/g, '');
    if (!text) continue;
    const lines = text.split('\n');
    if (lines.length === 1 && /^#{1,6}\s/.test(text)) out.push({ kind: 'heading', level: 3, text: text.replace(/^#+\s*/, '') });
    else if (lines.every((l) => /^\s*[-*+]\s+/.test(l))) out.push({ kind: 'list', items: lines.map((l) => l.replace(/^\s*[-*+]\s+/, '')) });
    else out.push({ kind: 'para', text });
  }
  return out;
}

/** Date with its era always spelled out, e.g. "1920 AS", "c. 200 OK". */
export function dateWithEra(d: ParsedDate, calendar: Calendar): string {
  return formatDate(d, { ...calendar, defaultEra: '' });
}

/** Text of a date field for documents: "1920 AS", or the raw text marked unreadable. */
export function showDate(text: string | undefined, ix: WorldIndex): string | undefined {
  if (text === undefined || text.trim() === '') return undefined;
  const r = parseDate(text, ix.calendar);
  if (r.kind === 'date') return dateWithEra(r.date, ix.calendar);
  if (r.kind === 'yearless') return `${formatYearless(r)} (year unknown)`;
  return r.kind === 'unknown' ? 'unknown' : `${text} (unreadable date)`;
}
