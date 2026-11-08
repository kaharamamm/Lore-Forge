import { definitelyBefore, type ParsedDate } from '../dates.ts';
import { when, type Appearance } from '../appearances.ts';
import type { Finding, Rule } from '../engine.ts';
import { msg } from '../i18n.ts';
import type { FactRef } from '../types.ts';

export const placeNotExisting: Rule = {
  id: 'place-not-existing',
  title: 'Place used when it does not exist',
  description: 'An event happens at, or a character is in, a place before it was founded or after it was destroyed.',
  severity: 'error',
  check: ({ ix }) => {
    const out: Finding[] = [];
    /** The message, from the place's name, when it is used, how its life starts or ends, when, and the source. */
    type Say = (place: string, when: string, word: string, at: string, source: string) => string;
    /** `overlap`: an event only has to overlap the place's life; a stay has to fit inside it. */
    const test = (placeRef: string, from: ParsedDate, to: ParsedDate, overlap: boolean, say: Say, key: () => string, legacyKey: string | undefined, at: () => FactRef): void => {
      const place = ix.resolve(placeRef);
      if (!place || place.type !== 'place') return;
      const { start, end } = ix.life(place);
      const point = start && definitelyBefore(overlap ? to : from, start.date) ? start : end && definitelyBefore(end.date, overlap ? from : to) ? end : undefined;
      if (!point) return;
      out.push({ key: key(), ...(legacyKey !== undefined ? { legacyKey } : {}), message: say(place.name, when(ix, { from, to }), point.word, ix.at(point.date), ix.source(place)), offending: at(), conflicting: ix.fact(place, point.field) });
    };
    for (const e of ix.entries) {
      if (e.type === 'event' && e.place) {
        const from = ix.date(e.date);
        const say: Say = (p, w, word, at, source) => msg`"${e.name}" can't happen at ${p} ${w}: ${p} ${word} ${at} (source: ${source}).`;
        if (from) test(e.place, from, ix.date(e.end) ?? from, true, say, () => e.id, undefined, () => ix.fact(e, 'place'));
      }
      if (e.type === 'character') {
        const say: Say = (p, w, word, at, source) => msg`${e.name} can't be in ${p} ${w}: ${p} ${word} ${at} (source: ${source}).`;
        e.locations?.forEach((l, i) => {
          const from = ix.date(l.from) ?? ix.date(l.to);
          const to = ix.date(l.to) ?? from;
          if (from && to) test(l.place, from, to, false, say, () => `${e.id}:${ix.rowKeys(e).locations[i]}`, `${e.id}:locations:${i}`, () => ix.fact(e, `locations[${i}]`));
        });
      }
    }
    return out;
  },
};

/** A stay covers its first and last day only partly (the days of travel); this day is strictly inside it. */
const inside = (a: Appearance, day: number): boolean => a.kind === 'location' && a.certain !== undefined && a.certain.lo < day && day < a.certain.hi;

export const twoPlacesAtOnce: Rule = {
  id: 'two-places-at-once',
  title: 'In two places at once',
  description: 'The same character is certainly in two different places at the same time (day-precise events or overlapping stays).',
  severity: 'warning',
  check: ({ ix, appearances }) => {
    const out: Finding[] = [];
    // Per character, sorted by start: each appearance is only compared with the ones that start before it ends.
    const byWho = new Map<string, { a: Appearance; n: number; lo: number; hi: number }[]>();
    appearances.forEach((a, n) => {
      if (a.who.type !== 'character' || a.where === undefined || !a.certain) return;
      const item = { a, n, lo: a.certain.lo, hi: a.certain.hi };
      const list = byWho.get(a.who.id);
      if (list) list.push(item);
      else byWho.set(a.who.id, [item]);
    });
    for (const list of byWho.values()) {
      if (list.length < 2) continue;
      list.sort((x, y) => x.lo - y.lo || x.n - y.n);
      for (let i = 0; i < list.length; i++) {
        const x = list[i]!;
        for (let j = i + 1; j < list.length && list[j]!.lo <= x.hi; j++) {
          const y = list[j]!;
          // Both are certain from y.lo to the earlier end. One shared day is a travel day when it is the first or
          // last day of the stays involved (leave Qarim on the 12th, reach Saltmere on the 12th); two events on the
          // same day, or a day in the middle of a stay, still clash.
          const last = Math.min(x.hi, y.hi);
          if (y.lo === last && !(x.a.kind === 'event' && y.a.kind === 'event') && !inside(x.a, last) && !inside(y.a, last)) continue;
          const [a, b] = x.n < y.n ? [x.a, y.a] : [y.a, x.a];
          const pa = ix.resolve(a.where);
          const pb = ix.resolve(b.where);
          if (!pa || !pb || ix.within(pa, pb) || ix.within(pb, pa)) continue;
          const [first, second] = [a, b].sort((p, q) => p.key.localeCompare(q.key)) as [Appearance, Appearance];
          const doing = (p: Appearance, place: typeof pa): string => (p.kind === 'location' ? p.phrase : msg`${p.phrase} at ${place.name}`);
          const f: Finding = {
            key: `${first.key}|${second.key}`,
            message: msg`${a.who.name} can't ${doing(a, pa)} ${when(ix, a)} and also ${doing(b, pb)} ${when(ix, b)}: those overlap in time (source: ${b.at.source}).`,
            offending: a.at,
            conflicting: b.at,
          };
          if (a.legacyKey !== undefined || b.legacyKey !== undefined) {
            const [l1, l2] = [a.legacyKey ?? a.key, b.legacyKey ?? b.key].sort((p, q) => p.localeCompare(q));
            f.legacyKey = `${l1}|${l2}`;
          }
          out.push(f);
        }
      }
    }
    return out;
  },
};
