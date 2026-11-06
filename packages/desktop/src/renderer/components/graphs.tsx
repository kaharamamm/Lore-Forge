import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon, SvgIcon } from './icon.tsx';
import { Portrait } from './cover.tsx';
import { usePanZoom, zoomIdentity, type PanZoom } from '../zoom.ts';
import { LIFECYCLE, TREE_LAYOUT, TYPE_ICON, TYPE_SINGULAR, type Entry, type FamilyTree, type TreeEdge } from '@lore-forge/core';

const clip = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s);

function nodeLabel(e: Entry, ended: boolean, dates?: string): string {
  const lc = LIFECYCLE[e.type];
  return `${TYPE_SINGULAR[e.type]} ${e.name}${ended && lc ? `, ${lc.endedWord}` : ''}${dates ? `, ${dates}` : ''}. Open.`;
}

/** One clickable SVG box. x/y is the top-left corner. */
function Node(props: { e: Entry; x: number; y: number; w: number; h: number; ended: boolean; focus: boolean; sub: string; raceName?: string; onOpen: (id: string) => void;
  onLinkStart?: (id: string, ev: PointerEvent) => void; onHide?: (id: string) => void }) {
  const { e, x, y, w, h, ended, focus } = props;
  const lc = LIFECYCLE[e.type];
  const open = () => props.onOpen(e.id);
  return (
    <g class={`node t-${e.type}${ended ? ' is-ended' : ''}${focus ? ' is-focus' : ''}`} role="button" tabIndex={0} aria-label={nodeLabel(e, ended, props.sub)} data-node-id={e.id}
      onClick={open} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } }}>
      <title>{`${TYPE_SINGULAR[e.type]}: ${e.name}${ended && lc ? ` (${lc.endedWord})` : ''}${props.sub ? `\n${props.sub}` : ''}`}</title>
      <rect x={x} y={y} width={w} height={h} rx={10} />
      <foreignObject x={x + 12} y={y + h / 2 - 16} width={32} height={32} class="node-portrait"><Portrait entry={e} raceName={props.raceName} size="sm" /></foreignObject>
      <text x={x + 52} y={y + h / 2 - 3} class="node-name">{clip(e.name, 13)}</text>
      {ended && lc && <SvgIcon class="node-mark" name={lc.endedIcon} x={x + w - 24} y={y + 6} size={16} />}
      <text x={x + 52} y={y + h / 2 + 15} class="node-sub">{clip(props.sub || TYPE_SINGULAR[e.type], 20)}</text>
      {props.onLinkStart && (
        <circle class="tree-connect" cx={x + w} cy={y + h / 2} r={7} onPointerDown={(ev) => { ev.stopPropagation(); props.onLinkStart!(e.id, ev); }} onClick={(ev) => ev.stopPropagation()}>
          <title>Drag onto another card to link them</title>
        </circle>
      )}
      {props.onHide && !focus && (
        <g class="node-hide" role="button" aria-label={`Remove ${e.name} from this view`} onClick={(ev) => { ev.stopPropagation(); props.onHide!(e.id); }}>
          <title>Remove from this view (the entry stays)</title>
          <circle cx={x + w - 10} cy={y + h - 10} r={8} />
          <path d={`M${x + w - 13} ${y + h - 13} l6 6 M${x + w - 7} ${y + h - 13} l-6 6`} />
        </g>
      )}
    </g>
  );
}

