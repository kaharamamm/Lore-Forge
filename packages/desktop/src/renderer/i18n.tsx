/**
 * The page's side of the app's language (shared/i18n.ts): switching it, hooks, and translating texts with elements
 * in them (tj) and texts core made (tm: warnings, rule names, statuses, relation labels). The English in the code is
 * the key, so nothing here costs anything in English.
 */
import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { localize, localizeDoc, type Doc } from '@lore-forge/core';
import { language, setLanguage, translations, untranslated, type Lang } from '../shared/i18n.ts';
import { TR, TR_CORE } from '../shared/locales/tr/index.ts';

export { capital, fill, LANGUAGES, language, lower, num, pct, t, tx, type Lang } from '../shared/i18n.ts';

const listeners = new Set<(l: Lang) => void>();
/** For the end-to-end checks: the texts shown in Turkish that have no translation. */
(globalThis as { loreUntranslated?: Set<string> }).loreUntranslated = untranslated;

/** Switch the page to a language: every view is drawn again in it (App remounts its views, see useLanguage). */
export function switchLanguage(l: Lang): void {
  setLanguage(l, l === 'tr' ? TR : null);
  document.documentElement.lang = l;
  for (const f of listeners) f(l);
}

/** The language, drawn again when it changes. */
export function useLanguage(): Lang {
  const [l, setL] = useState(language);
  useEffect(() => {
    const f = (next: Lang) => setL(next);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  return l;
}

/**
 * t() for a text with elements in it: "Press {key} to open it" with key: <kbd>Enter</kbd>. Each {name} is replaced
 * by parts[name], in the order the translation puts them.
 */
export function tj(text: string, parts: Readonly<Record<string, ComponentChildren>>): ComponentChildren {
  const table = translations();
  const s = table ? (table[text] ?? (untranslated.add(text), text)) : text;
  const out: ComponentChildren[] = [];
  let last = 0;
  let n = 0;
  for (const m of s.matchAll(/\{(\w+)\}/g)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = m[1]!;
    out.push(k in parts ? <Fragment key={n++}>{parts[k]}</Fragment> : m[0]);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const missingCore = (key: string): void => { if (untranslated.size < 2000) untranslated.add(`core: ${key}`); };

/**
 * A text core made, in the app's language: a warning message, a rule's name or description, a type, status or
 * relation label, a date as core writes it. Core keeps its English (files, `lore check`, the MCP server) and
 * remembers how it made each text (core/src/i18n.ts); this puts it together again in the app's language.
 */
export function tm(text: string): string {
  return translations() && text ? localize(text, TR_CORE, missingCore) : text;
}

/** A World Codex or Story Book as core built it, with its headings and labels in the app's language (the user's text stays). */
export function tmDoc(doc: Doc): Doc {
  return translations() ? localizeDoc(doc, TR_CORE, missingCore) : doc;
}
