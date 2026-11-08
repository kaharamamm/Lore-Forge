import type { Finding, Rule } from '../engine.ts';
import { msg, verbatim } from '../i18n.ts';
import { relationFits, relationKind } from '../relation-kinds.ts';
import type { EntryType } from '../types.ts';
import { A_TYPE, orList, TYPE_WORD } from '../words.ts';

/** "a character or a faction", or "any entry" for more than four types. */
const list = (ts: readonly EntryType[]) => (ts.length > 4 ? msg`any entry` : orList(ts.map((t) => A_TYPE[t])));

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
        const fits = kind.sameType ? msg`one entry to another of the same type` : msg`${list(kind.from)} to ${list(kind.to)}`;
        out.push({
          key: `${e.id}:${ix.rowKeys(e).relations[i]}`,
          legacyKey: `${e.id}:${i}`,
          message: msg`${e.name} (${TYPE_WORD[e.type]}) is "${verbatim(r.type)}" ${target.name} (${TYPE_WORD[target.type]}), but "${verbatim(r.type)}" only goes from ${fits} (source: ${ix.source(e)}).`,
          offending: ix.fact(e, `relations[${i}]`),
          conflicting: ix.fact(target, 'type'),
        });
      });
    }
    return out;
  },
};
