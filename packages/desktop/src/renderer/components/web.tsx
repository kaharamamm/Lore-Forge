import { useMemo } from 'preact/hooks';
import { Background, ConnectionMode, Controls, Handle, MiniMap, Position, ReactFlow, type Connection, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import { LIFECYCLE, relationKind, TYPE_SINGULAR, WEB_LAYOUT, WorldIndex, type Entry, type RelationWeb, type WebEdge as CoreWebEdge, type World } from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { Portrait } from './cover.tsx';

type EntryNodeData = { entry: Entry; raceName?: string; ended: boolean; focus: boolean; onOpen: (id: string) => void; onHide?: (id: string) => void; editable: boolean };
type EntryNode = Node<EntryNodeData, 'entry'>;
type WebEdgeData = { label: string; group: string; bend: number; arrow: boolean; edge: CoreWebEdge };
type WebEdge = Edge<WebEdgeData, 'web'>;

const { nodeW: W, nodeH: H } = WEB_LAYOUT;

/** A portrait card. The button inside is the keyboard target; both handles sit at the centre so edges can float. */
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

/** Centre-to-centre curve, cut at both boxes so the arrow stays visible; repeated pairs bend apart. */
function WebEdgeView({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<WebEdge>) {
  const dx = targetX - sourceX, dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.min((W / 2 + 4) / Math.abs(dx || 1e-9), (H / 2 + 4) / Math.abs(dy || 1e-9), 0.45);
  const x1 = sourceX + dx * t, y1 = sourceY + dy * t, x2 = targetX - dx * t, y2 = targetY - dy * t;
  const bend = (data?.bend ?? 0) * 28;
  const mx = (x1 + x2) / 2 + (-dy / len) * bend, my = (y1 + y2) / 2 + (dx / len) * bend;
  return (
    <g class={`web-edge g-${data?.group ?? 'other'}`}>
      <path id={id} class="edge" d={`M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`} marker-end={data?.arrow ? 'url(#web-arrow)' : undefined} />
      <path class="edge-hit" d={`M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`}><title>Click to edit or delete this link</title></path>
      <text class="edge-label" x={mx} y={my - 4} text-anchor="middle">{data?.label}</text>
    </g>
  );
}

const nodeTypes = { entry: EntryNodeView };
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
    data: { entry: n.entry, ended: n.ended, focus: n.focus, onOpen, editable: !!onConnect, ...(onHide ? { onHide } : {}), ...(n.entry.type === 'character' && n.entry.race ? { raceName: n.entry.race.split(',').map((r) => ix.nameOf(r.trim())).join(', ') } : {}) },
  })), [web, ix, onOpen, onHide, onConnect]);
  const edges = useMemo((): WebEdge[] => {
    const seen = new Map<string, number>();
    return web.edges.map((ed, i) => {
      const pair = [ed.from, ed.to].sort().join('|');
      const bend = seen.get(pair) ?? 0;
      seen.set(pair, bend + 1);
      return { id: `e${i}`, source: ed.from, target: ed.to, type: 'web', data: { label: ed.label, group: ed.group, bend, arrow: !relationKind(ed.type)?.symmetric, edge: ed } };
    });
  }, [web]);
  return (
    <div class="graph relation-web flow" role="group" aria-label={`Relationship web, ${web.nodes.length - 1} related entries. Drag to pan, Ctrl+scroll to zoom.`}>
      <svg class="flow-defs" aria-hidden="true" width="0" height="0">
        <defs>
          <marker id="web-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" class="arrow-head" />
          </marker>
        </defs>
      </svg>
      <ReactFlow<EntryNode, WebEdge> defaultNodes={nodes} defaultEdges={edges} key={`${web.nodes.map((n) => n.id).join(',')}|${web.edges.map((e) => `${e.holder}:${e.index ?? e.field}:${e.type}`).join(',')}`} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        colorMode="dark" fitView fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }} minZoom={0.2} maxZoom={2.5}
        nodesConnectable={!!onConnect} connectionMode={ConnectionMode.Loose} connectionRadius={80}
        onConnect={(c: Connection) => c.source && c.target && onConnect?.(c.source, c.target)}
        onEdgeClick={(_ev, edge) => edge.data && onEdit?.(edge.data.edge)}
        nodesFocusable={false} edgesFocusable={false} elementsSelectable={false}
        zoomOnScroll={false} zoomActivationKeyCode={['Control', 'Meta']} preventScrolling={false} zoomOnDoubleClick
        proOptions={{ hideAttribution: true }}>
        <Background gap={24} size={1} />
        <MiniMap pannable zoomable ariaLabel="Overview of the web" nodeClassName={(n) => `mini t-${(n.data as EntryNodeData).entry.type}`} nodeBorderRadius={8} />
        <Controls showInteractive={false} position="top-right" />
      </ReactFlow>
    </div>
  );
}
