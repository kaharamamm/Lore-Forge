/**
 * Renaming an entry everywhere: where the story and the book's entries still use the old name, the new one takes its
 * place. That covers the name in text (plain, and in [[links]]) and the fields that point at the entry by its name: a
 * relation's target, a home or a ruler, an event's place and people, a race, the event a look starts after, a map's
 * place. Turkish endings after the apostrophe follow the new name: Kadir'in becomes Murat'ın, Kadir'e becomes Ayşe'ye.
 * planRename lists the changes for the person to check; applyRename makes the ones they keep.
 */
import { DETAIL_FIELDS } from './details.ts';
import { namePattern } from './mentions.ts';
import { textAround } from './replace.ts';
import type { Entry, StoryChapter, World, WorldMap } from './types.ts';
import { normalizeName, WorldIndex } from './world-index.ts';

/** One place where the old name would change. */
export interface RenameHit {
  /** Stable while the book stays as it is: the owner, the field and the change's number in it. */
  id: string;
  /** What it is in: an entry's id, "story:" and a chapter's file, or "maps" (the book's maps). */
  owner: string;
  /** The field: "body", "summary", "title", "details.home", "relations[2].target", "maps[0].place", ... */
  field: string;
  /** The words around it on its line, to show it in its sentence. Empty for a field that only names the entry. */
  before: string;
  after: string;
  /** What is written now, and what it becomes ("Kadir'in", "Murat'ın"). */
  old: string;
  new: string;
  /** Another entry has the old name too, so this one may be about that entry. */
  shared?: boolean;
}

export interface RenameResult {
  /** Entries that changed, the renamed one included (its new name, and the old one kept as another name if asked). */
  entries: Entry[];
  chapters: StoryChapter[];
  /** The book's maps, when one of them changed. */
  maps?: WorldMap[];
  /** How many changes were made. */
  count: number;
}

// ------------------------------------------------------------------------------------- Turkish endings

const VOWELS = 'aeıioöuüâîû';
const BACK = 'aıouâû';
const VOICELESS = 'çfhkpsşt';
/** Endings of English after an apostrophe, which stay as they are: Kadir's, Kadir'll. */
const ENGLISH = new Set(['s', 'll', 'd', 've', 're', 'm', 't']);

/** The vowel a Turkish ending after this name agrees with: the last one (Kemal, Celal and Bilal take front endings). */
function lastVowel(name: string): string {
  const w = name.toLocaleLowerCase('tr');
  if (/[eiöüî][^aeıioöuüâîû\s]*[aâ]l$/.test(w)) return 'e';
  for (const c of [...w].reverse()) if (VOWELS.includes(c)) return c === 'â' ? 'a' : c === 'î' ? 'i' : c === 'û' ? 'u' : c;
  return 'e';
}

/**
 * The letter an ending takes after a vowel (Ayşe'nin, Ayşe'ye, Ayşe'si) and the ending without it. After a name that
 * ends in a consonant there is none, and the ending says which one a vowel would need.
 */
function bufferOf(afterVowel: boolean, e: string): { buffer: '' | 'n' | 'y' | 's'; rest: string } {
  if (afterVowel) {
    if (/^n[ıiuü]n/.test(e)) return { buffer: 'n', rest: e.slice(1) };
    if (/^y(?:[aeıiuü]|l[ae]|[dt][ıiuü]|m[ıiuü]ş|s[ae]|ken)/.test(e)) return { buffer: 'y', rest: e.slice(1) };
    if (/^s[ıiuü]/.test(e)) return { buffer: 's', rest: e.slice(1) };
    return { buffer: '', rest: e };
  }
  // Kadir'in (Ayşe'nin); Kadir'i, Kadir'e (Ayşe'yi, Ayşe'ye); Kadir'le, Kadir'di, Kadir'miş, Kadir'se, Kadir'ken (Ayşe'yle, ...).
  if (/^[ıiuü]n/.test(e)) return { buffer: 'n', rest: e };
  if (/^[ıiuüae]/.test(e) || /^l[ae](?!r)/.test(e) || /^[dt][ıiuü](?!r)/.test(e) || /^m[ıiuü]ş/.test(e) || /^s[ae]/.test(e) || /^ken/.test(e)) return { buffer: 'y', rest: e };
  return { buffer: '', rest: e };
}

