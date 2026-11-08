import { atDate, formatDate, parseDate, type DateResult, type ParsedDate } from './dates.ts';
import { msg, template } from './i18n.ts';
import { MentionMatcher } from './mentions.ts';
import { relationKind } from './relation-kinds.ts';
import { ENTRY_TYPES, TYPE_LABELS, type Calendar, type Entry, type EntryType, type FactRef, type StoryChapter, type World } from './types.ts';
import { killedPhrase } from './verbs.ts';

export interface LifePoint {
  date: ParsedDate;
  field: string;
  /** e.g. "was born", "died", "was founded". */
  word: string;
}

/** Prefix of FactRef.entryId for facts that live in the story, e.g. "story:story/01-the-salt-road.md". */
export const STORY_REF_PREFIX = 'story:';

const LIFE_FIELDS = {
  character: [['born', msg`was born`], ['died', msg`died`]],
  place: [['founded', msg`was founded`], ['destroyed', msg`was destroyed`]],
  faction: [['founded', msg`was founded`], ['dissolved', msg`was dissolved`]],
  item: [['created', msg`was made`], ['destroyed', msg`was destroyed`]],
  event: [['date', msg`started`], ['end', msg`ended`]],
  note: [['date', msg`is set`]],
} as const satisfies Record<Entry['type'], readonly (readonly [string, string])[]>;

/** "Characters/{0}", one template per type, so a source reads "Karakterler/Orsan" in Turkish. */
const SOURCE = Object.fromEntries(ENTRY_TYPES.map((t) => [t, template(`${TYPE_LABELS[t]}/`, '')])) as Record<EntryType, TemplateStringsArray>;

/** Event verbs that end the target's life. */
export const DEATH_VERBS: ReadonlySet<string> = new Set(['killed', 'murdered', 'slew', 'slain', 'executed']);

/** A killing of a character: an event action with a death verb, or a "killed" relation. */
export interface Killing {
  /** The killer's name, for messages. */
  by: string;
  /** "was killed by Orsan", "was slain by Orsan". */
  word: string;
  /** When it happened, if dated: the event's date or the relation's `from`. */
  date?: ParsedDate;
  /** The latest absolute day it can have happened: the end of a long event, else `date.hi`. */
  latest?: number;
  at: FactRef;
}

/** Content keys for an entry's relation and location rows, in list order (see WorldIndex.rowKeys). */
export interface RowKeys {
  relations: string[];
  locations: string[];
}

const UNKNOWN: DateResult = { kind: 'unknown' };

const NAME_KEYS = new Map<string, string>();

/**
 * Key for comparing names: case-insensitive, spaces collapsed, and Turkish dotted/dotless i folded together
 * (I, ı, İ and i all count as i), so "İlsa", "Ilsa" and "ılsa" are the same name. Remembered, because the
 * checks run on every keystroke and see the same names each time.
 */
export const normalizeName = (s: string): string => {
  let k = NAME_KEYS.get(s);
  if (k === undefined) {
    k = s.normalize('NFC').trim().replace(/[Iıİ]/g, 'i').toLowerCase().replace(/\s+/g, ' ');
    if (NAME_KEYS.size >= 50_000) NAME_KEYS.clear();
    NAME_KEYS.set(s, k);
  }
  return k;
};

/**
 * Parsed dates per calendar, kept between checks: the app checks the world on every keystroke and nearly all dates
 * stay the same. Keyed by the calendar's content, so an edited calendar never sees results of the old one.
 */
const DATE_CACHES = new Map<string, Map<string, DateResult>>();
function dateCache(calendar: Calendar): Map<string, DateResult> {
  const key = JSON.stringify(calendar);
  let cache = DATE_CACHES.get(key);
  if (!cache) {
    if (DATE_CACHES.size >= 8) DATE_CACHES.clear();
    cache = new Map();
    DATE_CACHES.set(key, cache);
  } else if (cache.size >= 50_000) cache.clear();
  return cache;
}

/** The same keys, with "#2", "#3", ... added to repeats (in order), so every key in the list is different. */
export function numberDuplicates(keys: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return keys.map((k) => {
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n === 1 ? k : `${k}#${n}`;
  });
}

/**
 * Read-only lookups over a World, shared by all rules. Parsed dates, lifespans and row keys are remembered,
 * because the rules read the same ones many times; an index belongs to one World and its entries must not change.
 */
export class WorldIndex {
  readonly calendar: Calendar;
  private readonly byId = new Map<string, Entry>();
  private readonly byName = new Map<string, Entry>();
  private readonly parsed: Map<string, DateResult>;
  private readonly resolved = new Map<string, Entry | undefined>();
  private readonly sources = new Map<Entry, string>();
  private readonly lives = new Map<Entry, { start?: LifePoint; end?: LifePoint }>();
  private readonly rows = new Map<Entry, RowKeys>();
  private killings: Map<string, Killing[]> | undefined;

  readonly world: World;