export function FamilyTreeSvg({ tree, onOpen, onConnect, onHide, onEdit }: {
  tree: FamilyTree; onOpen: (id: string) => void; onConnect?: (from: string, to: string) => void; onHide?: (id: string) => void; onEdit?: (edge: TreeEdge) => void;
}) {
  const { nodeW: w, nodeH: h } = TREE_LAYOUT;
  const at = new Map(tree.nodes.map((n) => [n.id, n]));
  const svg = useRef<SVGSVGElement>(null);
  const pz = usePanZoom(svg, { min: 0.2, max: 3, ignore: '.tree-connect, .node-hide, .edge-hit' });
  // A link being dragged from a card's connector: start point in layout units, pointer in layout units.
  const [drag, setDrag] = useState<{ from: string; x1: number; y1: number; x2: number; y2: number } | null>(null);
  const toLayout = (ev: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const [lx, ly] = pz.t.invert([ev.clientX - r.left, ev.clientY - r.top]);
    return { x: lx, y: ly };
  };
  const startLink = (from: string, ev: PointerEvent) => {
    const n = at.get(from)!;
    const p = toLayout(ev);
    setDrag({ from, x1: n.x + w, y1: n.y + h / 2, x2: p.x, y2: p.y });
    const move = (m: PointerEvent) => { const q = toLayout(m); setDrag((d) => d && { ...d, x2: q.x, y2: q.y }); };
    const up = (u: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      const hit = document.elementFromPoint(u.clientX, u.clientY)?.closest<SVGGElement>('[data-node-id]');
      const to = hit?.dataset['nodeId'];
      if (to && to !== from) onConnect?.(from, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const fit = () => {
    const el = svg.current;
    if (!el) return;
    const k = Math.min(1, (el.clientWidth - 24) / tree.width, (el.clientHeight - 24) / tree.height);
    pz.set(zoomIdentity.translate((el.clientWidth - tree.width * k) / 2, (el.clientHeight - tree.height * k) / 2).scale(k));
  };
  useLayoutEffect(fit, [tree]);
  return (
    <div class="zoom-frame">
    <svg ref={svg} class="graph family-tree" style={{ height: `clamp(14rem, ${tree.height + 48}px, 62vh)` }} role="group" aria-label={`Family tree, ${tree.generations} generations, ${tree.nodes.length} people. Drag to pan, Ctrl+scroll to zoom.`}>
      <g transform={pz.t.toString()}>
      <g class="edges">
        {tree.edges.map((ed, i) => {
          const a = at.get(ed.from)!;
          const b = at.get(ed.to)!;
          const hit = (d: string) => onEdit && (
            <path class="edge-hit" d={d} role="button" aria-label={`Edit the link between ${a.entry.name} and ${b.entry.name}`} onClick={() => onEdit(ed)}>
              <title>Click to edit or delete this link</title>
            </path>
          );
          if (ed.kind === 'parent') {
            // From the parent's bottom border to the child's top border; a child drawn higher up (a loop in the data)
            // is met at its bottom border, so the line never runs through its card.
            const x1 = a.x + w / 2, y1 = a.y + h, x2 = b.x + w / 2, below = b.y >= y1;
            const y2 = below ? b.y : b.y + h;
            const mid = below ? (y1 + y2) / 2 : Math.max(y1, y2) + 20;
            const d = `M${x1} ${y1} V${mid} H${x2} V${y2}`;
            return <g key={i} data-from={ed.from} data-to={ed.to}><path class="edge edge-parent" d={d} />{hit(d)}</g>;
          }
          const [l, r] = a.x <= b.x ? [a, b] : [b, a];
          if (ed.kind === 'spouse' && l.gen === r.gen) {
            const y = l.y + h / 2;
            return (
              <g key={i} data-from={l.id} data-to={r.id}>
                <line class="edge edge-spouse" x1={l.x + w} y1={y} x2={r.x} y2={y} />
                {hit(`M${l.x + w} ${y} H${r.x}`)}
                <SvgIcon class="edge-icon" name="diamond-ring" x={(l.x + w + r.x) / 2 - 8} y={y - 20} size={16} />
              </g>
            );
          }
          // An arc over the top: each end on its own card's top border, even when the two are on different rows.
          const x1 = l.x + w / 2, x2 = r.x + w / 2, top = Math.min(l.y, r.y) - 22;
          const d = `M${x1} ${l.y} C${x1} ${top}, ${x2} ${top}, ${x2} ${r.y}`;
          return <g key={i} data-from={l.id} data-to={r.id}><path class={`edge edge-${ed.kind}`} d={d} />{hit(d)}</g>;
        })}
      </g>
      {tree.nodes.map((n) => <Node key={n.id} e={n.entry} x={n.x} y={n.y} w={w} h={h} ended={n.ended} focus={n.focus} sub={n.dates} onOpen={onOpen}
        {...(onConnect ? { onLinkStart: startLink } : {})} {...(onHide ? { onHide } : {})} />)}
      {drag && <line class="edge edge-drag" x1={drag.x1} y1={drag.y1} x2={drag.x2} y2={drag.y2} />}
      </g>
    </svg>
    <ZoomControls pz={pz} onFit={fit} />
    </div>
  );
}

/** −, Fit and + for a pan-and-zoom canvas; the canvas itself also takes Ctrl+scroll and drag. */
export function ZoomControls({ pz, onFit }: { pz: PanZoom; onFit: () => void }) {
  return (
    <div class="zoom-controls" role="group" aria-label="Zoom">
      <button type="button" class="zoom-out" onClick={() => pz.zoomBy(1 / 1.4)} aria-label="Zoom out"><Icon name="contract" /></button>
      <button type="button" class="zoom-fit" onClick={onFit}>Fit</button>
      <button type="button" class="zoom-in" onClick={() => pz.zoomBy(1.4)} aria-label="Zoom in"><Icon name="expand" /></button>
    </div>
  );
}
