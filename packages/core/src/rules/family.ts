import { definitelyBefore } from '../dates.ts';
import type { Finding, Rule } from '../engine.ts';
import { msg } from '../i18n.ts';
import { relationKind } from '../relation-kinds.ts';
import type { Entry, FactRef } from '../types.ts';
import type { WorldIndex } from '../world-index.ts';

interface ParentEdge {
  parent: Entry;
  child: Entry;
  /** The relation that states it. */
  at: FactRef;
}

const EDGES = new WeakMap<WorldIndex, ParentEdge[]>();

/** parent-of and child-of relations (any capitalisation), normalised to parent -> child. Worked out once per index. */
export function parentEdges(ix: WorldIndex): ParentEdge[] {
  const known = EDGES.get(ix);
  if (known) return known;
  const out: ParentEdge[] = [];
  EDGES.set(ix, out);
  for (const e of ix.entries) {
    e.relations?.forEach((r, i) => {
      const type = relationKind(r.type)?.type;
      if (type !== 'parent-of' && type !== 'child-of') return;
      const other = ix.resolve(r.target);
      if (!other) return;
      const at = ix.fact(e, `relations[${i}]`);
      if (type === 'parent-of') out.push({ parent: e, child: other, at });
      else out.push({ parent: other, child: e, at });
    });
  }
  return out;
}

/**
 * Strongly connected groups of the parent graph with more than one member: everyone in such a group is their own
 * ancestor. Tarjan's algorithm, iterative (no recursion, so a 10,000-generation family is fine), O(people + edges).
 * `out[i]` lists the edges leaving node i.
 */
function cycleGroups(n: number, out: readonly number[][]): number[] {
  const group = new Array<number>(n).fill(-1);
  const index = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  const work: [node: number, next: number][] = [];
  let counter = 0;
  let groups = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    work.push([root, 0]);
    while (work.length) {
      const top = work[work.length - 1]!;
      const v = top[0];
      if (top[1] === 0 && index[v] === -1) {
        index[v] = low[v] = counter++;
        stack.push(v);
        onStack[v] = true;
      }
      const edges = out[v]!;
      if (top[1] < edges.length) {
        const w = edges[top[1]++]!;
        if (index[w] === -1) work.push([w, 0]);
        else if (onStack[w]) low[v] = Math.min(low[v]!, index[w]!);
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1]![0];
        low[parent] = Math.min(low[parent]!, low[v]!);
      }
      if (low[v] !== index[v]) continue;
      const members: number[] = [];
      let w: number;
      do {
        w = stack.pop()!;
        onStack[w] = false;
        members.push(w);
      } while (w !== v);
      if (members.length > 1) {
        for (const m of members) group[m] = groups;
        groups++;
      }
    }
  }
  return group;
}

export const parentCycle: Rule = {
  id: 'parent-cycle',
  title: 'Contradictory parent relations',
  description: 'Someone is their own parent or ancestor, e.g. A is parent of B and B is parent of A.',
  severity: 'error',
  check: ({ ix }) => {
    const edges = parentEdges(ix);
    const out: Finding[] = [];
    const num = new Map<string, number>();
    const nodes: Entry[] = [];
    const node = (e: Entry): number => {
      let i = num.get(e.id);
      if (i === undefined) {
        i = nodes.length;
        num.set(e.id, i);
        nodes.push(e);
      }
      return i;
    };
    const children: number[][] = [];
    const childEdges: ParentEdge[][] = [];
    for (const ed of edges) {
      if (ed.parent.id === ed.child.id) {
        out.push({ key: `${ed.parent.id}:self`, message: msg`${ed.parent.name} can't be their own parent (source: ${ed.at.source}).`, offending: ed.at });
        continue;
      }
      const p = node(ed.parent);
      const c = node(ed.child);
      (children[p] ??= []).push(c);
      (childEdges[p] ??= []).push(ed);
    }
    for (let i = 0; i < nodes.length; i++) {
      children[i] ??= [];
      childEdges[i] ??= [];
    }
    const group = cycleGroups(nodes.length, children);
    const members: string[][] = [];
    group.forEach((g, i) => {
      if (g !== -1) (members[g] ??= []).push(nodes[i]!.id);
    });
    // One warning per loop: the first relation (in file order) inside it, and the shortest way back from its
    // child to its parent, which is the relation that contradicts it.
    const reported = new Set<number>();
    for (const ed of edges) {
      const p = num.get(ed.parent.id);
      const c = num.get(ed.child.id);
      if (p === undefined || c === undefined || p === c) continue;
      const g = group[p]!;
      if (g === -1 || group[c] !== g || reported.has(g)) continue;
      reported.add(g);
      // Breadth-first from the child back to the parent, staying inside the loop.
      const via = new Map<number, ParentEdge>();
      const queue = [c];
      for (let q = 0; q < queue.length && !via.has(p); q++) {
        const v = queue[q]!;
        childEdges[v]!.forEach((back, k) => {
          const w = children[v]![k]!;
          if (group[w] !== g || w === c || via.has(w)) return;
          via.set(w, back);
          queue.push(w);
        });
      }
      const back: ParentEdge[] = [];
      for (let v = p; v !== c; ) {
        const step = via.get(v)!;
        back.unshift(step);
        v = num.get(step.parent.id)!;
      }
      const parent = ed.parent.name;
      const child = ed.child.name;
      const source = back[0]!.at.source;
      out.push({
        key: [...members[g]!].sort().join('+'),
        message: back.length === 1
          ? msg`${parent} can't be the parent of ${child}: ${child} is already the parent of ${parent} (source: ${source}).`
          : msg`${parent} can't be the parent of ${child}: ${child} is already an ancestor of ${parent} (source: ${source}).`,
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
      if (ed.parent.type !== 'character' || ed.child.type !== 'character') return [];
      const p = ix.life(ed.parent).start;
      const c = ix.life(ed.child).start;
      if (!p || !c || !definitelyBefore(c.date, p.date)) return [];
      return [{
        key: `${ed.parent.id}:${ed.child.id}`,
        message: msg`${ed.parent.name} can't be the parent of ${ed.child.name}: ${ed.parent.name} was born ${ix.at(p.date)}, after ${ed.child.name} was born ${ix.at(c.date)} (source: ${ix.source(ed.child)}).`,
        offending: ed.at,
        conflicting: ix.fact(ed.child, c.field),
      }];
    }),
};
