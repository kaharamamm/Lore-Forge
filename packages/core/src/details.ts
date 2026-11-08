import { msg } from './i18n.ts';
import { dateOf, monthsOf } from './dates.ts';
import type { Calendar, DateText, Entry, EntryType, Relation } from './types.ts';

/**
 * Optional detail fields per entry type. All are free to leave empty: empty means unknown,
 * and an empty field is never written to the file or shown in exports.
 * Stored as top-level front-matter keys (e.g. `occupation: Caravan master`).
 */
export type DetailKind = 'text' | 'long' | 'list' | 'ref' | 'refs';
export type DetailSection = 'basics' | 'story' | 'connections';

export interface DetailField {
  key: string;
  label: string;
  kind: DetailKind;
  section: DetailSection;
  hint?: string;
  /** For ref/refs: which entry types it may point at. */
  to?: readonly EntryType[];
  /** For ref/refs: the relationship this field stands for, used by the rules and the relationship views. */
  relation?: string;
  /** The relation reads from the target to this entry (a place's ruler `rules` the place). */
  reverse?: boolean;
  /** Suggested values for text fields. */
  suggest?: readonly string[];
}

export const DETAIL_SECTIONS: Record<DetailSection, string> = { basics: 'Basics', story: 'Story', connections: 'Connections' };

export const DETAIL_FIELDS: Record<EntryType, readonly DetailField[]> = {
  character: [
    { key: 'gender', label: msg`Gender`, kind: 'text', section: 'basics', suggest: ['female', 'male', 'genderless'] },
    { key: 'title', label: msg`Title or rank`, kind: 'text', section: 'basics', hint: 'e.g. King, Lady, Captain' },
    { key: 'occupation', label: msg`Occupation`, kind: 'text', section: 'basics', hint: 'e.g. caravan master, scribe' },
    { key: 'languages', label: msg`Languages`, kind: 'list', section: 'basics', hint: 'Comma-separated' },
    { key: 'personality', label: msg`Personality`, kind: 'long', section: 'story' },
    { key: 'goals', label: msg`Goals`, kind: 'long', section: 'story' },
    { key: 'skills', label: msg`Skills & abilities`, kind: 'long', section: 'story' },
    { key: 'affiliations', label: msg`Affiliations`, kind: 'refs', section: 'connections', to: ['faction'], relation: 'member-of' },
    { key: 'home', label: msg`Home`, kind: 'ref', section: 'connections', to: ['place'], relation: 'lives-in' },
    { key: 'possessions', label: msg`Notable possessions`, kind: 'refs', section: 'connections', to: ['item'], relation: 'owns' },
  ],
  place: [
    { key: 'kind', label: msg`Kind`, kind: 'text', section: 'basics', suggest: ['city', 'village', 'castle', 'palace', 'fortress', 'temple', 'region', 'desert', 'oasis', 'port', 'inn', 'ruin'] },
    { key: 'population', label: msg`Population`, kind: 'text', section: 'basics', hint: 'e.g. about 4,000' },
    { key: 'ruler', label: msg`Ruler`, kind: 'ref', section: 'connections', to: ['character', 'faction'], relation: 'rules', reverse: true },
    { key: 'features', label: msg`Notable features`, kind: 'long', section: 'story' },
  ],
  faction: [
    { key: 'kind', label: msg`Kind`, kind: 'text', section: 'basics', suggest: ['kingdom', 'guild', 'order', 'cult', 'tribe', 'house', 'army', 'council', 'company'] },
    { key: 'leader', label: msg`Leader`, kind: 'ref', section: 'connections', to: ['character'], relation: 'leader-of', reverse: true },
    { key: 'headquarters', label: msg`Headquarters`, kind: 'ref', section: 'connections', to: ['place'], relation: 'located-in' },
    { key: 'ideology', label: msg`Ideology & aims`, kind: 'long', section: 'story' },
    { key: 'allies', label: msg`Allies`, kind: 'refs', section: 'connections', to: ['faction', 'character'], relation: 'ally-of' },
    { key: 'enemies', label: msg`Enemies`, kind: 'refs', section: 'connections', to: ['faction', 'character'], relation: 'enemy-of' },
  ],
  item: [
    { key: 'kind', label: msg`Kind`, kind: 'text', section: 'basics', suggest: ['weapon', 'armour', 'jewellery', 'tool', 'book', 'relic', 'potion', 'instrument'] },
    { key: 'origin', label: msg`Origin`, kind: 'text', section: 'basics', hint: 'Who made it, where it comes from' },
    { key: 'location', label: msg`Current location`, kind: 'ref', section: 'connections', to: ['place'], relation: 'located-in' },
    { key: 'owners', label: msg`Owners over time`, kind: 'refs', section: 'connections', to: ['character', 'faction'], relation: 'owns', reverse: true },
    { key: 'powers', label: msg`Powers & properties`, kind: 'long', section: 'story' },
  ],
  event: [
    { key: 'kind', label: msg`Kind`, kind: 'text', section: 'basics', suggest: ['battle', 'siege', 'wedding', 'coronation', 'plague', 'festival', 'treaty', 'founding', 'journey', 'death'] },
    { key: 'causes', label: msg`Causes`, kind: 'long', section: 'story' },
    { key: 'outcome', label: msg`Outcome`, kind: 'long', section: 'story' },
    { key: 'consequences', label: msg`Consequences`, kind: 'long', section: 'story' },
  ],
  note: [],
};

