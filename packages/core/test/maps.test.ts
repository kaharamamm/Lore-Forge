/** Maps: pictures of the world with places pinned on them (world.json "maps", a place's "pins"), and their check. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMap, inYear, journeyAt, mapModel, mapTime, newMapId, parseEntry, parseManifest, pinNumber, pinOn, serializeEntry, withoutPin, withPin, type Place, type WorldMap } from '@lore-forge/core';
import { manifest, warnings, world, type Draft } from './helpers.ts';

const maps: WorldMap[] = [
  { id: 'the-sunsea', name: 'The Sunsea', image: 'maps/the-sunsea.png' },
  { id: 'camelamamm', name: 'Camelamamm', image: 'maps/camelamamm.jpg', place: 'Camelamamm' },
];
const drafts: Draft[] = [
  { id: 'place-sunsea', type: 'place', name: 'The Sunsea' },
  { id: 'place-camelamamm', type: 'place', name: 'Camelamamm', partOf: 'place-sunsea', ruler: 'char-samira', pins: [{ map: 'the-sunsea', x: 40, y: 62.5 }] },
  { id: 'place-kettle', type: 'place', name: 'The Patient Kettle', partOf: 'place-camelamamm', pins: [{ map: 'camelamamm', x: 20, y: 30 }, { map: 'the-sunsea', x: 41, y: 63 }] },
  { id: 'place-dunes', type: 'place', name: 'The Glass Dunes', status: 'destroyed', destroyed: '512', pins: [{ map: 'The Sunsea', x: 70, y: 10 }] },
  { id: 'place-well', type: 'place', name: 'The Singing Well' },
  { id: 'char-camel', type: 'character', name: 'Mr Camel', home: 'Camelamamm' },
  { id: 'char-samira', type: 'character', name: 'Queen Samira' },
  { id: 'char-pip', type: 'character', name: 'Pip', locations: [{ place: 'place-camelamamm', from: '500' }], body: 'Pip dreams of [[The Glass Dunes]].' },
  { id: 'fac-wardens', type: 'faction', name: 'The Well Wardens', headquarters: 'place-camelamamm' },
  { id: 'evt-quiet', type: 'event', name: 'The Morning the Well Went Quiet', date: '512', place: 'Camelamamm' },
];

test('pins are read and written with the place, after partOf', () => {
  const place = { id: 'place-a', type: 'place', name: 'A', partOf: 'place-b', pins: [{ map: 'land', x: 12.5, y: 80 }], body: '' } as Place;
  const text = serializeEntry(place);
  assert.match(text, /partOf: place-b\npins:\n {2}- map: land\n {4}x: 12\.5\n {4}y: 80\n/);
  assert.deepEqual(parseEntry(text), { entry: place, problems: [] });
});

test('a pin without its map or numbers is left out, and a number past the edge is moved onto it', () => {
  const r = parseEntry('---\nid: j\nname: J\ntype: place\npins:\n  - { map: a, x: 200, y: -5 }\n  - { x: 1, y: 2 }\n  - { map: a, x: wide, y: 1 }\n  - { map: a, y: 3 }\n---\n');
  assert.deepEqual((r.entry as Place).pins, [{ map: 'a', x: 100, y: 0 }]);
  assert.deepEqual(r.problems, [
    '"pins[0].x" should be from 0 to 100 (percent of the map).',
    '"pins[0].y" should be from 0 to 100 (percent of the map).',
    '"pins[1]" needs "map".',
    '"x" should be a number.',
    '"pins[3]" needs "x".',
  ]);
});

test('world.json maps: the ones that cannot be used are set aside, the rest keep every key', () => {
  const base = { ...manifest };
  const read = (m: unknown) => parseManifest(JSON.stringify({ ...base, maps: m }));
  const good = read([{ id: 'land', name: 'Land', image: ' maps/land.png ', place: ' Camelamamm ', grid: true }, { id: 'LAND', name: 'Twice', image: 'b.png' }, { id: 'x', name: 'No picture' }, 'map']);
  assert.deepEqual(good.manifest?.maps, [{ id: 'land', name: 'Land', image: 'maps/land.png', place: 'Camelamamm', grid: true }]);
  assert.deepEqual(good.issues, [
    'Map 2 in "maps" has the id of an earlier map ("LAND"). It was left out.',
    'Map 3 in "maps" needs a text "id", "name" and "image". It was left out.',
    'Map 4 in "maps" needs a text "id", "name" and "image". It was left out.',
  ]);
  const bad = read({ id: 'land' });
  assert.equal(bad.manifest?.maps, undefined);
  assert.deepEqual(bad.issues, ['"maps" should be a list of maps, each with an id, a name and a picture. The maps were left out.']);
  assert.equal(read(null).manifest?.maps, undefined);
  assert.ok(!('maps' in read(null).manifest!));
});

test('a map by id or name, and a new map id', () => {
  assert.equal(findMap(maps, 'camelamamm'), maps[1]);
  assert.equal(findMap(maps, '  the  SUNSEA '), maps[0]);
  assert.equal(findMap(maps, 'nowhere'), undefined);
  assert.equal(findMap(undefined, 'x'), undefined);
  assert.equal(newMapId(maps, 'The Sunsea'), 'the-sunsea-2');
  assert.equal(newMapId(maps, 'Işıklı Çöl'), 'isikli-col');
  assert.equal(newMapId([], '!!!'), 'map');
});

test('placing, moving and taking off a pin', () => {
  const land = maps[0]!;
  const place = { id: 'p', type: 'place', name: 'P', body: '', pins: [{ map: 'The Sunsea', x: 1, y: 2 }, { map: 'camelamamm', x: 5, y: 5 }] } as Place;
  assert.deepEqual(pinOn(place, land), { map: 'The Sunsea', x: 1, y: 2 });
  // Moved: the pin now names the map by its id, in the same place in the list.
  assert.deepEqual(withPin(place, land, 33.33333, 101).pins, [{ map: 'the-sunsea', x: 33.33, y: 100 }, { map: 'camelamamm', x: 5, y: 5 }]);
  assert.deepEqual(withPin({ ...place, pins: undefined }, land, 10, 20).pins, [{ map: 'the-sunsea', x: 10, y: 20 }]);
  assert.deepEqual(withoutPin(place, land).pins, [{ map: 'camelamamm', x: 5, y: 5 }]);
  assert.ok(!('pins' in withoutPin(withoutPin(place, land), maps[1]!)));
  assert.equal(pinNumber(-3), 0);
  assert.equal(pinNumber(12.345), 12.35);
});

test('a map: its pins from the top down, what each place holds, and what is not on it yet', () => {
  const w = world(drafts, { manifest: { maps } });
  const m = mapModel(w, 'The Sunsea')!;
  assert.deepEqual(m.pins.map((p) => [p.entry.name, p.x, p.y]), [['The Glass Dunes', 70, 10], ['Camelamamm', 40, 62.5], ['The Patient Kettle', 41, 63]]);
  assert.deepEqual(m.unpinned.map((p) => p.name), ['The Singing Well', 'The Sunsea']);
  assert.equal(m.place, undefined);
  assert.deepEqual(m.parents, []);
  const city = m.pins.find((p) => p.entry.id === 'place-camelamamm')!;
  // Its ruler, who lives and stays there, the faction based there, what happened there and the place inside it.
  assert.deepEqual(city.linked.map((e) => e.name), ['Mr Camel', 'Pip', 'Queen Samira', 'The Patient Kettle', 'The Well Wardens', 'The Morning the Well Went Quiet']);
  assert.equal(city.partOf?.id, 'place-sunsea');
  assert.deepEqual(city.maps.map((x) => x.id), ['camelamamm'], 'the city has a map of its own');
  assert.equal(city.ended, false);
  const dunes = m.pins.find((p) => p.entry.id === 'place-dunes')!;
  assert.equal(dunes.ended, true);
  assert.deepEqual(dunes.linked, [], 'a mention in the text is not a tie');
  // The city's own map: the place it shows and the map a level up.
  const inner = mapModel(w, 'camelamamm')!;
  assert.equal(inner.place?.id, 'place-camelamamm');
  assert.deepEqual(inner.parents.map((x) => x.id), ['the-sunsea']);
  assert.deepEqual(inner.pins.map((p) => p.entry.id), ['place-kettle']);
  assert.equal(mapModel(w, 'nowhere'), undefined);
});

test('the check: a pin on a map the book does not have, and a map set to show something that is not a place', () => {
  const ws = warnings([
    ...drafts,
    { id: 'place-lost', type: 'place', name: 'Lost Cove', pins: [{ map: 'old-chart', x: 1, y: 1 }, { map: 'the sunsea', x: 2, y: 2 }] },
  ], 'map-pin', { manifest: { maps: [...maps, { id: 'samira', name: 'The Queen', image: 'maps/q.png', place: 'Queen Samira' }, { id: 'isles', name: 'Isles', image: 'maps/i.png', place: 'Atlantis' }] } });
  assert.deepEqual(ws.map((w) => w.message).sort(), [
    'Lost Cove is pinned on the map "old-chart", which this book does not have (source: Places/Lost Cove).',
    'The map "Isles" is set to show "Atlantis", but no entry has that id or name (source: world.json).',
    'The map "The Queen" is set to show Queen Samira, which is not a place (source: world.json).',
  ]);
  assert.deepEqual(ws.map((w) => w.offending.field).sort(), ['maps[2].place', 'maps[3].place', 'pins[0]']);
  assert.equal(warnings(drafts, 'map-pin', { manifest: { maps } }).length, 0);
});

test('the map in time: dated events at their places (or the place around them), journeys, and when places stood', () => {
  const w = world([
    { id: 'place-sunsea', type: 'place', name: 'The Sunsea' },
    { id: 'place-town', type: 'place', name: 'Camelamamm', partOf: 'place-sunsea', founded: '100', pins: [{ map: 'land', x: 40, y: 60 }] },
    { id: 'place-well', type: 'place', name: 'The Singing Well', partOf: 'place-town' },
    { id: 'place-dunes', type: 'place', name: 'The Glass Dunes', status: 'destroyed', destroyed: '512', pins: [{ map: 'land', x: 70, y: 10 }] },
    { id: 'place-far', type: 'place', name: 'Far Isle' },
    { id: 'char-pip', type: 'character', name: 'Pip', born: '480', locations: [{ place: 'place-town', from: '490' }, { place: 'place-dunes', from: '505', to: '510' }, { place: 'place-far' }] },
    { id: 'char-stay', type: 'character', name: 'Stay', locations: [{ place: 'place-town' }] },
    { id: 'evt-quiet', type: 'event', name: 'The Well Went Quiet', date: '500', place: 'place-well', participants: [{ id: 'char-pip' }] },
    { id: 'evt-storm', type: 'event', name: 'The Glass Storm', date: '512', place: 'place-dunes', actions: [{ actor: 'char-pip', verb: 'fled' }] },
    { id: 'evt-far', type: 'event', name: 'Far Away', date: '300', place: 'place-far' },
    { id: 'evt-someday', type: 'event', name: 'Someday', place: 'place-town' },
  ], { manifest: { maps: [{ id: 'land', name: 'The Land', image: 'maps/land.png' }] } });
  const time = mapTime(w, mapModel(w, 'land')!);
  // Only dated events at a place on this map; the well's shows at the pin of the town it lies in.
  assert.deepEqual(time.events.map((e) => [e.entry.name, e.spot.pin.entry.name, e.spot.place.name, e.when]), [['The Well Went Quiet', 'Camelamamm', 'The Singing Well', '500'], ['The Glass Storm', 'The Glass Dunes', 'The Glass Dunes', '512']]);
  // Pip lived in the town (the well event there joins that stop), then in the dunes (and the storm); Far Isle is not
  // on this map. Stay has one stop: no journey.
  assert.deepEqual(time.journeys.map((j) => [j.entry.name, j.stops.map((s) => [s.spot.pin.entry.name, s.why.map((y) => y.kind)])]), [['Pip', [['Camelamamm', ['lived', 'event']], ['The Glass Dunes', ['lived', 'event']]]]]);
  const { min, max, daysPerYear: per } = time.span!;
  assert.deepEqual([min / per, max / per], [100, 512]);
  // The dunes stood until 512, the town from 100.
  assert.ok(inYear(time.lives['place-dunes']!, 512 * per, per) && !inYear(time.lives['place-dunes']!, 513 * per, per));
  assert.ok(!inYear(time.lives['place-town']!, 99 * per, per) && inYear(time.lives['place-town']!, 100 * per, per));
  // Where Pip is: nowhere before birth or before the first dated stop; the town in 495; the dunes from 505.
  const pip = time.journeys[0]!;
  assert.deepEqual([470, 485, 495, 506, 600].map((y) => journeyAt(pip, y * per, per)), [undefined, undefined, 0, 1, 1]);
  // Nothing dated: no years to move through.
  const plain = world([{ id: 'a', type: 'place', name: 'A', pins: [{ map: 'land', x: 1, y: 1 }] }], { manifest: { maps: [{ id: 'land', name: 'The Land', image: 'maps/land.png' }] } });
  assert.equal(mapTime(plain, mapModel(plain, 'land')!).span, undefined);
});
