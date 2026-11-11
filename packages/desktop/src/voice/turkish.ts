/**
 * Turkish text as phonemes for a Piper voice, in the IPA symbols Piper's voices use. Turkish is written much as it is
 * said, so each letter has its sound, with a few rules: k and g are palatal (c, ɟ) next to a front vowel (kedi, göz)
 * and l is dark (ɫ) next to a back one (kal, ol); ğ lengthens the vowel before it (dağ), or joins two vowels (değil);
 * â, î and û are long; and a word's last syllable carries the stress, except in the small words that lean on the next
 * one. Numbers, ordinals ("3. bölüm"), percentages and short abbreviations become words first.
 */

const ONES = ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
const SCALES: [number, string][] = [[1e12, 'trilyon'], [1e9, 'milyar'], [1e6, 'milyon'], [1e3, 'bin']];

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  return [h ? (h === 1 ? 'yüz' : `${ONES[h]} yüz`) : '', t ? TENS[t]! : '', o ? ONES[o]! : ''].filter(Boolean).join(' ');
}

/** A whole number in Turkish words: 1205 "bin iki yüz beş". */
export function turkishNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (n < 0) return `eksi ${turkishNumber(-n)}`;
  n = Math.floor(n);
  if (n === 0) return ONES[0]!;
  const parts: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      const k = Math.floor(n / size);
      // "bin", not "bir bin"; but "bir milyon".
      parts.push(k === 1 && size === 1e3 ? name : `${belowThousand(k)} ${name}`);
      n %= size;
    }
  }
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

const BACK = new Set([...'aıou']);
const FRONT_VOWELS = new Set([...'eiöüîâû']);
const VOWEL_LETTERS = new Set([...'aeıioöuüâîû']);

/** An ordinal: 3 "üçüncü", 4 "dördüncü", 6 "altıncı". */
export function turkishOrdinal(n: number): string {
  let w = turkishNumber(n);
  if (w.endsWith('dört')) w = `${w.slice(0, -4)}dörd`;
  const last = [...w].reverse().find((c) => VOWEL_LETTERS.has(c)) ?? 'i';
  const v = 'aı'.includes(last) ? 'ı' : 'ou'.includes(last) ? 'u' : 'öü'.includes(last) ? 'ü' : 'i';
  return VOWEL_LETTERS.has(w.slice(-1)) ? `${w}nc${v}` : `${w}${v}nc${v}`;
}

const digitsTr = (s: string): string => [...s].map((d) => ONES[Number(d)]).join(' ');

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bDr\./g, 'Doktor'], [/\bProf\./g, 'Profesör'], [/\bDoç\./g, 'Doçent'], [/\bvb\./g, 've benzeri'], [/\bvs\./g, 'vesaire'],
  [/\börn\./gi, 'örneğin'], [/\bbkz\./gi, 'bakınız'], [/\bçev\./gi, 'çeviren'], [/\bNo\.(?=\s*\d)/g, 'numara'],
];

