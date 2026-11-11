/**
 * An English word no dictionary has (a fantasy name, a new word) read by its letters: the NRL letter-to-sound rules
 * (nrl-rules.ts) give ARPAbet sounds, written here as Kokoro's (Misaki's) phonemes. Each rule reads
 * "LEFT[LETTERS]RIGHT=SOUNDS": LETTERS are read as SOUNDS when LEFT comes before them and RIGHT after, in these
 * patterns: # one or more vowels, . a voiced consonant, % a common ending (ER, E, ES, ED, ING, ELY), & a sibilant,
 * @ a consonant that makes a following U sound like OO, ^ one consonant, + E, I or Y, : any number of consonants, and
 * a space for the edge of the word. The first rule that fits wins. Adapted from HeadTTS (MIT License, Copyright (c) 2025
 * Mika Suominen).
 */
import { NRL_RULES } from './nrl-rules.ts';

const OPS: Record<string, string> = {
  '#': '[AEIOUY]+',
  '.': '[BDVGJLMNRWZ]',
  '%': '(?:ER|E|ES|ED|ING|ELY)',
  '&': '(?:[SCGZXJ]|CH|SH)',
  '@': '(?:[TSRDLZNJ]|TH|CH|SH)',
  '^': '[BCDFGHJKLMNPQRSTVWXZ]',
  '+': '[EIY]',
  ':': '[BCDFGHJKLMNPQRSTVWXZ]*',
  ' ': String.raw`\b`,
};

/** ARPAbet sounds as Misaki phonemes: diphthongs are one letter (A, I, O, W, Y), like the dictionaries write them. */
const ARPABET: Record<string, string> = {
  AO: 'ɔ', AA: 'ɑ', IY: 'i', UW: 'u', EH: 'ɛ', IH: 'ɪ', UH: 'ʊ', AH: 'ə', AE: 'æ', AX: 'ə', EY: 'A', AY: 'I', OW: 'O', AW: 'W', OY: 'Y',
  P: 'p', B: 'b', T: 't', D: 'd', K: 'k', G: 'ɡ', CH: 'ʧ', JH: 'ʤ', F: 'f', V: 'v', TH: 'θ', DH: 'ð', S: 's', Z: 'z', SH: 'ʃ', ZH: 'ʒ',
  HH: 'h', M: 'm', N: 'n', NX: 'ŋ', NG: 'ŋ', L: 'l', R: 'ɹ', ER: 'ɜɹ', W: 'w', WH: 'w', Y: 'j',
};

/** One sound of a rule: "IH1" is IH with the main stress, "AH1" the stressed ʌ. */
function sound(token: string): string {
  const m = /^([A-Z]+)([012])?$/.exec(token);
  if (!m) return '';
  const [, base, stress] = m;
  const ipa = base === 'AH' && stress === '1' ? 'ʌ' : ARPABET[base!] ?? '';
  return stress === '1' ? `ˈ${ipa}` : stress === '2' ? `ˌ${ipa}` : ipa;
}

interface Rule { regex: RegExp; move: number; sounds: string }

const RULES: Record<string, Rule[]> = Object.fromEntries(Object.entries(NRL_RULES).map(([letter, list]) => [letter, list.map((rule): Rule => {
  const l = rule.indexOf('[');
  const r = rule.indexOf(']');
  const e = rule.indexOf('=');
  const letters = rule.slice(l + 1, r);
  const context = (s: string) => [...s].map((c) => OPS[c] ?? c).join('');
  // The letter being read is the only lower-case one in the word tested, so a match is always at that letter.
  const exp = context(rule.slice(0, l)) + letters[0]!.toLowerCase() + letters.slice(1) + context(rule.slice(r + 1, e));
  return { regex: new RegExp(exp), move: letters.length, sounds: rule.slice(e + 1).split(' ').filter(Boolean).map(sound).join('') };
})]));

/** Misaki's vowels, single letters included. */
export const VOWELS = new Set([...'AIOQWYaɐɑɒæəɚɛɜɪʊʌɔiueoᵊᵻ']);

/** A word's phonemes from its letters, with the main stress on its first vowel when the rules gave none. */
export function lettersToPhonemes(word: string): string {
  const w = word.toUpperCase().replace(/[^A-Z']/g, '');
  let out = '';
  for (let i = 0; i < w.length;) {
    const rules = RULES[w[i]!];
    if (!rules) { i++; continue; }
    const test = w.slice(0, i) + w[i]!.toLowerCase() + w.slice(i + 1);
    const rule = rules.find((x) => x.regex.test(test));
    if (!rule) { i++; continue; }
    out += rule.sounds;
    i += rule.move;
  }
  // Spelling doubles letters, speech does not: "Camelamamm" ends in one m.
  out = out.replace(/([bdfɡhklmnpɹstvwzʃʒθðŋjʧʤ])\1+/g, '$1');
  if (!/[ˈˌ]/.test(out)) {
    const v = [...out].findIndex((c) => VOWELS.has(c));
    if (v >= 0) out = `${out.slice(0, v)}ˈ${out.slice(v)}`;
  }
  return out;
}
