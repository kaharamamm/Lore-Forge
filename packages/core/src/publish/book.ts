import type { ParsedDate } from '../dates.ts';
import { GENERATOR } from '../snapshot.ts';
import type { Entry, LoreEvent, Note, RefImage, StoryChapter, TrimSize, World } from '../types.ts';
import { WorldIndex } from '../world-index.ts';
import { chapterDate, wordCount } from '../story.ts';
import { imageBlock } from './codex.ts';
import { worldCoverArt } from '../cover.ts';
import { anchorOf, bodyBlocks, dateWithEra, DEFAULT_TRIM, markDropCaps, TRIMS, type Block, type Doc } from './doc.ts';

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
  /**
   * Worlds with a written story (story/*.md): add the events and notes after the manuscript as
   * "Appendix: Chronicle". Default true. Ignored without a story, where the chronicle is the book.
   */
  appendix?: boolean;
  /** Print trim size; default book.trim in world.json, else 6x9. */
  trim?: TrimSize;
  /** Year on the copyright page; default the current year. */
  year?: number;
}

export const CHRONICLE_APPENDIX = 'Appendix: Chronicle';

/** Manuscript chapters that have text, in reading order. */
export function writtenChapters(world: World): StoryChapter[] {
  return (world.story ?? []).filter((c) => c.body.trim() !== '');
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

/** Event and note pages, chapter headings at `level`. */
function chronicleBlocks(chapters: BookChapter[], ix: WorldIndex, level: 1 | 2, numbered: boolean): Block[] {
  const m = ix.world.manifest;
  const blocks: Block[] = [];
  const sub = (level + 1) as 2 | 3;
  chapters.forEach((ch, n) => {
    blocks.push({ kind: 'heading', level, text: numbered ? `Chapter ${n + 1}. ${ch.title}` : ch.title, toc: true, ...(level === 1 ? { newPage: true, opener: true } : {}) });
    for (const { entry: e, date } of ch.pages) {
      blocks.push({ kind: 'heading', level: sub, text: e.name, anchor: anchorOf(e.id), toc: level === 1 });
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
  return blocks;
}

/**
 * The Story Book. It assembles; it never rewrites prose.
 * - With a written manuscript (story/*.md): the chapters are the book, followed by the events and notes
 *   as "Appendix: Chronicle" (turn off with `appendix: false`).
 * - Without one: the events and lore pages in story order, as before v0.4.
 */
export function storyBook(world: World, opts: BookOptions = {}): Doc {
  const ix = new WorldIndex(world);
  const m = world.manifest;
  const title = m.book?.title ?? m.name;
  const chapters = bookChapters(world, opts);
  const written = writtenChapters(world);
  const blocks: Block[] = [];
  const pages = chapters.reduce((n, c) => n + c.pages.length, 0);
  let summary: string;
  let credit: string;
  if (written.length) {
    written.forEach((ch, n) => {
      blocks.push({ kind: 'heading', level: 1, text: `Chapter ${n + 1}. ${ch.title}`, toc: true, newPage: true, opener: true });
      const d = ix.date(chapterDate(ch));
      if (d) blocks.push({ kind: 'para', text: dateWithEra(d, m.calendar), style: 'muted' });
      blocks.push(...bodyBlocks(ch.body, ix));
    });
    const appendix = opts.appendix !== false && chapters.length > 0;
    if (appendix) {
      blocks.push({ kind: 'heading', level: 1, text: CHRONICLE_APPENDIX, toc: true, newPage: true, opener: true });
      blocks.push({ kind: 'para', text: 'The events and lore pages of the world, in story order.', style: 'muted' });
      blocks.push(...chronicleBlocks(chapters, ix, 2, false));
    }
    const words = written.reduce((n, c) => n + wordCount(c.body), 0);
    summary = `${written.length} chapter${written.length === 1 ? '' : 's'} · ${words.toLocaleString('en-US')} words${appendix ? ` · chronicle of ${pages} pages` : ''}`;
    credit = `Assembled by ${GENERATOR} from the story manuscript${appendix ? ' and the world\'s events and notes' : ''}. The text is the author's own; Lore-Forge only orders and typesets it.`;
  } else {
    blocks.push(...chronicleBlocks(chapters, ix, 1, true));
    if (!chapters.length) blocks.push({ kind: 'para', text: 'This world has no events or notes yet.', style: 'muted' });
    summary = `${chapters.length} chapters · ${pages} stories from events and lore pages`;
    credit = `Assembled by ${GENERATOR} from the world's events and notes. The text is the author's own; Lore-Forge only orders and typesets it.`;
  }
  const subtitle = m.book?.title ? `A story of ${m.name}` : 'A Story Book';
  const trim = opts.trim ?? m.book?.trim ?? DEFAULT_TRIM;
  return {
    kind: 'book',
    title,
    cover: {
      title,
      subtitle,
      lines: [...(m.book?.author ? [`by ${m.book.author}`] : []), summary, credit],
      art: worldCoverArt(world),
    },
    blocks: [...frontMatter(world, title, subtitle, credit, opts), { kind: 'toc' }, ...markDropCaps(blocks)],
    print: { trim: TRIMS[trim] ? trim : DEFAULT_TRIM },
  };
}

/** Half-title, title page, copyright page, then the dedication and epigraph when world.json has them. */
function frontMatter(world: World, title: string, subtitle: string, credit: string, opts: BookOptions): Block[] {
  const b = world.manifest.book ?? {};
  const author = b.author?.trim();
  const year = opts.year ?? new Date().getFullYear();
  const copyright = b.copyright?.trim()
    ? b.copyright.trim().split(/\n+/)
    : [`Copyright © ${year}${author ? ` ${author}` : ''}. All rights reserved.`];
  const out: Block[] = [
    { kind: 'front', role: 'half-title', lines: [title] },
    { kind: 'front', role: 'title', lines: [title, subtitle, author ? `by ${author}` : '', b.publisher?.trim() ?? ''] },
    { kind: 'front', role: 'copyright', lines: [...copyright, ...(b.publisher?.trim() ? [`Published by ${b.publisher.trim()}`] : []), credit] },
  ];
  if (b.dedication?.trim()) out.push({ kind: 'front', role: 'dedication', lines: b.dedication.trim().split(/\n+/) });
  if (b.epigraph?.trim()) out.push({ kind: 'front', role: 'epigraph', lines: [b.epigraph.trim(), ...(b.epigraphSource?.trim() ? [`— ${b.epigraphSource.trim()}`] : [])] });
  return out;
}
