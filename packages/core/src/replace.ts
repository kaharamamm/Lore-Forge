/**
 * Find and replace in plain text (the story's chapters): what is typed is found as it is, or with any case (the
 * Turkish and English i's included), as whole words or anywhere.
 */

export interface FindOptions {
  /** Only the same capitals: "Kadir" does not find "kadir". */
  matchCase?: boolean;
  /** Only whole words: "ali" does not find "Kalip". */
  wholeWords?: boolean;
}

/** Where a match is: [start, end) in the text. */
export interface Found {
  start: number;
  end: number;
}

const WORD = '[\\p{L}\\p{N}\\p{M}_]';
const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;
/**
 * The i's without case: i is also İ (Turkish) and I (English), ı is also I, and back. "istanbul" finds "İstanbul",
 * "kır" does not find "kir".
 */
const I_FORMS: Record<string, string> = { i: 'iİI', I: 'Iıi', ı: 'ıI', İ: 'İi' };
const outside = (c: string): string => c.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
const inside = (c: string): string => c.replace(/[\\\][^-]/g, '\\$&');

/** A letter with its other case, when both are one letter: "ş" "şŞ". */
function caseForms(c: string): string | undefined {
  const lo = c.toLowerCase();
  const up = c.toUpperCase();
  if (lo === up || [...lo].length !== 1 || [...up].length !== 1) return undefined;
  return lo === c ? lo + up : up + lo;
}

/** The pattern that finds `query`, or undefined for an empty one. */
export function findPattern(query: string, opts: FindOptions = {}): RegExp | undefined {
  const chars = [...query.normalize('NFC')];
  if (!chars.length) return undefined;
  let src = '';
  for (const c of chars) {
    const forms = opts.matchCase ? undefined : (I_FORMS[c] ?? caseForms(c));
    src += forms ? `[${[...forms].map(inside).join('')}]` : outside(c);
  }
  if (opts.wholeWords) {
    // Only where the query starts or ends with a letter: "-man" still finds "fisher-man".
    if (WORD_CHAR.test(chars[0]!)) src = `(?<!${WORD})${src}`;
    if (WORD_CHAR.test(chars.at(-1)!)) src = `${src}(?!${WORD})`;
  }
  return new RegExp(src, 'gu');
}

/** Every match of `query` in `text`, in order. */
export function findAll(text: string, query: string, opts: FindOptions = {}): Found[] {
  const re = findPattern(query, opts);
  if (!re || !text) return [];
  return [...text.matchAll(re)].filter((m) => m[0].length > 0).map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

/** The text with each of the matches replaced by `by`. */
export function replaceFound(text: string, found: readonly Found[], by: string): string {
  let out = text;
  for (const f of [...found].sort((a, b) => b.start - a.start)) out = out.slice(0, f.start) + by + out.slice(f.end);
  return out;
}

/**
 * The words around [start, end) in a text, on the same line, about `size` characters each side: to show a match in
 * its sentence. A cut in the middle of the line gets "…".
 */
export function textAround(text: string, start: number, end: number, size = 48): { before: string; after: string } {
  const from = Math.max(0, start - size);
  let before = text.slice(from, start);
  const nl = before.lastIndexOf('\n');
  if (nl >= 0) before = before.slice(nl + 1);
  else if (from > 0) before = `…${before.replace(/^\S*\s/, '')}`;
  const to = Math.min(text.length, end + size);
  let after = text.slice(end, to);
  const br = after.indexOf('\n');
  if (br >= 0) after = after.slice(0, br);
  else if (to < text.length) after = `${after.replace(/\s\S*$/, '')}…`;
  return { before: before.replace(/\s+/g, ' ').trimStart(), after: after.replace(/\s+/g, ' ').trimEnd() };
}
