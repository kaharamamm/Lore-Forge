import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTRY_ICON_NAMES, iconKeywords, searchIcons, type IconName } from '@lore-forge/core';

const names: IconName[] = ['castle', 'castle-ruins', 'broadsword', 'stone-tower', 'crossed-swords', 'house', 'dwarf-face'];

test('icon search: name prefix first, then name words, then keywords, then contains', () => {
  assert.deepEqual(searchIcons(names, 'castle'), ['castle', 'castle-ruins']);
  assert.deepEqual(searchIcons(names, 'ruins'), ['castle-ruins']);
  assert.deepEqual(searchIcons(names, 'sword'), ['crossed-swords', 'broadsword']);
  assert.deepEqual(searchIcons(names, 'tower'), ['stone-tower']);
  assert.deepEqual(searchIcons(names, ''), names);
  assert.deepEqual(searchIcons(names, 'qzx'), []);
});

test('icon search: keywords from the default-picture tables, races and types, in English and Turkish', () => {
  assert.ok(iconKeywords().get('castle')!.includes('fortress'));
  assert.deepEqual(searchIcons(names, 'fortress'), ['castle']);
  assert.deepEqual(searchIcons(names, 'KILIÇ'), ['broadsword']);
  assert.deepEqual(searchIcons(names, 'kilic'), ['broadsword']);
  assert.deepEqual(searchIcons(names, 'KULE'), ['stone-tower']);
  assert.deepEqual(searchIcons(names, 'dwarves'), ['dwarf-face']);
  assert.deepEqual(searchIcons(names, 'stone tow'), ['stone-tower']);
  for (const name of ENTRY_ICON_NAMES) assert.ok(searchIcons(ENTRY_ICON_NAMES, name.replace(/-/g, ' '))[0] === name || searchIcons(ENTRY_ICON_NAMES, name).includes(name), name);
});
