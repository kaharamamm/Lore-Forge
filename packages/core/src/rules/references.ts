import type { Finding, Rule } from '../engine.ts';
import { bodyLinks } from '../links.ts';
import type { Entry } from '../types.ts';
import { normalizeName, type WorldIndex } from '../world-index.ts';

export interface Reference {
  ref: string;
  field: string;
  /** A plain name in the text (no [[link]]). Always points at an existing entry. */
  implicit?: boolean;
  /** The plain name is shared by several entries; one reference per candidate. */
  ambiguous?: boolean;
}

/**
 * Every reference an entry makes to another entry, with the field it sits in.
 * With an index, plain names and aliases in the body count too (implicit: true).
 */
export function references(e: Entry, ix?: WorldIndex): Reference[] {
  const out: Reference[] = [];
  e.relations?.forEach((r, i) => out.push({ ref: r.target, field: `relations[${i}]` }));
  if (e.type === 'character') e.locations?.forEach((l, i) => out.push({ ref: l.place, field: `locations[${i}]` }));
  if (e.type === 'place' && e.partOf) out.push({ ref: e.partOf, field: 'partOf' });
  if (e.type === 'event') {
    if (e.place) out.push({ ref: e.place, field: 'place' });
    e.participants?.forEach((p, i) => out.push({ ref: p.id, field: `participants[${i}]` }));
    e.actions?.forEach((a, i) => {
      out.push({ ref: a.actor, field: `actions[${i}]` });
      if (a.target) out.push({ ref: a.target, field: `actions[${i}]` });
    });
  }
  for (const l of bodyLinks(e.body)) out.push({ ref: l.ref, field: 'body' });
  if (ix) {
    for (const m of ix.mentions.find(e.body, { exclude: e.id })) {
      for (const id of m.ids) out.push({ ref: id, field: 'body', implicit: true, ...(m.ids.length > 1 ? { ambiguous: true } : {}) });
    }
  }
  return out;
}

export const danglingReference: Rule = {
  id: 'dangling-reference',
  title: 'Reference to a missing entry',
  description: 'A field or a [[link]] / @mention points at an id or name that no entry has.',
  severity: 'warning',
  check: ({ ix }) =>
    ix.entries.flatMap((e) =>
      references(e)
        .filter((r) => !ix.resolve(r.ref))
        .map((r): Finding => ({
          key: `${e.id}:${r.field}:${r.ref}`,
          message: `${e.name} mentions "${r.ref}" (${r.field === 'body' ? 'in the text' : r.field}), but no entry has that id or name (source: ${ix.source(e)}).`,
          offending: ix.fact(e, r.field),
        })),
    ),
};

export const duplicateName: Rule = {
  id: 'duplicate-name',
  title: 'Same name on two entries',
  description: 'Two different entries share a name or alias, so links and readers can mix them up.',
  severity: 'warning',
  check: ({ ix }) => {
    const owners = new Map<string, { entry: Entry; field: string; label: string }>();
    const out: Finding[] = [];
    for (const e of ix.entries) {
      const names = [{ field: 'name', label: e.name }, ...(e.aliases ?? []).map((a, i) => ({ field: `aliases[${i}]`, label: a }))];
      for (const n of names) {
        const k = normalizeName(n.label);
        const first = owners.get(k);
        if (!first) owners.set(k, { entry: e, field: n.field, label: n.label });
        else if (first.entry.id !== e.id) {
          out.push({
            key: `${k}:${e.id}`,
            message: `"${n.label}" names both ${ix.source(e)} and ${ix.source(first.entry)} (source: ${ix.source(first.entry)}).`,
            offending: ix.fact(e, n.field),
            conflicting: ix.fact(first.entry, first.field),
          });
        }
      }
    }
    return out;
  },
};
