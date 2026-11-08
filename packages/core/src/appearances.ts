import type { ParsedDate } from './dates.ts';
import { msg } from './i18n.ts';
import { relationKind } from './relation-kinds.ts';
import type { Entry, FactRef } from './types.ts';
import { activePhrase, passivePhrase } from './verbs.ts';
import type { WorldIndex } from './world-index.ts';

/**
 * One dated moment or span where an entry does something or is somewhere. `phrase`, `at`, `key` and `legacyKey`
 * are only worked out when read: most appearances never end up in a warning, and the check runs on every keystroke.
 */
export interface Appearance {
  who: Entry;
  kind: 'event' | 'location' | 'relation';
  from: ParsedDate;
  to: ParsedDate;
  /** Place id/name, when known. */
  where?: string;
  /** What the entry does, in base form: "kill Queen Ilsa", "be in Saltmere". */
  readonly phrase: string;
  /** The fact this appearance comes from. */
  readonly at: FactRef;
  /** Stable key piece for warning ids, built from content (see WorldIndex.rowKeys), never from list positions. */
  readonly key: string;
  /** The key older versions used (with the row's list position), for intended marks made back then. */
  readonly legacyKey?: string;
  /** The span during which the appearance certainly holds (see certainSpan). */
  certain?: { lo: number; hi: number };
}

/** Where an appearance comes from: the event's actor, target or participant, a stay, a dated relation, or its victim. */
type Source = 'actor' | 'target' | 'participant' | 'stay' | 'relation' | 'victim';

class Seen implements Appearance {
  readonly who: Entry;
  readonly kind: Appearance['kind'];
  readonly from: ParsedDate;
  readonly to: ParsedDate;
  where?: string;
  certain?: { lo: number; hi: number };
  readonly #ix: WorldIndex;
  /** The entry holding the fact: the event, the character with the stay, the entry with the relation. */
  readonly #in: Entry;
  readonly #source: Source;
  /** Position in the list the fact sits in (actions, participants, locations or relations). */
  readonly #i: number;

  constructor(ix: WorldIndex, who: Entry, kind: Appearance['kind'], from: ParsedDate, to: ParsedDate, holder: Entry, source: Source, i: number) {
    this.#ix = ix;
    this.who = who;
    this.kind = kind;
    this.from = from;
    this.to = to;
    this.#in = holder;
    this.#source = source;
    this.#i = i;
  }

  get phrase(): string {
    const ix = this.#ix;
    const e = this.#in;
    const i = this.#i;
    switch (this.#source) {
      case 'actor':
      case 'target': {
        const act = (e.type === 'event' ? e.actions : undefined)![i]!;
        return this.#source === 'actor'
          ? activePhrase(act.verb, ix.nameOf(act.actor), act.target && ix.nameOf(act.target), ix.resolve(act.target)?.type)
          : passivePhrase(act.verb, ix.nameOf(act.actor), ix.nameOf(act.target!), this.who.type);
      }
      case 'participant':
        return msg`take part in "${e.name}"`;
      case 'stay':
        return msg`be in ${ix.nameOf((e.type === 'character' ? e.locations : undefined)![i]!.place)}`;
      case 'relation': {
        const r = e.relations![i]!;
        return activePhrase(r.type, e.name, ix.nameOf(r.target), ix.resolve(r.target)?.type, true);
      }
      case 'victim':
        return passivePhrase(e.relations![i]!.type, e.name, this.who.name);
    }
  }

  get at(): FactRef {
    const list = this.#source === 'actor' || this.#source === 'target' ? 'actions' : this.#source === 'participant' ? 'participants' : this.#source === 'stay' ? 'locations' : 'relations';
    return this.#ix.fact(this.#in, `${list}[${this.#i}]`);
  }

  get key(): string {
    const e = this.#in;
    switch (this.#source) {
      case 'stay':
        return `${e.id}:${this.#ix.rowKeys(e).locations[this.#i]}`;
      case 'relation':
        return `${e.id}:${this.#ix.rowKeys(e).relations[this.#i]}`;
      case 'victim':
        return `${e.id}:${this.#ix.rowKeys(e).relations[this.#i]}:target`;
      default:
        return `${e.id}:${this.who.id}`;
    }
  }

  get legacyKey(): string | undefined {
    const e = this.#in;
    switch (this.#source) {
      case 'stay':
        return `${e.id}:locations:${this.#i}`;
      case 'relation':
        return `${e.id}:relations:${this.#i}`;
      case 'victim':
        return `${e.id}:relations:${this.#i}:target`;
      default:
        return undefined;
    }
  }
}

const sameDay = (a: ParsedDate, b: ParsedDate): boolean => a.lo === b.lo && a.hi === b.hi;

/** Everything dated that entries do, gathered from events, locations and dated relations. */
export function appearances(ix: WorldIndex): Appearance[] {
  const out: Appearance[] = [];
  for (const e of ix.entries) {
    if (e.type === 'event') {
      const from = ix.date(e.date);
      if (from) {
        const to = ix.date(e.end) ?? from;
        // A one-day event (no end, or an end on the same day) pins its participants to its place for that day.
        const certain = sameDay(from, to) && from.precision === 'day' && !from.approx ? { lo: from.lo, hi: from.hi } : undefined;
        // One appearance per involved entry per event: actor beats target beats plain participant.
        const seen = new Set<string>();
        const add = (ref: string | undefined, source: Source, i: number): void => {
          const who = ix.resolve(ref);
          if (!who || seen.has(who.id)) return;
          seen.add(who.id);
          const a = new Seen(ix, who, 'event', from, to, e, source, i);
          if (e.place !== undefined) a.where = e.place;
          if (certain) a.certain = certain;
          out.push(a);
        };
        e.actions?.forEach((act, i) => add(act.actor, 'actor', i));
        e.actions?.forEach((act, i) => {
          if (act.target) add(act.target, 'target', i);
        });
        e.participants?.forEach((p, i) => add(p.id, 'participant', i));
      }
    }
    if (e.type === 'character') {
      e.locations?.forEach((l, i) => {
        const start = ix.date(l.from);
        const stop = ix.date(l.to);
        const from = start ?? stop;
        const to = stop ?? from;
        if (!from || !to) return;
        const a = new Seen(ix, e, 'location', from, to, e, 'stay', i);
        a.where = l.place;
        // A stay with both ends known certainly holds from its latest possible start to its earliest possible end.
        if (start && stop && start.hi <= stop.lo) a.certain = { lo: start.hi, hi: stop.lo };
        out.push(a);
      });
    }
    e.relations?.forEach((r, i) => {
      const from = ix.date(r.from);
      if (!from) return;
      out.push(new Seen(ix, e, 'relation', from, ix.date(r.to) ?? from, e, 'relation', i));
      if (relationKind(r.type)?.type !== 'killed') return;
      const target = ix.resolve(r.target);
      if (target) out.push(new Seen(ix, target, 'relation', from, from, e, 'victim', i));
    });
  }
  return out;
}

/** "in 1920", or "from 1760 to 1790" for spans. */
export function when(ix: WorldIndex, a: Pick<Appearance, 'from' | 'to'>): string {
  return a.from.lo === a.to.lo && a.from.hi === a.to.hi ? ix.at(a.from) : msg`from ${ix.fmt(a.from)} to ${ix.fmt(a.to)}`;
}

/**
 * The span during which the appearance certainly holds, if any (used for "two places at once"): a one-day event
 * that is not approximate, or a stay with both ends known.
 */
export function certainSpan(a: Appearance): { lo: number; hi: number } | undefined {
  return a.certain;
}
