import { parseDate } from './dates.ts';
import { WorldIndex } from './world-index.ts';
import type { Calendar, World } from './types.ts';

/** Era codes are what dates are written with ("312 OK"): a letter, then letters, digits or _. */
export const ERA_CODE_RE = /^[A-Za-z]\w*$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** The last absolute year of each era: its own `end`, else the year before the next era starts, else open. */
export function eraEnds(cal: Calendar): Map<string, number | undefined> {
  const sorted = [...cal.eras].sort((a, b) => a.start - b.start);
  return new Map(sorted.map((e, i) => [e.id, e.end ?? (i + 1 < sorted.length ? sorted[i + 1]!.start - 1 : undefined)]));
}

/**
 * What is wrong with a calendar, in plain sentences; empty when it can be saved. Eras may not overlap: a date has to
 * fall in exactly one era for the timeline and the Story Book chapters. Gaps between eras are fine.
 */
export function calendarProblems(cal: Calendar): string[] {
  const out: string[] = [];
  if (!cal.eras.length) out.push('Add at least one era.');
  const seen = new Set<string>();
  for (const e of cal.eras) {
    const who = e.name.trim() || e.id || 'An era';
    if (!e.name.trim()) out.push(`Era ${e.id || '(no code)'} needs a name.`);
    if (!ERA_CODE_RE.test(e.id)) out.push(`${who}: the abbreviation must start with a letter and use only letters, digits or _ (e.g. AS).`);
    else if (seen.has(e.id.toLowerCase())) out.push(`Two eras use the abbreviation ${e.id}.`);
    seen.add(e.id.toLowerCase());
    if (!Number.isInteger(e.start)) out.push(`${who}: the start year must be a whole number.`);
    if (e.end !== undefined && (!Number.isInteger(e.end) || e.end < e.start)) out.push(`${who}: the end year must be a whole number, not before the start (${e.start}).`);
    if (e.color !== undefined && !HEX_RE.test(e.color)) out.push(`${who}: the colour must be #rrggbb.`);
  }
  const sorted = [...cal.eras].filter((e) => Number.isInteger(e.start)).sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (a.start === b.start) out.push(`${a.name || a.id} and ${b.name || b.id} start in the same year (${a.start}).`);
    else if (a.end !== undefined && a.end >= b.start) out.push(`${a.name || a.id} ends in ${a.end}, after ${b.name || b.id} starts in ${b.start}: eras may not overlap.`);
  }
  if (!cal.eras.some((e) => e.id === cal.defaultEra)) out.push('Pick the default era (used when a date has no era code).');
  (cal.months ?? []).forEach((m, i) => {
    if (!m.name.trim()) out.push(`Month ${i + 1} needs a name.`);
    if (!Number.isInteger(m.days) || m.days < 1) out.push(`${m.name.trim() || `Month ${i + 1}`}: days must be a whole number of at least 1.`);
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
