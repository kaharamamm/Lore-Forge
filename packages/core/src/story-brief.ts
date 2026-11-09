/**
 * A chapter brief for an AI writing or changing a chapter: the book's voice, the story so far, and, on the chapter's
 * date, who is alive and where, how they look, which places stand, and what has happened or is still to come. All of
 * it comes from the book (its calendar, entries, looks and chapters), so a chapter written with it fits the canon.
 */
import { monthsOf, type ParsedDate } from './dates.ts';
import { sentences } from './extract.ts';
import { lookAt } from './looks.ts';
import { chapterDate, sortChapters, wordCount } from './story.ts';
import { normalizeName, WorldIndex } from './world-index.ts';
import type { Character, Entry, LoreEvent, Place, StoryChapter, World } from './types.ts';

/** Which chapter: its number (1 = first), title or file; none for a new one after the last. `date` sets a new one's date. */
export interface BriefTarget {
  chapter?: string | number;
  date?: string;
}

/** At most this many people, events on each side of the date, and characters of the last chapter's ending. */
const MAX_PEOPLE = 30;
const MAX_EVENTS = 8;
const ENDING_CHARS = 1500;

/** The first sentence of a text, cut at about `max` characters. */
function first(text: string | undefined, max = 140): string {
  const s = sentences((text ?? '').trim())[0]?.text ?? '';
  return s.length <= max ? s : `${s.slice(0, s.lastIndexOf(' ', max))}…`;
}

/** The last sentence of a text. */
function last(text: string, max = 160): string {
  const all = sentences(text.trim());
  const s = all[all.length - 1]?.text ?? '';
  return s.length <= max ? s : `…${s.slice(s.indexOf(' ', s.length - max) + 1)}`;
}

/** The end of a chapter: its last paragraphs, up to about ENDING_CHARS. */
function ending(text: string): string {
  const paras = text.trim().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let size = 0;
  for (let i = paras.length - 1; i >= 0; i--) {
    if (out.length && size + paras[i]!.length > ENDING_CHARS) break;
    out.unshift(paras[i]!);
    size += paras[i]!.length;
  }
  const joined = out.join('\n\n');
  return joined.length > ENDING_CHARS * 1.6 ? `…${joined.slice(-ENDING_CHARS)}` : joined;
}

/** The chapter a brief is for: an existing one, or where a new one would go. */
function findTarget(sorted: StoryChapter[], ref: string | number | undefined): { chapter?: StoryChapter; index: number; title?: string } {
  if (ref === undefined || ref === '') return { index: sorted.length };
  if (typeof ref === 'number' || /^\d+$/.test(String(ref).trim())) {
    const n = Number(ref);
    return n >= 1 && n <= sorted.length ? { chapter: sorted[n - 1]!, index: n - 1 } : { index: sorted.length };
  }
  const key = normalizeName(String(ref));
  const i = sorted.findIndex((c) => normalizeName(c.title) === key || c.file === ref);
  return i >= 0 ? { chapter: sorted[i]!, index: i } : { index: sorted.length, title: String(ref).trim() };
}

