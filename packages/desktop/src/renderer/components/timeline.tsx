import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ZoomTransform } from 'd3-zoom';
import { nextFrame, usePanZoom, zoomIdentity } from '../zoom.ts';
import { LIFECYCLE, TYPE_ICON, TYPE_LABELS, TYPE_SINGULAR, monthTicks, packRows, timelineModel, yearLabel, yearTicks, type EntryType, type TimelineLane, type TimelineModel, type Warning, type World } from '@lore-forge/core';
import { CountBadge } from './severity.tsx';
import { Icon } from './icon.tsx';
import { SEVERITY_ICON } from './severity.tsx';
import { BookLang, portraitFile, useImage, WorldDir } from './cover.tsx';
import { t, tm, tx } from '../i18n.tsx';

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 400;
/** Room kept between the track's edges and the first or last year. */
const TL_PAD = 24;
/** A month is named on the axis once it is this wide. */
const MONTH_PX = 64;
/** Bar widths (px) from which the bar shows its icon, its title and the date range under the title. */
const BAR_ICON = 34, BAR_TITLE = 84, BAR_DATES = 190;
/** Room between marks packed onto one row in the Stacked layout (px). */
const STACK_GAP = 10;

type Layout = 'lanes' | 'stacked';

interface Hover { lane: TimelineLane; x: number; y: number }
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Gantt timeline: era ribbons and columns, a sticky year axis (months once they fit), one swimlane per dated
 * entry grouped by type, bars with icon, title and dates, and an overview strip that shows and moves the view.
 * d3-zoom on the time axis: drag or Shift+scroll to pan, Ctrl+scroll or −/+ to zoom; it never pans past the
 * first or last year. Lanes scroll up and down natively.
 */
