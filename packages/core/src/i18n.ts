/**
 * Translating what core shows to people: warning messages, labels and the headings of exported documents.
 *
 * Core always speaks English, so the command line, the MCP server, the files and every warning id stay the same in
 * every language. A text is translated only when it is shown, with `localize` and a table from English to the other
 * language (CORE_TR for Turkish). Texts with values (names, dates, other texts) are made with the `msg` tag: while
 * recording is on it remembers which template and values made each text, so a translation can put the values in its
 * own order and translate the values that are core's own words.
 */
import type { Block, Doc } from './publish/doc.ts';

interface Made {
  /** The template's key ("{0} can't {1} {2}: ..."), with "context\u0004" in front when it has a context. */
  key: string;
  values: readonly unknown[];
}

/** Template objects are unique per call site, so each key is worked out once. */
const KEYS = new WeakMap<readonly string[], string>();
/** Texts made with values, newest last; only while recording. */
const MADE = new Map<string, Made>();
/** Texts made without values: core's fixed words and phrases. There are only as many as there are call sites, so this set is never pruned. */
const FIXED = new Set<string>();
const MAX_MADE = 30_000;
/** Separates a context from the template in a key, as in gettext: "faction\u0004betray {0}". */
const CONTEXT = '\u0004';
const PLACEHOLDER = /\{(\d+)\}/g;
const LETTER = /\p{L}/u;
let recording = false;

function keyOf(strings: readonly string[]): string {
  let key = KEYS.get(strings);
  if (key === undefined) {
    key = strings[0]!;
    for (let i = 1; i < strings.length; i++) key += `{${i - 1}}${strings[i]!}`;
    KEYS.set(strings, key);
  }
  return key;
}

function remember(text: string, key: string, values: readonly unknown[]): void {
  MADE.delete(text);
  MADE.set(text, { key, values });
  // The parts of a new text stay fresh with it, so a part made long ago (a file problem found when the world was read)
  // stays translatable while texts keep being made from it.
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const part = MADE.get(v);
    if (part) {
      MADE.delete(v);
      MADE.set(v, part);
    }
  }
  if (MADE.size > MAX_MADE) {
    let drop = MADE.size >> 1;
    for (const k of MADE.keys()) {
      if (drop-- <= 0) break;
      MADE.delete(k);
    }
  }
}

function make(strings: readonly string[], values: readonly unknown[], context: string | undefined): string {
  let text = strings[0]!;
  if (values.length === 0) {
    FIXED.add(text);
    return text;
  }
  for (let i = 0; i < values.length; i++) text += `${values[i]}${strings[i + 1]!}`;
  if (recording) {
    const key = keyOf(strings);
    remember(text, context ? `${context}${CONTEXT}${key}` : key, values);
  }
  return text;
}

/** Tag for English texts core shows to people. Returns the English text exactly as a plain template literal would. */
export function msg(strings: TemplateStringsArray, ...values: unknown[]): string {
  return make(strings, values, undefined);
}

/**
 * msg with a context: the same English, but a translation may differ by context (key "context\u0004template"; the
 * plain template is the fallback). Used where the other language needs to know more than the English says, such as
 * the kind of entry a verb acts on. A text without values ignores the context.
 */
export function msgIn(context: string | undefined): (strings: TemplateStringsArray, ...values: unknown[]) => string {
  return (strings, ...values) => make(strings, values, context);
}

/** A template made from data (a verb table) instead of a literal. Make it once and keep it, like a literal's. */
export function template(...parts: string[]): TemplateStringsArray {
  const strings = [...parts] as string[] & { raw: readonly string[] };
  strings.raw = Object.freeze([...parts]);
  return Object.freeze(strings) as unknown as TemplateStringsArray;
}

/** A fixed text that core builds from its own data (a view label, a list of file values): remembered like msg`...`. */
export function fixed(text: string): string {
  FIXED.add(text);
  return text;
}

class Verbatim {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
  toString(): string {
    return this.text;
  }
}

/**
 * A value msg inserts as it is, never translated, even when the same text is one of core's words: field names and
 * relation types as written in the files ("destroyed", "rules").
 */
export function verbatim(text: string): unknown {
  return new Verbatim(text);
}

/** `items` joined with `sep`, each item still translatable: the joined text is remembered with a key like "{0}, {1}, {2}". */
export function joined(items: readonly string[], sep: string): string {
  const text = items.join(sep);
  if (recording && items.length > 1) remember(text, items.map((_, i) => `{${i}}`).join(sep), items);
  return text;
}

