/**
 * A small, renderer-neutral document model shared by the World Bible and the Story Book.
 * The same Doc becomes Markdown (toMarkdown, here in core) and PDF (@lore-forge/pdf).
 * Inline text may use **bold** and *italic*; single newlines are kept as line breaks.
 */
import { formatDate, type ParsedDate } from '../dates.ts';
import type { Calendar } from '../types.ts';
import type { WorldIndex } from '../world-index.ts';

export type Block =
  /** `toc` headings appear in the table of contents and the PDF outline. */
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; anchor?: string; toc?: boolean; newPage?: boolean }
  | { kind: 'para'; text: string; style?: 'lead' | 'muted' }
  | { kind: 'facts'; rows: [label: string, value: string][] }
  | { kind: 'list'; items: string[] }
  /** `file` is relative to the world folder. */
  | { kind: 'image'; file: string; caption: string; details: string[] }
  /** Ready-to-copy text such as an image prompt; monospace in the PDF, a code block in Markdown. */
  | { kind: 'prompt'; label: string; text: string }
  | { kind: 'box'; title: string; blocks: Block[] }
  | { kind: 'toc' };

export interface Doc {
  kind: 'bible' | 'book';
  /** Used in PDF metadata, running footers and the Markdown title. */
  title: string;
  /** Cover page: big title, subtitle, then small lines. */
  cover: { title: string; subtitle: string; lines: string[] };
  blocks: Block[];
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
  const d = ix.date(text);
  if (d) return dateWithEra(d, ix.calendar);
  return /^(\?|unknown)$/i.test(text.trim()) ? 'unknown' : `${text} (unreadable date)`;
}
