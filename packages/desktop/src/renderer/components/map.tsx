/**
 * The Map view: the world's maps, each a picture with places pinned on it. Drag to move around, scroll to zoom, click a
 * pin to open its place; a place with a map of its own opens that map from its pin. In Edit pins, a pin is dragged to
 * move it, a place is dragged from the list onto the map (or pinned in the middle of the view), the arrow keys nudge
 * the pin in focus and Delete takes it off. Ctrl+Z and Ctrl+Y undo and redo pin changes.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ZoomTransform } from 'd3-zoom';
import {
  ENTRY_TYPES, inYear, journeyAt, LIFECYCLE, mapModel, mapPrompt, mapTime, newMapId, TYPE_LABELS, TYPE_SINGULAR, withArtStyle, withoutPin, withPin, WorldIndex, yearLabel,
  type Calendar, type Entry, type EntryType, type JourneyStop, type MapPin, type MapPlace, type MapTime, type Place, type World, type WorldMap,
} from '@lore-forge/core';
import type { MapPicture, PictureService } from '../../shared/api.ts';
import { usePanZoom, zoomIdentity } from '../zoom.ts';
import { t, tm } from '../i18n.tsx';
import { Icon } from './icon.tsx';
import { Portrait, useImageState } from './cover.tsx';
import { Dialog } from './dialog.tsx';
import { ConfirmDialog } from './confirm.tsx';
import { Select } from './select.tsx';
import { ZoomControls } from './graphs.tsx';

/** What a place dragged from the list carries. */
const DRAG_TYPE = 'application/x-lore-forge-place';
/** How much of the picture always stays in view while panning, in pixels. */
const KEEP = 80;
/** Arrow-key steps for the pin in focus, in percent of the map. */
const NUDGE = 0.25;
const NUDGE_BIG = 2;
/** At most this many names per kind in a pin's card. */
const CARD_NAMES = 6;

type Size = { w: number; h: number };
/** One undo step: the pins of each place it changed, before and after. */
type Step = { places: { id: string; before?: MapPin[]; after?: MapPin[] }[]; at: number; nudge?: string };

const lastMapKey = (dir: string): string => `lore-forge.map:${dir}`;
function lastMap(dir: string): string | null {
  try { return localStorage.getItem(lastMapKey(dir)); } catch { return null; }
}
/** The map the Map shows next time it opens in this book. */
export function rememberMap(dir: string, id: string): void {
  try { localStorage.setItem(lastMapKey(dir), id); } catch { /* the map is simply not remembered */ }
}

