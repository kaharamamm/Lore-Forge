import { LIFECYCLE, relationKind, TREE_LAYOUT, TYPE_EMOJI, TYPE_SINGULAR, WEB_LAYOUT, type Entry, type FamilyTree, type RelationWeb } from '@lore-forge/core';

const clip = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s);

function nodeLabel(e: Entry, ended: boolean, dates?: string): string {
  const lc = LIFECYCLE[e.type];
  return `${TYPE_SINGULAR[e.type]} ${e.name}${ended && lc ? `, ${lc.endedWord}` : ''}${dates ? `, ${dates}` : ''}. Open.`;
}

/** One clickable SVG box. x/y is the top-left corner. */
function Node(props: { e: Entry; x: number; y: number; w: number; h: number; ended: boolean; focus: boolean; sub: string; onOpen: (id: string) => void }) {
  const { e, x, y, w, h, ended, focus } = props;
  const lc = LIFECYCLE[e.type];
  const open = () => props.onOpen(e.id);
  return (
    <g class={`node t-${e.type}${ended ? ' is-ended' : ''}${focus ? ' is-focus' : ''}`} role="button" tabIndex={0} aria-label={nodeLabel(e, ended, props.sub)}
      onClick={open} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } }}>
      <title>{`${TYPE_SINGULAR[e.type]}: ${e.name}${ended && lc ? ` (${lc.endedWord})` : ''}${props.sub ? `\n${props.sub}` : ''}`}</title>
      <rect x={x} y={y} width={w} height={h} rx={10} />
      <rect class="node-stripe" x={x} y={y} width={6} height={h} rx={3} />
      <text x={x + 16} y={y + h / 2 - 4} class="node-name">
        {`${TYPE_EMOJI[e.type]} ${clip(e.name, 17)}${ended && lc ? ` ${lc.endedMark}` : ''}`}
      </text>
      <text x={x + 16} y={y + h / 2 + 15} class="node-sub">{clip(props.sub || TYPE_SINGULAR[e.type], 26)}</text>
    </g>
  );
}

export function FamilyTreeSvg({ tree, onOpen }: { tree: FamilyTree; onOpen: (id: string) => void }) {
  const { nodeW: w, nodeH: h } = TREE_LAYOUT;
  const at = new Map(tree.nodes.map((n) => [n.id, n]));
  return (
    <svg class="graph family-tree" width={tree.width} height={tree.height} viewBox={`0 0 ${tree.width} ${tree.height}`} role="group" aria-label={`Family tree, ${tree.generations} generations, ${tree.nodes.length} people`}>
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
                <text class="edge-icon" x={(l.x + w + r.x) / 2} y={y - 6} text-anchor="middle">💍</text>
              </g>
            );
          }
          const x1 = l.x + w / 2, x2 = r.x + w / 2, y = Math.min(l.y, r.y);
          return <path key={i} class={`edge edge-${ed.kind}`} d={`M${x1} ${y} C${x1} ${y - 22}, ${x2} ${y - 22}, ${x2} ${y}`} />;
        })}
      </g>
      {tree.nodes.map((n) => <Node key={n.id} e={n.entry} x={n.x} y={n.y} w={w} h={h} ended={n.ended} focus={n.focus} sub={n.dates} onOpen={onOpen} />)}
    </svg>
  );
}

export function RelationWebSvg({ web, onOpen }: { web: RelationWeb; onOpen: (id: string) => void }) {
  const { nodeW: w, nodeH: h } = WEB_LAYOUT;
  const at = new Map(web.nodes.map((n) => [n.id, n]));
  // Two relations between the same pair are drawn as separate curves.
  const seen = new Map<string, number>();
  return (
    <svg class="graph relation-web" width={web.width} height={web.height} viewBox={`0 0 ${web.width} ${web.height}`} role="group" aria-label={`Relationship web, ${web.nodes.length - 1} related entries`}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" class="arrow-head" />
        </marker>
      </defs>
      <g class="edges" aria-hidden="true">
        {web.edges.map((ed, i) => {
          const a = at.get(ed.from)!;
          const b = at.get(ed.to)!;
          const pair = [ed.from, ed.to].sort().join('|');
          const k = seen.get(pair) ?? 0;
          seen.set(pair, k + 1);
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          // Stop the line at the box edge so the arrow is visible.
          const t = Math.min((w / 2) / Math.abs(dx || 1e-9), (h / 2) / Math.abs(dy || 1e-9), 0.45);
          const x1 = a.x + dx * t, y1 = a.y + dy * t, x2 = b.x - dx * t, y2 = b.y - dy * t;
          const bend = k * 28;
          const nx = (-dy / len) * bend, ny = (dx / len) * bend;
          const mx = (x1 + x2) / 2 + nx, my = (y1 + y2) / 2 + ny;
          const symmetric = relationKind(ed.type)?.symmetric;
          return (
            <g key={i} class={`web-edge g-${ed.group}`}>
              <path class="edge" d={`M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`} marker-end={symmetric ? undefined : 'url(#arrow)'} />
              <text class="edge-label" x={mx} y={my - 4} text-anchor="middle">{ed.label}</text>
            </g>
          );
        })}
      </g>
      {web.nodes.map((n) => <Node key={n.id} e={n.entry} x={n.x - w / 2} y={n.y - h / 2} w={w} h={h} ended={n.ended} focus={n.focus} sub={TYPE_SINGULAR[n.entry.type]} onOpen={onOpen} />)}
    </svg>
  );
}
