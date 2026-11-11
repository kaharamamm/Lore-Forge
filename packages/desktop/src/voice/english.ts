/**
 * English text as the phonemes Kokoro speaks (Misaki's notation), American or British: numbers and abbreviations
 * become words, each word is looked up in the dictionary for its accent (voice-data/en-us.txt, en-gb.txt), and a word
 * the dictionary does not have is read through its stem (plurals, -ed, -ing, possessives), spelled out when it is a
 * short all-capital word, or read by its letters (nrl.ts) when it is a name nobody has listed. A few small words
 * change with the next sound, as people say them: "the" (thuh, thee), "a", "an", "to".
 */
import { numbersToWords } from './numbers.ts';
import { lettersToPhonemes, VOWELS } from './nrl.ts';

export type Accent = 'us' | 'gb';
export type Lexicon = ReadonlyMap<string, string>;

/** A dictionary file: one "word<TAB>phonemes" a line. */
export function parseLexicon(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab > 0) out.set(line.slice(0, tab), line.slice(tab + 1).trim());
  }
  return out;
}

/** Letter names, for initials and short all-capital words the dictionary does not have. */
const LETTERS: Record<string, string> = {
  A: 'ˈA', B: 'bˈi', C: 'sˈi', D: 'dˈi', E: 'ˈi', F: 'ˈɛf', G: 'ʤˈi', H: 'ˈAʧ', I: 'ˈI', J: 'ʤˈA', K: 'kˈA', L: 'ˈɛl', M: 'ˈɛm',
  N: 'ˈɛn', O: 'ˈO', P: 'pˈi', Q: 'kjˈu', R: 'ˈɑɹ', S: 'ˈɛs', T: 'tˈi', U: 'jˈu', V: 'vˈi', W: 'dˈʌbᵊlju', X: 'ˈɛks', Y: 'wˈI', Z: 'zˈi',
};

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bMrs\./g, 'Mrs'], [/\bMr\./g, 'Mr'], [/\bMs\./g, 'Ms'], [/\bDr\./g, 'Doctor'], [/\bSt\./g, 'Saint'], [/\bMt\./g, 'Mount'],
  [/\bvs\./gi, 'versus'], [/\betc\./gi, 'et cetera'], [/\be\.g\./gi, 'for example'], [/\bi\.e\./gi, 'that is'], [/\bNo\.(?=\s*\d)/g, 'number'],
];

