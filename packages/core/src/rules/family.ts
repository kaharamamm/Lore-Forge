import { definitelyBefore } from '../dates.ts';
import type { Finding, Rule } from '../engine.ts';
import type { Entry, FactRef } from '../types.ts';
import type { WorldIndex } from '../world-index.ts';

interface ParentEdge {
  parent: Entry;
  child: Entry;
  /** The relation that states it. */
  at: FactRef;
}

/** parent-of and child-of relations, normalised to parent -> child. */
export function parentEdges(ix: WorldIndex): ParentEdge[] {
  const out: ParentEdge[] = [];
  for (const e of ix.entries) {
    e.relations?.forEach((r, i) => {
      const other = ix.resolve(r.target);
      if (!other) return;
      const at = ix.fact(e, `relations[${i}]`);
      if (r.type === 'parent-of') out.push({ parent: e, child: other, at });
      if (r.type === 'child-of') out.push({ parent: other, child: e, at });
    });
  }
  return out;
}

export const parentCycle: Rule = {
  id: 'parent-cycle',
  title: 'Contradictory parent relations',
  description: 'Someone is their own parent or ancestor, e.g. A is parent of B and B is parent of A.',
  severity: 'error',
  check: ({ ix }) => {
    const edges = parentEdges(ix);
    const children = new Map<string, ParentEdge[]>();
    for (const ed of edges) children.set(ed.parent.id, [...(children.get(ed.parent.id) ?? []), ed]);
    /** Path of edges from `from` down to `to`, if `to` descends from `from`. */
    const path = (from: string, to: string, seen = new Set<string>()): ParentEdge[] | undefined => {
      for (const ed of children.get(from) ?? []) {
        if (ed.child.id === to) return [ed];
        if (seen.has(ed.child.id)) continue;
        seen.add(ed.child.id);
        const rest = path(ed.child.id, to, seen);
        if (rest) return [ed, ...rest];
      }
      return undefined;
    };
    const out: Finding[] = [];
    const reported = new Set<string>();
    for (const ed of edges) {
      if (ed.parent.id === ed.child.id) {
        out.push({ key: `${ed.parent.id}:self`, message: `${ed.parent.name} can't be their own parent (source: ${ed.at.source}).`, offending: ed.at });
        continue;
      }
      const back = path(ed.child.id, ed.parent.id);
      if (!back) continue;
      const cycle = [ed, ...back];
      const key = cycle.map((c) => c.parent.id).sort().join('+');
      if (reported.has(key)) continue;
      reported.add(key);
      const relation = back.length === 1 ? 'the parent' : 'an ancestor';
      out.push({
        key,
        message: `${ed.parent.name} can't be the parent of ${ed.child.name}: ${ed.child.name} is already ${relation} of ${ed.parent.name} (source: ${back[0]!.at.source}).`,
        offending: ed.at,
        conflicting: back[0]!.at,
      });
    }
    return out;
  },
};

export const parentBornAfterChild: Rule = {
  id: 'parent-born-after-child',
  title: 'Parent born after child',
  description: 'A parent was born after (or must have been born after) their child.',
  severity: 'error',
  check: ({ ix }) =>
    parentEdges(ix).flatMap((ed): Finding[] => {
      const p = ix.life(ed.parent).start;
      const c = ix.life(ed.child).start;
      if (ed.parent.type !== 'character' || ed.child.type !== 'character' || !p || !c || !definitelyBefore(c.date, p.date)) return [];
      return [{
        key: `${ed.parent.id}:${ed.child.id}`,
        message: `${ed.parent.name} can't be the parent of ${ed.child.name}: ${ed.parent.name} was born ${ix.at(p.date)}, after ${ed.child.name} was born ${ix.at(c.date)} (source: ${ix.source(ed.child)}).`,
        offending: ed.at,
        conflicting: ix.fact(ed.child, c.field),
      }];
    }),
};
