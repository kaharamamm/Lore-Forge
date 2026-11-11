/**
 * Planning the story (the Story view's board): how far each chapter is, and who is in which chapter, so a character
 * who drops out of the story for a long stretch stands out.
 */
import { msg } from './i18n.ts';
import { isEnded } from './lifecycle.ts';
import { bodyLinks } from './links.ts';
import type { ChapterStatus, EntryType, StoryChapter, World } from './types.ts';
import { WorldIndex } from './world-index.ts';

export const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string> = { idea: msg`Idea`, draft: msg`Draft`, revised: msg`Revised`, done: msg`Done` };

/** The chapter's status as set, else an idea while it has no text and a draft once it has. */
export function chapterStatus(ch: StoryChapter): ChapterStatus {
  return ch.status ?? (ch.body.trim() ? 'draft' : 'idea');
}

/** Ids of the entries a chapter names: plain names that belong to one entry only, and its [[links]] and @mentions. */
export function chapterNames(chapter: StoryChapter, ix: WorldIndex): Set<string> {
  const named = new Set<string>();
  for (const m of ix.mentions.find(chapter.body)) if (m.ids.length === 1) named.add(m.ids[0]!);
  for (const l of bodyLinks(chapter.body)) {
    const e = ix.resolve(l.ref);
    if (e) named.add(e.id);
  }
  return named;
}

/** A stretch of written chapters an entry is missing from (positions are 0-based, in reading order). */
export interface CastGap {
  /** The first chapter it is missing from. */
  from: number;
  /** The last one. */
  to: number;
  /** It is not seen again after `from - 1`: the gap runs to the end of the story. */
  last: boolean;
}

export interface CastRow {
  id: string;
  /** For each chapter in reading order: named in it, or its point of view. */
  in: boolean[];
  /** How many chapters it is in. */
  count: number;
  /** Its longest absence, when it is long for a recurring entry. */
  gap?: CastGap;
}

/**
 * Who is in which chapter: the entries of one type that a chapter names or tells its story from, the ones in the
 * most chapters first. A recurring entry (in three chapters or more) that is missing from a long stretch of written
 * chapters (a quarter of them, and at least three) gets its longest absence; the stretch after its last chapter only
 * counts while it is still alive (or standing, active...), since the dead are expected to be gone. Chapters without
 * text yet do not count as missing.
 */
export function chapterCast(world: World, chapters: readonly StoryChapter[], opts: {
  /** Characters when not given. */
  type?: EntryType;
  ix?: WorldIndex;
  /** The names each chapter's text has (chapterNames), when the caller keeps them between calls. */
  namesOf?: (c: StoryChapter) => ReadonlySet<string>;
} = {}): CastRow[] {
  const type = opts.type ?? 'character';
  const ix = opts.ix ?? new WorldIndex(world);
  const namesOf = opts.namesOf ?? ((c: StoryChapter) => chapterNames(c, ix));
  const ids = chapters.map((c) => {
    const named = new Set(namesOf(c));
    const pov = c.pov ? ix.resolve(c.pov) : undefined;
    if (pov) named.add(pov.id);
    return named;
  });
  const written = chapters.map((c) => c.body.trim() !== '');
  const total = written.filter(Boolean).length;
  const long = Math.max(3, Math.ceil(total / 4));
  const rows: CastRow[] = [];
  for (const e of world.entries) {
    if (e.type !== type) continue;
    const here = ids.map((s) => s.has(e.id));
    const count = here.filter(Boolean).length;
    if (!count) continue;
    const row: CastRow = { id: e.id, in: here, count };
    if (count >= 3) {
      // A gap's size counts the written chapters in it only: chapters still to write are not missing anyone.
      let best: CastGap | undefined;
      let bestSize = 0;
      let start = -1;
      let size = 0;
      const close = (to: number, last: boolean): void => {
        while (to > start && !written[to]) to--;
        if (size >= long && size > bestSize) {
          best = { from: start, to, last };
          bestSize = size;
        }
        start = -1;
        size = 0;
      };
      let seen = false;
      for (let i = 0; i < chapters.length; i++) {
        if (here[i]) {
          if (size) close(i - 1, false);
          seen = true;
        } else if (seen && written[i]) {
          if (start < 0) start = i;
          size++;
        }
      }
      if (size && !isEnded(e)) close(chapters.length - 1, true);
      if (best) row.gap = best;
    }
    rows.push(row);
  }
  const first = (r: CastRow): number => r.in.indexOf(true);
  return rows.sort((a, b) => b.count - a.count || first(a) - first(b));
}