/** An ending made to agree with a name: its vowels with the name's last vowel, d/t and c/ç with the sound before them. */
function harmonize(rest: string, vowel: string, sound: string): string {
  let v = vowel;
  let prev = sound;
  let out = '';
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]!;
    // -ki (Kadir'deki, Kadir'inki) and -ken keep their vowel.
    if (c === 'k' && rest[i + 1] === 'i' && (i + 2 === rest.length || 'ln'.includes(rest[i + 2]!))) {
      out += 'ki';
      v = prev = 'i';
      i++;
      continue;
    }
    if (rest.startsWith('ken', i)) {
      out += 'ken';
      v = 'e';
      prev = 'n';
      i += 2;
      continue;
    }
    let n = c;
    if (c === 'a' || c === 'e') n = BACK.includes(v) ? 'a' : 'e';
    else if ('ıiuü'.includes(c)) n = 'aı'.includes(v) ? 'ı' : 'ou'.includes(v) ? 'u' : 'öü'.includes(v) ? 'ü' : 'i';
    else if (c === 'd' || c === 't') n = VOICELESS.includes(prev) ? 't' : 'd';
    else if (c === 'c' || c === 'ç') n = VOICELESS.includes(prev) ? 'ç' : 'c';
    if (VOWELS.includes(n)) v = n;
    prev = n;
    out += n;
  }
  return out;
}

/**
 * A Turkish ending written after one name (the part after the apostrophe), made right for another name: Kadir'in
 * Murat'ın, Kadir'e Ayşe'ye, Ayşe'nin Kadir'in, Kadir'den Ahmet'ten. English endings (Kadir's) stay as they are.
 */
export function turkishEnding(oldName: string, newName: string, ending: string): string {
  const lower = ending.toLocaleLowerCase('tr');
  if (ENGLISH.has(lower) || !/^[a-zçğıöşüâîû]+$/.test(lower)) return ending;
  const was = oldName.trim().toLocaleLowerCase('tr');
  const now = newName.trim().toLocaleLowerCase('tr');
  if (!was || !now) return ending;
  const { buffer, rest } = bufferOf(VOWELS.includes(was.at(-1)!), lower);
  const lead = VOWELS.includes(now.at(-1)!) ? buffer : '';
  const made = lead + harmonize(rest, lastVowel(now), lead || now.at(-1)!);
  return ending !== lower && ending === ending.toLocaleUpperCase('tr') ? made.toLocaleUpperCase('tr') : made;
}

// ------------------------------------------------------------------------------------------ finding