/** Text ready to read: one kind of apostrophe and dash, abbreviations and numbers in words, symbols as words or gone. */
function normalize(text: string): string {
  let s = text.replace(/[‘’ʼ]/g, "'").replace(/\.{3,}/g, '…').replace(/–/g, '—').replace(/\s-{1,2}\s/g, ' — ');
  for (const [re, to] of ABBREVIATIONS) s = s.replace(re, to);
  return numbersToWords(s).replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/[*_~`#>[\]{}|\\/=<@^]/g, ' ');
}

type Token = { word: string } | { mark: string };
const TOKENS = /[\p{L}\p{M}]+(?:['-][\p{L}\p{M}]+)*'?|[.,!?;:…—()"“”]/gu;

const SIBILANTS = new Set([...'szʃʒʧʤ']);
const VOICELESS = new Set([...'ptkfθ']);
/** The last sound of a word, past stress and length marks. */
const lastSound = (p: string): string => p.replace(/[ˈˌː]+$/, '').slice(-1);
/** The -s ending after a word: "kettles" z, "cats" s, "horses" ɪz. */
const sEnding = (p: string): string => (SIBILANTS.has(lastSound(p)) ? 'ɪz' : VOICELESS.has(lastSound(p)) ? 's' : 'z');
/** The -ed ending: "walked" t, "played" d, "waited" ɪd. */
const edEnding = (p: string): string => {
  const last = lastSound(p);
  return last === 't' || last === 'd' ? 'ɪd' : VOICELESS.has(last) || last === 's' || last === 'ʃ' || last === 'ʧ' ? 't' : 'd';
};

const capitalized = (w: string): string => w[0]!.toUpperCase() + w.slice(1).toLowerCase();

/** A word as the dictionary has it: as written, in lower case, or capitalized. */
function lookup(word: string, lex: Lexicon): string | undefined {
  return lex.get(word) ?? lex.get(word.toLowerCase()) ?? lex.get(capitalized(word));
}

/** A word through its stem: plurals and -s, -ed, -ing and -ly forms of words the dictionary has. */
function stemmed(word: string, lex: Lexicon): string | undefined {
  const w = word.toLowerCase();
  const base = (b: string): string | undefined => (b.length > 1 ? lookup(b, lex) : undefined);
  // "running" -> "run": the doubled last consonant goes.
  const single = (b: string): string => (/([bdfgklmnprtvz])\1$/.test(b) ? b.slice(0, -1) : b);
  if (w.endsWith('s') && !w.endsWith('ss')) {
    const ies = w.endsWith('ies') ? base(`${w.slice(0, -3)}y`) : undefined;
    if (ies) return `${ies}z`;
    const es = w.endsWith('es') ? base(w.slice(0, -2)) : undefined;
    if (es) return es + sEnding(es);
    const s = base(w.slice(0, -1));
    if (s) return s + sEnding(s);
  }
  if (w.endsWith('ed')) {
    for (const b of [w.slice(0, -2), w.slice(0, -1), single(w.slice(0, -2))]) {
      const p = base(b);
      if (p) return p + edEnding(p);
    }
    const ied = w.endsWith('ied') ? base(`${w.slice(0, -3)}y`) : undefined;
    if (ied) return `${ied}d`;
  }
  if (w.endsWith('ing')) {
    for (const b of [w.slice(0, -3), `${w.slice(0, -3)}e`, single(w.slice(0, -3))]) {
      const p = base(b);
      if (p) return `${p}ɪŋ`;
    }
  }
  if (w.endsWith('ly')) {
    const p = base(w.slice(0, -2));
    if (p) return `${p}li`;
  }
  return undefined;
}

/** A British reading of phonemes made for American English (letter rules give American sounds). */
function british(p: string): string {
  return p
    .replace(/O/g, 'Q')
    .replace(/æ/g, 'a')
    .replace(/ɜɹ/g, 'ɜː')
    .replace(/ɹ(?![AIOQWYaɐɑɒæəɛɜɪʊʌɔiueoᵊᵻ])/g, '')
    .replace(/ˈ([iuɑɔ])(?!ː)/g, 'ˈ$1ː');
}

/**
 * One word's phonemes. `names` are the book's names with a pronunciation (respell.ts), by their words in lower case:
 * they come before the dictionary, so a name is said the way its author wrote it.
 */
export function wordPhonemes(word: string, lex: Lexicon, accent: Accent, names?: Lexicon): string {
  const own = names?.get(word.toLowerCase());
  if (own) return accent === 'gb' ? british(own) : own;
  const known = lookup(word, lex);
  if (known) return known;
  // "Camel's", and "camels'" (the plural's apostrophe says nothing).
  const poss = /^(.+)'s$/i.exec(word);
  if (poss) {
    const p = wordPhonemes(poss[1]!, lex, accent, names);
    return p + sEnding(p);
  }
  if (word.endsWith("'")) return wordPhonemes(word.slice(0, -1), lex, accent, names);
  if (word.includes('-')) return word.split('-').filter(Boolean).map((part) => wordPhonemes(part, lex, accent, names)).join(' ');
  const stem = stemmed(word, lex);
  if (stem) return stem;
  // "CR", "AD": an era code or initials, letter by letter.
  if (/^[A-Z]{1,4}$/.test(word)) return [...word].map((c) => LETTERS[c]!).join(' ');
  const p = lettersToPhonemes(word);
  return accent === 'gb' ? british(p) : p;
}

const startsWithVowel = (p: string | undefined): boolean => !!p && VOWELS.has(p.replace(/^[ˈˌ]+/, '')[0] ?? '');

/** The phonemes of a text, words apart and punctuation kept, for Kokoro. `names`: see wordPhonemes. */
export function phonemize(text: string, lex: Lexicon, accent: Accent, names?: Lexicon): string {
  const tokens: Token[] = [...normalize(text).matchAll(TOKENS)].map((m) => (/^[\p{L}\p{M}]/u.test(m[0]) ? { word: m[0] } : { mark: m[0] }));
  const sounds = tokens.map((t) => ('word' in t ? wordPhonemes(t.word, lex, accent, names) : ''));
  let out = '';
  let quoteOpen = false;
  let attach = false;
  tokens.forEach((t, i) => {
    if ('mark' in t) {
      const m = t.mark;
      const opening = m === '(' || m === '“' || (m === '"' && !quoteOpen);
      if (m === '"') quoteOpen = !quoteOpen;
      if (opening) {
        out += (out ? ' ' : '') + m;
        attach = true;
      } else if (m === '—') {
        out += ' —';
      } else {
        out += m;
      }
      return;
    }
    // The next word's first sound, unless punctuation comes first.
    const next = 'word' in (tokens[i + 1] ?? { mark: '.' }) ? sounds[i + 1] : undefined;
    const w = t.word;
    const lw = w.toLowerCase();
    let p = sounds[i]!;
    if (lw === 'the') p = startsWithVowel(next) ? 'ði' : 'ðə';
    else if ((w === 'a' || w === 'A') && next !== undefined) p = 'ɐ';
    else if (lw === 'an' && next !== undefined) p = 'ən';
    else if (lw === 'to' && next !== undefined) p = startsWithVowel(next) ? 'tʊ' : 'tə';
    else if (w === 'I') p = 'ˌI';
    out += (out && !attach ? ' ' : '') + p;
    attach = false;
  });
  return out.trim();
}