/** `text` without its final full stop (as `text.replace(/\.$/, '')`), still translatable: the stop goes from its template too. */
export function withoutStop(text: string): string {
  if (!text.endsWith('.')) return text;
  const out = text.slice(0, -1);
  if (FIXED.has(text)) FIXED.add(out);
  else if (recording) {
    const made = MADE.get(text);
    if (made && made.key.endsWith('.')) {
      // The text can be one that is kept between checks (a parsed date's reason), so it stays fresh too.
      remember(text, made.key, made.values);
      remember(out, made.key.slice(0, -1), made.values);
    }
  }
  return out;
}

/**
 * `next` was made from the text `prev` by replacing some of its values (story warnings quote the story as their
 * source). When `prev` came from a template and the same template with the mapped values gives `next`, `next` is
 * remembered that way, so it stays translatable. Returns `next`.
 */
export function rewritten(prev: string, next: string, map: (value: unknown) => unknown): string {
  if (!recording || prev === next) return next;
  const made = MADE.get(prev);
  if (!made) return next;
  const values = made.values.map(map);
  if (fill(templateOf(made.key), values.map((v) => `${v}`)) === next) remember(next, made.key, values);
  return next;
}

/** The desktop turns this on at start (renderer and main process). Off by default, so the CLI and MCP do no extra work. */
export function recordMessages(on: boolean): void {
  recording = on;
  if (!on) MADE.clear();
}

const own = (table: Readonly<Record<string, string>>, key: string): string | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);
const templateOf = (key: string): string => key.slice(key.indexOf(CONTEXT) + 1);
const fill = (t: string, values: readonly string[]): string => t.replace(PLACEHOLDER, (m, n: string) => values[Number(n)] ?? m);
/** A template with nothing but placeholders and punctuation ("{0}, {1}") reads the same in every language. */
const needsWords = (t: string): boolean => LETTER.test(t.replace(PLACEHOLDER, ''));

function translate(text: string, table: Readonly<Record<string, string>>, onMissing: ((key: string) => void) | undefined, depth: number): string {
  const made = MADE.get(text);
  if (made) {
    const values = made.values.map((v) =>
      typeof v === 'string' && v !== text && depth < 16 && (MADE.has(v) || FIXED.has(v)) ? translate(v, table, onMissing, depth + 1) : `${v}`,
    );
    const t = templateOf(made.key);
    let tr = own(table, made.key);
    if (tr === undefined && t !== made.key) tr = own(table, t);
    if (tr === undefined) {
      if (onMissing && needsWords(t)) onMissing(t);
      tr = t;
    }
    return fill(tr, values);
  }
  const tr = own(table, text);
  if (tr !== undefined) return tr;
  if (onMissing && FIXED.has(text) && LETTER.test(text)) onMissing(text);
  return text;
}

/**
 * The text in another language. `table` maps English templates to translations.
 * - A text made by msg with values: its template key (the static parts joined with {0}, {1}, … in order) is looked
 *   up in `table`. The translation may reorder or repeat placeholders. Each value is localized the same way (recursively)
 *   when it is itself a registered text; other values (names, numbers, file paths) are inserted as they are. When the
 *   key has no translation, the English template is filled with the localized values (partial translation).
 * - A text made by msg without values (a fixed word or phrase such as msg`died`): table[text].
 * - Any other text: table[text] if present (static labels like 'Characters', rule titles), else the text unchanged.
 * `onMissing`, when given, is called with each template key or fixed text that has no translation (tests use it).
 */
export function localize(text: string, table: Readonly<Record<string, string>>, onMissing?: (key: string) => void): string {
  return translate(text, table, onMissing, 0);
}

/** The same for a whole exported document (the Doc model in publish/doc.ts): only texts made by msg are translated, never the user's own text. */
export function localizeDoc(doc: Doc, table: Readonly<Record<string, string>>, onMissing?: (key: string) => void): Doc {
  const t = (s: string): string => (MADE.has(s) || FIXED.has(s) ? translate(s, table, onMissing, 0) : s);
  const block = (b: Block): Block => {
    switch (b.kind) {
      case 'heading':
        return { ...b, text: t(b.text), ...(b.stamp !== undefined ? { stamp: t(b.stamp) } : {}) };
      case 'para':
        return { ...b, text: t(b.text) };
      case 'front':
        return { ...b, lines: b.lines.map(t) };
      case 'facts':
        return { ...b, rows: b.rows.map(([label, value]): [string, string] => [t(label), t(value)]) };
      case 'list':
        return { ...b, items: b.items.map(t) };
      case 'image':
        return { ...b, caption: t(b.caption), details: b.details.map(t) };
      case 'prompt':
        return { ...b, label: t(b.label) };
      case 'box':
        return { ...b, title: t(b.title), blocks: b.blocks.map(block) };
      case 'toc':
        return b;
    }
  };
  return {
    ...doc,
    title: t(doc.title),
    cover: { ...doc.cover, title: t(doc.cover.title), subtitle: t(doc.cover.subtitle), lines: doc.cover.lines.map(t) },
    blocks: doc.blocks.map(block),
  };
}
