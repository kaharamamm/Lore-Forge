import { msg } from '../i18n.ts';
import { isEnded } from '../lifecycle.ts';
import { parentEdges } from '../rules/family.ts';
import type { Character, World } from '../types.ts';
import { WorldIndex } from '../world-index.ts';

export const TREE_LAYOUT = { nodeW: 176, nodeH: 64, gapX: 32, gapY: 80, margin: 24 } as const;

export interface TreeNode {
  id: string;
  entry: Character;
  /** 0 = the oldest generation shown. */
  gen: number;
  /** Top-left corner, in layout units (px at 100%). */
  x: number;
  y: number;
  ended: boolean;
  focus: boolean;
  dates: string;
}

export interface TreeEdge {
  kind: 'parent' | 'spouse' | 'sibling';
  /** parent edges go parent -> child. */
  from: string;
  to: string;
  /** The entry whose `relations[index]` states this link (for editing it from the tree). */
  holder: string;
  index: number;
}

export interface FamilyTree {
  nodes: TreeNode[];
  edges: TreeEdge[];
  width: number;
  height: number;
  generations: number;
}

/**
 * Family tree laid out top-down by generation: parents above children, spouses side by side.
 * With a character focus, shows that character's family (everyone linked by parent, child, spouse
 * or sibling relations); otherwise every family in the world, side by side.
 * Contradictory data (parent cycles) still lays out; the first generation found wins.
 */
