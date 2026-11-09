import { monthsOf } from '../dates.ts';
import type { Character, LoreEvent, Place, World } from '../types.ts';
import { WorldIndex } from '../world-index.ts';
import type { MapModel, MapPlace } from './map-model.ts';

/** Where something shows on a map: at its place's pin, or at the pin of a place that place lies in. */
export interface MapSpot {
  /** The pinned place it shows at. */
  pin: MapPlace;
  /** The place itself (a well inside the pinned city, say). */
  place: Place;
}

/** A dated event at a place on the map. Days are absolute days on the world axis. */
export interface MapEvent {
  entry: LoreEvent;
  spot: MapSpot;
  from: number;
  to: number;
  /** Its date as written, with the era ("312 OK", "1920 – 1925"). */
  when: string;
}

/** Why someone was at a stop of their journey: living there, or an event there. */
export type JourneyWhy = { kind: 'lived'; place: Place; when?: string } | { kind: 'event'; event: LoreEvent; when: string };

export interface JourneyStop {
  spot: MapSpot;
  /** When they were there, as far as the book says. */
  from?: number;
  to?: number;
  why: JourneyWhy[];
}

/** Someone's way across the map: the places they lived in and the events they were part of, in order. */
export interface Journey {
  entry: Character;
  stops: JourneyStop[];
  /** Their life, when known. */
  from?: number;
  to?: number;
}

export interface MapTime {
  /** The years a slider runs over (absolute days of the first and the last), when the map has dated things over more than one year. */
  span?: { min: number; max: number; daysPerYear: number };
  events: MapEvent[];
  /** Everyone with stops at two or more pins of this map, by name. */
  journeys: Journey[];
  /** When the pinned places exist, for those with a known start or end. */
  lives: Record<string, { from?: number; to?: number }>;
}

/** The map's dated story: events at its places, who travelled between them, and when its places stood. */
export function mapTime(world: World, model: MapModel): MapTime {
  const ix = new WorldIndex(world);
  const pinned = new Map(model.pins.map((p) => [p.entry.id, p]));
  const spotOf = (ref: string | undefined): MapSpot | undefined => {
    const own = ref ? ix.resolve(ref) : undefined;
    if (own?.type !== 'place') return undefined;
    let at: Place | undefined = own;
    for (let i = 0; at && i < 12; i++) {
      const pin = pinned.get(at.id);
      if (pin) return { pin, place: own };
      const up: ReturnType<WorldIndex['resolve']> = at.partOf ? ix.resolve(at.partOf) : undefined;
      at = up?.type === 'place' ? up : undefined;
    }
    return undefined;
  };
  const days: number[] = [];

  const events: MapEvent[] = [];
  for (const e of ix.entries) {
    if (e.type !== 'event') continue;
    const spot = spotOf(e.place);
    const life = ix.life(e);
    if (!spot || !life.start) continue;
    const from = life.start.date.lo;
    const to = Math.max(from, (life.end ?? life.start).date.hi);
    events.push({ entry: e, spot, from, to, when: life.end ? `${ix.fmt(life.start.date)} – ${ix.fmt(life.end.date)}` : ix.fmt(life.start.date) });
    days.push(from, to);
  }
  events.sort((a, b) => a.from - b.from || a.entry.name.localeCompare(b.entry.name));

  const lives: MapTime['lives'] = {};
  for (const p of model.pins) {
    const life = ix.life(p.entry);
    if (!life.start && !life.end) continue;
    lives[p.entry.id] = { ...(life.start ? { from: life.start.date.lo } : {}), ...(life.end ? { to: life.end.date.hi } : {}) };
    if (life.start) days.push(life.start.date.lo);
    if (life.end) days.push(life.end.date.hi);
  }

  const journeys: Journey[] = [];
  const isMe = (ref: string | undefined, id: string): boolean => !!ref && ix.resolve(ref)?.id === id;
  for (const c of ix.entries) {
    if (c.type !== 'character') continue;
    // Where they lived, in the order written; a place without a date stays after the one before it.
    let last = -Infinity;
    const steps: { key: number; stop: JourneyStop }[] = [];
    for (const l of c.locations ?? []) {
      const spot = spotOf(l.place);
      if (!spot) continue;
      const a = ix.date(l.from), b = ix.date(l.to);
      if (a) last = a.lo;
      // An open end stays open, as on the Timeline: "490 –", "– 498".
      const when = a && b ? `${ix.fmt(a)} – ${ix.fmt(b)}` : a ? `${ix.fmt(a)} –` : b ? `– ${ix.fmt(b)}` : undefined;
      steps.push({ key: a?.lo ?? last, stop: { spot, ...(a ? { from: a.lo } : {}), ...(b ? { to: b.hi } : {}), why: [{ kind: 'lived', place: spot.place, ...(when ? { when } : {}) }] } });
    }
    for (const ev of events) {
      const e = ev.entry;
      if (!(e.participants ?? []).some((p) => isMe(p.id, c.id)) && !(e.actions ?? []).some((a) => isMe(a.actor, c.id) || isMe(a.target, c.id))) continue;
      steps.push({ key: ev.from, stop: { spot: ev.spot, from: ev.from, to: ev.to, why: [{ kind: 'event', event: e, when: ev.when }] } });
    }
    steps.sort((x, y) => x.key - y.key);
    // One stop for each stay at a pin: events in the town they live in join that stop.
    const stops: JourneyStop[] = [];
    for (const { stop } of steps) {
      const prev = stops.at(-1);
      if (prev?.spot.pin.entry.id !== stop.spot.pin.entry.id) {
        stops.push(stop);
        continue;
      }
      prev.why.push(...stop.why);
      const from = Math.min(prev.from ?? Infinity, stop.from ?? Infinity);
      const to = Math.max(prev.to ?? -Infinity, stop.to ?? -Infinity);
      if (Number.isFinite(from)) prev.from = from;
      if (Number.isFinite(to)) prev.to = to;
    }
    if (new Set(stops.map((s) => s.spot.pin.entry.id)).size < 2) continue;
    const life = ix.life(c);
    journeys.push({ entry: c, stops, ...(life.start ? { from: life.start.date.lo } : {}), ...(life.end ? { to: life.end.date.hi } : {}) });
    for (const s of stops) for (const d of [s.from, s.to]) if (d !== undefined) days.push(d);
  }
  journeys.sort((a, b) => a.entry.name.localeCompare(b.entry.name));

  const perYear = monthsOf(world.manifest.calendar).reduce((s, m) => s + m.days, 0);
  const year = (d: number): number => Math.floor(d / perYear) * perYear;
  const min = days.length ? year(Math.min(...days)) : 0;
  const max = days.length ? year(Math.max(...days)) : 0;
  return { ...(max > min ? { span: { min, max, daysPerYear: perYear } } : {}), events, journeys, lives };
}

/** Whether something that lasts from `from` to `to` (either end open) is there at some time in the year starting on `day`. */
export function inYear(span: { from?: number; to?: number }, day: number, daysPerYear: number): boolean {
  return (span.from === undefined || span.from < day + daysPerYear) && (span.to === undefined || span.to >= day);
}

/**
 * Which stop someone is at in the year starting on `day`: the last dated one they had reached by the end of it. None
 * before the first dated stop, and none outside their life.
 */
export function journeyAt(j: Journey, day: number, daysPerYear: number): number | undefined {
  if (!inYear(j, day, daysPerYear)) return undefined;
  let at: number | undefined;
  j.stops.forEach((s, i) => {
    if (s.from !== undefined && s.from < day + daysPerYear) at = i;
  });
  return at;
}
