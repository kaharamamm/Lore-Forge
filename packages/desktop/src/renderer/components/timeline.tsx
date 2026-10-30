import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LIFECYCLE, TYPE_EMOJI, TYPE_LABELS, TYPE_SINGULAR, timelineModel, yearLabel, yearTicks, type EntryType, type TimelineLane, type Warning, type World } from '@lore-forge/core';
import { CountBadge } from './severity.tsx';

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 400;
const SEV_ICON = { error: '✖', warning: '▲', info: 'ℹ' } as const;

interface Hover { lane: TimelineLane; x: number; y: number }

/** Era-banded timeline: lifespans as bars, events as points, warnings as markers. Ctrl+wheel or −/+ to zoom. */
export function TimelineView({ world, warnings, selectedId, onOpen }: { world: World; warnings: Warning[]; selectedId: string | null; onOpen: (id: string) => void }) {
  const model = useMemo(() => timelineModel(world, warnings), [world, warnings]);
  const cal = world.manifest.calendar;
  const scroller = useRef<HTMLDivElement>(null);
  const labelCol = useRef<HTMLDivElement>(null);
  const [pxPerYear, setPxPerYear] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<EntryType>>(new Set());
  const [hover, setHover] = useState<Hover | null>(null);

  const years = model ? Math.max(1, (model.max - model.min) / model.daysPerYear) : 1;
  const fit = () => {
    const el = scroller.current;
    if (!el || !model) return 10;
    const avail = el.clientWidth - (labelCol.current?.offsetWidth ?? 240) - 48;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, avail / years));
  };
  useLayoutEffect(() => { if (pxPerYear === null && model) setPxPerYear(fit()); });

  if (!model) {
    return (
      <section class="timeline">
        <h2>🕰️ Timeline</h2>
        <div class="empty-state"><span class="empty-emoji" aria-hidden="true">⏳</span><p>Nothing has a date yet. Give a character a birth year, a place a founding year or an event a date, and it shows up here.</p></div>
      </section>
    );
  }
  const ppy = pxPerYear ?? 10;
  const ppd = ppy / model.daysPerYear;
  const width = Math.ceil(years * ppy) + 48;
  const xOf = (day: number) => 24 + (day - model.min) * ppd;
  const ticks = yearTicks(model, ppy);

  const zoom = (factor: number, anchorClientX?: number) => {
    const el = scroller.current;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, ppy * factor));
    if (!el) return setPxPerYear(next);
    const label = labelCol.current?.offsetWidth ?? 0;
    const rect = el.getBoundingClientRect();
    const ax = anchorClientX !== undefined ? anchorClientX - rect.left - label : (el.clientWidth - label) / 2;
    const dayAt = (el.scrollLeft + ax - 24) / ppd;
    setPxPerYear(next);
    requestAnimationFrame(() => { el.scrollLeft = dayAt * (next / model.daysPerYear) + 24 - ax; });
  };
  const onWheel = (ev: WheelEvent) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    zoom(ev.deltaY < 0 ? 1.25 : 0.8, ev.clientX);
  };
  const toggle = (t: EntryType) => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const groups = model.groups.filter((g) => !hidden.has(g.type));
  const lanes = model.groups.reduce((n, g) => n + g.lanes.length, 0);
  const flagged = model.groups.reduce((n, g) => n + g.lanes.filter((l) => l.warnings.length).length, 0);

  const show = (lane: TimelineLane, ev: MouseEvent | FocusEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    setHover({ lane, x: 'clientX' in ev ? ev.clientX : r.left + r.width / 2, y: r.bottom });
  };

  return (
    <section class="timeline" aria-labelledby="timeline-title">
      <header class="view-head">
        <h2 id="timeline-title" tabIndex={-1}>🕰️ Timeline</h2>
        <p class="muted">{lanes} dated entries, {model.eras.length} eras{flagged ? `, ${flagged} with warnings` : ''}. Hold Ctrl (⌘) and scroll to zoom.</p>
      </header>
      <div class="tl-toolbar">
        <div class="segmented" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoom(0.66)} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => setPxPerYear(fit())}>Fit</button>
          <button type="button" onClick={() => zoom(1.5)} aria-label="Zoom in">+</button>
        </div>
        <span class="muted tl-scale" aria-live="polite">{ppy >= 1 ? `${Math.round(ppy)} px per year` : `1 px ≈ ${Math.round(1 / ppy)} years`}</span>
        <div class="type-filters" role="group" aria-label="Show types">
          {model.groups.map((g) => (
            <button key={g.type} type="button" class={`pill t-${g.type}`} aria-pressed={!hidden.has(g.type)} onClick={() => toggle(g.type)}>
              <span aria-hidden="true">{TYPE_EMOJI[g.type]} </span>{TYPE_LABELS[g.type]} <span class="muted">{g.lanes.length}</span>
            </button>
          ))}
        </div>
      </div>

      <div class="tl-scroll" ref={scroller} onWheel={onWheel} onMouseLeave={() => setHover(null)}>
        <div class="tl-canvas" style={{ width: `calc(var(--tl-label) + ${width}px)` }}>
          <div class="tl-bands" style={{ width: `${width}px` }} aria-hidden="true">
            {model.eras.map((era, i) => (
              <div key={era.id} class={`tl-band band-${i % 2}`} style={{ left: `${xOf(era.from)}px`, width: `${Math.max(2, (era.to - era.from) * ppd)}px` }}>
                <span class="tl-band-name">{era.name}</span>
              </div>
            ))}
          </div>
          <div class="tl-row tl-axis">
            <div class="tl-label" ref={labelCol}><span class="muted">Eras · years</span></div>
            <div class="tl-track" style={{ width: `${width}px` }} aria-hidden="true">
              {ticks.map((t) => <span key={t.day} class="tl-tick" style={{ left: `${xOf(t.day)}px` }}>{yearLabel(t.day, cal)}</span>)}
            </div>
          </div>
          {model.eras.length > 0 && (
            <ul class="sr-only" aria-label="Eras">
              {model.eras.map((e) => <li key={e.id}>{e.name}: {yearLabel(e.from, cal)} to {yearLabel(e.to, cal)}</li>)}
            </ul>
          )}
          {groups.map((g) => (
            <div key={g.type} class={`tl-group t-${g.type}`} role="group" aria-label={TYPE_LABELS[g.type]}>
              <div class="tl-row tl-group-head">
                <div class="tl-label"><span aria-hidden="true">{TYPE_EMOJI[g.type]} </span>{TYPE_LABELS[g.type]}</div>
                <div class="tl-track" style={{ width: `${width}px` }} />
              </div>
              {g.lanes.map((lane) => {
                const e = lane.entry;
                const lc = LIFECYCLE[e.type];
                const left = xOf(lane.from);
                const w = Math.max(lane.point ? 0 : 6, (lane.to - lane.from) * ppd);
                const cls = `${lane.openStart ? ' open-start' : ''}${lane.openEnd ? ' open-end' : ''}${lane.ended ? ' is-ended' : ''}`;
                const label = `${TYPE_SINGULAR[e.type]} ${e.name}${lane.ended && lc ? `, ${lc.endedWord}` : ''}, ${lane.dates}${lane.warnings.length ? `, ${lane.warnings.length} warning${lane.warnings.length > 1 ? 's' : ''}` : ''}`;
                return (
                  <div key={e.id} class={`tl-row tl-lane${e.id === selectedId ? ' is-selected' : ''}`}>
                    <div class="tl-label">
                      <button type="button" class={`tl-name t-${e.type}${lane.ended ? ' is-ended' : ''}`} aria-label={`${label}. Open.`}
                        onClick={() => onOpen(e.id)} onFocus={(ev) => show(lane, ev)} onBlur={() => setHover(null)}>
                        <span aria-hidden="true">{TYPE_EMOJI[e.type]} </span>{e.name}{lane.ended && lc ? <span aria-hidden="true"> {lc.endedMark}</span> : null}
                      </button>
                      <CountBadge warnings={lane.warnings} />
                    </div>
                    <div class="tl-track" style={{ width: `${width}px` }}>
                      <button type="button" tabIndex={-1} aria-hidden="true" class={`tl-mark ${lane.point ? 'tl-point' : 'tl-bar'} t-${e.type}${cls}`}
                        style={{ left: `${left}px`, width: lane.point ? undefined : `${w}px` }}
                        onClick={() => onOpen(e.id)} onMouseEnter={(ev) => show(lane, ev)} onMouseMove={(ev) => show(lane, ev)} onMouseLeave={() => setHover(null)}>
                        {lane.point ? null : <span class="tl-bar-text">{w > 90 ? e.name : ''}</span>}
                      </button>
                      {lane.worst && (
                        <button type="button" tabIndex={-1} aria-hidden="true" class={`tl-warn sev-${lane.worst}`} style={{ left: `${left + (lane.point ? 10 : w) + 4}px` }}
                          onClick={() => onOpen(e.id)} onMouseEnter={(ev) => show(lane, ev)} onMouseLeave={() => setHover(null)}>
                          {SEV_ICON[lane.worst]} {lane.warnings.length}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {hover && <TimelineCard hover={hover} />}
    </section>
  );
}

function TimelineCard({ hover }: { hover: Hover }) {
  const { lane } = hover;
  const e = lane.entry;
  const lc = LIFECYCLE[e.type];
  const left = Math.min(hover.x + 12, window.innerWidth - 340);
  const top = Math.min(hover.y + 8, window.innerHeight - 200);
  return (
    <div class={`hover-card t-${e.type}`} role="tooltip" style={{ left: `${Math.max(8, left)}px`, top: `${Math.max(8, top)}px` }}>
      <p class="hover-title"><span aria-hidden="true">{TYPE_EMOJI[e.type]} </span><strong>{e.name}</strong> <span class="muted">· {TYPE_SINGULAR[e.type]}</span></p>
      <p>{lane.dates}{lane.ended && lc ? ` · ${lc.endedMark} ${lc.endedWord}` : ''}</p>
      {lane.warnings.slice(0, 3).map((w, i) => <p key={i} class={`hover-warn sev-${w.severity}`}><span aria-hidden="true">{SEV_ICON[w.severity]} </span>{w.message}</p>)}
      {lane.warnings.length > 3 && <p class="muted">and {lane.warnings.length - 3} more…</p>}
      <p class="muted small">Click to open</p>
    </div>
  );
}
