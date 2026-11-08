/**
 * Looks: how an entry looks for a while (after a war, in coronation robes), each with its own pictures and 3D models
 * and, for what changes, its own visual description. The Default look is the entry itself: its visual description,
 * and the pictures and models that name no look. A look says why it differs and when it applies: between dates, in
 * an era, after or before an event (or any entry with a date), or any mix of them (the time they all leave open).
 * A look after an event starts once the event is over, and one before an event ends as it begins, so the event itself
 * shows the look the entry had going in: "before the war" and "after the war" never clash.
 */
import { eraEnds } from './calendar.ts';
import { monthsOf, type ParsedDate } from './dates.ts';
import { joined, msg } from './i18n.ts';
import type { Entry, Look, RefImage } from './types.ts';
import type { WorldIndex } from './world-index.ts';

/** The time a look applies, in absolute days (inclusive). An end that is not set is open. */
export interface LookSpan {
  lo?: number;
  hi?: number;
}

/** A point a look starts or ends at, and what set it. */
export interface LookPoint {
  date: ParsedDate;
  /** "from", "to", "after" or "before": the field of the look that gives this point. */
  field: 'from' | 'to' | 'after' | 'before';
}

/**
 * When an entry's look starts or ends because of another entry: the end of an event (or its date) for "after", its
 * start for "before"; for other entries their life (died, destroyed, ... for "after"; born, founded, ... for
 * "before"). Undefined when that entry has no such date.
 */
export function pointOf(target: Entry, side: 'after' | 'before', ix: WorldIndex): ParsedDate | undefined {
  if (target.type === 'event' || target.type === 'note') {
    const start = ix.date(target.date);
    return side === 'after' && target.type === 'event' ? ix.date(target.end) ?? start : start;
  }
  const life = ix.life(target);
  return side === 'after' ? life.end?.date : life.start?.date;
}

/** The first day a look can have from this point: "after" an entry means once it is over, so the day after it. */
function firstDay(p: LookPoint): number {
  return p.field === 'after' ? p.date.hi + 1 : p.date.lo;
}

/** The last day a look can have up to this point: "before" an entry means until it begins, so the day before it. */
function lastDay(p: LookPoint): number {
  return p.field === 'before' ? p.date.lo - 1 : p.date.hi;
}

/** Where a look starts: its "from" date or the "after" entry, whichever comes later. Eras do not count here. */
export function lookStart(look: Look, ix: WorldIndex): LookPoint | undefined {
  const from = ix.date(look.from);
  const after = look.after?.trim() ? ix.resolve(look.after) : undefined;
  const a = after ? pointOf(after, 'after', ix) : undefined;
  const f: LookPoint | undefined = from && { date: from, field: 'from' };
  const p: LookPoint | undefined = a && { date: a, field: 'after' };
  return f && p ? (firstDay(f) >= firstDay(p) ? f : p) : f ?? p;
}

/** Where a look ends: its "to" date or the "before" entry, whichever comes first. Eras do not count here. */
export function lookEnd(look: Look, ix: WorldIndex): LookPoint | undefined {
  const to = ix.date(look.to);
  const before = look.before?.trim() ? ix.resolve(look.before) : undefined;
  const b = before ? pointOf(before, 'before', ix) : undefined;
  const t: LookPoint | undefined = to && { date: to, field: 'to' };
  const p: LookPoint | undefined = b && { date: b, field: 'before' };
  return t && p ? (lastDay(t) <= lastDay(p) ? t : p) : t ?? p;
}

/** The days an era covers, from its first year to its last (open when it never ends). */
function eraSpan(eraId: string, ix: WorldIndex): LookSpan | undefined {
  const cal = ix.world.manifest.calendar;
  const era = cal.eras.find((e) => e.id.toLowerCase() === eraId.trim().toLowerCase());
  if (!era) return undefined;
  const perYear = monthsOf(cal).reduce((n, m) => n + m.days, 0);
  const last = eraEnds(cal).get(era.id);
  return { lo: era.start * perYear, ...(typeof last === 'number' && Number.isFinite(last) ? { hi: (last + 1) * perYear - 1 } : {}) };
}