const WORD = '[\\p{L}\\p{N}\\p{M}_]';
/** Turkish dotted and dotless i are one letter for matching, as for linking names (mentions.ts). */
const foldI = (s: string): string => s.normalize('NFC').replace(/ı/g, 'i').replace(/İ/g, 'I');
const LINK = /\[\[([^\]|\n]+)(\|[^\]\n]*)?\]\]/g;
/** @id mentions and `code` hold no plain names. */
const MASKS = [/@[A-Za-z0-9][\w-]*/g, /`[^`\n]*`/g];

interface Spot {
  start: number;
  end: number;
  old: string;
  new: string;
}
type Kind = 'text' | 'ref';
type Visit = (field: string, value: string, kind: Kind) => string;

/** Finds the old name in texts and in name fields, and says what each becomes. */
function finder(world: World, entryId: string, name: string, said: string) {
  const key = normalizeName(name);
  // References are read in the book as it was, with the entry still under its old name.
  const ix = new WorldIndex({ ...world, entries: world.entries.map((e) => (e.id === entryId ? { ...e, name } : e)) });
  const ours = (ref: string): boolean => normalizeName(ref) === key && ix.resolve(ref.trim())?.id === entryId;
  const shared = world.entries.some((e) => e.id !== entryId && [e.name, ...(e.aliases ?? [])].some((n) => normalizeName(n) === key));
  // The name as written (Turkish i's alike, any spaces between its words), and in capitals.
  const forms = [...new Set([foldI(name), foldI(name).toUpperCase()])].map((f) => f.split(' ').map(namePattern).join('[ \\t]+'));
  const re = new RegExp(`(?<!${WORD})(${forms.join('|')})(?!${WORD})(?:(['’])([\\p{L}\\p{M}]+))?`, 'gu');
  // Longer names of other entries with the old name in them ("Kadir's Lamp"): where the text says one of those, it
  // means that entry, as linking reads it (the longest name wins), so the old name in it stays.
  const has = new RegExp(re.source, 'u');
  const longer = [...new Set(world.entries.filter((e) => e.id !== entryId).flatMap((e) => [e.name, ...(e.aliases ?? [])]).map((n) => n.trim().replace(/\s+/g, ' ')))]
    .filter((n) => normalizeName(n) !== key && has.test(n))
    .sort((a, b) => b.length - a.length)
    .map((n) => foldI(n).split(' ').map(namePattern).join('[ \\t]+'));
  const longerRe = longer.length ? new RegExp(`(?<!${WORD})(?:${longer.join('|')})(?!${WORD})`, 'gu') : undefined;

  const plain = (text: string, offset: number, masks: readonly [number, number][]): Spot[] => {
    const out: Spot[] = [];
    for (const m of text.matchAll(re)) {
      const found = m[1]!;
      const start = offset + m.index;
      const nameEnd = start + found.length;
      if (masks.some(([a, b]) => start < b && nameEnd > a)) continue;
      // A name written in capitals (a heading, a shout) stays in capitals.
      const caps = found !== name && found === found.toUpperCase() && found !== found.toLowerCase();
      const word = caps ? (/[İı]/.test(found) ? said.toLocaleUpperCase('tr') : said.toUpperCase()) : said;
      let spot: Spot = { start, end: nameEnd, old: found, new: word };
      if (m[3]) {
        const ending = turkishEnding(name, said, m[3]);
        if (ending !== m[3]) spot = { start, end: nameEnd + 1 + m[3].length, old: m[0], new: `${word}${m[2]}${ending}` };
      }
      if (spot.old !== spot.new) out.push(spot);
    }
    return out;
  };

  /** The name in a text: plain, and as a [[link]] (its target, and plain in its label). */
  const text = (value: string): Spot[] => {
    if (!value) return [];
    const out: Spot[] = [];
    const masks: [number, number][] = [];
    for (const m of value.matchAll(LINK)) {
      masks.push([m.index, m.index + m[0].length]);
      const ref = m[1]!;
      const trimmed = ref.trim();
      const at = m.index + 2 + (ref.length - ref.trimStart().length);
      if (ours(trimmed) && trimmed !== said) out.push({ start: at, end: at + trimmed.length, old: trimmed, new: said });
      if (m[2]) out.push(...plain(m[2].slice(1), m.index + 2 + ref.length + 1, []));
    }
    for (const mask of MASKS) for (const m of value.matchAll(mask)) masks.push([m.index, m.index + m[0].length]);
    if (longerRe) for (const m of value.matchAll(longerRe)) masks.push([m.index, m.index + m[0].length]);
    out.push(...plain(value, 0, masks));
    return out.sort((a, b) => a.start - b.start);
  };

  /** A field that names an entry: the whole value, when it is this one by its old name. */
  const ref = (value: string): Spot[] => (value.trim() && ours(value) && value !== said ? [{ start: 0, end: value.length, old: value, new: said }] : []);

  return { text, ref, shared };
}

// ------------------------------------------------------------------------------------------ walking

/** The entry with each of its texts and name fields passed through `visit`. */
function mapEntry(e: Entry, visit: Visit): Entry {
  const out = { ...e } as Record<string, unknown> & Entry;
  const texts = (rec: Record<string, string>, path: string): Record<string, string> =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, visit(`${path}.${k}`, v, 'text')]));
  if (e.summary !== undefined) out.summary = visit('summary', e.summary, 'text');
  out.body = visit('body', e.body, 'text');
  if (e.chapter !== undefined) out.chapter = visit('chapter', e.chapter, 'text');
  if (e.details) {
    const kinds = new Map(DETAIL_FIELDS[e.type].map((d): [string, Kind] => [d.key, d.kind === 'ref' || d.kind === 'refs' ? 'ref' : 'text']));
    out.details = Object.fromEntries(Object.entries(e.details).map(([k, v]) => {
      const kind = kinds.get(k) ?? 'text';
      return [k, Array.isArray(v) ? v.map((x, i) => visit(`details.${k}[${i}]`, x, kind)) : visit(`details.${k}`, v, kind)];
    }));
  }
  if (e.fields) out.fields = Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, typeof v === 'string' ? visit(`fields.${k}`, v, 'text') : v]));
  if (e.visual) out.visual = texts(e.visual, 'visual');
  if (e.looks) {
    out.looks = e.looks.map((l, i) => {
      const look = { ...l, name: visit(`looks[${i}].name`, l.name, 'text') };
      if (l.reason !== undefined) look.reason = visit(`looks[${i}].reason`, l.reason, 'text');
      if (l.after !== undefined) look.after = visit(`looks[${i}].after`, l.after, 'ref');
      if (l.before !== undefined) look.before = visit(`looks[${i}].before`, l.before, 'ref');
      if (l.visual) look.visual = texts(l.visual, `looks[${i}].visual`);
      return look;
    });
  }
  if (e.relations) {
    out.relations = e.relations.map((r, i) => {
      const rel = { ...r, target: visit(`relations[${i}].target`, r.target, 'ref') };
      if (r.note !== undefined) rel.note = visit(`relations[${i}].note`, r.note, 'text');
      return rel;
    });
  }
  switch (e.type) {
    case 'character': {
      if (e.race !== undefined) {
        const items = e.race.split(',').map((x) => x.trim());
        const next = items.map((x, i) => (x ? visit(`race[${i}]`, x, 'ref') : x));
        if (next.some((x, i) => x !== items[i])) out['race'] = next.join(', ');
      }
      if (e.locations) {
        out['locations'] = e.locations.map((l, i) => {
          const loc = { ...l, place: visit(`locations[${i}].place`, l.place, 'ref') };
          if (l.note !== undefined) loc.note = visit(`locations[${i}].note`, l.note, 'text');
          return loc;
        });
      }
      break;
    }
    case 'place':
      if (e.partOf !== undefined) out['partOf'] = visit('partOf', e.partOf, 'ref');
      break;
    case 'event':
      if (e.place !== undefined) out['place'] = visit('place', e.place, 'ref');
      if (e.participants) {
        out['participants'] = e.participants.map((p, i) => {
          const who = { ...p, id: visit(`participants[${i}].id`, p.id, 'ref') };
          if (p.role !== undefined) who.role = visit(`participants[${i}].role`, p.role, 'text');
          return who;
        });
      }
      if (e.actions) {
        out['actions'] = e.actions.map((a, i) => {
          const act = { ...a, actor: visit(`actions[${i}].actor`, a.actor, 'ref') };
          if (a.target !== undefined) act.target = visit(`actions[${i}].target`, a.target, 'ref');
          return act;
        });
      }
      break;
    default:
      break;
  }
  return out;
}

