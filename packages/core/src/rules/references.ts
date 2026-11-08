import type { Finding, Rule } from '../engine.ts';
import { DETAIL_FIELDS, detailList } from '../details.ts';
import { msg, verbatim } from '../i18n.ts';
import { bodyLinks, type BodyLink } from '../links.ts';
import type { Entry } from '../types.ts';
import { normalizeName, numberDuplicates, type WorldIndex } from '../world-index.ts';

export interface Reference {
  ref: string;
  field: string;
  /** A plain name in the text (no [[link]]). Always points at an existing entry. */
  implicit?: boolean;
  /** The plain name is shared by several entries; one reference per candidate. */
  ambiguous?: boolean;
}

/** Links found in an entry's text, remembered while the text stays the same (the check runs on every keystroke). */
const LINKS = new WeakMap<Entry, { body: string; links: BodyLink[] }>();
function linksOf(e: Entry): BodyLink[] {
  const known = LINKS.get(e);
  if (known && known.body === e.body) return known.links;
  const links = bodyLinks(e.body);
  LINKS.set(e, { body: e.body, links });
  return links;
}

/**
 * Every reference an entry makes to another entry, with the field it sits in.
 * With an index, plain names and aliases in the body count too (implicit: true).
 * Empty references (rows the editor added but nobody filled in yet) are left out.
 */
export function references(e: Entry, ix?: WorldIndex): Reference[] {
  const out: Reference[] = [];
  const add = (ref: string | undefined, field: string): void => {
    if (ref !== undefined && ref.trim() !== '') out.push({ ref, field });
  };
  e.relations?.forEach((r, i) => add(r.target, `relations[${i}]`));
  if (e.type === 'character') e.locations?.forEach((l, i) => add(l.place, `locations[${i}]`));
  if (e.type === 'place') add(e.partOf, 'partOf');
  if (e.type === 'event') {
    add(e.place, 'place');
    e.participants?.forEach((p, i) => add(p.id, `participants[${i}]`));
    e.actions?.forEach((a, i) => {
      add(a.actor, `actions[${i}]`);
      add(a.target, `actions[${i}]`);
    });
  }
  for (const f of DETAIL_FIELDS[e.type]) if (f.kind === 'ref' || f.kind === 'refs') for (const ref of detailList(e, f.key)) add(ref, f.key);
  for (const l of linksOf(e)) add(l.ref, 'body');
  if (ix) {
    for (const m of ix.mentions.find(e.body, { exclude: e.id })) {
      for (const id of m.ids) out.push({ ref: id, field: 'body', implicit: true, ...(m.ids.length > 1 ? { ambiguous: true } : {}) });
    }
  }
  return out;
}

/** "relations[2]" -> "relations": list rows are keyed by what they point at, not by their position. */
const LIST_FIELD = /^(relations|locations|participants|actions)\[\d+\]$/;

export const danglingReference: Rule = {
  id: 'dangling-reference',
  title: 'Reference to a missing entry',
  description: 'A field or a [[link]] / @mention points at an id or name that no entry has.',
  severity: 'warning',
  check: ({ ix }) =>
    ix.entries.flatMap((e) => {
      const missing = references(e).filter((r) => !ix.resolve(r.ref));
      if (!missing.length) return [];
      // List rows pointing at the same missing name each keep a warning (numbered); a name linked twice in the text is one.
      const rowKeys = numberDuplicates(missing.filter((r) => LIST_FIELD.test(r.field)).map((r) => `${r.field.replace(LIST_FIELD, '$1')}:${r.ref}`));
      let row = 0;
      return missing.map((r): Finding => {
        const inList = LIST_FIELD.test(r.field);
        const f: Finding = {
          key: `${e.id}:${inList ? rowKeys[row++] : `${r.field}:${r.ref}`}`,
          message: msg`${e.name} mentions "${verbatim(r.ref)}" (${r.field === 'body' ? msg`in the text` : verbatim(r.field)}), but no entry has that id or name (source: ${ix.source(e)}).`,
          offending: ix.fact(e, r.field),
        };
        if (inList) f.legacyKey = `${e.id}:${r.field}:${r.ref}`;
        return f;
      });
    }),
};

export const duplicateName: Rule = {
  id: 'duplicate-name',
  title: 'Same name on two entries',
  description: 'Two different entries share a name or alias, so links and readers can mix them up.',
  severity: 'warning',
  check: ({ ix }) => {
    const owners = new Map<string, { entry: Entry; field: string; label: string; order: number }[]>();
    ix.entries.forEach((e, order) => {
      const names = [{ field: 'name', label: e.name }, ...(e.aliases ?? []).map((a, i) => ({ field: `aliases[${i}]`, label: a }))];
      for (const n of names) {
        const k = normalizeName(n.label);
        if (!k) continue;
        const list = owners.get(k);
        if (!list) owners.set(k, [{ entry: e, ...n, order }]);
        else if (!list.some((o) => o.entry.id === e.id)) list.push({ entry: e, ...n, order });
      }
    });
    const out: Finding[] = [];
    for (const [k, list] of owners) {
      if (list.length < 2) continue;
      // Compared against the entry with the smallest id, so the warning id does not depend on the order entries
      // were loaded or added in. The id names both entries.
      const anchor = list.reduce((m, o) => (o.entry.id < m.entry.id ? o : m));
      for (const o of list) {
        if (o === anchor) continue;
        out.push({
          key: `${k}:${anchor.entry.id}+${o.entry.id}`,
          legacyKey: `${k}:${(o.order > anchor.order ? o : anchor).entry.id}`,
          message: msg`"${verbatim(o.label)}" names both ${ix.source(o.entry)} and ${ix.source(anchor.entry)} (source: ${ix.source(anchor.entry)}).`,
          offending: ix.fact(o.entry, o.field),
          conflicting: ix.fact(anchor.entry, anchor.field),
        });
      }
    }
    return out;
  },
};
