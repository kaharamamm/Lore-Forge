import { monthsOf, type ParsedDate } from '../dates.ts';
import { isEnded } from '../lifecycle.ts';
import type { Calendar, Entry, EntryType, Severity, Warning, World } from '../types.ts';
import { WorldIndex } from '../world-index.ts';

export interface TimelineLane {
  entry: Entry;
  /** Absolute days on the world axis. */
  from: number;
  to: number;
  /** No start / end date: the bar fades out at that side. */
  openStart: boolean;
  openEnd: boolean;
  /** A single moment (an event without an end, a dated note). */
  point: boolean;
  dates: string;
  ended: boolean;
  /** Current (not intended) warnings that involve this entry. */
  warnings: Warning[];
  worst?: Severity;
}

export interface EraBand {
  id: string;
  name: string;
  from: number;
  to: number;
}

export interface TimelineGroup {
  type: EntryType;
  lanes: TimelineLane[];
}

export interface TimelineModel {
  min: number;
  max: number;
  daysPerYear: number;
  eras: EraBand[];
  groups: TimelineGroup[];
}

const ORDER: EntryType[] = ['character', 'faction', 'place', 'item', 'event', 'note'];
const RANK: Record<Severity, number> = { error: 3, warning: 2, info: 1 };

export const involvesEntry = (w: Warning, id: string): boolean => w.offending.entryId === id || w.conflicting?.entryId === id;

/** Everything dated, as lanes grouped by type, with era bands across the visible range. */
export function timelineModel(world: World, warnings: readonly Warning[]): TimelineModel | undefined {
  const ix = new WorldIndex(world);
  const cal = world.manifest.calendar;
  const perYear = monthsOf(cal).reduce((s, m) => s + m.days, 0);
  const raw: { entry: Entry; start?: ParsedDate; end?: ParsedDate }[] = [];
  for (const e of ix.entries) {
    const life = ix.life(e);
    if (life.start || life.end) raw.push({ entry: e, start: life.start?.date, end: life.end?.date });
  }
  const dated = raw.flatMap((r) => [r.start, r.end]).filter((d): d is ParsedDate => !!d);
  if (!dated.length) return undefined;
  let min = Math.min(...dated.map((d) => d.lo));
  let max = Math.max(...dated.map((d) => d.hi));
  const pad = Math.max((max - min) * 0.04, perYear);
  min = Math.floor(min - pad);
  max = Math.ceil(max + pad);
  const groups: TimelineGroup[] = ORDER.map((type) => ({
    type,
    lanes: raw
      .filter((r) => r.entry.type === type)
      .map((r): TimelineLane => {
        const point = (type === 'event' || type === 'note') && !r.end;
        const from = r.start ? r.start.lo : min;
        const to = point ? r.start!.hi : r.end ? r.end.hi : max;
        const ws = warnings.filter((w) => !w.intended && involvesEntry(w, r.entry.id));
        const worst = ws.reduce<Severity | undefined>((acc, w) => (!acc || RANK[w.severity] > RANK[acc] ? w.severity : acc), undefined);
        const dates = point
          ? ix.fmt(r.start!)
          : `${r.start ? ix.fmt(r.start) : '?'} – ${r.end ? ix.fmt(r.end) : type === 'event' ? '' : '?'}`.trim();
        return { entry: r.entry, from, to: Math.max(to, from), openStart: !r.start, openEnd: !point && !r.end, point, dates, ended: isEnded(r.entry), warnings: ws, ...(worst ? { worst } : {}) };
      })
      .sort((a, b) => a.from - b.from || a.entry.name.localeCompare(b.entry.name)),
  })).filter((g) => g.lanes.length);
  const eras = [...cal.eras].sort((a, b) => a.start - b.start);
  const bands: EraBand[] = eras
    .map((e, i) => ({ id: e.id, name: e.name, from: e.start * perYear, to: i + 1 < eras.length ? eras[i + 1]!.start * perYear - 1 : max }))
    .map((b, i) => (i === 0 ? { ...b, from: Math.min(b.from, min) } : b))
    .filter((b) => b.to >= min && b.from <= max)
    .map((b) => ({ ...b, from: Math.max(b.from, min), to: Math.min(b.to, max) }));
  return { min, max, daysPerYear: perYear, eras: bands, groups };
}

/** Absolute day -> "1800" or "410 OK", using the era that contains it. */
export function yearLabel(day: number, cal: Calendar): string {
  const perYear = monthsOf(cal).reduce((s, m) => s + m.days, 0);
  const abs = Math.floor(day / perYear);
  const eras = [...cal.eras].sort((a, b) => a.start - b.start);
  const era = [...eras].reverse().find((e) => e.start <= abs) ?? eras[0]!;
  const y = abs - era.start + 1;
  return era.id === cal.defaultEra ? String(y) : `${y} ${era.id}`;
}

/** Year ticks at a round step so labels are at least `minGapPx` apart at `pxPerYear`. */
export function yearTicks(model: TimelineModel, pxPerYear: number, minGapPx = 80): { day: number; years: number }[] {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  const step = steps.find((s) => s * pxPerYear >= minGapPx) ?? steps.at(-1)!;
  const firstYear = Math.ceil(model.min / model.daysPerYear / step) * step;
  const out: { day: number; years: number }[] = [];
  for (let y = firstYear; y * model.daysPerYear <= model.max; y += step) out.push({ day: y * model.daysPerYear, years: step });
  return out;
}
