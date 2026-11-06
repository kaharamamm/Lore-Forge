import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Background, ConnectionMode, Controls, Handle, MiniMap, Position, ReactFlow, type Connection, type Edge, type EdgeProps, type FitViewOptions, type Node, type NodeProps, useInternalNode } from '@xyflow/react';
import { LIFECYCLE, raceLabel, relationKind, TYPE_SINGULAR, WEB_LAYOUT, WorldIndex, type Entry, type RelationWeb, type WebEdge as CoreWebEdge, type World } from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { Portrait } from './cover.tsx';

type EntryNodeData = { entry: Entry; raceName?: string; ended: boolean; focus: boolean; onOpen: (id: string) => void; onHide?: (id: string) => void; editable: boolean };
type EntryNode = Node<EntryNodeData, 'entry'>;
type WebEdgeData = { label: string; group: string; bend: number; arrow: boolean; edge: CoreWebEdge };
type WebEdge = Edge<WebEdgeData, 'web'>;

const { nodeW: W, nodeH: H } = WEB_LAYOUT;

/** A portrait card. The button inside is the keyboard target; the two hidden handles only let React Flow draw the links (each link finds the cards' borders itself). */
function EntryNodeView({ data }: NodeProps<EntryNode>) {
  const { entry: e, ended, focus } = data;
  const lc = LIFECYCLE[e.type];
  return (
    <div class={`node t-${e.type}${ended ? ' is-ended' : ''}${focus ? ' is-focus' : ''}`}>
      <Handle type="target" position={Position.Top} class="web-handle" isConnectable={false} />
      <button type="button" class="web-node" onClick={() => data.onOpen(e.id)}
        aria-label={`${TYPE_SINGULAR[e.type]} ${e.name}${ended && lc ? `, ${lc.endedWord}` : ''}. Open.`}>
        <Portrait entry={e} raceName={data.raceName} size="sm" />
        <span class="web-node-text">
          <span class="web-node-name">{e.name}</span>
          <span class="web-node-sub">{ended && lc ? <><Icon name={lc.endedIcon} /> {lc.endedWord}</> : data.raceName ?? TYPE_SINGULAR[e.type]}</span>
        </span>
      </button>
      <Handle type="source" position={Position.Bottom} class="web-handle" isConnectable={false} />
      {data.editable && <Handle type="source" id="connect" position={Position.Right} class="web-connect" title="Drag onto another card to link them" />}
      {data.onHide && !focus && (
        <button type="button" class="node-hide-btn nodrag" aria-label={`Remove ${e.name} from this view`} title="Remove from this view (the entry stays)" onClick={() => data.onHide!(e.id)}>×</button>
      )}
    </div>
  );
}

/** How far apart (px) the curves of links between the same two cards bow, per step. */
const BEND = 46;

