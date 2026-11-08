/**
 * The words the exporters write themselves ("Contents", notes about pictures and fonts) in another language: the
 * English is the key, `{name}` placeholders are filled from `vars`. Without one, the exports write English.
 * (Its own module: index.ts and docx.ts both use it, and docx.ts is loaded from index.ts.)
 */
export type Translate = (text: string, vars?: Readonly<Record<string, string | number>>) => string;

/** English: the text with its placeholders filled. */
export const english: Translate = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text);
