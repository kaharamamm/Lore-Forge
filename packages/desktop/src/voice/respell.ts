/**
 * A name's pronunciation as its author writes it (an entry's "pronunciation"), in the sounds the voices speak.
 * Syllables go with hyphens and the stressed one in capitals: "KAM-eh-la-mam". English voices read each syllable the
 * way English pronunciation guides spell sounds (ah, eh, ee, ih, oo, uh, ay, eye, oh, ow, oy, aw; th, dh, sh, zh, ch,
 * ng, kh); Turkish voices read it as Turkish (turkish.ts). IPA between slashes ("/ˈkæm.ə.lə.mæm/") is taken as it is.
 */
import { turkishWord } from './turkish.ts';
import type { SpokenName } from '../shared/voices.ts';

/** Sounds as English pronunciation guides spell them, longest first, in Misaki's notation (english.ts). */
const VOWELS: [string, string][] = [
  ['eye', 'I'], ['igh', 'I'], ['air', 'ɛɹ'], ['ear', 'ɪɹ'], ['eer', 'ɪɹ'], ['oor', 'ʊɹ'], ['our', 'Wɹ'],
  ['ar', 'ɑɹ'], ['or', 'ɔɹ'], ['er', 'ɜɹ'], ['ur', 'ɜɹ'], ['ir', 'ɜɹ'],
  ['ay', 'A'], ['ey', 'A'], ['ai', 'A'], ['ee', 'i'], ['ea', 'i'], ['oo', 'u'], ['uu', 'ʊ'], ['ow', 'W'], ['ou', 'W'],
  ['oy', 'Y'], ['oi', 'Y'], ['oh', 'O'], ['oa', 'O'], ['ah', 'ɑ'], ['aw', 'ɔ'], ['au', 'ɔ'], ['eh', 'ɛ'], ['ih', 'ɪ'], ['uh', 'ʌ'],
  ['a', 'æ'], ['e', 'ɛ'], ['i', 'ɪ'], ['o', 'ɑ'], ['u', 'ʌ'], ['ə', 'ə'],
];
const CONSONANTS: [string, string][] = [
  ['tch', 'ʧ'], ['ch', 'ʧ'], ['sh', 'ʃ'], ['zh', 'ʒ'], ['th', 'θ'], ['dh', 'ð'], ['ng', 'ŋ'], ['nk', 'ŋk'], ['kh', 'x'],
  ['ph', 'f'], ['wh', 'w'], ['ck', 'k'], ['dj', 'ʤ'], ['j', 'ʤ'], ['g', 'ɡ'], ['c', 'k'], ['q', 'k'], ['x', 'ks'], ['r', 'ɹ'],
  ['y', 'j'], ['b', 'b'], ['d', 'd'], ['f', 'f'], ['h', 'h'], ['k', 'k'], ['l', 'l'], ['m', 'm'], ['n', 'n'], ['p', 'p'],
  ['s', 's'], ['t', 't'], ['v', 'v'], ['w', 'w'], ['z', 'z'],
];
const isIpa = (say: string): boolean => /^\s*\/.*\/\s*$/.test(say);
const words = (say: string): string[] => say.trim().split(/\s+/).filter(Boolean);
const syllables = (word: string): string[] => word.split(/[-·.]/).filter(Boolean);
/** A syllable written in capitals carries the stress. */
const caps = (s: string, lower: (x: string) => string, upper: (x: string) => string): boolean => s === upper(s) && s !== lower(s);

function englishSyllable(s: string, stressed: boolean): string {
  const w = s.toLowerCase();
  let out = '';
  let vowelAt = -1;
  for (let i = 0; i < w.length; ) {
    // "MY", "SKY": a y closing a syllable with no other vowel is the vowel of "eye".
    if (w[i] === 'y' && i > 0 && i === w.length - 1 && vowelAt < 0) {
      vowelAt = out.length;
      out += 'I';
      i++;
      continue;
    }
    const v = VOWELS.find(([spelt]) => w.startsWith(spelt, i));
    if (v) {
      // "uh" and "er" sound weaker without the stress: the a of "sofa", the er of "letter".
      const p = stressed ? v[1] : v[1] === 'ʌ' ? 'ə' : v[1] === 'ɜɹ' ? 'əɹ' : v[1];
      if (vowelAt < 0) vowelAt = out.length;
      out += p;
      i += v[0].length;
      continue;
    }
    const c = CONSONANTS.find(([spelt]) => w.startsWith(spelt, i));
    if (c) out += c[1];
    i += c ? c[0].length : 1;
  }
  return stressed && vowelAt >= 0 ? `${out.slice(0, vowelAt)}ˈ${out.slice(vowelAt)}` : out;
}

