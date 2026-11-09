/** The spell checking languages Settings offers, and the default ones. */
import type { Lang } from './i18n.ts';

export const SPELL_LANGUAGES = ['en-US', 'en-GB', 'tr'] as const;

/** By their own names, like the app's language picker. */
export const SPELL_NAMES: Readonly<Record<string, string>> = { 'en-US': 'English (US)', 'en-GB': 'English (UK)', tr: 'Türkçe' };

/** The languages checked when none were chosen in Settings: the app's language (English as the system writes it). */
export function defaultSpelling(lang: Lang, locale: string): string[] {
  if (lang === 'tr') return ['tr'];
  return [/^en[-_](GB|IE|AU|NZ|ZA|IN)\b/i.test(locale) ? 'en-GB' : 'en-US'];
}
