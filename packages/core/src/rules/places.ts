import { definitelyBefore, type ParsedDate } from '../dates.ts';
import { certainSpan, when } from '../appearances.ts';
import type { Finding, Rule } from '../engine.ts';
import type { FactRef } from '../types.ts';

export const placeNotExisting: Rule = {
  id: 'place-not-existing',
  title: 'Place used when it does not exist',
  description: 'An event happens at, or a character is in, a place before it was founded or after it was destroyed.',
  severity: 'error',
  check: ({ ix }) => {
    const out: Finding[] = [];
    const test = (placeRef: string, from: ParsedDate, to: ParsedDate, subject: string, key: string, at: FactRef): void => {
      const place = ix.resolve(placeRef);
      if (!place || place.type !== 'place') return;
      const life = ix.life(place);
      const span = { from, to };
      for (const [point, broken] of [
        [life.start, life.start && definitelyBefore(from, life.start.date)],
        [life.end, life.end && definitelyBefore(life.end.date, to)],
      ] as const) {
        if (!point || !broken) continue;
        out.push({ key, message: `${subject} ${place.name} ${when(ix, span)}: ${place.name} ${point.word} ${ix.at(point.date)} (source: ${ix.source(place)}).`, offending: at, conflicting: ix.fact(place, point.field) });
        return;
      }
    };
    for (const e of ix.entries) {
      if (e.type === 'event' && e.place) {
        const from = ix.date(e.date);
        if (from) test(e.place, from, ix.date(e.end) ?? from, `"${e.name}" can't happen at`, e.id, ix.fact(e, 'place'));
      }
      if (e.type === 'character') {
        e.locations?.forEach((l, i) => {
          const from = ix.date(l.from) ?? ix.date(l.to);
          const to = ix.date(l.to) ?? from;
          if (from && to) test(l.place, from, to, `${e.name} can't be in`, `${e.id}:locations:${i}`, ix.fact(e, `locations[${i}]`));
        });
      }
    }
    return out;
  },
};

export const twoPlacesAtOnce: Rule = {
  id: 'two-places-at-once',
  title: 'In two places at once',
  description: 'The same character is certainly in two different places at the same time (day-precise events or overlapping stays).',
  severity: 'warning',
  check: ({ ix, appearances }) => {
    const out: Finding[] = [];
    const placed = appearances.filter((a) => a.who.type === 'character' && a.where !== undefined && certainSpan(a));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        if (a.who.id !== b.who.id) continue;
        const sa = certainSpan(a)!;
        const sb = certainSpan(b)!;
        if (Math.max(sa.lo, sb.lo) > Math.min(sa.hi, sb.hi)) continue;
        const pa = ix.resolve(a.where);
        const pb = ix.resolve(b.where);
        if (!pa || !pb || ix.within(pa, pb) || ix.within(pb, pa)) continue;
        const [first, second] = [a, b].sort((x, y) => x.key.localeCompare(y.key)) as [typeof a, typeof b];
        const doing = (x: typeof a, p: typeof pa): string => (x.kind === 'location' ? x.phrase : `${x.phrase} at ${p.name}`);
        out.push({
          key: `${first.key}|${second.key}`,
          message: `${a.who.name} can't ${doing(a, pa)} ${when(ix, a)} and also ${doing(b, pb)} ${when(ix, b)}: those overlap in time (source: ${b.at.source}).`,
          offending: a.at,
          conflicting: b.at,
        });
      }
    }
    return out;
  },
};
