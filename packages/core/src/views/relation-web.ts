import { detailRelations } from '../details.ts';
import { isEnded } from '../lifecycle.ts';
import { RELATION_GROUPS, relationKind, relationLabel, type RelationGroup } from '../relation-kinds.ts';
import type { Entry, World } from '../types.ts';
import { WorldIndex } from '../world-index.ts';

export const WEB_LAYOUT = { nodeW: 168, nodeH: 52, margin: 24 } as const;

export interface WebNode {
  id: string;
  entry: Entry;
  /** Center point, in layout units. */
  x: number;
  y: number;
  ended: boolean;
  focus: boolean;
}

export interface WebEdge {
  from: string;
  to: string;
  type: string;
  /** Reads from -> to, e.g. "enemy of". */
  label: string;
  group: RelationGroup;
  groupLabel: string;
  /** The entry whose file holds this link. */
  holder: string;
  /** Index into the holder's `relations`, when it is a plain relation. */
  index?: number;
  /** Detail field the link comes from (e.g. "home"), when it is not a plain relation. Edit it in the editor. */
  field?: string;
}

export interface WebOptions {
  /** Extra entries to show (e.g. dropped onto the canvas), even when not related yet. */
  add?: readonly string[];
  /** Entries to leave out of the view (the entries themselves are untouched). */
  hide?: readonly string[];
}

export interface RelationWeb {
  nodes: WebNode[];
  edges: WebEdge[];
  width: number;
  height: number;
}

/**
 * The selected entry in the middle, everything it is related to around it (both directions),
 * neighbours sorted by relation group so allies, enemies and members cluster.
 * Relations between two neighbours are drawn too.
 */
export function relationWeb(world: World, focusId: string, opts: WebOptions = {}): RelationWeb | undefined {
  const ix = new WorldIndex(world);
  const focus = ix.byIdOf(focusId);
  if (!focus) return undefined;
  const all: WebEdge[] = [];
  for (const e of ix.entries) {
    const push = (from: Entry | undefined, to: Entry | undefined, type: string, link: { index?: number; field?: string }) => {
      if (!from || !to || from.id === to.id) return;
      const group = relationKind(type)?.group ?? 'other';
      all.push({ from: from.id, to: to.id, type, label: relationLabel(type), group, groupLabel: RELATION_GROUPS[group].label, holder: e.id, ...link });
    };
    (e.relations ?? []).forEach((r, index) => push(e, ix.resolve(r.target), r.type, { index }));
    for (const d of detailRelations(e)) push(ix.resolve(d.source), ix.resolve(d.target), d.type, { field: d.field });
  }
  const hide = new Set(opts.hide ?? []);
  hide.delete(focus.id);
  const touching = all.filter((ed) => ed.from === focus.id || ed.to === focus.id);
  const order = Object.keys(RELATION_GROUPS);
  const firstGroup = new Map<string, number>();
  for (const ed of touching) {
    const other = ed.from === focus.id ? ed.to : ed.from;
    const g = order.indexOf(ed.group);
    firstGroup.set(other, Math.min(firstGroup.get(other) ?? g, g));
  }
  for (const id of opts.add ?? []) if (id !== focus.id && ix.byIdOf(id) && !firstGroup.has(id)) firstGroup.set(id, order.length);
  const around = [...firstGroup.keys()]
    .filter((id) => !hide.has(id))
    .map((id) => ix.byIdOf(id)!)
    .sort((a, b) => firstGroup.get(a.id)! - firstGroup.get(b.id)! || a.name.localeCompare(b.name));
  const { nodeW, nodeH, margin } = WEB_LAYOUT;
  const n = around.length;
  // Radius big enough that neighbouring boxes on the circle do not overlap.
  const radius = n <= 1 ? nodeW : Math.max(nodeW, (nodeW + 24) / (2 * Math.sin(Math.PI / n)));
  const rx = radius;
  const ry = Math.max(nodeH * 2, radius * 0.7);
  const cx = margin + nodeW / 2 + rx;
  const cy = margin + nodeH / 2 + ry;
  const nodes: WebNode[] = [{ id: focus.id, entry: focus, x: cx, y: cy, ended: isEnded(focus), focus: true }];
  around.forEach((e, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
    nodes.push({ id: e.id, entry: e, x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a), ended: isEnded(e), focus: false });
  });
  const shown = new Set(nodes.map((x) => x.id));
  const edges = all.filter((ed) => shown.has(ed.from) && shown.has(ed.to));
  return { nodes, edges, width: 2 * (margin + nodeW / 2 + rx), height: 2 * (margin + nodeH / 2 + ry) };
}