type Box = { x: number; y: number; w: number; h: number };
/** Where the ray from the box's centre towards (tx, ty) leaves the box: the point on its border. */
export function borderPoint(b: Box, tx: number, ty: number): { x: number; y: number } {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * A floating link: it starts on the border of the source card and ends on the border of the target card, wherever
 * the cards are (dragged or laid out), with the arrow's tip on the border. The geometry comes from the measured
 * cards (useInternalNode), not from the hidden handles. Links between the same two cards bow out to both sides
 * (bend -0.5 and +0.5 for two); each end leaves its card towards the curve's control point, so the curve meets the
 * border head-on. The label sits on the curve's middle, on a small backing so lines never run through the text.
 */
function WebEdgeView({ id, source, target, data }: EdgeProps<WebEdge>) {
  const s = useInternalNode<EntryNode>(source), t = useInternalNode<EntryNode>(target);
  const label = useRef<SVGTextElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // The label's backing fits the text; measured after each render (it only changes with the text or the font).
  useLayoutEffect(() => {
    const b = label.current?.getBBox();
    if (b && b.width && (Math.abs(b.width - (size?.w ?? 0)) > 0.5 || Math.abs(b.height - (size?.h ?? 0)) > 0.5)) setSize({ w: b.width, h: b.height });
  });
  if (!s || !t) return null;
  const box = (n: NonNullable<typeof s>): Box => ({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured.width ?? W, h: n.measured.height ?? H });
  const a = box(s), b = box(t);
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const bend = (data?.bend ?? 0) * BEND * 2;
  // (cx, cy): the control point, bowed along the unit normal; each end aims at it from its card's centre.
  const cx = (ax + bx) / 2 + (-dy / len) * bend, cy = (ay + by) / 2 + (dx / len) * bend;
  const p1 = borderPoint(a, bend ? cx : bx, bend ? cy : by);
  const p2 = borderPoint(b, bend ? cx : ax, bend ? cy : ay);
  const d = bend ? `M${p1.x} ${p1.y} Q${cx} ${cy} ${p2.x} ${p2.y}` : `M${p1.x} ${p1.y} L${p2.x} ${p2.y}`;
  // The middle of the drawn curve (t = 0.5).
  const lx = bend ? (p1.x + 2 * cx + p2.x) / 4 : (p1.x + p2.x) / 2, ly = bend ? (p1.y + 2 * cy + p2.y) / 4 : (p1.y + p2.y) / 2;
  return (
    <g class={`web-edge g-${data?.group ?? 'other'}`} data-source={source} data-target={target}>
      <path id={id} class="edge" d={d} marker-end={data?.arrow ? 'url(#web-arrow)' : undefined} />
      <path class="edge-hit" d={d}><title>Click to edit or delete this link</title></path>
      {data?.label && (
        <g class="edge-label-group" transform={`translate(${lx} ${ly})`}>
          {size && <rect class="edge-label-bg" x={-size.w / 2 - 5} y={-size.h / 2 - 2} width={size.w + 10} height={size.h + 4} rx={4} />}
          <text ref={label} class="edge-label" x={0} y={0} text-anchor="middle" dominant-baseline="central">{data.label}</text>
        </g>
      )}
    </g>
  );
}

const nodeTypes = { entry: EntryNodeView };
/**
 * Fitting the web leaves the right side free for the zoom buttons (top right) and the minimap (bottom right), so no
 * card sits under them, and never zooms in past 100%, so labels keep their size. The canvas is usually wider than
 * the web needs, so the room comes off the side.
 */
const FIT: FitViewOptions = { padding: { top: '28px', bottom: '28px', left: '28px', right: '190px' }, maxZoom: 1 };
const edgeTypes = { web: WebEdgeView };

/**
 * The relationship web on a pan-and-zoom canvas (React Flow through preact/compat):
 * the core layout places the boxes; drag to pan, Ctrl+scroll or the buttons to zoom, drag a card to move it.
 */
export function RelationWebFlow({ world, web, onOpen, onConnect, onHide, onEdit }: {
  world: World; web: RelationWeb; onOpen: (id: string) => void; onConnect?: (from: string, to: string) => void; onHide?: (id: string) => void; onEdit?: (edge: CoreWebEdge) => void;
}) {
  const ix = useMemo(() => new WorldIndex(world), [world]);
  const nodes = useMemo((): EntryNode[] => web.nodes.map((n) => ({
    id: n.id, type: 'entry', position: { x: n.x - W / 2, y: n.y - H / 2 }, width: W, height: H,
    data: { entry: n.entry, ended: n.ended, focus: n.focus, onOpen, editable: !!onConnect, ...(onHide ? { onHide } : {}), ...(n.entry.type === 'character' && n.entry.race ? { raceName: n.entry.race.split(',').map((r) => raceLabel(r.trim(), (x) => ix.resolve(x)?.name)).join(', ') } : {}) },
  })), [web, ix, onOpen, onHide, onConnect]);
  const edges = useMemo((): WebEdge[] => {
    // Links between the same two cards spread evenly to both sides of the straight line. The side is taken along
    // the pair in a fixed order, so "A ally of B" and "B enemy of A" bow apart rather than onto each other.
    const pairOf = (ed: CoreWebEdge) => [ed.from, ed.to].sort().join('|');
    const total = new Map<string, number>();
    for (const ed of web.edges) total.set(pairOf(ed), (total.get(pairOf(ed)) ?? 0) + 1);
    const seen = new Map<string, number>();
    return web.edges.map((ed, i) => {
      const pair = pairOf(ed);
      const k = seen.get(pair) ?? 0;
      seen.set(pair, k + 1);
      const bend = (k - ((total.get(pair) ?? 1) - 1) / 2) * (ed.from < ed.to ? 1 : -1);
      return { id: `e${i}`, source: ed.from, target: ed.to, type: 'web', data: { label: ed.label, group: ed.group, bend, arrow: !relationKind(ed.type)?.symmetric, edge: ed } };
    });
  }, [web]);
  return (
    <div class="graph relation-web flow" role="group" aria-label={`Relationship web, ${web.nodes.length - 1} related entries. Drag to pan, Ctrl+scroll to zoom.`}>
      <svg class="flow-defs" aria-hidden="true" width="0" height="0">
        <defs>
          <marker id="web-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" class="arrow-head" />
          </marker>
        </defs>
      </svg>
      <ReactFlow<EntryNode, WebEdge> defaultNodes={nodes} defaultEdges={edges} key={`${web.nodes.map((n) => n.id).join(',')}|${web.edges.map((e) => `${e.holder}:${e.index ?? e.field}:${e.type}`).join(',')}`} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        colorMode="dark" fitView fitViewOptions={FIT} minZoom={0.2} maxZoom={2.5}
        nodesConnectable={!!onConnect} connectionMode={ConnectionMode.Loose} connectionRadius={80}
        onConnect={(c: Connection) => c.source && c.target && onConnect?.(c.source, c.target)}
        onEdgeClick={(_ev, edge) => edge.data && onEdit?.(edge.data.edge)}
        nodesFocusable={false} edgesFocusable={false} elementsSelectable={false}
        zoomOnScroll={false} zoomActivationKeyCode={['Control', 'Meta']} preventScrolling={false} zoomOnDoubleClick
        proOptions={{ hideAttribution: true }}>
        <Background gap={24} size={1} />
        <MiniMap pannable zoomable ariaLabel="Overview of the web" style={{ width: 150, height: 100 }} nodeClassName={(n) => `mini t-${(n.data as EntryNodeData).entry.type}`} nodeBorderRadius={8} />
        <Controls showInteractive={false} position="top-right" fitViewOptions={FIT} />
      </ReactFlow>
    </div>
  );
}
