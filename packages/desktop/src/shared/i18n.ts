/**
 * The app's language (Settings, Language): English or Turkish. The English text in the code is also the key to its
 * translation, so English needs no table and a text without a translation stays readable. Used by the main process
 * (dialogs) and the page; the page also translates what core says (warnings, labels) with `localize` from core.
 */

export type Lang = 'en' | 'tr';

/** The languages offered, each named in itself. */
export const LANGUAGES: readonly { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'tr', name: 'Türkçe' },
];

export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'tr';

/** The language for a system locale: Turkish for "tr" and "tr-TR", English for everything else. */
export const langFor = (locale: string | undefined): Lang => (/^tr(?:[-_]|$)/i.test(locale ?? '') ? 'tr' : 'en');

/** BCP 47 tag for number and date formatting. */
export const localeOf = (l: Lang): string => (l === 'tr' ? 'tr-TR' : 'en-GB');

let lang: Lang = 'en';
let table: Readonly<Record<string, string>> | null = null;

/** Switch the language: `translations` is that language's table (none for English). */
export function setLanguage(l: Lang, translations: Readonly<Record<string, string>> | null): void {
  lang = l;
  table = l === 'en' ? null : translations;
}
export const language = (): Lang => lang;
/** The current language's table, or null in English. */
export const translations = (): Readonly<Record<string, string>> | null => table;

/** Fills {name} placeholders from `vars`; a placeholder without a value stays as it is. */
export function fill(text: string, vars: Readonly<Record<string, unknown>>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Texts asked for in another language that have no translation (for the checks; it stays small). */
export const untranslated = new Set<string>();
const miss = (text: string): string => {
  if (untranslated.size < 2000) untranslated.add(text);
  return text;
};

/** A text in the app's language. `text` is the English, and the key to the translation. */
export function t(text: string, vars?: Readonly<Record<string, unknown>>): string {
  const s = table ? (table[text] ?? miss(text)) : text;
  return vars ? fill(s, vars) : s;
}

/**
 * The same, for an English text that needs different translations in different places: `context` tells them apart
 * (the key is "context|text"). Falls back to the text's plain translation.
 */
export function tx(context: string, text: string, vars?: Readonly<Record<string, unknown>>): string {
  const s = table ? (table[`${context}|${text}`] ?? table[text] ?? miss(text)) : text;
  return vars ? fill(s, vars) : s;
}

/** A number written the way the language writes it ("1,000" in English, "1.000" in Turkish). */
export const num = (n: number): string => n.toLocaleString(localeOf(lang));

/** "133%" in English, "%133" in Turkish. */
export const pct = (n: number): string => (lang === 'tr' ? `%${n}` : `${n}%`);

/** Lower case in the language's own rules (Turkish: "I" → "ı", "İ" → "i"). */
export const lower = (s: string): string => s.toLocaleLowerCase(localeOf(lang));

/** A capital first letter in the language's own rules (Turkish: "iksir" → "İksir", not "Iksir"). */
export const capital = (s: string): string => (s ? s.charAt(0).toLocaleUpperCase(localeOf(lang)) + s.slice(1) : s);
