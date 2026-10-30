import { useLayoutEffect, useRef } from 'preact/hooks';
import { Icon, SvgIcon } from './icon.tsx';
import { Portrait } from './cover.tsx';
import { usePanZoom, zoomIdentity, type PanZoom } from '../zoom.ts';
import { LIFECYCLE, TREE_LAYOUT, TYPE_ICON, TYPE_SINGULAR, type Entry, type FamilyTree } from '@lore-forge/core';

const clip = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s);

function nodeLabel(e: Entry, ended: boolean, dates?: string): string {
  const lc = LIFECYCLE[e.type];
  return `${TYPE_SINGULAR[e.type]} ${e.name}${ended && lc ? `, ${lc.endedWord}` : ''}${dates ? `, ${dates}` : ''}. Open.`;
}

/** One clickable SVG box. x/y is the top-left corner. */
function Node(props: { e: Entry; x: number; y: number; w: number; h: number; ended: boolean; focus: boolean; sub: string; raceName?: string; onOpen: (id: string) => void }) {
  const { e, x, y, w, h, ended, focus } = props;
  const lc = LIFECYCLE[e.type];
  const open = () => props.onOpen(e.id);
  return (
    <g class={`node t-${e.type}${ended ? ' is-ended' : ''}${focus ? ' is-focus' : ''}`} role="button" tabIndex={0} aria-label={nodeLabel(e, ended, props.sub)}
      onClick={open} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } }}>
      <title>{`${TYPE_SINGULAR[e.type]}: ${e.name}${ended && lc ? ` (${lc.endedWord})` : ''}${props.sub ? `\n${props.sub}` : ''}`}</title>
      <rect x={x} y={y} width={w} height={h} rx={10} />
      <rect class="node-stripe" x={x} y={y} width={6} height={h} rx={3} />
      <foreignObject x={x + 12} y={y + h / 2 - 16} width={32} height={32} class="node-portrait"><Portrait entry={e} raceName={props.raceName} size="sm" /></foreignObject>
      <text x={x + 52} y={y + h / 2 - 3} class="node-name">{clip(e.name, 13)}</text>
      {ended && lc && <SvgIcon class="node-mark" name={lc.endedIcon} x={x + w - 24} y={y + 6} size={16} />}
      <text x={x + 52} y={y + h / 2 + 15} class="node-sub">{clip(props.sub || TYPE_SINGULAR[e.type], 20)}</text>
    </g>
  );
}

export function FamilyTreeSvg({ tree, onOpen }: { tree: FamilyTree; onOpen: (id: string) => void }) {
  const { nodeW: w, nodeH: h } = TREE_LAYOUT;
  const at = new Map(tree.nodes.map((n) => [n.id, n]));
  const svg = useRef<SVGSVGElement>(null);
  const pz = usePanZoom(svg, { min: 0.2, max: 3 });
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
      <g class="edges" aria-hidden="true">
        {tree.edges.map((ed, i) => {
          const a = at.get(ed.from)!;
          const b = at.get(ed.to)!;
          if (ed.kind === 'parent') {
            const x1 = a.x + w / 2, y1 = a.y + h, x2 = b.x + w / 2, y2 = b.y;
            const mid = y2 > y1 ? (y1 + y2) / 2 : y1 + 20;
            return <path key={i} class="edge edge-parent" d={`M${x1} ${y1} V${mid} H${x2} V${y2}`} />;
          }
          const [l, r] = a.x <= b.x ? [a, b] : [b, a];
          if (ed.kind === 'spouse' && l.gen === r.gen) {
            const y = l.y + h / 2;
            return (
              <g key={i}>
                <line class="edge edge-spouse" x1={l.x + w} y1={y} x2={r.x} y2={y} />
                <SvgIcon class="edge-icon" name="diamond-ring" x={(l.x + w + r.x) / 2 - 8} y={y - 20} size={16} />
              </g>
            );
          }
          const x1 = l.x + w / 2, x2 = r.x + w / 2, y = Math.min(l.y, r.y);
          return <path key={i} class={`edge edge-${ed.kind}`} d={`M${x1} ${y} C${x1} ${y - 22}, ${x2} ${y - 22}, ${x2} ${y}`} />;
        })}
      </g>
      {tree.nodes.map((n) => <Node key={n.id} e={n.entry} x={n.x} y={n.y} w={w} h={h} ended={n.ended} focus={n.focus} sub={n.dates} onOpen={onOpen} {...(n.entry.type === 'character' && n.entry.race ? { raceName: n.entry.race } : {})} />)}
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
