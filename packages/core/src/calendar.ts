import { parseDate, type ParsedDate } from './dates.ts';
import { msg } from './i18n.ts';
import { WorldIndex } from './world-index.ts';
import type { Calendar, Era, Month, World } from './types.ts';

/** Era codes are what dates are written with ("312 OK"): a letter, then letters, digits or _. */
export const ERA_CODE_RE = /^[A-Za-z]\w*$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** The last absolute year of each era: its own `end`, else the year before the next era starts, else open. */
export function eraEnds(cal: Calendar): Map<string, number | undefined> {
  const sorted = [...cal.eras].sort((a, b) => a.start - b.start);
  return new Map(sorted.map((e, i) => [e.id, e.end ?? (i + 1 < sorted.length ? sorted[i + 1]!.start - 1 : undefined)]));
}

/** Each era with its last absolute year (see eraEnds), by era id. */
export function eraBounds(cal: Calendar): Map<string, { era: Era; last: number | undefined }> {
  const ends = eraEnds(cal);
  return new Map(cal.eras.map((era) => {
    const last = ends.get(era.id);
    return [era.id, { era, last: typeof last === 'number' && Number.isFinite(last) ? last : undefined }];
  }));
}

/**
 * Why a readable date lies outside its era, or undefined when it fits. Era years start at 1 ("0 AS" and "-5 AS"
 * are before the era), and an era ends at its `end` or the year before the next era starts ("1500 OK" when the
 * next era starts 1000 years after OK). Pass `bounds` (from eraBounds) when checking many dates.
 */
export function eraRangeProblem(text: string, d: ParsedDate, cal: Calendar, bounds: ReadonlyMap<string, { era: Era; last: number | undefined }> = eraBounds(cal)): string | undefined {
  const b = bounds.get(d.era);
  if (!b) return undefined;
  const { era, last } = b;
  const after = last !== undefined && era.start + d.year - 1 > last;
  // Years before the first era has nothing earlier to be written in: "-12" counts back from the start, as in a world
  // with one era. Before a later era, the earlier era is the one to use, so that is flagged.
  const first = cal.eras.every((e) => e === era || !(e.start < era.start));
  if ((d.year >= 1 || first) && !after) return undefined;
  const year = (y: number) => (era.id === cal.defaultEra ? `${y}` : `${y} ${era.id}`);
  if (d.year < 1) return msg`"${text.trim()}" is before ${era.name} began: its first year is ${year(1)}.`;
  return msg`"${text.trim()}" is after ${era.name} ended: its last year is ${year(last! - era.start + 1)}.`;
}

/**
 * What is wrong with a calendar, in plain sentences; empty when it can be saved. Eras may not overlap: a date has to
 * fall in exactly one era for the timeline and the Story Book chapters. Gaps between eras are fine.
 */
export function calendarProblems(cal: Calendar): string[] {
  const out: string[] = [];
  if (!cal.eras.length) out.push(msg`Add at least one era.`);
  const seen = new Set<string>();
  for (const e of cal.eras) {
    const who = e.name.trim() || e.id || msg`An era`;
    if (!e.name.trim()) out.push(e.id ? msg`Era ${e.id} needs a name.` : msg`Era (no code) needs a name.`);
    if (!ERA_CODE_RE.test(e.id)) out.push(msg`${who}: the abbreviation must start with a letter and use only letters, digits or _ (e.g. AS).`);
    else if (seen.has(e.id.toLowerCase())) out.push(msg`Two eras use the abbreviation ${e.id}.`);
    seen.add(e.id.toLowerCase());
    if (!Number.isInteger(e.start)) out.push(msg`${who}: the start year must be a whole number.`);
    if (e.end !== undefined && (!Number.isInteger(e.end) || e.end < e.start)) out.push(msg`${who}: the end year must be a whole number, not before the start (${e.start}).`);
    if (e.color !== undefined && !HEX_RE.test(e.color)) out.push(msg`${who}: the colour must be #rrggbb.`);
  }
  const sorted = [...cal.eras].filter((e) => Number.isInteger(e.start)).sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (a.start === b.start) out.push(msg`${a.name || a.id} and ${b.name || b.id} start in the same year (${a.start}).`);
    else if (a.end !== undefined && a.end >= b.start) out.push(msg`${a.name || a.id} ends in ${a.end}, after ${b.name || b.id} starts in ${b.start}: eras may not overlap.`);
  }
  if (!cal.eras.some((e) => e.id === cal.defaultEra)) out.push(msg`Pick the default era (used when a date has no era code).`);
  const months: unknown = cal.months;
  if (months !== undefined && !Array.isArray(months)) out.push(msg`The months must be a list.`);
  (Array.isArray(months) ? (months as Partial<Month>[]) : []).forEach((m, i) => {
    const name = typeof m?.name === 'string' ? m.name.trim() : '';
    if (!name) out.push(msg`Month ${i + 1} needs a name.`);
    if (!Number.isInteger(m?.days) || m!.days! < 1) out.push(name ? msg`${name}: days must be a whole number of at least 1.` : msg`Month ${i + 1}: days must be a whole number of at least 1.`);
  });
  return out;
}

/** How many dates in the world are written in each era (an explicit code, or no code for the default era). */
export function eraUsage(world: World): Map<string, number> {
  const cal = world.manifest.calendar;
  const ix = new WorldIndex(world);
  const count = new Map(cal.eras.map((e) => [e.id, 0]));
  const texts = [...world.entries.flatMap((e) => ix.dateFields(e).map(([, t]) => t)), ...(world.story ?? []).flatMap((c) => (c.date ? [c.date] : []))];
  for (const t of texts) {
    const r = parseDate(t, cal);
    if (r.kind === 'date') count.set(r.date.era, (count.get(r.date.era) ?? 0) + 1);
  }
  return count;
}
