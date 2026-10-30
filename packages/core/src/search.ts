import { DETAIL_FIELDS } from './details.ts';
import { TYPE_SINGULAR, VISUAL_FIELDS, type Entry, type World } from './types.ts';

/**
 * Search over entry content, ranked in tiers: 0 name and alias, 1 basic facts (type, race, title, occupation,
 * status, gender, places, dates, tags and the other basics), 2 summary, 3 appearance and the other details, 4 body.
 * Matching ignores case and folds Turkish I/ı/İ to i, so "ilk" finds "İlk" and "Irmak" finds "ırmak".
 */
export type SearchTier = 0 | 1 | 2 | 3 | 4;

export interface SearchHit {
  entry: Entry;
  tier: SearchTier;
  /** Lower is better: tier first, then how well the term sits in the text (whole value, word start, inside a word). */
  rank: number;
  /** Which field matched, e.g. "Name", "Race", "Summary", "Appearance", "Text". */
  field: string;
  /** The matched text, cut to a short snippet around the match. */
  snippet: string;
  /** Where the match sits in `snippet` (UTF-16 offsets, end exclusive). */
  start: number;
  end: number;
}

/** Case-fold one character at a time so offsets in the folded text are offsets in the original. */
export function foldSearch(s: string): string {
  let out = '';
  for (const c of s) {
    const f = c === 'I' || c === 'ı' || c === 'İ' ? 'i' : c.toLowerCase();
    // Keep the length: a character whose lower case is longer (rare) keeps its first unit and pads.
    out += f.length === c.length ? f : (f + c).slice(0, c.length);
  }
  return out;
}

const DATE_KEYS = ['born', 'died', 'founded', 'destroyed', 'dissolved', 'created', 'date', 'end'] as const;

