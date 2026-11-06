import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanOrder, moveBook, orderShelf, otherInstallSample, placeAfter, planShelf, removeKind, type ShelfSources, type WorldInfo } from '../src/shared/library.ts';

const SAMPLE: WorldInfo = { id: 'camelamamm', name: 'Camelamamm' };
/** A small fake disk: folder -> world.json id and name. */
const disk = (worlds: Record<string, WorldInfo>, over: Partial<ShelfSources> = {}): ShelfSources => ({
  recents: [], inRoot: [], sample: null, ownResources: null, hideSample: false,
  exists: (d) => d in worlds, info: (d) => worlds[d] ?? null, resolve: (d) => d.replace(/\/+$/, ''), ...over,
});

test('another install\'s sample is told apart from this app\'s own', () => {
  assert.ok(otherInstallSample('/opt/Lore-Forge-1.0/resources/worlds/camelamamm', '/opt/Lore-Forge/resources'));
  assert.ok(otherInstallSample('C:\\Users\\a\\AppData\\Local\\Temp\\2abc\\resources\\worlds\\camelamamm', 'C:\\Program Files\\Lore-Forge\\resources'));
  assert.ok(!otherInstallSample('/opt/Lore-Forge/resources/worlds/camelamamm', '/opt/Lore-Forge/resources'));
  assert.ok(!otherInstallSample('/home/a/worlds/camelamamm', null), 'a world folder of the user is not an install');
});

test('only one Camelamamm: the running app\'s sample wins over an old copy from another install', () => {
  const own = '/opt/Lore-Forge/resources/worlds/camelamamm';
  const old = '/tmp/.mount_Lore10/resources/worlds/camelamamm';
  const src = disk({ [own]: SAMPLE, [old]: SAMPLE, '/home/a/worlds/mine': { id: 'mine', name: 'Mine' } }, {
    recents: [old, '/home/a/worlds/mine'], inRoot: ['/home/a/worlds/mine'], sample: own, ownResources: '/opt/Lore-Forge/resources',
  });
  const { shelf, recents } = planShelf(src);
  assert.deepEqual(shelf, ['/home/a/worlds/mine', own]);
  assert.deepEqual(recents, ['/home/a/worlds/mine'], 'the old install\'s sample is dropped from the recent list');
});

test('a raw copy of the sample (same id and name) is hidden; a Duplicate (new id) and other worlds stay', () => {
  const own = '/repo/worlds/camelamamm';
  const src = disk({
    [own]: SAMPLE,
    '/home/a/Lore/camelamamm': SAMPLE,
    '/home/a/Lore/camelamamm-copy': { id: 'camelamamm-copy', name: 'Camelamamm (copy)' },
    '/home/a/Lore/renamed': { id: 'camelamamm', name: 'My Camel Tales' },
  }, { inRoot: ['/home/a/Lore/camelamamm', '/home/a/Lore/camelamamm-copy', '/home/a/Lore/renamed'], sample: own });
  assert.deepEqual(planShelf(src).shelf, ['/home/a/Lore/camelamamm-copy', '/home/a/Lore/renamed', own]);
});

test('recent folders that are gone are pruned, and each folder is listed once', () => {
  const src = disk({ '/w/a': { id: 'a', name: 'A' }, '/w/b': { id: 'b', name: 'B' } }, { recents: ['/w/a', '/w/gone', '/w/a/', '/w/b'], inRoot: ['/w/b'] });
  const { shelf, recents } = planShelf(src);
  assert.deepEqual(recents, ['/w/a', '/w/b']);
  assert.deepEqual(shelf, ['/w/a', '/w/b']);
});

test('Show sample world off hides the sample, and only the sample', () => {
  const own = '/repo/worlds/camelamamm';
  const src = disk({ [own]: SAMPLE, '/w/a': { id: 'a', name: 'A' } }, { recents: [own], inRoot: ['/w/a'], sample: own, hideSample: true });
  assert.deepEqual(planShelf(src).shelf, ['/w/a']);
  assert.deepEqual(planShelf({ ...src, hideSample: false }).shelf, [own, '/w/a']);
});

test('removing a book: the app\'s own sample is taken off the shelf, any other folder goes to the trash', () => {
  assert.equal(removeKind('/repo/worlds/camelamamm', '/repo/worlds/camelamamm'), 'hide');
  assert.equal(removeKind('/home/a/Lore/camelamamm', '/repo/worlds/camelamamm'), 'trash');
  assert.equal(removeKind('/w/a', null), 'trash');
});