  constructor(world: World) {
    this.world = world;
    this.calendar = world.manifest.calendar;
    this.parsed = dateCache(this.calendar);
    for (const e of world.entries) this.byId.set(e.id, e);
    for (const e of world.entries) {
      for (const n of [e.name, ...(e.aliases ?? [])]) {
        const k = normalizeName(n);
        if (k && !this.byName.has(k)) this.byName.set(k, e);
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

  /** Find an entry by id, or else by name or alias (case-insensitive). Empty references (blank editor rows) find nothing. */
  resolve(ref: string | undefined): Entry | undefined {
    if (ref === undefined) return undefined;
    const hit = this.byId.get(ref);
    if (hit) return hit;
    if (this.resolved.has(ref)) return this.resolved.get(ref);
    const k = normalizeName(ref);
    const e = k ? this.byName.get(k) : undefined;
    this.resolved.set(ref, e);
    return e;
  }

  /** Name for messages; falls back to the raw reference. */
  nameOf(ref: string): string {
    return this.resolve(ref)?.name ?? ref;
  }

  /** "Characters/Orsan the Grey"; the id stands in for an empty name. */
  source(entry: Entry): string {
    let s = this.sources.get(entry);
    if (s === undefined) {
      s = msg(SOURCE[entry.type], entry.name.trim() ? entry.name : entry.id);
      this.sources.set(entry, s);
    }
    return s;
  }

  fact(entry: Entry, field: string): FactRef {
    return { entryId: entry.id, field, source: this.source(entry) };
  }

  /** A fact in a story chapter's header, e.g. its date. */
  chapterFact(chapter: StoryChapter, field: string): FactRef {
    return { entryId: STORY_REF_PREFIX + chapter.file, field, source: msg`Story/${chapter.title}`, chapter: chapter.file };
  }

  /** parseDate with this world's calendar (remembered per text, also between checks of the same calendar). */
  parse(text: string | undefined): DateResult {
    if (text === undefined) return UNKNOWN;
    let r = this.parsed.get(text);
    if (r === undefined) {
      r = parseDate(text, this.calendar);
      this.parsed.set(text, r);
    }
    return r;
  }

  /** The date for comparisons, or undefined if missing, unknown or invalid. The same text gives the same object. */
  date(text: string | undefined): ParsedDate | undefined {
    const r = this.parse(text);
    return r.kind === 'date' ? r.date : undefined;
  }

  at(d: ParsedDate): string {
    return atDate(d, this.calendar);
  }

  fmt(d: ParsedDate): string {
    return formatDate(d, this.calendar);
  }

  /** When the entry starts and stops existing, if known. */
  life(entry: Entry): { start?: LifePoint; end?: LifePoint } {
    const known = this.lives.get(entry);
    if (known) return known;
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
    this.lives.set(entry, out);
    return out;
  }

  /** The entry's own date fields (born, died, founded, date, ...) that hold text, as [field, text] pairs. */
  lifeFields(entry: Entry): [string, string][] {
    const out: [string, string][] = [];
    const rec = entry as unknown as Record<string, unknown>;
    for (const [f] of LIFE_FIELDS[entry.type]) {
      const v = rec[f];
      if (typeof v === 'string') out.push([f, v]);
    }
    return out;
  }

  /** All raw date fields of an entry, as [field path, text] pairs. */
  dateFields(entry: Entry): [string, string][] {
    const out = this.lifeFields(entry);
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
    entry.looks?.forEach((l, i) => {
      if (l.from !== undefined) out.push([`looks[${i}].from`, l.from]);
      if (l.to !== undefined) out.push([`looks[${i}].to`, l.to]);
    });
    return out;
  }

  /** The id a reference points at, or the reference itself when nothing has that id or name. */
  refId(ref: string): string {
    return this.resolve(ref)?.id ?? ref;
  }

  /**
   * Keys for an entry's relation and location rows that say what the row is, not where it sits in the list, so
   * warning ids (and intended marks) stay with their row when other rows are added or removed. A relation is
   * `type>target`, with `@from-to` when it is dated; a stay is `place@from-to`. Repeated rows get #2, #3, ...
   */
  rowKeys(entry: Entry): RowKeys {
    let keys = this.rows.get(entry);
    if (!keys) {
      const span = (from: string | undefined, to: string | undefined) => `@${from ?? ''}-${to ?? ''}`;
      keys = {
        relations: numberDuplicates((entry.relations ?? []).map((r) => `${relationKind(r.type)?.type ?? r.type.trim()}>${this.refId(r.target)}${r.from || r.to ? span(r.from, r.to) : ''}`)),
        locations: entry.type === 'character' ? numberDuplicates((entry.locations ?? []).map((l) => `${this.refId(l.place)}${span(l.from, l.to)}`)) : [],
      };
      this.rows.set(entry, keys);
    }
    return keys;
  }

  /**
   * Every killing of the character with this id, in entry order: event actions with a death verb (killed,
   * murdered, slew, slain, executed) and "killed" relations. Built in one pass over the world on first use.
   */
  killingsOf(id: string): readonly Killing[] {
    if (!this.killings) {
      const map = new Map<string, Killing[]>();
      const add = (targetRef: string, k: Omit<Killing, 'word'>, verb: string): void => {
        const victim = this.resolve(targetRef);
        if (!victim || victim.type !== 'character') return;
        const word = killedPhrase(verb, k.by, victim.name);
        const list = map.get(victim.id);
        if (list) list.push({ ...k, word });
        else map.set(victim.id, [{ ...k, word }]);
      };
      const when = (from: ParsedDate | undefined, to: ParsedDate | undefined) => (from ? { date: from, latest: Math.max(from.hi, to?.hi ?? from.hi) } : {});
      for (const e of this.world.entries) {
        if (e.type === 'event') {
          e.actions?.forEach((a, i) => {
            if (!a.target || !DEATH_VERBS.has(a.verb.trim().toLowerCase())) return;
            add(a.target, { by: this.nameOf(a.actor), ...when(this.date(e.date), this.date(e.end)), at: this.fact(e, `actions[${i}]`) }, a.verb);
          });
        }
        e.relations?.forEach((r, i) => {
          if (relationKind(r.type)?.type !== 'killed') return;
          add(r.target, { by: e.name, ...when(this.date(r.from), undefined), at: this.fact(e, `relations[${i}]`) }, 'killed');
        });
      }
      this.killings = map;
    }
    return this.killings.get(id) ?? [];
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
