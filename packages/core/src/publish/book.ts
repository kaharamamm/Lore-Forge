import type { ParsedDate } from '../dates.ts';
import { GENERATOR } from '../snapshot.ts';
import type { Entry, LoreEvent, Note, RefImage, World } from '../types.ts';
import { WorldIndex } from '../world-index.ts';
import { imageBlock } from './codex.ts';
import { anchorOf, bodyBlocks, dateWithEra, type Block, type Doc } from './doc.ts';

export const LORE_AND_LEGENDS = 'Lore & Legends';

export interface BookPage {
  entry: LoreEvent | Note;
  date?: ParsedDate;
}

export interface BookChapter {
  title: string;
  pages: BookPage[];
}

/**
 * Chapter grouping. `era`: one chapter per era. `years`: year ranges inside each era
 * (`chapterYears`, else book.chapterYears in world.json, else 100). `single`: every dated page in one chapter.
 * Default: years when world.json sets book.chapterYears, else era. A page's own `chapter:` always wins.
 */
export type ChapterGrouping = 'era' | 'years' | 'single';

export interface BookOptions {
  grouping?: ChapterGrouping;
  chapterYears?: number;
}

export const SINGLE_CHAPTER = 'The Story';

/** Chapter title for a dated page. */
function autoChapter(d: ParsedDate, world: World, opts: BookOptions): string {
  const era = world.manifest.calendar.eras.find((e) => e.id === d.era);
  const name = era ? `${era.name}` : d.era;
  const manifestSpan = world.manifest.book?.chapterYears;
  const grouping = opts.grouping ?? (manifestSpan && manifestSpan >= 1 ? 'years' : 'era');
  if (grouping === 'single') return SINGLE_CHAPTER;
  const span = grouping === 'years' ? (opts.chapterYears ?? manifestSpan ?? 100) : undefined;
  if (!span || span < 1) return name;
  const start = Math.floor(d.year / span) * span;
  return `${name}, ${start}–${start + span - 1}`;
}

/**
 * Events and notes, grouped into chapters and ordered by in-world date.
 * - `chapter:` on a page overrides the automatic chapter (era, or year range with book.chapterYears).
 * - Undated pages without a chapter go to "Lore & Legends", always last.
 * - Inside a chapter: `bookOrder` (default 0, lower first), then date, then name.
 * - Chapters are ordered by their earliest dated page; chapters with no dated page come after those.
 */
export function bookChapters(world: World, opts: BookOptions = {}): BookChapter[] {
  const ix = new WorldIndex(world);
  const chapters = new Map<string, BookPage[]>();
  for (const e of world.entries) {
    if (e.type !== 'event' && e.type !== 'note') continue;
    const date = ix.date(e.date);
    const title = e.chapter?.trim() || (date ? autoChapter(date, world, opts) : LORE_AND_LEGENDS);
    const page: BookPage = date ? { entry: e, date } : { entry: e };
    chapters.set(title, [...(chapters.get(title) ?? []), page]);
  }
  const lo = (p: BookPage) => p.date?.lo ?? Number.POSITIVE_INFINITY;
  const earliest = (pages: BookPage[]) => Math.min(...pages.map(lo));
  const list = [...chapters].map(([title, pages]) => ({
    title,
    pages: pages.sort((a, b) => (a.entry.bookOrder ?? 0) - (b.entry.bookOrder ?? 0) || lo(a) - lo(b) || a.entry.name.localeCompare(b.entry.name)),
  }));
  const rank = (c: BookChapter) => (c.title === LORE_AND_LEGENDS ? 1 : 0);
  return list.sort((a, b) => rank(a) - rank(b) || earliest(a.pages) - earliest(b.pages) || a.title.localeCompare(b.title));
}

/** Illustrations: the page's own images; for an event without any, its place's images. */
function illustrations(e: LoreEvent | Note, ix: WorldIndex): { img: RefImage; of: Entry }[] {
  if (e.images?.length) return e.images.map((img) => ({ img, of: e }));
  const place = e.type === 'event' ? ix.resolve(e.place) : undefined;
  const img = place?.images?.find((i) => i.view === 'establishing') ?? place?.images?.[0];
  return place && img ? [{ img, of: place }] : [];
}

/** The Story Book: the author's events and lore pages in story order. It assembles; it never rewrites prose. */
export function storyBook(world: World, opts: BookOptions = {}): Doc {
  const ix = new WorldIndex(world);
  const m = world.manifest;
  const title = m.book?.title ?? m.name;
  const chapters = bookChapters(world, opts);
  const blocks: Block[] = [{ kind: 'toc' }];
  chapters.forEach((ch, n) => {
    blocks.push({ kind: 'heading', level: 1, text: `Chapter ${n + 1}. ${ch.title}`, toc: true, newPage: true });
    for (const { entry: e, date } of ch.pages) {
      blocks.push({ kind: 'heading', level: 2, text: e.name, anchor: anchorOf(e.id), toc: true });
      const place = e.type === 'event' && e.place ? ix.nameOf(e.place) : undefined;
      const line = [date && dateWithEra(date, m.calendar), place].filter(Boolean).join(' · ');
      if (line) blocks.push({ kind: 'para', text: line, style: 'muted' });
      for (const { img, of } of illustrations(e, ix)) {
        const b = imageBlock(img, of);
        blocks.push(b.kind === 'image' ? { ...b, details: [] } : b);
      }
      const body = bodyBlocks(e.body, ix);
      if (body.length) blocks.push(...body);
      else if (e.summary) blocks.push({ kind: 'para', text: e.summary });
      else blocks.push({ kind: 'para', text: '(No text written for this page yet.)', style: 'muted' });
    }
  });
  if (!chapters.length) blocks.push({ kind: 'para', text: 'This world has no events or notes yet.', style: 'muted' });
  const pages = chapters.reduce((n, c) => n + c.pages.length, 0);
  return {
    kind: 'book',
    title,
    cover: {
      title,
      subtitle: m.book?.title ? `A story of ${m.name}` : 'A Story Book',
      lines: [
        ...(m.book?.author ? [`by ${m.book.author}`] : []),
        `${chapters.length} chapters · ${pages} stories from events and lore pages`,
        `Assembled by ${GENERATOR} from the world's events and notes. The text is the author's own; Lore-Forge only orders and typesets it.`,
      ],
    },
    blocks,
  };
}
