/**
 * The phonemes a Piper voice is trained on and speaks: English text through english.ts, written in the IPA symbols
 * Piper's voices use (diphthongs as two letters, the length mark on long stressed vowels, r-coloured vowels as ɜː and
 * ɚ), or Turkish text through turkish.ts. The Voice Studio's training (tools/voice-studio/train.mjs) and the app
 * use these same functions, so a voice hears in the app exactly what it learned from.
 */
import { phonemize, type Lexicon } from './english.ts';
import { turkishPhonemes } from './turkish.ts';

const DIPHTHONGS: Record<string, string> = { A: 'eɪ', I: 'aɪ', O: 'oʊ', W: 'aʊ', Y: 'ɔɪ', Q: 'əʊ' };

/** Misaki's phonemes (english.ts) in Piper's IPA. */
export function misakiToIpa(p: string): string {
  return p
    .replace(/[AIOWYQ]/g, (c) => DIPHTHONGS[c]!)
    .replace(/ʤ/g, 'dʒ')
    .replace(/ʧ/g, 'tʃ')
    .replace(/ᵊ/g, 'ə')
    .replace(/ɜɹ/g, 'ɜː')
    .replace(/əɹ/g, 'ɚ')
    .replace(/([ˈˌ])([iuɑɔ])(?![ːɪʊ])/g, '$1$2ː')
    .replace(/[“”]/g, '"')
    .replace(/ —/g, ',')
    .replace(/…/g, '.');
}

/**
 * A text as a Piper voice's phonemes: English needs its dictionary (en-us.txt); Turkish needs none. `names` are the
 * book's names with a pronunciation, already in the language's phonemes (respell.ts spokenNames).
 */
export function piperPhonemes(text: string, language: 'en' | 'tr', lexicon?: Lexicon, names?: Lexicon): string {
  if (language === 'tr') return turkishPhonemes(text, names);
  if (!lexicon) throw new Error('English needs its pronunciation dictionary.');
  return misakiToIpa(phonemize(text, lexicon, 'us', names));
}
