import type { Finding, Rule } from '../engine.ts';
import { relationFits, relationKind } from '../relation-kinds.ts';
import { TYPE_SINGULAR, type EntryType } from '../types.ts';

const a = (t: EntryType) => `${/^[aeiou]/i.test(t) ? 'an' : 'a'} ${t}`;
const list = (ts: readonly EntryType[]) => (ts.length > 4 ? 'any entry' : ts.map(a).join(' or '));

export const relationKindRule: Rule = {
  id: 'relation-kind',
  title: 'Relation that does not fit the entry types',
  description: 'A known relationship type is used between entry types it does not fit, such as an item that is "parent-of" someone. Custom relationship types are not checked.',
  severity: 'warning',
  check: ({ ix }) => {
    const out: Finding[] = [];
    for (const e of ix.entries) {
      e.relations?.forEach((r, i) => {
        const kind = relationKind(r.type);
        const target = ix.resolve(r.target);
        if (!kind || !target || relationFits(kind, e.type, target.type)) return;
        const fits = kind.sameType ? `one entry to another of the same type` : `${list(kind.from)} to ${list(kind.to)}`;
        out.push({
          key: `${e.id}:${i}`,
          message: `${e.name} (${TYPE_SINGULAR[e.type].toLowerCase()}) is "${r.type}" ${target.name} (${TYPE_SINGULAR[target.type].toLowerCase()}), but "${r.type}" only goes from ${fits} (source: ${ix.source(e)}).`,
          offending: ix.fact(e, `relations[${i}]`),
          conflicting: ix.fact(target, 'type'),
        });
      });
    }
    return out;
  },
};