/** The brief, as Markdown, for the chapter `target` names (or a new one after the last). */
export function chapterBrief(world: World, target: BriefTarget = {}): string {
  const ix = new WorldIndex(world);
  const cal = world.manifest.calendar;
  const perYear = monthsOf(cal).reduce((s, m) => s + m.days, 0);
  const sorted = sortChapters(world.story ?? []);
  const { chapter, index, title } = findTarget(sorted, target.chapter);
  const before = sorted.slice(0, index);
  const name = chapter?.title || title || '';
  const heading = chapter ? `chapter ${index + 1}, "${name}"` : name ? `a new chapter, "${name}"` : `a new chapter (chapter ${index + 1})`;

  // The date: the chapter's own, the one asked for, or else the date of the nearest chapter before it.
  const own = chapter ? chapterDate(chapter) : target.date?.trim() || undefined;
  const earlier = [...before].reverse().find((c) => ix.date(chapterDate(c)));
  const dateText = own ?? (earlier ? chapterDate(earlier) : undefined);
  const when: ParsedDate | undefined = ix.date(dateText);
  const at = when ? ix.fmt(when) : undefined;

  const out: string[] = [`# Brief for ${heading}${at ? `, set in ${at}` : ''}`];
  if (when && !own && earlier) out.push(`It has no date of its own; the chapter before it is set in ${at}. Give it a date when the story moves on.`);

  out.push('', '## The book\'s voice');
  const voice = world.manifest.writingStyle?.trim();
  out.push(voice || 'No writing style is set for this book: match the voice of the chapters before (or ask the user what they want).');

  out.push('', '## The story so far');
  if (!before.length) out.push('Nothing yet: this is the first chapter.');
  before.forEach((c, i) => {
    const d = ix.date(chapterDate(c));
    const names = [...new Set(ix.mentions.find(c.body).flatMap((m) => (m.ids.length === 1 ? [m.ids[0]!] : [])))].map((id) => ix.byIdOf(id)?.name).filter(Boolean).slice(0, 8);
    out.push(`${i + 1}. **${c.title || c.file}**${d ? ` (${ix.fmt(d)})` : ''}, ${wordCount(c.body)} words${names.length ? `; with ${names.join(', ')}` : ''}.`, `   Opens: ${first(c.body)}`, `   Ends: ${last(c.body)}`);
  });
  const prev = before[before.length - 1];
  if (prev?.body.trim()) out.push('', '## Where the chapter before ends', ending(prev.body));
  if (chapter?.body.trim()) out.push('', `## This chapter now`, `It has ${wordCount(chapter.body)} words; read_story gives its whole text.`);

  // People, places and events, on the date when there is one; else as the entries say.
  const characters = ix.entries.filter((e): e is Character => e.type === 'character');
  const here = new Set(chapter ? ix.mentions.find(chapter.body).flatMap((m) => m.ids) : []);
  const lately = new Set(prev ? ix.mentions.find(prev.body).flatMap((m) => m.ids) : []);
  const rank = (e: Entry): number => (here.has(e.id) ? 0 : lately.has(e.id) ? 1 : 2);
  const cast = [...characters].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, MAX_PEOPLE);
  const day = when?.lo;
  const living: string[] = [];
  const unborn: string[] = [];
  const dead: string[] = [];
  for (const c of cast) {
    const life = ix.life(c);
    const born = life.start?.date;
    const died = c.died ? ix.date(c.died) : undefined;
    if (day !== undefined && born && born.lo > day) { unborn.push(`${c.name} (born ${ix.fmt(born)})`); continue; }
    if (day !== undefined && died && died.hi < day) { dead.push(`${c.name} (died ${ix.fmt(died)})`); continue; }
    if (day === undefined && (died || c.status === 'dead')) { dead.push(died ? `${c.name} (died ${ix.fmt(died)})` : c.name); continue; }
    const parts: string[] = [];
    if (day !== undefined && born) parts.push(`${Math.max(0, Math.floor((day - born.lo) / perYear))} years old`);
    const home = livesIn(c, ix, day);
    if (home) parts.push(`lives in ${home}`);
    const look = when ? lookAt(c, when, ix) : undefined;
    if (look) {
      const changes = Object.entries(look.visual ?? {}).filter(([, v]) => v?.trim()).map(([k, v]) => `${k}: ${v!.trim()}`);
      parts.push(`looks as in "${look.name || look.id}"${look.reason?.trim() ? ` (${look.reason.trim()})` : ''}${changes.length ? `: ${changes.join('; ')}` : ''}`);
    }
    living.push(`- ${c.name}${c.summary ? `: ${first(c.summary, 100)}` : ''}${parts.length ? ` (${parts.join('; ')})` : ''}`);
  }
  out.push('', when ? `## People on ${at}` : '## People');
  out.push(...(living.length ? living : ['No one yet.']));
  if (unborn.length) out.push(`- Not born yet: ${unborn.join(', ')}.`);
  if (dead.length) out.push(`- Dead by then: ${dead.join(', ')}. They do not come back unless the story says how.`);
  if (characters.length > cast.length) out.push(`- And ${characters.length - cast.length} more; get_entry tells about anyone else.`);

  if (when) {
    const places = ix.entries.filter((e): e is Place => e.type === 'place');
    const gone = places.flatMap((p) => { const d = p.destroyed ? ix.date(p.destroyed) : undefined; return d && d.hi < when.lo ? [`${p.name} (destroyed ${ix.fmt(d)})`] : []; });
    const notYet = places.flatMap((p) => { const d = p.founded ? ix.date(p.founded) : undefined; return d && d.lo > when.hi ? [`${p.name} (founded ${ix.fmt(d)})`] : []; });
    if (gone.length || notYet.length) {
      out.push('', `## Places on ${at}`);
      if (gone.length) out.push(`- Gone by then: ${gone.join(', ')}.`);
      if (notYet.length) out.push(`- Not there yet: ${notYet.join(', ')}.`);
    }
  }

  const events = ix.entries
    .filter((e): e is LoreEvent => e.type === 'event')
    .flatMap((e) => { const life = ix.life(e); return life.start ? [{ e, from: life.start.date.lo, to: Math.max(life.start.date.hi, life.end?.date.hi ?? 0), text: life.end ? `${ix.fmt(life.start.date)} – ${ix.fmt(life.end.date)}` : ix.fmt(life.start.date) }] : []; })
    .sort((a, b) => a.from - b.from || a.e.name.localeCompare(b.e.name));
  const line = (x: (typeof events)[number]): string => `- ${x.e.name} (${x.text}${x.e.place ? `, at ${ix.nameOf(x.e.place)}` : ''})${x.e.summary ? `: ${first(x.e.summary, 120)}` : ''}`;
  if (when && events.length) {
    const now = events.filter((x) => x.from <= when.hi && x.to >= when.lo);
    const done = events.filter((x) => x.to < when.lo).slice(-MAX_EVENTS);
    const later = events.filter((x) => x.from > when.hi).slice(0, MAX_EVENTS);
    if (now.length) out.push('', `## Happening on ${at}`, ...now.map(line));
    if (done.length) out.push('', '## Already happened', ...done.map(line));
    if (later.length) out.push('', '## Still to come (do not let these happen early, and do not contradict them)', ...later.map(line));
  } else if (events.length) {
    out.push('', '## Events in the book, in order', ...events.slice(0, MAX_EVENTS * 2).map(line));
  }

  out.push('', '## When you write', [
    'Use the exact names of entries, so they link and the story is checked against them.',
    voice ? 'Keep to the voice above.' : 'Keep to the voice of the chapters before.',
    'Write plainly and concretely: no stock phrases ("a testament to", "a tapestry of", "little did they know"), no "It wasn\'t X. It was Y.", few dashes. check_book notes such phrasing (ai-phrasing); rewrite those sentences.',
    'Then run check_book and fix what it finds.',
  ].join(' '));
  return out.join('\n');
}

/** Where someone lives on a day: the stay that covers it (the latest starting one), else a stay without dates. */
function livesIn(c: Character, ix: WorldIndex, day: number | undefined): string | undefined {
  const stays = (c.locations ?? []).map((l) => ({ l, from: ix.date(l.from), to: ix.date(l.to) }));
  if (day !== undefined) {
    const now = stays.filter((s) => (!s.from || s.from.lo <= day) && (!s.to || s.to.hi >= day) && (s.from || s.to)).sort((a, b) => (b.from?.lo ?? -Infinity) - (a.from?.lo ?? -Infinity))[0];
    if (now) return ix.nameOf(now.l.place);
  }
  const plain = stays.find((s) => !s.from && !s.to);
  return plain ? ix.nameOf(plain.l.place) : undefined;
}
