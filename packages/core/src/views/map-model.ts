import { isEnded } from '../lifecycle.ts';
import { references } from '../rules/references.ts';
import { ENTRY_TYPES, type Entry, type MapPin, type Place, type World, type WorldMap } from '../types.ts';
import { WorldIndex } from '../world-index.ts';

const key = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** A map by its id, else by its name (case and extra spaces aside). */
export function findMap(maps: readonly WorldMap[] | undefined, ref: string): WorldMap | undefined {
  const k = key(ref);
  if (!k) return undefined;
  return maps?.find((m) => key(m.id) === k) ?? maps?.find((m) => key(m.name) === k);
}

/** A free id for a new map, made from its name the way look ids are. */
export function newMapId(maps: readonly WorldMap[] | undefined, name: string): string {
  const base = name.replace(/ı/g, 'i').replace(/İ/g, 'I').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'map';
  const taken = new Set((maps ?? []).map((m) => m.id.toLowerCase()));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** A place's pin on one map (by the map's id or name), when it has one. */
export function pinOn(place: Place, map: WorldMap): MapPin | undefined {
  return place.pins?.find((p) => p.map === map.id) ?? place.pins?.find((p) => findMap([map], p.map) === map);
}

/** Pins in the file keep two decimals: finer than any screen, and the numbers stay short. */
export const pinNumber = (n: number): number => Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;

/** The place with its pin on a map set to (x, y), added when it had none there. */
export function withPin(place: Place, map: WorldMap, x: number, y: number): Place {
  const pin: MapPin = { map: map.id, x: pinNumber(x), y: pinNumber(y) };
  const pins = place.pins ?? [];
  const at = pins.findIndex((p) => p === pinOn(place, map));
  return { ...place, pins: at < 0 ? [...pins, pin] : pins.map((p, i) => (i === at ? pin : p)) };
}

/** The place without its pin on a map. */
export function withoutPin(place: Place, map: WorldMap): Place {
  const pins = (place.pins ?? []).filter((p) => findMap([map], p.map) !== map);
  const { pins: _old, ...rest } = place;
  return pins.length ? { ...rest, pins } : rest;
}

export interface MapPlace {
  entry: Place;
  /** Its pin on this map, in percent of the picture from the left and top edges. */
  x: number;
  y: number;
  /** Destroyed (or otherwise over). */
  ended: boolean;
  /** The place it lies in, when the book has it. */
  partOf?: Entry;
  /** Maps that show this place (a city's own map), opened from its pin. */
  maps: WorldMap[];
  /**
   * Entries tied to it, by type and then name: who lives or stays there, the factions and items kept there, what
   * happened there, the places inside it, and whoever the place itself names (its ruler).
   */
  linked: Entry[];
}

export interface MapModel {
  map: WorldMap;
  /** The pinned places, from the top of the picture down, so a pin lower on the map is drawn over a higher one. */
  pins: MapPlace[];
  /** The book's places that are not on this map, by name. */
  unpinned: Place[];
  /** The place this map shows, when the book has it. */
  place?: Place;
  /** Other maps that have that place pinned on them: a level up. */
  parents: WorldMap[];
}

/** One map of the world with its pinned places, and what is not on it yet. Undefined when the book has no such map. */
export function mapModel(world: World, mapRef: string): MapModel | undefined {
  const maps = world.manifest.maps ?? [];
  const map = findMap(maps, mapRef);
  if (!map) return undefined;
  const ix = new WorldIndex(world);
  const places = ix.entries.filter((e): e is Place => e.type === 'place');

  // Every link to or from a place in a field (not mentions in the text), both ways, so each pin can list them.
  const linked = new Map<string, Set<string>>();
  const tie = (placeId: string, otherId: string): void => {
    if (placeId === otherId) return;
    let s = linked.get(placeId);
    if (!s) linked.set(placeId, (s = new Set()));
    s.add(otherId);
  };
  for (const e of ix.entries) {
    for (const r of references(e)) {
      if (r.field === 'body') continue;
      const target = ix.resolve(r.ref);
      if (!target) continue;
      if (target.type === 'place') tie(target.id, e.id);
      // A place's own links (its ruler), but not the larger place it lies in: that one is shown as "part of".
      if (e.type === 'place' && r.field !== 'partOf') tie(e.id, target.id);
    }
  }
  const order = (a: Entry, b: Entry): number => ENTRY_TYPES.indexOf(a.type) - ENTRY_TYPES.indexOf(b.type) || a.name.localeCompare(b.name);
  const mapsOf = (p: Place): WorldMap[] => maps.filter((m) => m.place && ix.resolve(m.place)?.id === p.id);

  const pins: MapPlace[] = [];
  const unpinned: Place[] = [];
  for (const p of places) {
    const pin = pinOn(p, map);
    if (!pin) {
      unpinned.push(p);
      continue;
    }
    const parent = p.partOf ? ix.resolve(p.partOf) : undefined;
    const ids = [...(linked.get(p.id) ?? [])];
    pins.push({
      entry: p, x: pin.x, y: pin.y, ended: isEnded(p),
      ...(parent && parent.id !== p.id ? { partOf: parent } : {}),
      maps: mapsOf(p).filter((m) => m.id !== map.id),
      linked: ids.map((id) => ix.byIdOf(id)).filter((e): e is Entry => !!e).sort(order),
    });
  }
  pins.sort((a, b) => a.y - b.y || a.x - b.x);
  unpinned.sort((a, b) => a.name.localeCompare(b.name));

  const shown = map.place ? ix.resolve(map.place) : undefined;
  const place = shown?.type === 'place' ? shown : undefined;
  const parents = place ? maps.filter((m) => m.id !== map.id && pinOn(place, m)) : [];
  return { map, pins, unpinned, ...(place ? { place } : {}), parents };
}