/**
 * When a look applies, or undefined when it names no time at all (a look that is not tied to a time). Every part it
 * names narrows it: "from 512" and "in the Third Age" together mean from 512 while the Third Age lasts.
 */
export function lookSpan(look: Look, ix: WorldIndex): LookSpan | undefined {
  const lows: number[] = [];
  const highs: number[] = [];
  const start = lookStart(look, ix);
  if (start) lows.push(firstDay(start));
  const end = lookEnd(look, ix);
  if (end) highs.push(lastDay(end));
  if (look.era?.trim()) {
    const era = eraSpan(look.era, ix);
    if (era?.lo !== undefined) lows.push(era.lo);
    if (era?.hi !== undefined) highs.push(era.hi);
  }
  if (!lows.length && !highs.length) return undefined;
  return { ...(lows.length ? { lo: Math.max(...lows) } : {}), ...(highs.length ? { hi: Math.min(...highs) } : {}) };
}

/**
 * The look an entry has on a date: of the looks whose time covers it, the one that started last (the newest change),
 * so "after the war" gives way to "old age" once that starts. Undefined: the Default look.
 */
export function lookAt(entry: Entry, when: ParsedDate, ix: WorldIndex): Look | undefined {
  let best: { look: Look; lo: number } | undefined;
  for (const look of entry.looks ?? []) {
    const s = lookSpan(look, ix);
    if (!s || (s.lo ?? -Infinity) > when.hi || (s.hi ?? Infinity) < when.lo) continue;
    const lo = s.lo ?? -Infinity;
    if (!best || lo > best.lo) best = { look, lo };
  }
  return best?.look;
}

/** A look's visual description: the Default look's, with the fields the look changes. */
export function lookVisual(entry: Entry, look: Look | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries({ ...entry.visual, ...look?.visual }).filter(([, v]) => typeof v === 'string' && v.trim() !== ''));
}

/** Which look a picture belongs to: its look when the entry has it, else the Default look (undefined). */
export function imageLook(entry: Entry, img: RefImage): Look | undefined {
  return img.look ? entry.looks?.find((l) => l.id === img.look) : undefined;
}

/** An entry's pictures for one look (undefined: the Default look, which also keeps pictures of a look that is gone). */
export function lookImages(entry: Entry, look: Look | undefined): RefImage[] {
  return (entry.images ?? []).filter((img) => imageLook(entry, img) === look);
}

/** A free id for a new look of an entry, from its name: "after-the-war", then "after-the-war-2", ... */
export function newLookId(entry: Entry, name: string): string {
  const base = name.replace(/ı/g, 'i').replace(/İ/g, 'I').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'look';
  const taken = new Set((entry.looks ?? []).map((l) => l.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** When a look applies, in words ("after The Battle of Gate", "from 512 to 530", "in the Third Age"); '' for no time. */
export function lookWhen(look: Look, ix: WorldIndex): string {
  const parts: string[] = [];
  const from = look.from?.trim() ? ix.date(look.from) : undefined;
  const to = look.to?.trim() ? ix.date(look.to) : undefined;
  if (from && to) parts.push(msg`from ${ix.fmt(from)} to ${ix.fmt(to)}`);
  else if (from) parts.push(msg`from ${ix.fmt(from)}`);
  else if (to) parts.push(msg`until ${ix.fmt(to)}`);
  if (look.era?.trim()) {
    const era = ix.world.manifest.calendar.eras.find((e) => e.id.toLowerCase() === look.era!.trim().toLowerCase());
    parts.push(msg`during ${era?.name ?? look.era.trim()}`);
  }
  if (look.after?.trim()) parts.push(msg`after ${ix.nameOf(look.after.trim())}`);
  if (look.before?.trim()) parts.push(msg`before ${ix.nameOf(look.before.trim())}`);
  return parts.length ? joined(parts, ', ') : '';
}