/** The place with exactly these pins (none: no pins key). */
function withPins(p: Place, pins: MapPin[] | undefined): Place {
  const { pins: _old, ...rest } = p;
  return pins?.length ? { ...rest, pins } : rest;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function MapView({ dir, world, selectedId, onOpen, onPins, onSaveMaps }: {
  dir: string;
  world: World;
  selectedId: string | null;
  onOpen: (id: string) => void;
  /** Places whose pins changed: save them. */
  onPins: (places: Place[]) => void;
  /** Save the list of maps (and copy one map's picture in). Resolves with what was saved. */
  onSaveMaps: (maps: WorldMap[], picture?: MapPicture & { map: string }) => Promise<WorldMap[]>;
}) {
  const maps = world.manifest.maps ?? [];
  const [mapId, setMapId] = useState<string | null>(() => {
    const last = lastMap(dir);
    return maps.find((m) => m.id === last)?.id ?? maps[0]?.id ?? null;
  });
  // A map that went away (deleted, or the book changed on disk) gives way to the first one.
  const current = maps.find((m) => m.id === mapId) ?? maps[0];
  const show = (id: string): void => {
    setMapId(id);
    rememberMap(dir, id);
  };
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<{ map?: WorldMap } | null>(null);
  const [doomed, setDoomed] = useState<WorldMap | null>(null);
  const model = useMemo(() => (current ? mapModel(world, current.id) : undefined), [world, current]);
  // Its events, journeys and the years they span (none when nothing on it is dated).
  const time = useMemo(() => (model ? mapTime(world, model) : undefined), [world, model]);

  // Pin changes, to undo and redo.
  const undo = useRef<Step[]>([]);
  const redo = useRef<Step[]>([]);
  const worldRef = useRef(world);
  worldRef.current = world;
  const placeOf = (id: string): Place | undefined => worldRef.current.entries.find((e): e is Place => e.id === id && e.type === 'place');
  /** Save changed places and remember the change; nudges of one pin in a row are one step. */
  const change = (next: Place[], nudge?: string): void => {
    const before = next.map((p) => placeOf(p.id));
    const now = performance.now();
    const last = undo.current.at(-1);
    if (nudge && last?.nudge === nudge && now - last.at < 1500) {
      last.places = last.places.map((x) => ({ ...x, after: next.find((p) => p.id === x.id)?.pins }));
      last.at = now;
    } else {
      undo.current.push({ places: next.map((p, i) => ({ id: p.id, before: before[i]?.pins, after: p.pins })), at: now, ...(nudge ? { nudge } : {}) });
      if (undo.current.length > 100) undo.current.shift();
    }
    redo.current = [];
    onPins(next);
  };
  const replay = (from: Step[], to: Step[], back: boolean): void => {
    const step = from.pop();
    if (!step) return;
    const places = step.places.map((x) => { const p = placeOf(x.id); return p && withPins(p, back ? x.before : x.after); }).filter((p): p is Place => !!p);
    to.push(step);
    if (places.length) onPins(places);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el?.closest('input, textarea, [contenteditable="true"], [role="dialog"]') || document.querySelector('.modal-backdrop, .confirm-backdrop')) return;
      e.preventDefault();
      if (k === 'z' && !e.shiftKey) replay(undo.current, redo.current, true);
      else replay(redo.current, undo.current, false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Undo is for the map in view: another map starts without any, so Ctrl+Z never moves a pin out of sight.
  useEffect(() => {
    undo.current = [];
    redo.current = [];
  }, [current?.id]);

  const saveMap = async (map: WorldMap, picture?: MapPicture): Promise<void> => {
    const list = maps.some((m) => m.id === map.id) ? maps.map((m) => (m.id === map.id ? map : m)) : [...maps, map];
    await onSaveMaps(list, picture ? { ...picture, map: map.id } : undefined);
    show(map.id);
  };
  const deleteMap = async (map: WorldMap): Promise<void> => {
    await onSaveMaps(maps.filter((m) => m.id !== map.id));
    // Its places lose their pins on it (a pin on a map the book does not have would only be a warning).
    const pinned = world.entries.filter((e): e is Place => e.type === 'place' && (e.pins ?? []).length > 0 && withoutPin(e, map).pins?.length !== e.pins!.length);
    if (pinned.length) onPins(pinned.map((p) => withoutPin(p, map)));
    undo.current = [];
    redo.current = [];
  };

  return (
    <section class="map-view" aria-labelledby="map-title">
      <header class="view-head">
        <h2 id="map-title" tabIndex={-1}><Icon name="treasure-map" /> {t('Map')}</h2>
      </header>
      {maps.length > 0 && (
        <div class="tl-toolbar map-toolbar">
          <div class="map-list" role="group" aria-label={t('Maps')}>
            {maps.map((m) => (
              <button key={m.id} type="button" class="map-tab" aria-pressed={m.id === current?.id} onClick={() => show(m.id)}>
                <Icon name="treasure-map" /> {m.name || m.id}
              </button>
            ))}
            <button type="button" class="ghost small map-add" onClick={() => setDialog({})}>+ {t('New map')}</button>
          </div>
          {current && (
            <div class="map-actions">
              {model && model.parents.length > 0 && model.place && (
                <button type="button" class="ghost small map-up" onClick={() => show(model.parents[0]!.id)} title={t('Show {place} on {map}', { place: model.place.name, map: model.parents[0]!.name })}>
                  <Icon name="plain-arrow" class="point-up" /> {model.parents[0]!.name}
                </button>
              )}
              <div class="tl-seg">
                <button type="button" class="map-edit" aria-pressed={editing} onClick={() => setEditing((v) => !v)} title={t('Drag pins to move them, and put places on the map')}><Icon name="position-marker" /> {t('Edit pins')}</button>
                <button type="button" class="map-settings" onClick={() => setDialog({ map: current })} aria-label={t('Map settings')} title={t('Map settings: name, picture, the place it shows')}><Icon name="cog" /></button>
              </div>
            </div>
          )}
        </div>
      )}
      {!current ? (
        <div class="map-empty">
          <Icon class="empty-icon" name="treasure-map" />
          <h3>{t('No maps yet')}</h3>
          <p>{t('Add a picture of a map of your world, then pin its places on it. Each pin shows who lives there and what happened there, and opens the place.')}</p>
          <button type="button" class="primary map-add-first" onClick={() => setDialog({})}><Icon name="treasure-map" /> {t('Add a map…')}</button>
        </div>
      ) : model && (
        <MapCanvas key={current.id} dir={dir} model={model} time={time} cal={world.manifest.calendar} editing={editing} selectedId={selectedId}
          onOpen={onOpen} onShowMap={show} onChange={change} onStopEditing={() => setEditing(false)} />
      )}
      {dialog && (
        <MapDialog dir={dir} world={world} map={dialog.map} onClose={() => setDialog(null)} onSave={saveMap}
          {...(dialog.map ? { onDelete: () => { setDoomed(dialog.map!); setDialog(null); } } : {})} />
      )}
      {doomed && (() => {
        const n = world.entries.filter((e) => e.type === 'place' && withoutPin(e, doomed).pins?.length !== (e as Place).pins?.length).length;
        return (
          <ConfirmDialog title={t('Delete the map “{name}”?', { name: doomed.name || doomed.id })} confirmLabel={t('Delete map')} onClose={() => setDoomed(null)}
            onConfirm={() => deleteMap(doomed).then(() => setDoomed(null))}
            subject={<div class="confirm-world"><span class="confirm-chapter" aria-hidden="true"><Icon name="treasure-map" /></span><div><strong class="confirm-name">{doomed.name}</strong><span class="muted">{doomed.image}</span></div></div>}>
            <p>{n === 1 ? t('Its picture is removed, and one place loses its pin on it. The book history keeps a copy.')
              : n ? t('Its picture is removed, and {n} places lose their pin on it. The book history keeps a copy.', { n })
              : t('Its picture is removed. The book history keeps a copy.')}</p>
          </ConfirmDialog>
        );
      })()}
    </section>
  );
}

function MapCanvas({ dir, model, time, cal, editing, selectedId, onOpen, onShowMap, onChange, onStopEditing }: {
  dir: string;
  model: NonNullable<ReturnType<typeof mapModel>>;
  /** Events, journeys and years on this map; the bar for them shows only when there is something to show. */
  time: MapTime | undefined;
  cal: Calendar;
  editing: boolean;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onShowMap: (id: string) => void;
  onChange: (next: Place[], nudge?: string) => void;
  onStopEditing: () => void;
}) {
  const { map } = model;
  const src = useImageState(dir, map.image);
  // A year on the map (its first day; null: all of time) and the journey drawn on it.
  const [year, setYear] = useState<number | null>(null);
  const [follow, setFollow] = useState('');
  const span = time?.span;
  const per = span?.daysPerYear ?? 365;
  const when = year !== null && span ? Math.min(Math.max(year, span.min), span.max) : null;
  const journey = time?.journeys.find((j) => j.entry.id === follow);
  const here = journey && when !== null ? journeyAt(journey, when, per) : undefined;
  const yearEvents = when !== null && time ? time.events.filter((e) => inYear(e, when, per)) : [];
  const absent = (id: string): boolean => when !== null && !!time?.lives[id] && !inYear(time.lives[id]!, when, per);
  const timeBar = !!time && !editing && (!!span || time.journeys.length > 0);
  const [size, setSize] = useState<Size | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const clamp = (tr: ZoomTransform): ZoomTransform => {
    const el = canvas.current;
    const s = sizeRef.current;
    if (!el || !s) return tr;
    const w = s.w * tr.k, h = s.h * tr.k;
    const x = Math.min(el.clientWidth - KEEP, Math.max(KEEP - w, tr.x));
    const y = Math.min(el.clientHeight - KEEP, Math.max(KEEP - h, tr.y));
    return x === tr.x && y === tr.y ? tr : zoomIdentity.translate(x, y).scale(tr.k);
  };
  // How far it zooms: from half the size that fits to eight times it (at least to the picture's own pixels, twice).
  const fitK = (): number => {
    const el = canvas.current;
    return el && size ? Math.min(el.clientWidth / size.w, el.clientHeight / size.h) : 1;
  };
  const [limits, setLimits] = useState({ min: 0.05, max: 4 });
  const pz = usePanZoom(canvas, { min: limits.min, max: limits.max, anyWheel: true, ignore: '.map-pin', clamp });
  /** The whole picture in view, below the zoom buttons (and above the time bar, when there is one). */
  const fit = (): void => {
    const el = canvas.current;
    if (!el || !size) return;
    const top = 52, edge = 16, bottom = timeBar ? 68 : edge;
    const k = Math.min((el.clientWidth - edge * 2) / size.w, (el.clientHeight - top - bottom) / size.h);
    pz.set(zoomIdentity.translate((el.clientWidth - size.w * k) / 2, top + (el.clientHeight - top - bottom - size.h * k) / 2).scale(k));
  };
  useLayoutEffect(() => {
    if (!size) return;
    const k = fitK();
    setLimits({ min: k * 0.5, max: Math.max(k * 8, 2) });
  }, [size]);
  // A new picture is fitted once it is known.
  useLayoutEffect(() => { if (size) fit(); }, [size, limits]);
  // When the frame changes size (the places list opens, the window is resized), the middle of the view stays on the
  // same spot of the map.
  const live = useRef({ pz, size });
  live.current = { pz, size };
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let box = { w: el.clientWidth, h: el.clientHeight };
    const ro = new ResizeObserver(() => {
      const was = box;
      box = { w: el.clientWidth, h: el.clientHeight };
      const { pz: now, size: s } = live.current;
      if (!s || (was.w === box.w && was.h === box.h)) return;
      now.set(zoomIdentity.translate(now.t.x + (box.w - was.w) / 2, now.t.y + (box.h - was.h) / 2).scale(now.t.k));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const t2 = pz.t;
  const at = (x: number, y: number): { left: number; top: number } => ({ left: t2.x + (x / 100) * (size?.w ?? 0) * t2.k, top: t2.y + (y / 100) * (size?.h ?? 0) * t2.k });
  /** A point on screen, in percent of the picture. */
  const toPercent = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = canvas.current!.getBoundingClientRect();
    const [ix, iy] = t2.invert([clientX - r.left, clientY - r.top]);
    return { x: (ix / (size?.w ?? 1)) * 100, y: (iy / (size?.h ?? 1)) * 100 };
  };
  const centerOn = (p: { x: number; y: number }): void => {
    const el = canvas.current;
    if (!el || !size) return;
    const k = Math.max(pz.t.k, fitK() * 1.5);
    pz.set(zoomIdentity.translate(el.clientWidth / 2 - (p.x / 100) * size.w * k, el.clientHeight / 2 - (p.y / 100) * size.h * k).scale(k));
  };

  // A place chosen in the sidebar while the map is open: shown in the middle.
  const seen = useRef(selectedId);
  useEffect(() => {
    if (!size || selectedId === seen.current) return;
    seen.current = selectedId;
    const p = model.pins.find((x) => x.entry.id === selectedId);
    if (p) centerOn(p);
  }, [selectedId, size]);

  const [hover, setHover] = useState<{ p: MapPlace; at: DOMRect } | null>(null);
  useEffect(() => setHover(null), [t2]);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const pinAt = (p: Place, x: number, y: number): void => onChange([withPin(p, map, x, y)]);
  const unpin = (p: Place): void => onChange([withoutPin(p, map)]);
  /** The middle of the view, or the nearest free spot around it, so pins put there one after another do not stack. */
  const middle = (): { x: number; y: number } => {
    const r = canvas.current!.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const taken = model.pins.map((p) => { const a = at(p.x, p.y); return { x: r.left + a.left, y: r.top + a.top }; });
    for (let ring = 0; ring < 6; ring++) {
      const n = ring ? ring * 6 : 1;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = cx + Math.cos(a) * ring * 170, y = cy + Math.sin(a) * ring * 66;
        if (x > r.left + 40 && x < r.right - 40 && y > r.top + 60 && y < r.bottom - 40 && taken.every((p) => Math.abs(p.x - x) > 160 || Math.abs(p.y - y) > 60)) return toPercent(x, y);
      }
    }
    return toPercent(cx, cy);
  };

  const startDrag = (p: MapPlace, ev: PointerEvent): void => {
    if (!editing || ev.button !== 0) return;
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture(ev.pointerId);
    const start = { x: ev.clientX, y: ev.clientY };
    let moved = false;
    setHover(null);
    const move = (e: PointerEvent): void => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
      moved = true;
      setDrag({ id: p.entry.id, ...toPercent(e.clientX, e.clientY) });
    };
    const end = (e: PointerEvent, keep: boolean): void => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      setDrag(null);
      if (moved && keep) {
        const to = toPercent(e.clientX, e.clientY);
        pinAt(p.entry, to.x, to.y);
      }
    };
    const up = (e: PointerEvent): void => end(e, true);
    const cancel = (e: PointerEvent): void => end(e, false);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
  };
  const pinKey = (p: MapPlace, e: KeyboardEvent): void => {
    if (!editing) return;
    const step = e.shiftKey ? NUDGE_BIG : NUDGE;
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key];
    if (d) {
      e.preventDefault();
      onChange([withPin(p.entry, map, p.x + d[0], p.y + d[1])], p.entry.id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      unpin(p.entry);
    }
  };
  const canvasKey = (e: KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return;
    const pan = ({ ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] } as Record<string, [number, number]>)[e.key];
    if (pan) { e.preventDefault(); pz.panBy(pan[0], pan[1]); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); pz.zoomBy(1.25); }
    else if (e.key === '-') { e.preventDefault(); pz.zoomBy(1 / 1.25); }
    else if (e.key === '0') { e.preventDefault(); fit(); }
    else if (e.key === 'Escape' && editing) onStopEditing();
  };
  const hoverOn = (p: MapPlace, ev: MouseEvent | FocusEvent): void => {
    if (('buttons' in ev && ev.buttons) || drag) return;
    setHover({ p, at: (ev.currentTarget as HTMLElement).getBoundingClientRect() });
  };
  const unhover = (p: MapPlace): void => setHover((h) => (h?.p.entry.id === p.entry.id ? null : h));

  return (
    <div class={`map-body${editing ? ' is-editing' : ''}`}>
      {editing && (
        <aside class="map-places" aria-label={t('Places')}>
          <p class="map-help muted">{t('Drag a place onto the map, or use Pin to put it in the middle. Drag a pin to move it; arrow keys nudge the pin in focus, Delete takes it off.')}</p>
          <h3>{t('Not on this map')} <span class="count">{model.unpinned.length}</span></h3>
          {model.unpinned.length ? (
            <ul class="map-place-list">
              {model.unpinned.map((p) => (
                <li key={p.id} draggable onDragStart={(e) => { e.dataTransfer?.setData(DRAG_TYPE, p.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}>
                  <Portrait entry={p} size="xs" />
                  <span class="map-place-name" title={p.name || p.id}>{p.name || p.id}</span>
                  <button type="button" class="ghost small map-pin-here" onClick={() => { const m = middle(); pinAt(p, m.x, m.y); }} title={t('Pin {name} in the middle of the view', { name: p.name || p.id })}>{t('Pin')}</button>
                </li>
              ))}
            </ul>
          ) : <p class="muted small">{t('Every place is on this map.')}</p>}
          <h3>{t('On this map')} <span class="count">{model.pins.length}</span></h3>
          {model.pins.length ? (
            <ul class="map-place-list">
              {[...model.pins].sort((a, b) => a.entry.name.localeCompare(b.entry.name)).map((p) => (
                <li key={p.entry.id}>
                  <Portrait entry={p.entry} size="xs" />
                  <button type="button" class="link map-place-name" onClick={() => centerOn(p)} title={t('Show it on the map')}>{p.entry.name || p.entry.id}</button>
                  <button type="button" class="ghost small icon-only map-unpin" onClick={() => unpin(p.entry)} aria-label={t('Take {name} off this map', { name: p.entry.name || p.entry.id })} title={t('Take it off this map')}><Icon name="cancel" /></button>
                </li>
              ))}
            </ul>
          ) : <p class="muted small">{t('No places on this map yet.')}</p>}
        </aside>
      )}
      <div class="map-frame">
        <div ref={canvas} class="map-canvas" tabIndex={0} role="group" onKeyDown={canvasKey}
          aria-label={t('Map: {name}. Drag to move around, scroll to zoom, arrow keys pan.', { name: map.name })}
          onDragOver={(e) => { if (editing && e.dataTransfer?.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
          onDrop={(e) => {
            const id = e.dataTransfer?.getData(DRAG_TYPE);
            const p = id ? model.unpinned.find((x) => x.id === id) : undefined;
            if (!editing || !p || !size) return;
            e.preventDefault();
            const to = toPercent(e.clientX, e.clientY);
            pinAt(p, to.x, to.y);
          }}>
          {src && (
            <img class="map-picture" src={src} alt="" draggable={false}
              style={size ? { width: `${size.w}px`, height: `${size.h}px`, transform: `translate(${t2.x}px, ${t2.y}px) scale(${t2.k})` } : { visibility: 'hidden' }}
              onLoad={(e) => { const img = e.currentTarget; if (!size || size.w !== img.naturalWidth || size.h !== img.naturalHeight) setSize({ w: img.naturalWidth, h: img.naturalHeight }); }} />
          )}
          {src && size && journey && !editing && <Route stops={journey.stops} here={here} at={at} />}
          {src && size && model.pins.map((p) => {
            const moving = drag?.id === p.entry.id ? drag : null;
            const pos = at(moving?.x ?? p.x, moving?.y ?? p.y);
            const name = p.entry.name || p.entry.id;
            return (
              <div key={p.entry.id} class={`map-pin t-place${p.ended ? ' is-ended' : ''}${absent(p.entry.id) ? ' is-absent' : ''}${p.entry.id === selectedId ? ' is-selected' : ''}${moving ? ' is-moving' : ''}`} style={{ left: `${pos.left}px`, top: `${pos.top}px` }}>
                <button type="button" class="map-pin-dot" data-id={p.entry.id}
                  aria-label={editing ? t('{name}: arrow keys move it, Delete takes it off', { name }) : t('Open {name}', { name })}
                  onClick={() => { if (!editing) onOpen(p.entry.id); }}
                  onPointerDown={(e) => startDrag(p, e)} onKeyDown={(e) => pinKey(p, e)}
                  onMouseEnter={(e) => hoverOn(p, e)} onMouseMove={(e) => { if (hover?.p.entry.id !== p.entry.id) hoverOn(p, e); }}
                  onMouseLeave={() => unhover(p)} onFocus={(e) => hoverOn(p, e)} onBlur={() => unhover(p)}>
                  <Portrait entry={p.entry} size="sm" />
                </button>
                <span class="map-pin-name" aria-hidden="true">{name}</span>
                {p.maps.length > 0 && !editing && (
                  <button type="button" class="map-pin-map" onClick={() => onShowMap(p.maps[0]!.id)} aria-label={t('Open the map {name}', { name: p.maps[0]!.name })} title={t('Open the map {name}', { name: p.maps[0]!.name })}>
                    <Icon name="treasure-map" />
                  </button>
                )}
              </div>
            );
          })}
          {src && size && !editing && journey && here !== undefined && (() => {
            const stop = journey.stops[here]!;
            const pos = at(stop.spot.pin.x, stop.spot.pin.y);
            return (
              <button type="button" class="map-traveller" style={{ left: `${pos.left}px`, top: `${pos.top}px` }} onClick={() => onOpen(journey.entry.id)}
                title={t('{name}, at {place}', { name: journey.entry.name, place: stop.spot.place.name })} aria-label={t('{name}, at {place}', { name: journey.entry.name, place: stop.spot.place.name })}>
                <Portrait entry={journey.entry} size="sm" />
              </button>
            );
          })()}
          {src && size && !editing && yearEvents.map((ev) => {
            const pos = at(ev.spot.pin.x, ev.spot.pin.y);
            // Events at one pin stack upwards beside it.
            const nth = yearEvents.filter((x) => x.spot.pin === ev.spot.pin).indexOf(ev);
            const where = ev.spot.place.id !== ev.spot.pin.entry.id ? `, ${ev.spot.place.name}` : '';
            return (
              <button key={ev.entry.id} type="button" class="map-event t-event" style={{ left: `${pos.left}px`, top: `${pos.top}px`, '--nth': nth }} onClick={() => onOpen(ev.entry.id)}
                title={`${ev.entry.name} (${ev.when}${where})`}>
                <Portrait entry={ev.entry} size="xs" /><span class="map-event-name">{ev.entry.name}</span>
              </button>
            );
          })}
          {src === undefined && <p class="map-note" role="status"><Icon name="cycle" class="ask-spin" /> {t('Loading the map…')}</p>}
          {src === null && (
            <div class="map-note is-missing" role="alert">
              <Icon name="hazard-sign" />
              <p>{t('The picture of this map is missing: {file}. Choose another one in Map settings.', { file: map.image })}</p>
            </div>
          )}
        </div>
        {src && size && <ZoomControls pz={pz} onFit={fit} />}
        {src && size && timeBar && time && (
          <div class="map-time" role="group" aria-label={t('Time on the map')}>
            {time.journeys.length > 0 && (
              <Select id="map-follow" class="map-follow" value={follow} onChange={setFollow} aria-label={t('Whose journey to draw')}
                options={[{ value: '', label: t('No journey'), icon: 'direction-signs' as const }, ...time.journeys.map((j) => ({ value: j.entry.id, label: j.entry.name || j.entry.id, icon: 'person' as const, tone: 't-character' }))]} />
            )}
            {span && (
              <div class="map-year">
                <Icon name="hourglass" />
                <input type="range" class="map-year-slider" min={span.min / per} max={span.max / per} step={1} list="map-year-marks"
                  value={(when ?? span.max) / per} onInput={(e) => setYear(Number(e.currentTarget.value) * per)}
                  aria-label={t('Year on the map')} aria-valuetext={when === null ? t('All time') : yearLabel(when, cal)} />
                <datalist id="map-year-marks">
                  {[...new Set(time.events.map((e) => Math.floor(e.from / per)))].map((y) => <option key={y} value={y} />)}
                </datalist>
                <output class="map-year-label">{when === null ? t('All time') : yearLabel(when, cal)}</output>
                {when !== null && (
                  <button type="button" class="ghost small icon-only map-year-reset" onClick={() => setYear(null)} aria-label={t('All time')} title={t('All time: every place, no year')}><Icon name="cancel" /></button>
                )}
              </div>
            )}
          </div>
        )}
        {src && size && !model.pins.length && !editing && (
          <p class="map-hint muted"><Icon name="position-marker" /> {t('No places on this map yet. Use Edit pins to put them on it.')}</p>
        )}
      </div>
      {hover && <PinCard p={hover.p} at={hover.at} />}
    </div>
  );
}

/**
 * Someone's journey under the pins: a dashed line from stop to stop with each stop numbered beside its pin (a stop
 * visited again gets its number next to the first). With a year, the way still ahead of them is faint.
 */
function Route({ stops, here, at }: { stops: JourneyStop[]; here: number | undefined; at: (x: number, y: number) => { left: number; top: number } }) {
  const pts = stops.map((s) => at(s.spot.pin.x, s.spot.pin.y));
  const line = (list: { left: number; top: number }[]): string => list.map((p) => `${p.left},${p.top}`).join(' ');
  const done = here === undefined ? pts.length : here + 1;
  const tip = (s: JourneyStop, i: number): string => [
    `${i + 1}. ${s.spot.place.name}`,
    ...s.why.map((w) => (w.kind === 'lived' ? (w.when ? t('Lived in {place} ({when})', { place: w.place.name, when: w.when }) : t('Lived in {place}', { place: w.place.name })) : `${w.event.name} (${w.when})`)),
  ].join('\n');
  return (
    <svg class="map-route" aria-hidden="true">
      {done < pts.length && <><polyline class="map-route-case is-ahead" points={line(pts.slice(done - 1))} /><polyline class="map-route-line is-ahead" points={line(pts.slice(done - 1))} /></>}
      <polyline class="map-route-case" points={line(pts.slice(0, done))} />
      <polyline class="map-route-line" points={line(pts.slice(0, done))} />
      {pts.map((p, i) => {
        const again = stops.slice(0, i).filter((s) => s.spot.pin === stops[i]!.spot.pin).length;
        const x = p.left - 31 - again * 20, y = p.top;
        return (
          <g key={i} class={`map-route-stop${i >= done ? ' is-ahead' : ''}`}>
            <title>{tip(stops[i]!, i)}</title>
            <circle cx={x} cy={y} r={9} />
            <text x={x} y={y}>{i + 1}</text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * What a pin shows on hover or focus: the place, where it lies, and who and what is tied to it. It opens above the pin
 * and to its right (left near the right edge, below the name near the top), so the pin and its name stay in view.
 */
function PinCard({ p, at }: { p: MapPlace; at: DOMRect }) {
  const byType = new Map<EntryType, Entry[]>();
  for (const e of p.linked) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  const kind = typeof p.entry.details?.['kind'] === 'string' ? (p.entry.details['kind'] as string) : '';
  const cx = at.left + at.width / 2;
  const style = {
    ...(cx > window.innerWidth - 380 ? { right: `${window.innerWidth - cx + 16}px` } : { left: `${cx + 16}px` }),
    ...(at.top > 320 ? { bottom: `${window.innerHeight - at.top + 6}px` } : { top: `${at.bottom + 26}px` }),
  };
  return (
    <div class="hover-card map-card t-place" role="tooltip" style={style}>
      <div class="map-card-head">
        <Portrait entry={p.entry} size="md" />
        <div>
          <strong>{p.entry.name || p.entry.id}</strong>
          <span class="muted small">{[kind || tm(TYPE_SINGULAR.place), p.partOf ? t('in {place}', { place: p.partOf.name }) : '', p.ended ? tm(LIFECYCLE.place!.endedWord) : ''].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      {p.entry.summary && <p class="map-card-summary">{p.entry.summary}</p>}
      {ENTRY_TYPES.filter((ty) => byType.has(ty)).map((ty) => {
        const list = byType.get(ty)!;
        const names = list.slice(0, CARD_NAMES).map((e) => e.name || e.id).join(', ');
        return (
          <p key={ty} class="small map-card-row">
            <strong>{tm(TYPE_LABELS[ty])}:</strong> {list.length > CARD_NAMES ? t('{names} and {n} more', { names, n: list.length - CARD_NAMES }) : names}
          </p>
        );
      })}
      {p.maps.length > 0 && <p class="small muted"><Icon name="treasure-map" /> {t('Has its own map: {names}', { names: p.maps.map((m) => m.name).join(', ') })}</p>}
    </div>
  );
}

/** Add a map or change one: its name, its picture (a file, or a map picture the book already has) and the place it shows. */
function MapDialog({ dir, world, map, onSave, onDelete, onClose }: {
  dir: string;
  world: World;
  map?: WorldMap;
  onSave: (map: WorldMap, picture?: MapPicture) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const ix = useMemo(() => new WorldIndex(world), [world]);
  const maps = world.manifest.maps ?? [];
  const [name, setName] = useState(map?.name ?? (maps.length ? '' : t('World map')));
  const [place, setPlace] = useState(() => (map?.place ? (ix.resolve(map.place)?.id ?? '') : ''));
  const [picture, setPicture] = useState<MapPicture | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Drawing the picture with AI: the prompt follows the place it shows until it is changed by hand.
  const [drawOpen, setDrawOpen] = useState(false);
  const [ownPrompt, setOwnPrompt] = useState<string | null>(null);
  const [service, setService] = useState<PictureService | null | undefined>(undefined);
  const [drawing, setDrawing] = useState(false);
  const builtPrompt = useMemo(() => withArtStyle(mapPrompt(ix, place || undefined), world.manifest.artStyle), [ix, place, world]);
  const prompt = ownPrompt ?? builtPrompt;
  const openDraw = (): void => {
    setDrawOpen((o) => !o);
    if (service === undefined) void window.lore.pictureService().then(setService, () => setService(null));
  };
  const draw = async (): Promise<void> => {
    setDrawing(true);
    setProblem(null);
    try {
      const made = await window.lore.mapPictureMake(prompt);
      setPicture({ picked: made.path });
      setPicked(await window.lore.readPickedImage(made.path));
      setDrawOpen(false);
    } catch (e) {
      setProblem(message(e));
    } finally {
      setDrawing(false);
    }
  };
  const places = useMemo(() => world.entries.filter((e) => e.type === 'place').sort((a, b) => a.name.localeCompare(b.name)), [world]);
  // Pictures the book already has that are maps (a place's or an event's map view).
  const bookMaps = useMemo(() => world.entries.flatMap((e) => (e.images ?? []).filter((i) => i.view === 'map').map((i) => ({ entry: e, file: i.file }))), [world]);
  const shown = picture && 'from' in picture ? picture.from : undefined;
  const current = useImageState(dir, picture ? shown : map?.image);
  const preview = picture && 'picked' in picture ? picked : current;
  const choose = async (): Promise<void> => {
    const p = await window.lore.pickImageFile();
    if (!p) return;
    setPicture({ picked: p });
    setPicked(await window.lore.readPickedImage(p));
  };
  const ready = !!name.trim() && (!!map || !!picture) && !busy && !drawing;
  const save = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    try {
      const { place: _old, ...rest } = map ?? { id: newMapId(maps, name), name: '', image: '' };
      await onSave({ ...rest, name: name.trim(), ...(place ? { place } : {}) }, picture ?? undefined);
      onClose();
    } catch (e) {
      setProblem(message(e));
      setBusy(false);
    }
  };
  return (
    <Dialog title={map ? t('Map settings') : t('Add a map')} onClose={onClose} class="map-dialog"
      footer={<>
        {onDelete && <button type="button" class="ghost danger map-delete" onClick={onDelete}><Icon name="trash-can" /> {t('Delete map')}</button>}
        <span class="spacer" />
        <button type="button" class="ghost" onClick={onClose}>{t('Cancel')}</button>
        <button type="button" class="primary map-save" disabled={!ready} onClick={() => void save()}>{map ? t('Save') : t('Add map')}</button>
      </>}>
      <form class="map-dialog-body" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div class="field">
          <label for="map-name">{t('Name')}</label>
          <input id="map-name" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder={t('The Sunsea, The city of Qarim…')} autoFocus />
        </div>
        <div class="field">
          <label for="map-choose">{t('Picture')}</label>
          <div class="map-picture-pick">
            <div class="map-preview">
              {preview ? <img src={preview} alt="" /> : <span class="muted"><Icon name="treasure-map" /> {preview === null && map && !picture ? t('The picture is missing') : t('No picture yet')}</span>}
            </div>
            <div class="map-picture-actions">
              <button type="button" id="map-choose" class="map-choose" onClick={() => void choose()} disabled={drawing}><Icon name="treasure-map" /> {map || picture ? t('Choose another picture…') : t('Choose a picture…')}</button>
              <button type="button" class="map-draw" aria-expanded={drawOpen} aria-controls="map-draw-panel" onClick={openDraw} disabled={drawing}><Icon name="magic-swirl" /> {t('Draw one with AI…')}</button>
              <span class="hint">{t('PNG, JPEG, WebP or GIF. It is copied into the book.')}</span>
            </div>
          </div>
          {drawOpen && (
            <div class="map-draw-panel" id="map-draw-panel">
              <label for="map-draw-prompt">{t('What it shows')}</label>
              <textarea id="map-draw-prompt" rows={5} value={prompt} disabled={drawing} onInput={(e) => setOwnPrompt(e.currentTarget.value)} />
              <span class="hint">
                {t("Built from the book's places (the ones in the place it shows) and its art style. Change it as you like.")}{' '}
                {ownPrompt !== null && <button type="button" class="link" onClick={() => setOwnPrompt(null)}>{t('Build it again')}</button>}
              </span>
              {service === undefined ? null : service ? (
                <p class="muted make-picture-service"><Icon name="info" /> {service.model ? t('{service} draws it with {model}, billed to your key.', { service: service.service, model: service.model }) : t('{service} draws it, billed to your key.', { service: service.service })}</p>
              ) : (
                <p class="make-picture-service is-off"><Icon name="hazard-sign" /> {t('No picture service is set up. In the library, open Connect AI and add a key under Pictures.')}</p>
              )}
              <div class="map-draw-actions">
                <button type="button" class="primary small map-draw-go" disabled={drawing || !service || !prompt.trim()} onClick={() => void draw()}><Icon name="magic-swirl" /> {drawing ? t('Drawing…') : t('Draw the map')}</button>
                {drawing && <span class="make-picture-busy" role="status"><Icon name="cycle" class="ask-spin" /> {t('Drawing. This usually takes 10 to 60 seconds.')}</span>}
              </div>
            </div>
          )}
          {bookMaps.length > 0 && (
            <div class="map-book-pictures">
              <span class="hint">{t('Or use a map picture the book already has:')}</span>
              <div class="map-book-list">
                {bookMaps.map((b) => (
                  <BookPicture key={b.file} dir={dir} file={b.file} label={b.entry.name} chosen={shown === b.file} onChoose={() => { setPicture({ from: b.file }); setPicked(null); }} />
                ))}
              </div>
            </div>
          )}
        </div>
        <div class="field">
          <label for="map-place">{t('Shows')}</label>
          <Select id="map-place" value={place} onChange={setPlace}
            options={[{ value: '', label: t('The whole world (no one place)') }, ...places.map((p) => ({ value: p.id, label: p.name || p.id, icon: 'castle' as const, tone: 't-place' }))]} />
          <span class="hint">{t('A map of one place (a city, a region): its pin on the other maps opens this map.')}</span>
        </div>
        {problem && <p class="error-line" role="alert"><Icon name="cancel" /> {problem}</p>}
      </form>
    </Dialog>
  );
}

function BookPicture({ dir, file, label, chosen, onChoose }: { dir: string; file: string; label: string; chosen: boolean; onChoose: () => void }) {
  const src = useImageState(dir, file);
  return (
    <button type="button" class="map-book-picture" aria-pressed={chosen} onClick={onChoose} title={file}>
      {src ? <img src={src} alt="" /> : <Icon name="treasure-map" />}
      <span>{label}</span>
    </button>
  );
}
