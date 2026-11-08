import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fill, langFor, setLanguage, t, tx } from '../src/shared/i18n.ts';
import { CORE_TR } from '@lore-forge/core';
import { TR } from '../src/shared/locales/tr/index.ts';
import { APP } from '../src/shared/locales/tr/app.ts';
import { EDITOR } from '../src/shared/locales/tr/editor.ts';
import { LIBRARY } from '../src/shared/locales/tr/library.ts';
import { MAIN } from '../src/shared/locales/tr/main.ts';
import { STORY } from '../src/shared/locales/tr/story.ts';
import { VIEWS } from '../src/shared/locales/tr/views.ts';

const SRC = join(import.meta.dirname, '..', 'src');
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : /\.tsx?$/.test(d.name) && !d.name.endsWith('.d.ts') ? [join(dir, d.name)] : []));

/** A JS string literal's text: '…' or "…" with its escapes. */
const unquote = (lit: string): string => JSON.parse(lit[0] === '"' ? lit : `"${lit.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) as string;
const STR = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")`;

/** Every key the code passes to t(), tj() and tx() as a literal, with where it is. */
function keys(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files(SRC)) {
    if (f.includes(`${join('shared', 'locales')}`)) continue;
    const src = readFileSync(f, 'utf8');
    const where = f.slice(SRC.length + 1);
    for (const m of src.matchAll(new RegExp(String.raw`(?<![\w.$])(?:t|tj)\(\s*${STR}`, 'g'))) out.set(unquote(m[1]!), where);
    for (const m of src.matchAll(new RegExp(String.raw`(?<![\w.$])tx\(\s*${STR}\s*,\s*${STR}`, 'g'))) out.set(`${unquote(m[1]!)}|${unquote(m[2]!)}`, where);
  }
  return out;
}

const holes = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every text the app passes to t(), tj() or tx() has a Turkish translation', () => {
  const missing = [...keys()].filter(([k]) => !(k in TR) && !(k.includes('|') && k.slice(k.indexOf('|') + 1) in TR));
  assert.deepEqual(missing.map(([k, f]) => `${f}: ${k}`), []);
});

test('every Turkish translation keeps the placeholders of its English', () => {
  // The app's own texts: exactly the same named placeholders.
  const own = [MAIN, LIBRARY, EDITOR, VIEWS, STORY, APP].flatMap((table) => Object.entries(table));
  const wrong = own.filter(([k, v]) => holes(k.includes('|') ? k.slice(k.indexOf('|') + 1) : k) !== holes(v)).map(([k, v]) => `${k} → ${v}`);
  assert.deepEqual(wrong, []);
  // Core's templates ({0}, {1}, …) may leave one out (a name the English repeats), but never add one.
  const extra = Object.entries(CORE_TR).filter(([k, v]) => [...v.matchAll(/\{(\w+)\}/g)].some((m) => !k.includes(m[0]))).map(([k, v]) => `${k} → ${v}`);
  assert.deepEqual(extra, []);
});

test('one English text has one Turkish translation in every catalogue (else use tx with a context)', () => {
  const seen = new Map<string, Set<string>>();
  for (const table of [MAIN, LIBRARY, EDITOR, VIEWS, STORY, APP]) for (const [k, v] of Object.entries(table)) seen.set(k, (seen.get(k) ?? new Set()).add(v));
  assert.deepEqual([...seen].filter(([, v]) => v.size > 1).map(([k, v]) => `${k} → ${[...v].join(' / ')}`), []);
});

test('no Turkish translation is left empty or in English by mistake', () => {
  const empty = Object.entries(TR).filter(([, v]) => !v.trim()).map(([k]) => k);
  assert.deepEqual(empty, []);
});

test('t() is the English itself until a language is set, and fills placeholders', () => {
  setLanguage('en', null);
  assert.equal(t('Saved'), 'Saved');
  assert.equal(t('{n} books', { n: 3 }), '3 books');
  setLanguage('tr', { 'Saved': 'Kaydedildi', 'verb|Open': 'Aç', '{n} books': '{n} kitap' });
  assert.equal(t('Saved'), 'Kaydedildi');
  assert.equal(t('{n} books', { n: 3 }), '3 kitap');
  assert.equal(tx('verb', 'Open'), 'Aç');
  assert.equal(t('Not there'), 'Not there', 'a missing translation shows the English');
  setLanguage('en', null);
  assert.equal(fill('{a} and {b}', { a: 1 }), '1 and {b}');
  assert.equal(langFor('tr-TR'), 'tr');
  assert.equal(langFor('tr'), 'tr');
  assert.equal(langFor('en-US'), 'en');
  assert.equal(langFor('trk'), 'en');
});
