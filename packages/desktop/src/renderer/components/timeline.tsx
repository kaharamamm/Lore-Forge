import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { usePanZoom, zoomIdentity } from '../zoom.ts';
import { LIFECYCLE, TYPE_ICON, TYPE_LABELS, TYPE_SINGULAR, timelineModel, yearLabel, yearTicks, type EntryType, type TimelineLane, type Warning, type World } from '@lore-forge/core';
import { CountBadge } from './severity.tsx';
import { Icon } from './icon.tsx';
import { SEVERITY_ICON } from './severity.tsx';

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 400;

interface Hover { lane: TimelineLane; x: number; y: number }

/**
 * Era-banded timeline: lifespans as bars, events as points, warnings as markers.
 * d3-zoom on the time axis: drag or Shift+scroll to pan, Ctrl+scroll or −/+ to zoom. Lanes scroll up and down natively.
 */
export function TimelineView({ world, warnings, selectedId, onOpen }: { world: World; warnings: Warning[]; selectedId: string | null; onOpen: (id: string) => void }) {
  const model = useMemo(() => timelineModel(world, warnings), [world, warnings]);
  const cal = world.manifest.calendar;
  const scroller = useRef<HTMLDivElement>(null);
  const labelCol = useRef<HTMLDivElement>(null);
  /** Pixels per year that fit the whole span; zoom scales from there. */
  const [basePpy, setBasePpy] = useState<number | null>(null);
  const [trackW, setTrackW] = useState(0);
  const [hidden, setHidden] = useState<Set<EntryType>>(new Set());
  const [hover, setHover] = useState<Hover | null>(null);

  const years = model ? Math.max(1, (model.max - model.min) / model.daysPerYear) : 1;
  const fit = () => {
    const el = scroller.current;
    if (!el || !model) return 10;
    const avail = el.clientWidth - (labelCol.current?.offsetWidth ?? 240) - 48;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, avail / years));
  };
  useLayoutEffect(() => { if (basePpy === null && model) setBasePpy(fit()); });
  const base = basePpy ?? 10;
  const pz = usePanZoom(scroller, { min: ZOOM_MIN / base, max: ZOOM_MAX / base, xOnly: true, ignore: '.tl-label, .tl-group-head' });
  // The visible track width follows the window.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setTrackW(Math.max(0, el.clientWidth - (labelCol.current?.offsetWidth ?? 240)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scroller.current]);

  if (!model) {
    return (
      <section class="timeline">
        <h2><Icon name="hourglass" /> Timeline</h2>
        <div class="empty-state"><Icon class="empty-icon" name="sands-of-time" /><p>Nothing has a date yet. Give a character a birth year, a place a founding year or an event a date, and it shows up here.</p></div>
      </section>
    );
  }
  const ppy = base * pz.t.k;
  const ppd = ppy / model.daysPerYear;
  const label = labelCol.current?.offsetWidth ?? 0;
  const width = trackW || Math.ceil(years * ppy) + 48;
  // d3-zoom works in scroller coordinates (label column included); tracks start after the label column.
  const xOf = (day: number) => pz.t.applyX(label + 24 + (day - model.min) * (base / model.daysPerYear)) - label;
  const ticks = yearTicks(model, ppy).filter((t) => { const x = xOf(t.day); return x >= -40 && x <= width + 40; });
  const fitAll = () => pz.set(zoomIdentity);
  /** Shift+scroll, or a sideways trackpad swipe, pans along time; a plain wheel scrolls the lanes. */
  const onWheel = (ev: WheelEvent) => {
    if (ev.ctrlKey || ev.metaKey) return;
    const dx = ev.shiftKey ? ev.deltaY || ev.deltaX : Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : 0;
    if (!dx) return;
    ev.preventDefault();
    pz.panBy(-dx, 0);
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
        <h2 id="timeline-title" tabIndex={-1}><Icon name="hourglass" /> Timeline</h2>
        <p class="muted">{lanes} dated entries, {model.eras.length} eras{flagged ? `, ${flagged} with warnings` : ''}. Drag or Shift+scroll to move along time, Ctrl (⌘)+scroll to zoom.</p>
      </header>
      <div class="tl-toolbar">
        <div class="segmented" role="group" aria-label="Zoom">
          <button type="button" class="tl-zoom-out" onClick={() => pz.zoomBy(1 / 1.5)} aria-label="Zoom out"><Icon name="contract" /></button>
          <button type="button" class="tl-fit" onClick={() => { setBasePpy(fit()); fitAll(); }}>Fit</button>
          <button type="button" class="tl-zoom-in" onClick={() => pz.zoomBy(1.5)} aria-label="Zoom in"><Icon name="expand" /></button>
          <button type="button" onClick={() => pz.panBy(trackW / 3, 0)} aria-label="Earlier"><Icon name="fast-backward-button" /></button>
          <button type="button" onClick={() => pz.panBy(-trackW / 3, 0)} aria-label="Later"><Icon name="fast-forward-button" /></button>
        </div>
        <span class="muted tl-scale" aria-live="polite">{ppy >= 1 ? `${Math.round(ppy)} px per year` : `1 px ≈ ${Math.round(1 / ppy)} years`}</span>
        <div class="type-filters" role="group" aria-label="Show types">
          {model.groups.map((g) => (
            <button key={g.type} type="button" class={`pill t-${g.type}`} aria-pressed={!hidden.has(g.type)} onClick={() => toggle(g.type)}>
              <Icon name={TYPE_ICON[g.type]} /> {TYPE_LABELS[g.type]} <span class="muted">{g.lanes.length}</span>
            </button>
          ))}
        </div>
      </div>

      <div class="tl-scroll" ref={scroller} onWheel={onWheel} onMouseLeave={() => setHover(null)}>
        <div class="tl-canvas">
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
                <div class="tl-label"><Icon name={TYPE_ICON[g.type]} /> {TYPE_LABELS[g.type]}</div>
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
                        <Icon name={TYPE_ICON[e.type]} /> {e.name}{lane.ended && lc ? <> <Icon name={lc.endedIcon} /></> : null}
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
                          <Icon name={SEVERITY_ICON[lane.worst]} /> {lane.warnings.length}
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
      <p class="hover-title"><Icon name={TYPE_ICON[e.type]} /> <strong>{e.name}</strong> <span class="muted">· {TYPE_SINGULAR[e.type]}</span></p>
      <p>{lane.dates}{lane.ended && lc ? <> · <Icon name={lc.endedIcon} /> {lc.endedWord}</> : ''}</p>
      {lane.warnings.slice(0, 3).map((w, i) => <p key={i} class={`hover-warn sev-${w.severity}`}><Icon name={SEVERITY_ICON[w.severity]} /> {w.message}</p>)}
      {lane.warnings.length > 3 && <p class="muted">and {lane.warnings.length - 3} more…</p>}
      <p class="muted small">Click to open</p>
    </div>
  );
}
