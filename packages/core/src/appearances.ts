import type { ParsedDate } from './dates.ts';
import type { Entry, FactRef } from './types.ts';
import { activePhrase, passivePhrase } from './verbs.ts';
import type { WorldIndex } from './world-index.ts';

/** One dated moment or span where an entry does something or is somewhere. */
export interface Appearance {
  who: Entry;
  kind: 'event' | 'location' | 'relation';
  from: ParsedDate;
  to: ParsedDate;
  /** Place id/name, when known. */
  where?: string;
  /** What the entry does, in base form: "kill Queen Ilsa", "be in Saltmere". */
  phrase: string;
  /** The fact this appearance comes from. */
  at: FactRef;
  /** Stable key piece for warning ids. */
  key: string;
}

/** Everything dated that entries do, gathered from events, locations and dated relations. */
export function appearances(ix: WorldIndex): Appearance[] {
  const out: Appearance[] = [];
  for (const e of ix.entries) {
    if (e.type === 'event') {
      const from = ix.date(e.date);
      if (!from) continue;
      const to = ix.date(e.end) ?? from;
      // One appearance per involved entry per event: actor beats target beats plain participant.
      const seen = new Set<string>();
      const add = (ref: string, phrase: string, field: string): void => {
        const who = ix.resolve(ref);
        if (!who || seen.has(who.id)) return;
        seen.add(who.id);
        const a: Appearance = { who, kind: 'event', from, to, phrase, at: ix.fact(e, field), key: `${e.id}:${who.id}` };
        if (e.place !== undefined) a.where = e.place;
        out.push(a);
      };
      e.actions?.forEach((act, i) => {
        add(act.actor, activePhrase(act.verb, ix.nameOf(act.actor), act.target && ix.nameOf(act.target)), `actions[${i}]`);
      });
      e.actions?.forEach((act, i) => {
        if (act.target) add(act.target, passivePhrase(act.verb, ix.nameOf(act.actor), ix.nameOf(act.target)), `actions[${i}]`);
      });
      e.participants?.forEach((p, i) => add(p.id, `take part in "${e.name}"`, `participants[${i}]`));
    }
    if (e.type === 'character') {
      e.locations?.forEach((l, i) => {
        const from = ix.date(l.from) ?? ix.date(l.to);
        const to = ix.date(l.to) ?? from;
        if (!from || !to) return;
        out.push({ who: e, kind: 'location', from, to, where: l.place, phrase: `be in ${ix.nameOf(l.place)}`, at: ix.fact(e, `locations[${i}]`), key: `${e.id}:locations:${i}` });
      });
    }
    e.relations?.forEach((r, i) => {
      const from = ix.date(r.from);
      if (!from) return;
      const to = ix.date(r.to) ?? from;
      const at = ix.fact(e, `relations[${i}]`);
      out.push({ who: e, kind: 'relation', from, to, phrase: activePhrase(r.type, e.name, ix.nameOf(r.target)), at, key: `${e.id}:relations:${i}` });
      const target = ix.resolve(r.target);
      if (target && r.type === 'killed') {
        out.push({ who: target, kind: 'relation', from, to: from, phrase: passivePhrase(r.type, e.name, target.name), at, key: `${e.id}:relations:${i}:target` });
      }
    });
  }
  return out;
}

/** "in 1920", or "from 1760 to 1790" for spans. */
export function when(ix: WorldIndex, a: Pick<Appearance, 'from' | 'to'>): string {
  return a.from.lo === a.to.lo && a.from.hi === a.to.hi ? ix.at(a.from) : `from ${ix.fmt(a.from)} to ${ix.fmt(a.to)}`;
}

/** The span during which the appearance certainly holds, if any (used for "two places at once"). */
export function certainSpan(a: Appearance): { lo: number; hi: number } | undefined {
  if (a.kind === 'event') {
    const point = a.from === a.to;
    return point && a.from.precision === 'day' && !a.from.approx ? { lo: a.from.lo, hi: a.from.hi } : undefined;
  }
  if (a.kind === 'location' && a.from !== a.to && a.from.hi <= a.to.lo) return { lo: a.from.hi, hi: a.to.lo };
  return undefined;
}
