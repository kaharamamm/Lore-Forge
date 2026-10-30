import type { Entry } from './types.ts';

/** A plain-text name or alias found in prose. More than one id means the name is shared (ambiguous). */
export interface Mention {
  start: number;
  end: number;
  text: string;
  ids: string[];
}

/** Letters, digits and combining marks of any script (Turkish ç ğ ı İ ö ş ü included) count as word characters. */
const WORD = '[\\p{L}\\p{N}\\p{M}_]';
const MIN_LENGTH = 2;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Spans that already are explicit links or code: [[...]], @id and `code`. Implicit matching skips them. */
function maskedRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const re of [/\[\[[^\]\n]*\]\]/g, /@[A-Za-z0-9][\w-]*/g, /`[^`\n]*`/g]) {
    for (const m of text.matchAll(re)) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

/**
 * Finds entry names and aliases written as plain words in text.
 * Case-sensitive, whole words only (Unicode-aware boundaries), longest name first,
 * so "Kadir Humpback" wins over "Kadir". Names shorter than two characters are ignored.
 */
export class MentionMatcher {
  private readonly owners = new Map<string, string[]>();
  private readonly re: RegExp | undefined;

  constructor(entries: readonly Entry[]) {
    for (const e of entries) {
      for (const raw of [e.name, ...(e.aliases ?? [])]) {
        const n = raw.trim().replace(/\s+/g, ' ');
        if ([...n].length < MIN_LENGTH) continue;
        const ids = this.owners.get(n) ?? [];
        if (!ids.includes(e.id)) ids.push(e.id);
        this.owners.set(n, ids);
      }
    }
    const names = [...this.owners.keys()].sort((a, b) => [...b].length - [...a].length || a.localeCompare(b));
    // A space inside a name matches any run of spaces or tabs (not line breaks).
    const alts = names.map((n) => n.split(' ').map(escape).join('[ \\t]+'));
    this.re = alts.length ? new RegExp(`(?<!${WORD})(?:${alts.join('|')})(?!${WORD})`, 'gu') : undefined;
  }

  /** Mentions in `text`, in order. `exclude` drops one entry (usually the entry whose body this is). */
  find(text: string, opts: { exclude?: string } = {}): Mention[] {
    if (!this.re || !text) return [];
    const masks = maskedRanges(text);
    const out: Mention[] = [];
    for (const m of text.matchAll(this.re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (masks.some(([a, b]) => start < b && end > a)) continue;
      const ids = (this.owners.get(m[0].replace(/[ \t]+/g, ' ')) ?? []).filter((id) => id !== opts.exclude);
      if (ids.length) out.push({ start, end, text: m[0], ids });
    }
    return out;
  }
}