function walk(world: World, entryId: string, from: string, to: string, keep?: (hit: RenameHit) => boolean, keepOldName = false): { hits: RenameHit[]; result: RenameResult } {
  const name = from.trim().replace(/\s+/g, ' ');
  const said = to.trim().replace(/\s+/g, ' ');
  const hits: RenameHit[] = [];
  const result: RenameResult = { entries: [], chapters: [], count: 0 };
  const renamed = world.entries.find((e) => e.id === entryId);
  if (!renamed || !normalizeName(name) || !said) return { hits, result };
  const f = finder(world, entryId, name, said);

  /** Visits the fields of one owner; `changed` hears when a change was made there. */
  const visitor = (owner: string, changed: () => void): Visit => (field, value, kind) => {
    const spots = kind === 'ref' ? f.ref(value) : f.text(value);
    const chosen: Spot[] = [];
    spots.forEach((s, n) => {
      const around = kind === 'text' ? textAround(value, s.start, s.end) : { before: '', after: '' };
      const hit: RenameHit = { id: `${owner}|${field}|${n}`, owner, field, ...around, old: s.old, new: s.new, ...(f.shared && kind === 'text' ? { shared: true } : {}) };
      hits.push(hit);
      if (keep?.(hit)) chosen.push(s);
    });
    if (!chosen.length) return value;
    changed();
    result.count += chosen.length;
    let out = value;
    for (const s of chosen.sort((a, b) => b.start - a.start)) out = out.slice(0, s.start) + s.new + out.slice(s.end);
    return out;
  };

  // The story first, in reading order; then the renamed entry, the other entries, and the maps.
  for (const c of world.story ?? []) {
    let changed = false;
    const visit = visitor(`story:${c.file}`, () => (changed = true));
    const title = visit('title', c.title, 'text');
    const pov = c.pov === undefined ? undefined : visit('pov', c.pov, 'ref');
    const summary = c.summary === undefined ? undefined : visit('summary', c.summary, 'text');
    const body = visit('body', c.body, 'text');
    if (changed) result.chapters.push({ ...c, title, body, ...(pov !== undefined ? { pov } : {}), ...(summary !== undefined ? { summary } : {}) });
  }
  for (const e of [renamed, ...world.entries.filter((x) => x.id !== entryId)]) {
    let changed = false;
    const visit = visitor(e.id, () => (changed = true));
    // The renamed entry's other names with the old one in them ("Kadir the Merchant") change with it; the old name
    // itself, kept as another name, stays.
    const aliases = e.id === entryId ? e.aliases?.map((a, i) => (normalizeName(a) === normalizeName(name) ? a : visit(`aliases[${i}]`, a, 'text'))) : undefined;
    let next = mapEntry(e, visit);
    if (aliases) next = { ...next, aliases };
    if (e.id === entryId && keep) {
      if (next.name !== said) {
        next = { ...next, name: said };
        changed = true;
      }
      const aliases = next.aliases ?? [];
      if (keepOldName && normalizeName(name) !== normalizeName(said) && !aliases.some((a) => normalizeName(a) === normalizeName(name))) {
        next = { ...next, aliases: [...aliases, name] };
        changed = true;
      }
    }
    if (changed) result.entries.push(next);
  }
  const maps = world.manifest.maps ?? [];
  let mapsChanged = false;
  const visitMaps = visitor('maps', () => (mapsChanged = true));
  const nextMaps = maps.map((m, i) => {
    const map: WorldMap = { ...m, name: visitMaps(`maps[${i}].name`, m.name, 'text') };
    if (m.place !== undefined) map.place = visitMaps(`maps[${i}].place`, m.place, 'ref');
    return map;
  });
  if (mapsChanged) result.maps = nextMaps;
  return { hits, result };
}

/** Every place where an entry's old name would change to its new one, in the story, the entries and the maps. */
export function planRename(world: World, entryId: string, from: string, to: string): RenameHit[] {
  return walk(world, entryId, from, to).hits;
}

/**
 * Makes the change: every hit of planRename except those in `skip`. The renamed entry gets the new name; with
 * `keepOldName`, the old one stays among its other names, so text that still says it keeps linking.
 */
export function applyRename(world: World, entryId: string, from: string, to: string, opts: { skip?: ReadonlySet<string>; keepOldName?: boolean } = {}): RenameResult {
  const skip = opts.skip ?? new Set<string>();
  return walk(world, entryId, from, to, (h) => !skip.has(h.id), opts.keepOldName ?? false).result;
}