/** Strip link and Markdown markup so the body reads like the page shows it. */
const plain = (md: string, nameOf: (id: string) => string): string => md
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
  .replace(/\[\[([^\]]+)\]\]/g, (_m, id: string) => nameOf(id))
  .replace(/(^|\s)@([\w-]+)/g, (_m, sp: string, id: string) => sp + nameOf(id))
  .replace(/^#+\s*/gm, '')
  .replace(/[*_`>]+/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const label = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

/** Every searchable text of an entry with its tier and field label, best tier first. */
function fieldsOf(e: Entry, nameOf: (id: string) => string): [SearchTier, string, string][] {
  const out: [SearchTier, string, string][] = [];
  const add = (tier: SearchTier, field: string, v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push([tier, field, v]);
    else if (Array.isArray(v)) for (const x of v) add(tier, field, x);
  };
  const rec = e as unknown as Record<string, unknown>;
  add(0, 'Name', e.name);
  add(0, 'Alias', e.aliases);
  add(1, 'Type', TYPE_SINGULAR[e.type]);
  if (e.type === 'character') add(1, 'Race', e.race);
  add(1, 'Status', rec['status']);
  for (const k of DATE_KEYS) add(1, label(k), rec[k]);
  if (e.type === 'character') for (const l of e.locations ?? []) add(1, 'Place', nameOf(l.place));
  if (e.type === 'event') add(1, 'Place', e.place ? nameOf(e.place) : undefined);
  if (e.type === 'place') add(1, 'Part of', e.partOf ? nameOf(e.partOf) : undefined);
  add(1, 'Tag', e.tags);
  const details = DETAIL_FIELDS[e.type];
  for (const [k, v] of Object.entries(e.details ?? {})) {
    const f = details.find((d) => d.key === k);
    const refs = f?.kind === 'ref' || f?.kind === 'refs';
    const value = refs ? (Array.isArray(v) ? v : [v]).map(nameOf) : v;
    add(f?.section === 'basics' ? 1 : 3, f?.label ?? label(k), value);
  }
  add(2, 'Summary', e.summary);
  for (const [k, v] of Object.entries(e.visual ?? {})) add(3, VISUAL_FIELDS[e.type].find((f) => f.key === k)?.label ?? label(k), v);
  if (e.type === 'event') for (const p of e.participants ?? []) add(3, 'Participant', p.role ? `${nameOf(p.id)} (${p.role})` : nameOf(p.id));
  for (const r of e.relations ?? []) add(3, 'Relation', `${r.type} ${nameOf(r.target)}`);
  add(4, 'Text', plain(e.body, nameOf));
  return out;
}

/** A short window of `text` around [at, at+len), with the offsets of the match inside it. */
function cut(text: string, at: number, len: number): { snippet: string; start: number; end: number } {
  if (text.length <= 90) return { snippet: text, start: at, end: at + len };
  let from = Math.max(0, at - 32);
  let to = Math.min(text.length, at + len + 52);
  // Start and end on word boundaries where there is one close by.
  if (from > 0) { const sp = text.indexOf(' ', from); if (sp !== -1 && sp < at) from = sp + 1; }
  if (to < text.length) { const sp = text.lastIndexOf(' ', to); if (sp > at + len) to = sp; }
  const pre = from > 0 ? '…' : '';
  return { snippet: pre + text.slice(from, to) + (to < text.length ? '…' : ''), start: at - from + pre.length, end: at - from + pre.length + len };
}

/** How well `q` sits in `hay` (both folded): 0 the whole value, 1 its start, 2 a word start, 3 inside a word; -1 none. */
function fit(hay: string, q: string): { quality: number; at: number } {
  const at = hay.indexOf(q);
  if (at === -1) return { quality: -1, at };
  if (hay.trim() === q) return { quality: 0, at };
  if (at === 0) return { quality: 1, at };
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').exec(hay);
  return word ? { quality: 2, at: word.index + word[1]!.length } : { quality: 3, at };
}

/**
 * Entries that match `query`, best first. Every word of the query has to appear somewhere in the entry; the entry
 * ranks by the best field the whole query appears in, or else by the weakest of its words.
 */
export function searchEntries(world: Pick<World, 'entries'>, query: string): SearchHit[] {
  const q = foldSearch(query.normalize('NFC')).trim().replace(/\s+/g, ' ');
  if (!q) return [];
  const words = q.split(' ');
  const names = new Map(world.entries.map((e) => [e.id, e.name]));
  const nameOf = (id: string) => names.get(id) ?? id;
  const hits: SearchHit[] = [];
  for (const entry of world.entries) {
    const fields = fieldsOf(entry, nameOf).map(([tier, field, text]) => ({ tier, field, text, folded: foldSearch(text) }));
    const best = (term: string) => {
      let top: { tier: SearchTier; quality: number; at: number; f: (typeof fields)[number] } | undefined;
      for (const f of fields) {
        const m = fit(f.folded, term);
        if (m.quality < 0) continue;
        if (!top || f.tier < top.tier || (f.tier === top.tier && m.quality < top.quality)) top = { tier: f.tier, quality: m.quality, at: m.at, f };
      }
      return top;
    };
    let hit = best(q);
    let len = q.length;
    if (!hit && words.length > 1) {
      const each = words.map(best);
      if (each.some((x) => !x)) continue;
      // Rank by the weakest word, show the first word's match.
      const worst = each.reduce((a, b) => (b!.tier > a!.tier || (b!.tier === a!.tier && b!.quality > a!.quality) ? b : a))!;
      hit = { ...each[0]!, tier: worst.tier, quality: worst.quality };
      len = words[0]!.length;
    }
    if (!hit) continue;
    const { snippet, start, end } = cut(hit.f.text, hit.at, len);
    hits.push({ entry, tier: hit.tier, rank: hit.tier * 10 + hit.quality, field: hit.f.field, snippet, start, end });
  }
  return hits.sort((a, b) => a.rank - b.rank || a.entry.name.localeCompare(b.entry.name));
}