export function TimelineView({ world, warnings, selectedId, onOpen, onOpenLook }: { world: World; warnings: Warning[]; selectedId: string | null; onOpen: (id: string) => void; onOpenLook: (id: string, look: string) => void }) {
  const bookLang = useContext(BookLang);
  const model = useMemo(() => timelineModel(world, warnings), [world, warnings]);
  const cal = world.manifest.calendar;
  const scroller = useRef<HTMLDivElement>(null);
  const labelCol = useRef<HTMLDivElement>(null);
  /** Pixels per year that fit the whole span; zoom scales from there. */
  const [basePpy, setBasePpy] = useState<number | null>(null);
  const [trackW, setTrackW] = useState(0);
  const [hidden, setHidden] = useState<Set<EntryType>>(new Set());
  // The hover card lives in its own component: moving over the cards redraws the card, not every lane.
  const setHover = useRef<(h: Hover | null) => void>(() => {});
  const wheelPan = useRef({ dx: 0, waiting: false });
  /** One lane per entry, or LegendKeeper-style rows that pack each type's entries side by side. */
  const [layout, setLayout] = useState<Layout>('lanes');

  const years = model ? Math.max(1, (model.max - model.min) / model.daysPerYear) : 1;
  const fit = () => {
    const el = scroller.current;
    if (!el || !model) return 10;
    const avail = el.clientWidth - (labelCol.current?.offsetWidth ?? 240) - 2 * TL_PAD;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, avail / years));
  };
  useLayoutEffect(() => { if (basePpy === null && model) setBasePpy(fit()); });
  const base = basePpy ?? 10;
  /**
   * Keeps the time span on screen: at any zoom the first and last year can't leave the track by more than
   * TL_PAD, and zooming out stops where the span fills the track, so no empty time shows before the first or
   * after the last year. (Only a span too short to fill the track even at the closest zoom stays pinned to its
   * start.) Content runs from `label + TL_PAD` to that plus `years * base` in unzoomed scroller coordinates.
   */
  const clamp = (t: ZoomTransform): ZoomTransform => {
    const el = scroller.current;
    if (!el || !model) return t;
    const label = labelCol.current?.offsetWidth ?? 0;
    const view = Math.max(0, el.clientWidth - label);
    const fill = Math.min(ZOOM_MAX / base, (view - 2 * TL_PAD) / (years * base));
    const k = Math.max(t.k, fill);
    const start = label + TL_PAD, span = years * base * k;
    const pinned = label + TL_PAD - start * k; // start of the span at the track's start (+ pad)
    const x = span <= view - 2 * TL_PAD ? pinned : Math.min(pinned, Math.max(label + view - TL_PAD - start * k - span, t.x));
    return x === t.x && k === t.k && !t.y ? t : zoomIdentity.translate(x, 0).scale(k);
  };
  /**
   * A pan at the same zoom moves what is drawn with a CSS offset (--pan) instead of re-rendering every lane each
   * frame; the lanes are drawn again when the pan ends, or once it has moved far enough to need ticks, labels and
   * bars that were left out. Zooming re-renders, at most once per frame.
   */
  const live = (next: ZoomTransform, shown: ZoomTransform) => {
    const el = scroller.current;
    if (!el || next.k !== shown.k || Math.abs(next.x - shown.x) > trackW * 0.4) return false;
    el.style.setProperty('--pan', `${next.x - shown.x}px`);
    return true;
  };
  const pz = usePanZoom(scroller, { min: ZOOM_MIN / base, max: ZOOM_MAX / base, xOnly: true, ignore: '.tl-label', clamp, live });
  // A render draws the new positions: drop the live offset before it is painted.
  useLayoutEffect(() => { scroller.current?.style.setProperty('--pan', '0px'); }, [pz.t]);
  // A new base scale (Fit) or track width changes what fits: pull the span back inside.
  useLayoutEffect(() => pz.reclamp(), [base, trackW]);
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
        <h2><Icon name="hourglass" /> {t('Timeline')}</h2>
        <div class="empty-state"><Icon class="empty-icon" name="sands-of-time" /><p>{t('Nothing has a date yet. Give a character a birth year, a place a founding year or an event a date, and it shows up here.')}</p></div>
      </section>
    );
  }
  const ppy = base * pz.t.k;
  const ppd = ppy / model.daysPerYear;
  const label = labelCol.current?.offsetWidth ?? 0;
  const width = trackW || Math.ceil(years * ppy) + 2 * TL_PAD;
  // d3-zoom works in scroller coordinates (label column included); tracks start after the label column.
  const xOf = (day: number) => pz.t.applyX(label + TL_PAD + (day - model.min) * (base / model.daysPerYear)) - label;
  const dayAt = (x: number) => model.min + (pz.t.invertX(x + label) - label - TL_PAD) / (base / model.daysPerYear);
  // Ticks and grid lines reach half a track past each side, so a live pan (up to 40% of the track) never runs out.
  const inView = (x: number) => x >= -width / 2 && x <= width * 1.5;
  // Axis: years on top; under them months once a month is wide enough to name, else finer years.
  const majors = yearTicks(model, ppy, 120).filter((t) => inView(xOf(t.day)));
  const monthW = Math.min(...monthsWidths(model, cal)) * ppd;
  const showMonths = monthW >= MONTH_PX;
  const minors: { day: number; text: string }[] = showMonths
    ? monthTicks(model, cal, dayAt(-width / 2), dayAt(width * 1.5)).map((m) => ({ day: m.day, text: m.name }))
    : finerYears(model, majors[0]?.years ?? 1, ppy, dayAt(-width / 2), dayAt(width * 1.5)).map((day) => ({ day, text: yearLabel(day, cal) }));
  const fitAll = () => pz.set(zoomIdentity);
  /** Puts `day` at the track's left edge, past the pad (the clamp keeps the ends in). */
  const goTo = (day: number) => pz.set(zoomIdentity.translate(label + TL_PAD - (label + TL_PAD + (day - model.min) * (base / model.daysPerYear)) * pz.t.k, 0).scale(pz.t.k));
  /** Shift+scroll, or a sideways trackpad swipe, pans along time; a plain wheel scrolls the lanes. */
  const onWheel = (ev: WheelEvent) => {
    if (ev.ctrlKey || ev.metaKey) return;
    const dx = ev.shiftKey ? ev.deltaY || ev.deltaX : Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : 0;
    if (!dx) return;
    ev.preventDefault();
    // A trackpad sends many small deltas per frame: add them up and pan once per frame.
    const w = wheelPan.current;
    w.dx += dx;
    if (!w.waiting) { w.waiting = true; nextFrame(() => { const d = w.dx; w.dx = 0; w.waiting = false; pz.panBy(-d, 0); }); }
  };
  const toggle = (t: EntryType) => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const groups = model.groups.filter((g) => !hidden.has(g.type));

  const show = (lane: TimelineLane, ev: MouseEvent | FocusEvent) => {
    if ('buttons' in ev && ev.buttons) return; // dragging the timeline, not pointing at a card
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    setHover.current({ lane, x: 'clientX' in ev ? ev.clientX : r.left + r.width / 2, y: r.bottom });
  };
  /** How far a label must move right to stay readable when its bar starts left of the track. */
  const inset = (left: number, w: number, keep: number) => clampN(-left, 0, Math.max(0, w - keep));

  return (
    <section class="timeline" aria-labelledby="timeline-title">
      <header class="view-head">
        <h2 id="timeline-title" tabIndex={-1}><Icon name="hourglass" /> {t('Timeline')}</h2>
      </header>
      <div class="tl-toolbar">
        <div class="tl-seg" role="group" aria-label={t('Zoom')}>
          <button type="button" class="tl-zoom-out" onClick={() => pz.zoomBy(1 / 1.5)} aria-label={t('Zoom out')}><Icon name="contract" /></button>
          <button type="button" class="tl-fit" onClick={() => { setBasePpy(fit()); fitAll(); }}>{t('Fit')}</button>
          <button type="button" class="tl-zoom-in" onClick={() => pz.zoomBy(1.5)} aria-label={t('Zoom in')}><Icon name="expand" /></button>
          <button type="button" onClick={() => pz.panBy(trackW / 3, 0)} aria-label={t('Earlier')}><Icon name="fast-backward-button" /></button>
          <button type="button" onClick={() => pz.panBy(-trackW / 3, 0)} aria-label={tx('time', 'Later')}><Icon name="fast-forward-button" /></button>
        </div>
        <div class="tl-seg" role="group" aria-label={t('Layout')}>
          <button type="button" class="tl-layout-lanes" aria-pressed={layout === 'lanes'} onClick={() => setLayout('lanes')} title={t('One lane per entry')}><Icon name="scroll-unfurled" /> {t('Lanes')}</button>
          <button type="button" class="tl-layout-stacked" aria-pressed={layout === 'stacked'} onClick={() => setLayout('stacked')} title={t("Each type's entries packed side by side")}><Icon name="sands-of-time" /> {t('Stacked')}</button>
        </div>
        <span class="tl-sep" aria-hidden="true" />
        <div class="type-filters" role="group" aria-label={t('Show types')}>
          {model.groups.map((g) => (
            <button key={g.type} type="button" class={`tl-chip t-${g.type}`} aria-pressed={!hidden.has(g.type)} onClick={() => toggle(g.type)}>
              <span class="tl-chip-icon"><Icon name={TYPE_ICON[g.type]} /></span> {tm(TYPE_LABELS[g.type])} <span class="tl-chip-count">{g.lanes.length}</span>
            </button>
          ))}
        </div>
      </div>

      <div class="tl-frame">
        <div class={`tl-scroll is-${layout}`} ref={scroller} data-ppy={ppy.toFixed(4)} data-from={Math.round(xOf(model.min))} data-to={Math.round(xOf(model.max))} onWheel={onWheel} onMouseLeave={() => setHover.current(null)}>
          <div class="tl-canvas">
            {/* Era columns and grid lines run behind every lane. */}
            <div class="tl-grid" style={{ width: `${width}px` }} aria-hidden="true">
              {model.eras.map((era, i) => (
                <div key={era.id} class={`tl-band band-${i % 2}`} style={{ left: `${xOf(era.from)}px`, width: `${Math.max(2, (era.to - era.from) * ppd)}px`, ...(era.color ? { '--era': era.color } : {}) }} />
              ))}
              {majors.map((t) => <span key={`M${t.day}`} class="tl-line is-major" style={{ left: `${xOf(t.day)}px` }} />)}
              {minors.map((t) => <span key={`m${t.day}`} class="tl-line" style={{ left: `${xOf(t.day)}px` }} />)}
            </div>
            <div class="tl-head">
              {model.eras.length > 0 && (
                <div class="tl-row tl-era-row">
                  <div class="tl-label"><Icon name="crown" /> {t('Eras')}</div>
                  <div class="tl-track" style={{ width: `${width}px` }} aria-hidden="true">
                    {model.eras.map((era) => {
                      const left = xOf(era.from), w = Math.max(2, (era.to - era.from) * ppd);
                      return (
                        <div key={era.id} class="tl-era" style={{ left: `${left}px`, width: `${w}px`, ...(era.color ? { '--era': era.color } : {}) }}>
                          <span class="tl-era-name" lang={bookLang} style={{ marginLeft: `${inset(left, w, 140)}px` }}>{era.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div class="tl-row tl-axis">
                <div class="tl-label" ref={labelCol}><Icon name="calendar" /> {showMonths ? t('Years · months') : t('Years')}</div>
                <div class="tl-track" style={{ width: `${width}px` }} aria-hidden="true">
                  {majors.map((t) => <span key={t.day} class="tl-tick is-major" style={{ left: `${xOf(t.day)}px` }}>{yearLabel(t.day, cal)}</span>)}
                  {minors.map((t) => <span key={t.day} class="tl-tick" style={{ left: `${xOf(t.day)}px` }}>{t.text}</span>)}
                </div>
              </div>
            </div>
            {model.eras.length > 0 && (
              <ul class="sr-only" aria-label={t('Eras')}>
                {model.eras.map((e) => <li key={e.id}>{t('{era}: {from} to {to}', { era: e.name, from: yearLabel(e.from, cal), to: yearLabel(e.to, cal) })}</li>)}
              </ul>
            )}
            {groups.map((g) => {
              return (
                <div key={g.type} class={`tl-group t-${g.type}`} role="group" aria-label={tm(TYPE_LABELS[g.type])}>
                  <div class="tl-row tl-group-head">
                    <div class="tl-label"><Icon name={TYPE_ICON[g.type]} /> {tm(TYPE_LABELS[g.type])} <span class="tl-count">{g.lanes.length}</span></div>
                    <div class="tl-track" style={{ width: `${width}px` }} aria-hidden="true" />
                  </div>
                  {(() => {
                    const items = g.lanes.map((lane): Placed => ({ lane, left: xOf(lane.from), w: lane.point ? 0 : Math.max(8, (lane.to - lane.from) * ppd) }));
                    const mark = { trackW: width, inset, onOpen, onOpenLook, show, hide: () => setHover.current(null) };
                    if (layout === 'lanes') return items.map((it) => <Lane key={it.lane.entry.id} it={it} selected={it.lane.entry.id === selectedId} mark={mark} />);
                    // Stacked: pack by what each mark takes on screen (its bar, or its diamond and side label).
                    const rows = packRows(items.map((it) => ({ from: it.left - (it.lane.point ? 20 : 0), to: it.left + footprint(it) })), STACK_GAP);
                    return Array.from({ length: rows.count }, (_, row) => {
                      const on = items.filter((_, i) => rows.rows[i] === row);
                      return (
                        <div key={row} class={`tl-row tl-lane tl-stack-row${on.some((it) => portraitFile(it.lane.entry)) ? ' is-tall' : ''}${on.some((it) => it.lane.entry.id === selectedId) ? ' is-selected' : ''}`}>
                          <div class="tl-label" aria-hidden="true" />
                          <div class="tl-track" style={{ width: `${width}px` }}>
                            {on.map((it) => <Mark key={it.lane.entry.id} it={it} focusable {...mark} />)}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              );
            })}
          </div>
        </div>
        <Overview model={model} from={dayAt(0)} to={dayAt(width)} goTo={goTo} panBy={(dx) => pz.panBy(dx, 0)} trackW={width} yearAt={(d) => yearLabel(d, cal)} />
      </div>
      <HoverCard bind={setHover} />
    </section>
  );
}

/** Month lengths in days (12 equal months when the calendar names none). */
function monthsWidths(model: TimelineModel, cal: World['manifest']['calendar']): number[] {
  return cal.months?.length ? cal.months.map((m) => m.days) : [model.daysPerYear / 12];
}

/** Years between the major ticks, at the smallest step that divides the major step and leaves room for a label. */
function finerYears(model: TimelineModel, major: number, ppy: number, fromDay: number, toDay: number): number[] {
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((s) => s < major && major % s === 0 && s * ppy >= 56);
  if (!step) return [];
  const out: number[] = [];
  const lo = Math.max(fromDay, model.min), hi = Math.min(toDay, model.max);
  for (let y = Math.ceil(lo / model.daysPerYear / step) * step; y * model.daysPerYear <= hi; y += step) if (y % major) out.push(y * model.daysPerYear);
  return out;
}

interface Placed { lane: TimelineLane; left: number; w: number }
interface MarkProps { trackW: number; inset: (left: number, w: number, keep: number) => number; onOpen: (id: string) => void; onOpenLook: (id: string, look: string) => void; show: (lane: TimelineLane, ev: MouseEvent | FocusEvent) => void; hide: () => void }

/** What fits inside the visible part of a bar. */
function fits(it: Placed, trackW: number): 'none' | 'icon' | 'title' | 'dates' {
  if (it.lane.point) return 'none';
  const seen = Math.min(it.left + it.w, trackW) - Math.max(it.left, 0);
  return seen >= BAR_DATES ? 'dates' : seen >= BAR_TITLE ? 'title' : seen >= BAR_ICON ? 'icon' : 'none';
}
/** Width of the side label (and warning pill) drawn beside a mark. */
const asideWidth = (it: Placed, inside: string) => (it.lane.worst ? 48 : 0) + (inside === 'none' || inside === 'icon' ? it.lane.entry.name.length * 7.5 + 8 : 0);
/** How far right of its start a mark reaches on screen, side label included (for packing the Stacked layout). */
const footprint = (it: Placed) => {
  const inside = it.lane.point ? 'none' : it.w >= BAR_DATES ? 'dates' : it.w >= BAR_TITLE ? 'title' : it.w >= BAR_ICON ? 'icon' : 'none';
  const aside = asideWidth(it, inside);
  return (it.lane.point ? 24 : it.w) + (aside ? aside + 8 : 0);
};
const ariaLabel = (lane: TimelineLane) => {
  const e = lane.entry, lc = LIFECYCLE[e.type];
  const n = lane.warnings.length;
  return `${tm(TYPE_SINGULAR[e.type])} ${e.name}${lane.ended && lc ? `, ${tm(lc.endedWord)}` : ''}, ${lane.dates}${n ? `, ${n > 1 ? t('{n} warnings', { n }) : t('{n} warning', { n })}` : ''}`;
};

/** One swimlane: the entry's name on the left, its mark on the track. Taller when the entry has a picture. */
function Lane({ it, selected, mark }: { it: Placed; selected: boolean; mark: MarkProps }) {
  const { lane } = it;
  const e = lane.entry;
  const lc = LIFECYCLE[e.type];
  return (
    <div class={`tl-row tl-lane${selected ? ' is-selected' : ''}${portraitFile(e) ? ' is-tall' : ''}`}>
      <div class="tl-label">
        <button type="button" class={`tl-name t-${e.type}${lane.ended ? ' is-ended' : ''}`} aria-label={t('{label}. Open.', { label: ariaLabel(lane) })}
          onClick={() => mark.onOpen(e.id)} onFocus={(ev) => mark.show(lane, ev)} onBlur={mark.hide}>
          <Icon name={TYPE_ICON[e.type]} /> {e.name}{lane.ended && lc ? <> <Icon name={lc.endedIcon} /></> : null}
        </button>
        <CountBadge warnings={lane.warnings} />
      </div>
      <div class="tl-track" style={{ width: `${mark.trackW}px` }}>
        <Mark it={it} {...mark} />
      </div>
    </div>
  );
}

/**
 * An entry on the track: a solid card in its type's colour with icon, title and dates (its picture behind them
 * when it has one), or a diamond (a round picture) for a moment; warnings and a side label after it.
 * In the Stacked layout the marks are the keyboard stops, since rows have no names on the left.
 */
function Mark({ it, focusable, trackW, inset, onOpen, onOpenLook, show, hide }: MarkProps & { it: Placed; focusable?: boolean }) {
  const { lane, left, w } = it;
  const e = lane.entry;
  const dir = useContext(WorldDir);
  const src = useImage(dir, portraitFile(e));
  const cls = `${lane.openStart ? ' open-start' : ''}${lane.openEnd ? ' open-end' : ''}${lane.ended ? ' is-ended' : ''}`;
  const inside = fits(it, trackW);
  // After the mark, or before it when the label would run off the track's right edge.
  const asideW = asideWidth(it, inside);
  const half = lane.point ? (src ? 20 : 9) : 0;
  const end = left + (lane.point ? half : w) + 8;
  const flip = end + asideW > trackW && left - half - 8 - asideW >= 0;
  const handlers = { onClick: () => onOpen(e.id), onMouseEnter: (ev: MouseEvent) => show(lane, ev), onMouseMove: (ev: MouseEvent) => show(lane, ev), onMouseLeave: hide };
  const focus = focusable ? { tabIndex: 0, 'aria-label': t('{label}. Open.', { label: ariaLabel(lane) }), onFocus: (ev: FocusEvent) => show(lane, ev), onBlur: hide } : { tabIndex: -1, 'aria-hidden': true as const };
  return (
    <>
      <button type="button" {...focus} class={`tl-mark ${lane.point ? 'tl-point' : 'tl-bar'} t-${e.type}${cls}${inside === 'dates' ? ' has-dates' : ''}${src ? ' has-image' : ''}`}
        style={{ left: `${left}px`, width: lane.point ? undefined : `${w}px`, ...(src ? { '--img': `url("${src}")` } : {}) }} {...handlers}>
        {inside !== 'none' && (
          <span class="tl-bar-body" style={{ paddingLeft: `${inset(left, w, BAR_TITLE)}px` }}>
            <Icon name={TYPE_ICON[e.type]} />
            {inside !== 'icon' && <span class="tl-bar-text"><span class="tl-bar-title">{e.name}</span>{inside === 'dates' && <span class="tl-bar-dates">{lane.dates}</span>}</span>}
          </span>
        )}
      </button>
      {/* Its looks: a gold line along the bottom of the bar while each applies, under the icon and text. */}
      {!lane.point && lane.looks.length > 0 && (
        <span class={`tl-looks${src ? ' has-image' : ''}`} style={{ left: `${left}px`, width: `${w}px` }}>
          {lane.looks.map((lk) => {
            const perDay = lane.to > lane.from ? w / (lane.to - lane.from) : 0;
            const x = (lk.from - lane.from) * perDay;
            const title = lk.when ? `${t('Look: {name}', { name: lk.name })} · ${tm(lk.when)}` : t('Look: {name}', { name: lk.name });
            return (
              <button key={lk.id} type="button" tabIndex={-1} class="tl-look" style={{ left: `${x}px`, width: `${Math.max(6, (lk.to - lk.from) * perDay)}px` }} title={title} aria-label={title} onClick={() => onOpenLook(e.id, lk.id)} />
            );
          })}
        </span>
      )}
      {(lane.worst || inside === 'none' || inside === 'icon') && left <= trackW && left + w >= 0 && (
        <span class={`tl-after${flip ? ' is-before' : ''}`} style={flip ? { right: `${trackW - left + half + 8}px` } : { left: `${end}px` }}>
          {lane.worst && (
            <button type="button" tabIndex={-1} aria-hidden="true" class={`tl-warn sev-${lane.worst}`} {...handlers}>
              <Icon name={SEVERITY_ICON[lane.worst]} /> {lane.warnings.length}
            </button>
          )}
          {(inside === 'none' || inside === 'icon') && <span class="tl-aside" aria-hidden="true">{e.name}</span>}
        </span>
      )}
    </>
  );
}

/**
 * The overview under the lanes: the whole span with its eras and every entry, and a frame for what the track
 * shows. Click to jump there, drag the frame (or anywhere) to move, arrows and Home/End from the keyboard.
 */
function Overview({ model, from, to, goTo, panBy, trackW, yearAt }: {
  model: TimelineModel; from: number; to: number; goTo: (day: number) => void; panBy: (dx: number) => void; trackW: number; yearAt: (day: number) => string;
}) {
  const span = Math.max(1, model.max - model.min);
  const pct = (d: number) => `${clampN(((d - model.min) / span) * 100, 0, 100)}%`;
  const all = useMemo(() => model.groups.flatMap((g) => g.lanes.map((l) => ({ type: g.type, from: l.from, to: l.point ? l.from + span / 400 : l.to }))), [model]);
  const packed = useMemo(() => packRows(all, span / 300), [all]);
  const rows = Math.max(1, Math.min(6, packed.count));
  const grab = useRef<number | null>(null);
  const dayAtPointer = (ev: PointerEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    return model.min + ((ev.clientX - r.left) / Math.max(1, r.width)) * span;
  };
  const viewSpan = Math.max(0, to - from);
  return (
    <div class="tl-overview">
      <div class="tl-label tl-overview-label"><Icon name="world" /> {t('Overview')}</div>
      <div class="tl-mini" role="slider" tabIndex={0} aria-label={t('Visible years')}
        aria-valuemin={Math.round(model.min / model.daysPerYear)} aria-valuemax={Math.round(model.max / model.daysPerYear)} aria-valuenow={Math.round(from / model.daysPerYear)}
        aria-valuetext={t('{from} to {to}', { from: yearAt(Math.max(from, model.min)), to: yearAt(Math.min(to, model.max)) })}
        onPointerDown={(ev) => {
          if (ev.button) return;
          const d = dayAtPointer(ev);
          grab.current = d >= from && d <= to ? d - from : viewSpan / 2;
          try { (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); } catch { /* not a live pointer (synthetic events) */ }
          goTo(d - grab.current);
          ev.preventDefault();
        }}
        onPointerMove={(ev) => { if (grab.current !== null) goTo(dayAtPointer(ev) - grab.current); }}
        onPointerUp={() => { grab.current = null; }}
        onPointerCancel={() => { grab.current = null; }}
        onLostPointerCapture={() => { grab.current = null; }}
        onKeyDown={(ev) => {
          const step = ev.key === 'ArrowLeft' ? trackW / 4 : ev.key === 'ArrowRight' ? -trackW / 4 : ev.key === 'PageUp' ? trackW : ev.key === 'PageDown' ? -trackW : 0;
          if (step) panBy(step);
          else if (ev.key === 'Home') goTo(model.min);
          else if (ev.key === 'End') goTo(model.max);
          else return;
          ev.preventDefault();
        }}>
        {model.eras.map((era, i) => <span key={era.id} class={`tl-mini-era band-${i % 2}`} style={{ left: pct(era.from), width: `calc(${pct(era.to)} - ${pct(era.from)})`, ...(era.color ? { '--era': era.color } : {}) }} />)}
        {all.map((s, i) => <span key={i} class={`tl-mini-item t-${s.type}`} style={{ left: pct(s.from), width: `max(2px, calc(${pct(s.to)} - ${pct(s.from)}))`, top: `${4 + (packed.rows[i]! % rows) * (28 / rows)}px` }} />)}
        <span class="tl-mini-view" style={{ left: pct(from), width: `max(6px, calc(${pct(to)} - ${pct(from)}))` }} />
      </div>
    </div>
  );
}

/** The hover card, with its own state so showing or moving it redraws only the card. */
function HoverCard({ bind }: { bind: { current: (h: Hover | null) => void } }) {
  const [hover, setHover] = useState<Hover | null>(null);
  bind.current = setHover;
  return hover ? <TimelineCard hover={hover} /> : null;
}

function TimelineCard({ hover }: { hover: Hover }) {
  const { lane } = hover;
  const e = lane.entry;
  const lc = LIFECYCLE[e.type];
  const left = Math.min(hover.x + 12, window.innerWidth - 340);
  const top = Math.min(hover.y + 8, window.innerHeight - 200);
  return (
    <div class={`hover-card t-${e.type}`} role="tooltip" style={{ left: `${Math.max(8, left)}px`, top: `${Math.max(8, top)}px` }}>
      <p class="hover-title"><Icon name={TYPE_ICON[e.type]} /> <strong>{e.name}</strong> <span class="muted">· {tm(TYPE_SINGULAR[e.type])}</span></p>
      <p>{lane.dates}{lane.ended && lc ? <> · <Icon name={lc.endedIcon} /> {tm(lc.endedWord)}</> : ''}</p>
      {lane.warnings.slice(0, 3).map((w, i) => <p key={i} class={`hover-warn sev-${w.severity}`}><Icon name={SEVERITY_ICON[w.severity]} /> {tm(w.message)}</p>)}
      {lane.warnings.length > 3 && <p class="muted">{t('and {n} more…', { n: lane.warnings.length - 3 })}</p>}
      <p class="muted small">{t('Click to open')}</p>
    </div>
  );
}