export type DetailValue = string | string[];

/** The detail field definition for a key, if `type` has one. */
export function detailField(type: EntryType, key: string): DetailField | undefined {
  return DETAIL_FIELDS[type].find((f) => f.key === key);
}

/** A detail value as a list (refs/list fields) or text; empty values come back undefined. */
export function detailOf(e: Entry, key: string): DetailValue | undefined {
  const v = e.details?.[key];
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.length ? v : undefined;
  return v.trim() ? v : undefined;
}
export function detailList(e: Entry, key: string): string[] {
  const v = detailOf(e, key);
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** Filled detail fields, in table order: what exports show. */
export function filledDetails(e: Entry): { field: DetailField; value: DetailValue }[] {
  return DETAIL_FIELDS[e.type].flatMap((field) => {
    const value = detailOf(e, field.key);
    return value === undefined ? [] : [{ field, value }];
  });
}

/** A relation implied by a reference detail field, e.g. `home: oasis` -> lives-in oasis. */
export interface DetailRelation extends Relation {
  /** The entry that holds the field. */
  holder: string;
  field: string;
  /** Source of the relation (the holder, or the target when the field reads in reverse). */
  source: string;
}

/** Relations implied by an entry's reference fields. */
export function detailRelations(e: Entry): DetailRelation[] {
  return DETAIL_FIELDS[e.type].flatMap((f) => {
    if (!f.relation || (f.kind !== 'ref' && f.kind !== 'refs')) return [];
    return detailList(e, f.key).map((ref): DetailRelation =>
      f.reverse ? { type: f.relation!, target: e.id, source: ref, holder: e.id, field: f.key } : { type: f.relation!, target: ref, source: e.id, holder: e.id, field: f.key },
    );
  });
}

/** Age at death in whole years from the born and died dates ("about" when either is approximate or year-only), if both are known. */
export function ageAtDeath(born: DateText | undefined, died: DateText | undefined, calendar: Calendar): { years: number; approx: boolean } | undefined {
  const b = dateOf(born, calendar), d = dateOf(died, calendar);
  if (!b || !d || d.hi < b.lo) return undefined;
  const yearDays = monthsOf(calendar).reduce((n, m) => n + m.days, 0) || 360;
  const approx = b.approx || d.approx || b.precision !== 'day' || d.precision !== 'day';
  return { years: Math.max(0, Math.floor((d.lo - b.lo) / yearDays)), approx };
}

/** "Age at death: 63" / "about 63", or undefined. */
export function ageAtDeathText(e: Entry, calendar: Calendar): string | undefined {
  if (e.type !== 'character') return undefined;
  const a = ageAtDeath(e.born, e.died, calendar);
  return a ? (a.approx ? msg`about ${a.years}` : `${a.years}`) : undefined;
}
