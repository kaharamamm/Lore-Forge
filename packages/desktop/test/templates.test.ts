/** A new book's ready starts: every template gives a calendar that works and fields that load, in both languages. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarProblems, parseCustomFields } from '@lore-forge/core';
import { setLanguage } from '../src/shared/i18n.ts';
import { TR } from '../src/shared/locales/tr/index.ts';
import { bookTemplates, eraCode } from '../src/renderer/templates.ts';

test('era codes from era names', () => {
  assert.equal(eraCode('Second Age'), 'SA');
  assert.equal(eraCode('Age of Legends'), 'AL');
  assert.equal(eraCode('İkinci Çağ'), 'IC');
  assert.equal(eraCode('Efsaneler Çağı'), 'EC');
  assert.equal(eraCode('the 9th age'), 'T9A');
  assert.equal(eraCode('9 lives'), 'E9L');
});

for (const lang of ['en', 'tr'] as const) {
  test(`every template works (${lang})`, () => {
    setLanguage(lang, lang === 'tr' ? TR : null);
    try {
      const all = bookTemplates();
      assert.equal(all[0]!.id, 'blank');
      assert.equal(new Set(all.map((x) => x.id)).size, all.length);
      for (const tp of all) {
        if (tp.calendar) assert.deepEqual(calendarProblems(tp.calendar), [], `${tp.id}: the calendar works`);
        if (tp.id !== 'blank') assert.ok(tp.writingStyle && tp.artStyle && tp.cover, `${tp.id}: writing and picture style and a cover`);
        const issues: string[] = [];
        parseCustomFields(tp.fields, issues);
        assert.deepEqual(issues, [], `${tp.id}: the fields load`);
        for (const list of Object.values(tp.fields ?? {})) for (const f of list) assert.match(f.key, /^[a-z][A-Za-z0-9]*$/, `${tp.id}: ${f.key}`);
      }
      const game = all.find((x) => x.id === 'game')!;
      assert.deepEqual(Object.keys(game.fields!), ['character', 'item', 'place']);
      if (lang === 'tr') {
        assert.deepEqual(game.calendar!.eras.map((e) => [e.id, e.name]), [['EC', 'Efsaneler Çağı'], ['KC', 'Kahramanlar Çağı']]);
        assert.equal(game.fields!.character![2]!.key, 'canPuani');
        assert.equal(all.find((x) => x.id === 'mystery')!.calendar!.months![1]!.name, 'Şubat');
      } else {
        assert.deepEqual(game.fields!.character!.map((f) => f.key), ['level', 'class', 'hitPoints']);
        assert.equal(all.find((x) => x.id === 'mystery')!.calendar!.months!.reduce((n, m) => n + m.days, 0), 365);
      }
    } finally {
      setLanguage('en', null);
    }
  });
}