const IPA_TO_MISAKI: [RegExp, string][] = [
  [/eɪ/g, 'A'], [/aɪ/g, 'I'], [/oʊ/g, 'O'], [/əʊ/g, 'Q'], [/aʊ/g, 'W'], [/ɔɪ/g, 'Y'], [/dʒ/g, 'ʤ'], [/tʃ/g, 'ʧ'],
  [/ɚ/g, 'əɹ'], [/ɝ/g, 'ɜɹ'], [/r/g, 'ɹ'], [/g/g, 'ɡ'], [/ɒ/g, 'ɑ'], [/ɫ/g, 'l'], [/[.ːˑ/]/g, ''],
];

/** IPA in Misaki's notation: its diphthongs as one letter, and the stress mark on the vowel, not before the syllable. */
function ipaToMisaki(ipa: string): string {
  let s = ipa;
  for (const [re, to] of IPA_TO_MISAKI) s = s.replace(re, to);
  return s.replace(/([ˈˌ])([^aeiouæɑɔɛɪʊʌəɜɐAIOWYQᵊ]*)/g, '$2$1');
}

/** A pronunciation as Misaki phonemes (english.ts), one string a word. The first syllable is stressed unless one is in capitals. */
export function englishRespelling(say: string): string[] {
  if (isIpa(say)) return words(say).map(ipaToMisaki).filter(Boolean);
  return words(say).map((w) => {
    const parts = syllables(w);
    const upper = (x: string) => x.toUpperCase();
    const lower = (x: string) => x.toLowerCase();
    let stressed = parts.findIndex((p) => caps(p, lower, upper));
    if (stressed < 0) stressed = 0;
    return parts.map((p, i) => englishSyllable(p, i === stressed)).join('');
  }).filter(Boolean);
}

/** A pronunciation as a Turkish voice's phonemes (turkish.ts), one string a word. Without capitals, Turkish stress. */
export function turkishRespelling(say: string): string[] {
  if (isIpa(say)) return words(say).map((w) => w.replace(/[./]/g, '')).filter(Boolean);
  return words(say).map((w) => {
    const parts = syllables(w);
    const lower = (x: string) => x.toLocaleLowerCase('tr');
    const upper = (x: string) => x.toLocaleUpperCase('tr');
    const stressed = parts.findIndex((p) => caps(p, lower, upper));
    const word = parts.map(lower).join('');
    if (stressed < 0) return turkishWord(word);
    return turkishWord(word, [...parts.slice(0, stressed).map(lower).join('')].length);
  });
}

/**
 * The book's names with a pronunciation, as a voice's word list: each word of a name (lower case) and its phonemes.
 * A name of several words needs a part for each ("mister KAM-el"); a one-word name may be written in several parts.
 */
export function spokenNames(names: readonly SpokenName[], language: 'en' | 'tr'): Map<string, string> {
  const out = new Map<string, string>();
  const respell = language === 'tr' ? turkishRespelling : englishRespelling;
  const lower = (x: string) => (language === 'tr' ? x.toLocaleLowerCase('tr') : x.toLowerCase());
  for (const n of names) {
    const said = n.say.trim();
    const parts = words(n.name);
    if (!said || !parts.length) continue;
    let sounds = respell(said);
    // "KAM eh la mam" for "Camelamamm": one word, written in parts.
    if (parts.length === 1 && sounds.length > 1) sounds = respell(isIpa(said) ? said.replace(/\s+/g, '') : words(said).join('-'));
    if (sounds.length !== parts.length) continue;
    parts.forEach((p, i) => out.set(lower(p), sounds[i]!));
  }
  return out;
}