/** The numbers in a Turkish text as words: dotted dates, ordinals ("3. bölüm"), "%50", decimals ("2,5") and counts. */
export function turkishNumbersToWords(text: string): string {
  return text
    .replace(/(\d+)\.(\d+)\.(\d+)/g, (_m, a: string, b: string, c: string) => `${turkishNumber(Number(a))}, ${turkishNumber(Number(b))}, ${turkishNumber(Number(c))}`)
    .replace(/%\s*(\d+)/g, (_m, a: string) => `yüzde ${turkishNumber(Number(a))}`)
    .replace(/(\d+)\.(?=\s+\p{Ll})/gu, (_m, a: string) => turkishOrdinal(Number(a)))
    .replace(/(\d+)'?(?:inci|ıncı|uncu|üncü|nci|ncı|ncu|ncü)\b/g, (_m, a: string) => turkishOrdinal(Number(a)))
    .replace(/(\d+),(\d+)/g, (_m, a: string, b: string) => `${turkishNumber(Number(a))} virgül ${digitsTr(b)}`)
    .replace(/\d{1,3}(?:\.\d{3})+/g, (m) => turkishNumber(Number(m.replace(/\./g, ''))))
    .replace(/\d+/g, (m) => (m.length > 15 ? digitsTr(m) : turkishNumber(Number(m))));
}

/** Letter names, for initials and short all-capital words: "MS" "me se". */
const LETTERS: Record<string, string> = {
  a: 'a', b: 'be', c: 'ce', ç: 'çe', d: 'de', e: 'e', f: 'fe', g: 'ge', ğ: 'yumuşak ge', h: 'he', ı: 'ı', i: 'i', j: 'je', k: 'ke', l: 'le',
  m: 'me', n: 'ne', o: 'o', ö: 'ö', p: 'pe', q: 'kü', r: 're', s: 'se', ş: 'şe', t: 'te', u: 'u', ü: 'ü', v: 've', w: 've', x: 'iks', y: 'ye', z: 'ze',
};

const SOUNDS: Record<string, string> = {
  a: 'a', e: 'e', ı: 'ɯ', i: 'i', o: 'o', ö: 'ø', u: 'u', ü: 'y', â: 'aː', î: 'iː', û: 'uː',
  b: 'b', c: 'dʒ', ç: 'tʃ', d: 'd', f: 'f', h: 'h', j: 'ʒ', m: 'm', n: 'n', p: 'p', r: 'ɾ', s: 's', ş: 'ʃ', t: 't', v: 'v', y: 'j', z: 'z',
  q: 'k', w: 'v', x: 'ks',
};

/** Small words that lean on the next word and carry no stress of their own. */
const UNSTRESSED = new Set(['ve', 'de', 'da', 'ki', 'mi', 'mı', 'mu', 'mü', 'bir', 'bu', 'şu', 'o', 'ile', 'ne', 'ya', 'ama', 'çok', 'gibi', 'için']);

/**
 * One word's phonemes, with the stress on its last syllable unless it is one of the small words. `stress` puts it on
 * the syllable that starts at that letter instead (a name's pronunciation, "ka-me-LA-mam"), and 'none' leaves it out
 * (the ending after a name).
 */
export function turkishWord(word: string, stress?: number | 'none'): string {
  const w = word.toLocaleLowerCase('tr').replace(/['’]/g, '');
  const letters = [...w];
  /** Where each letter's sound starts in `out`. */
  const at: number[] = [];
  const vowelAt = (from: number, step: 1 | -1): string | undefined => {
    for (let i = from; i >= 0 && i < letters.length; i += step) if (VOWEL_LETTERS.has(letters[i]!)) return letters[i];
    return undefined;
  };
  /** Next to a front vowel: the next letter, or, before a consonant or the end, the vowel before. */
  const front = (i: number): boolean => {
    const next = letters[i + 1];
    if (next && VOWEL_LETTERS.has(next)) return FRONT_VOWELS.has(next);
    const before = vowelAt(i - 1, -1);
    return !!before && FRONT_VOWELS.has(before);
  };
  const out: string[] = [];
  let lastVowel = -1;
  for (let i = 0; i < letters.length; i++) {
    const c = letters[i]!;
    const next = letters[i + 1];
    at[i] = out.length;
    if (c === 'k') out.push(front(i) ? 'c' : 'k');
    else if (c === 'g') out.push(front(i) ? 'ɟ' : 'ɡ');
    else if (c === 'l') {
      const v = next && VOWEL_LETTERS.has(next) ? next : vowelAt(i - 1, -1) ?? vowelAt(i + 1, 1);
      out.push(v && BACK.has(v) ? 'ɫ' : 'l');
    } else if (c === 'ğ') {
      const before = letters[i - 1];
      if (!before || !VOWEL_LETTERS.has(before)) continue;
      if (next && VOWEL_LETTERS.has(next)) {
        // The same vowel on both sides is one long vowel (ağaç, eğer); two front vowels have a y between them
        // (değil); other vowels just meet (doğum).
        if (next === before) {
          out.push('ː');
          i++;
        } else if (FRONT_VOWELS.has(before) && FRONT_VOWELS.has(next)) out.push('j');
      } else if (!out[out.length - 1]?.endsWith('ː')) out.push('ː');
    } else if (SOUNDS[c]) {
      if (VOWEL_LETTERS.has(c)) lastVowel = out.length;
      out.push(SOUNDS[c]!);
    }
  }
  if (stress === 'none') return out.join('');
  if (typeof stress === 'number') {
    const spot = at[stress];
    if (spot !== undefined) out.splice(spot, 0, 'ˈ');
    return out.join('');
  }
  const vowels = letters.filter((c) => VOWEL_LETTERS.has(c)).length;
  if (vowels > 1 && lastVowel >= 0 && !UNSTRESSED.has(w)) {
    // The stress mark goes before the last syllable's consonant, as IPA writes it: "ki.ˈtap".
    let at = lastVowel;
    if (at > 0 && !/^[aeɯiouøyː]/.test(out[at - 1]!) && at - 1 > 0) at--;
    out.splice(at, 0, 'ˈ');
  }
  return out.join('');
}

/**
 * A Turkish text as Piper phonemes: words apart, sentence punctuation kept. `names` are the book's names with a
 * pronunciation (respell.ts), by their words in lower case; an ending after one (Kadir'in) is read after it.
 */
export function turkishPhonemes(text: string, names?: ReadonlyMap<string, string>): string {
  let s = text.replace(/[‘’ʼ]/g, "'").replace(/\.{3,}|…/g, '.').replace(/[–—]/g, ',');
  for (const [re, to] of ABBREVIATIONS) s = s.replace(re, to);
  s = turkishNumbersToWords(s);
  const out: string[] = [];
  for (const m of s.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*|[.,!?;:]/gu)) {
    const t = m[0];
    if (/^[.,!?;:]$/.test(t)) {
      if (out.length) out[out.length - 1] += t;
      continue;
    }
    const [stem = '', ...ending] = t.split("'");
    const own = names?.get(stem.toLocaleLowerCase('tr'));
    if (own) out.push(own + (ending.length ? turkishWord(ending.join(''), 'none') : ''));
    // "MS", "TBMM": letter by letter.
    else if (/^[A-ZÇĞİÖŞÜ]{2,4}$/u.test(t)) out.push(...[...t.toLocaleLowerCase('tr')].map((c) => turkishWord(LETTERS[c] ?? c)));
    else out.push(turkishWord(t));
  }
  return out.join(' ');
}