test('a book moves to any place on the shelf, from the last shelf to the first and back', () => {
  const shelf = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(moveBook(shelf, 'e', 0), ['e', 'a', 'b', 'c', 'd'], 'last to first');
  assert.deepEqual(moveBook(shelf, 'a', 4), ['b', 'c', 'd', 'e', 'a'], 'first to last');
  assert.deepEqual(moveBook(shelf, 'e', 1), ['a', 'e', 'b', 'c', 'd'], 'right after the first book');
  assert.deepEqual(moveBook(shelf, 'b', 3), ['a', 'c', 'd', 'b', 'e']);
  assert.deepEqual(moveBook(shelf, 'c', 99), ['a', 'b', 'd', 'e', 'c'], 'clamped at the end');
  assert.deepEqual(moveBook(shelf, 'c', -5), ['c', 'a', 'b', 'd', 'e'], 'clamped at the start');
  assert.deepEqual(moveBook(shelf, 'zzz', 0), shelf, 'an unknown book changes nothing');
  assert.deepEqual(shelf, ['a', 'b', 'c', 'd', 'e'], 'the shelf passed in is not changed');
});

test('the saved order wins; new worlds go at the end; gone folders are skipped', () => {
  const shelf = ['/w/recent', '/w/a', '/w/b', '/w/c', '/w/new'];
  assert.deepEqual(orderShelf(shelf, undefined), shelf, 'no saved order: the shelf as planned (recent first)');
  assert.deepEqual(orderShelf(shelf, []), shelf);
  assert.deepEqual(orderShelf(shelf, ['/w/c', '/w/gone', '/w/a', '/w/recent', '/w/b']), ['/w/c', '/w/a', '/w/recent', '/w/b', '/w/new']);
  assert.deepEqual(orderShelf(shelf, ['/w/b', '/w/b', '/w/a']), ['/w/b', '/w/a', '/w/recent', '/w/c', '/w/new'], 'a repeated folder counts once; the rest keep the planned order');
});

test('the shelf order survives a restart: saved to settings.json, read back, applied to the next shelf', () => {
  const worlds: Record<string, WorldInfo> = {};
  for (const n of ['one', 'two', 'three', 'four']) worlds[`/home/a/worlds/${n}`] = { id: n, name: n };
  const own = '/opt/Lore-Forge/resources/worlds/camelamamm';
  worlds[own] = SAMPLE;
  const src = disk(worlds, { recents: ['/home/a/worlds/three'], inRoot: Object.keys(worlds).filter((d) => d !== own).sort(), sample: own, ownResources: '/opt/Lore-Forge/resources' });
  const first = planShelf(src).shelf;
  assert.deepEqual(first, ['/home/a/worlds/three', '/home/a/worlds/four', '/home/a/worlds/one', '/home/a/worlds/two', own]);
  // The sample is dragged from the end to the front; the settings file is written and read again.
  const arranged = moveBook(first, own, 0);
  const file = JSON.stringify({ shelfOrder: cleanOrder(arranged) });
  const saved = cleanOrder((JSON.parse(file) as { shelfOrder?: unknown }).shelfOrder);
  // Next launch: another world was opened (recents change) and a new one was made; the arranged order holds.
  worlds['/home/a/worlds/zeta'] = { id: 'zeta', name: 'Zeta' };
  const next = planShelf({ ...src, recents: ['/home/a/worlds/two', '/home/a/worlds/three'], inRoot: [...src.inRoot, '/home/a/worlds/zeta'] }).shelf;
  assert.deepEqual(orderShelf(next, saved), [own, '/home/a/worlds/three', '/home/a/worlds/four', '/home/a/worlds/one', '/home/a/worlds/two', '/home/a/worlds/zeta']);
});

test('a saved order is cleaned before it is kept', () => {
  assert.equal(cleanOrder(undefined), undefined);
  assert.equal(cleanOrder('nope'), undefined);
  assert.equal(cleanOrder([]), undefined);
  assert.deepEqual(cleanOrder(['/a', 3, null, '', '/b', '/a']), ['/a', '/b']);
  assert.equal(cleanOrder(Array.from({ length: 20_000 }, (_, i) => `/w/${i}`))!.length, 10_000);
});

test('a Duplicate goes right after its original on the shelf, wherever the copy was listed', () => {
  assert.deepEqual(placeAfter(['a', 'b', 'c', 'copy'], 'b', 'copy'), ['a', 'b', 'copy', 'c']);
  assert.deepEqual(placeAfter(['copy', 'a', 'b'], 'b', 'copy'), ['a', 'b', 'copy']);
  assert.deepEqual(placeAfter(['a', 'b'], 'a', 'copy'), ['a', 'copy', 'b']);
  // An original that is not on the shelf (say, a hidden sample): the copy goes at the end.
  assert.deepEqual(placeAfter(['a', 'copy', 'b'], 'gone', 'copy'), ['a', 'b', 'copy']);
});
