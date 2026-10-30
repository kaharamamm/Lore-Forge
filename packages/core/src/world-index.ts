import { atDate, dateOf, formatDate, type ParsedDate } from './dates.ts';
import { MentionMatcher } from './mentions.ts';
import { TYPE_LABELS, type Calendar, type Entry, type FactRef, type World } from './types.ts';

export interface LifePoint {
  date: ParsedDate;
  field: string;
  /** e.g. "was born", "died", "was founded". */
  word: string;
}

const LIFE_FIELDS = {
  character: [['born', 'was born'], ['died', 'died']],
  place: [['founded', 'was founded'], ['destroyed', 'was destroyed']],
  faction: [['founded', 'was founded'], ['dissolved', 'was dissolved']],
  item: [['created', 'was made'], ['destroyed', 'was destroyed']],
  event: [['date', 'started'], ['end', 'ended']],
  note: [['date', 'is set']],
} as const satisfies Record<Entry['type'], readonly (readonly [string, string])[]>;

/**
 * Key for comparing names: case-insensitive, spaces collapsed, and Turkish dotted/dotless i folded together
 * (I, ı, İ and i all count as i), so "İlsa", "Ilsa" and "ılsa" are the same name.
 */
export const normalizeName = (s: string): string => s.normalize('NFC').trim().replace(/[Iıİ]/g, 'i').toLowerCase().replace(/\s+/g, ' ');

/** Read-only lookups over a World, shared by all rules. */
export class WorldIndex {
  readonly calendar: Calendar;
  private readonly byId = new Map<string, Entry>();
  private readonly byName = new Map<string, Entry>();

  readonly world: World;

  constructor(world: World) {
    this.world = world;
    this.calendar = world.manifest.calendar;
    for (const e of world.entries) this.byId.set(e.id, e);
    for (const e of world.entries) {
      for (const n of [e.name, ...(e.aliases ?? [])]) {
        const k = normalizeName(n);
        if (!this.byName.has(k)) this.byName.set(k, e);
      }
    }
  }

  get entries(): readonly Entry[] {
    return this.world.entries;
  }

  private matcher: MentionMatcher | undefined;
  /** Plain-name mention matcher over all names and aliases, built on first use. */
  get mentions(): MentionMatcher {
    return (this.matcher ??= new MentionMatcher(this.world.entries));
  }

  /** Entry by id only. */
  byIdOf(id: string): Entry | undefined {
    return this.byId.get(id);
  }

  /** Find an entry by id, or else by name or alias (case-insensitive). */
  resolve(ref: string | undefined): Entry | undefined {
    if (ref === undefined) return undefined;
    return this.byId.get(ref) ?? this.byName.get(normalizeName(ref));
  }

  /** Name for messages; falls back to the raw reference. */
  nameOf(ref: string): string {
    return this.resolve(ref)?.name ?? ref;
  }

  source(entry: Entry): string {
    return `${TYPE_LABELS[entry.type]}/${entry.name}`;
  }

  fact(entry: Entry, field: string): FactRef {
    return { entryId: entry.id, field, source: this.source(entry) };
  }

  date(text: string | undefined): ParsedDate | undefined {
    return dateOf(text, this.calendar);
  }

  at(d: ParsedDate): string {
    return atDate(d, this.calendar);
  }

  fmt(d: ParsedDate): string {
    return formatDate(d, this.calendar);
  }

  /** When the entry starts and stops existing, if known. */
  life(entry: Entry): { start?: LifePoint; end?: LifePoint } {
    const [startDef, endDef] = LIFE_FIELDS[entry.type] as readonly (readonly [string, string])[];
    const point = (def: readonly [string, string] | undefined): LifePoint | undefined => {
      if (!def) return undefined;
      const d = this.date((entry as unknown as Record<string, string | undefined>)[def[0]]);
      return d ? { date: d, field: def[0], word: def[1] } : undefined;
    };
    const out: { start?: LifePoint; end?: LifePoint } = {};
    const s = point(startDef);
    const e = point(endDef);
    if (s) out.start = s;
    if (e) out.end = e;
    return out;
  }

  /** All raw date fields of an entry, as [field path, text] pairs. */
  dateFields(entry: Entry): [string, string][] {
    const out: [string, string][] = [];
    const rec = entry as unknown as Record<string, unknown>;
    for (const [f] of LIFE_FIELDS[entry.type]) {
      const v = rec[f];
      if (typeof v === 'string') out.push([f, v]);
    }
    entry.relations?.forEach((r, i) => {
      if (r.from !== undefined) out.push([`relations[${i}].from`, r.from]);
      if (r.to !== undefined) out.push([`relations[${i}].to`, r.to]);
    });
    if (entry.type === 'character') {
      entry.locations?.forEach((l, i) => {
        if (l.from !== undefined) out.push([`locations[${i}].from`, l.from]);
        if (l.to !== undefined) out.push([`locations[${i}].to`, l.to]);
      });
    }
    return out;
  }

  /** True when place `inner` is `outer` or lies inside it via partOf. */
  within(inner: Entry, outer: Entry): boolean {
    const seen = new Set<string>();
    let cur: Entry | undefined = inner;
    while (cur && !seen.has(cur.id)) {
      if (cur.id === outer.id) return true;
      seen.add(cur.id);
      cur = cur.type === 'place' ? this.resolve(cur.partOf) : undefined;
    }
    return false;
  }
}
