// Writes voice-data/en-us.txt and voice-data/en-gb.txt: the pronunciations the built-in English voices use, one word a
// line ("word<TAB>phonemes"), from Misaki's dictionaries (Apache-2.0, https://github.com/hexgrad/misaki), the ones
// Kokoro's voices were trained with. The "gold" dictionary wins over the larger "silver" one; a word with several
// readings keeps its usual one. Run: node scripts/build-lexicons.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The Misaki version the lists come from. */
const COMMIT = 'fba1236595f2d2bf21d414ba6e57d25256afada3';
const BASE = `https://raw.githubusercontent.com/hexgrad/misaki/${COMMIT}/misaki/data`;
const OUT = join(import.meta.dirname, '..', 'voice-data');

async function json(name) {
  const r = await fetch(`${BASE}/${name}.json`);
  if (!r.ok) throw new Error(`${name}.json: ${r.status}`);
  return r.json();
}

const reading = (v) => (typeof v === 'string' ? v : (v?.DEFAULT ?? Object.values(v ?? {}).find((x) => typeof x === 'string')));

await mkdir(OUT, { recursive: true });
for (const accent of ['us', 'gb']) {
  const [gold, silver] = await Promise.all([json(`${accent}_gold`), json(`${accent}_silver`)]);
  const words = new Map();
  for (const [word, v] of Object.entries(silver)) { const p = reading(v); if (p) words.set(word, p); }
  for (const [word, v] of Object.entries(gold)) { const p = reading(v); if (p) words.set(word, p); }
  const lines = [...words].filter(([w, p]) => !/[\t\n]/.test(w + p)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([w, p]) => `${w}\t${p}`);
  await writeFile(join(OUT, `en-${accent}.txt`), lines.join('\n') + '\n', 'utf8');
  console.log(`en-${accent}.txt: ${lines.length} words`);
}