export function familyTree(world: World, focusId?: string | null, opts: { add?: readonly string[]; hide?: readonly string[] } = {}): FamilyTree {
  const ix = new WorldIndex(world);
  const edges: TreeEdge[] = [];
  const seen = new Set<string>();
  const add = (ed: TreeEdge) => {
    const key = ed.kind === 'parent' ? `p:${ed.from}>${ed.to}` : `${ed.kind}:${[ed.from, ed.to].sort().join('|')}`;
    if (ed.from === ed.to || seen.has(key)) return;
    seen.add(key);
    edges.push(ed);
  };
  for (const p of parentEdges(ix)) {
    const index = Number(/\[(\d+)\]/.exec(p.at.field)?.[1] ?? 0);
    if (p.parent.type === 'character' && p.child.type === 'character') add({ kind: 'parent', from: p.parent.id, to: p.child.id, holder: p.at.entryId, index });
  }
  for (const e of ix.entries) {
    if (e.type !== 'character') continue;
    (e.relations ?? []).forEach((r, index) => {
      const t = ix.resolve(r.target);
      if (t?.type !== 'character') return;
      if (r.type === 'spouse-of') add({ kind: 'spouse', from: e.id, to: t.id, holder: e.id, index });
      if (r.type === 'sibling-of') add({ kind: 'sibling', from: e.id, to: t.id, holder: e.id, index });
    });
  }
  // Hidden characters leave the view (and their lines with them); the entries are untouched.
  const hide = new Set((opts.hide ?? []).filter((id) => id !== focusId));
  for (let i = edges.length - 1; i >= 0; i--) if (hide.has(edges[i]!.from) || hide.has(edges[i]!.to)) edges.splice(i, 1);
  // Undirected adjacency with generation offsets.
  const adj = new Map<string, { id: string; dg: number }[]>();
  const link = (a: string, b: string, dg: number) => adj.set(a, [...(adj.get(a) ?? []), { id: b, dg }]);
  for (const ed of edges) {
    const dg = ed.kind === 'parent' ? 1 : 0;
    link(ed.from, ed.to, dg);
    link(ed.to, ed.from, -dg);
  }
  const chars = ix.entries.filter((e): e is Character => e.type === 'character');
  const byId = new Map(chars.map((c) => [c.id, c]));
  const bornLo = (c: Character) => ix.date(c.born)?.lo ?? Number.POSITIVE_INFINITY;
  const focus = focusId ? byId.get(focusId) : undefined;
  const added = (opts.add ?? []).flatMap((id) => (byId.has(id) && !hide.has(id) ? [byId.get(id)!] : []));
  const roots = [...(focus ? [focus] : chars.filter((c) => adj.has(c.id) && !hide.has(c.id)).sort((a, b) => bornLo(a) - bornLo(b) || a.name.localeCompare(b.name))), ...added];

  // Generations by breadth-first search, one component at a time.
  const gen = new Map<string, number>();
  const comps: string[][] = [];
  for (const root of roots) {
    if (gen.has(root.id)) continue;
    const comp = [root.id];
    gen.set(root.id, 0);
    for (let i = 0; i < comp.length; i++) {
      const cur = comp[i]!;
      for (const n of adj.get(cur) ?? []) {
        if (gen.has(n.id) || !byId.has(n.id)) continue;
        gen.set(n.id, gen.get(cur)! + n.dg);
        comp.push(n.id);
      }
    }
    const min = Math.min(...comp.map((id) => gen.get(id)!));
    for (const id of comp) gen.set(id, gen.get(id)! - min);
    comps.push(comp);
  }

  const { nodeW, nodeH, gapX, gapY, margin } = TREE_LAYOUT;
  const nodes: TreeNode[] = [];
  const pos = new Map<string, number>();
  const parentsOf = (id: string) => edges.filter((e) => e.kind === 'parent' && e.to === id).map((e) => e.from);
  const spousesOf = (id: string) => edges.filter((e) => e.kind === 'spouse' && (e.from === id || e.to === id)).map((e) => (e.from === id ? e.to : e.from));
  let offset = margin;
  let generations = 0;
  for (const comp of comps) {
    const depth = Math.max(...comp.map((id) => gen.get(id)!)) + 1;
    generations = Math.max(generations, depth);
    const rows: string[][] = [];
    for (let g = 0; g < depth; g++) {
      const ids = comp.filter((id) => gen.get(id) === g);
      const key = (id: string) => {
        const ps = parentsOf(id).filter((p) => pos.has(p));
        return ps.length ? ps.reduce((s, p) => s + pos.get(p)!, 0) / ps.length : Number.POSITIVE_INFINITY;
      };
      ids.sort((a, b) => key(a) - key(b) || bornLo(byId.get(a)!) - bornLo(byId.get(b)!) || byId.get(a)!.name.localeCompare(byId.get(b)!.name));
      // Spouses sit next to each other.
      const row: string[] = [];
      for (const id of ids) {
        if (row.includes(id)) continue;
        row.push(id);
        for (const s of spousesOf(id)) if (ids.includes(s) && !row.includes(s)) row.push(s);
      }
      row.forEach((id, i) => pos.set(id, i));
      rows.push(row);
    }
    const widest = Math.max(...rows.map((r) => r.length));
    const compW = widest * nodeW + (widest - 1) * gapX;
    rows.forEach((row, g) => {
      const rowW = row.length * nodeW + (row.length - 1) * gapX;
      const start = offset + (compW - rowW) / 2;
      row.forEach((id, i) => {
        const c = byId.get(id)!;
        const life = ix.life(c);
        const startText = life.start ? ix.fmt(life.start.date) : '?';
        const dates = !life.start && !life.end ? '' : life.end ? msg`${startText} – ${ix.fmt(life.end.date)}` : msg`${startText} –`;
        nodes.push({ id, entry: c, gen: g, x: start + i * (nodeW + gapX), y: margin + g * (nodeH + gapY), ended: isEnded(c), focus: id === focus?.id, dates });
      });
    });
    offset += compW + gapX * 2;
  }
  const shown = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: edges.filter((e) => shown.has(e.from) && shown.has(e.to)),
    width: nodes.length ? offset - gapX * 2 + margin : 0,
    height: generations ? margin * 2 + generations * nodeH + (generations - 1) * gapY : 0,
    generations,
  };
}
