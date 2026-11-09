import { Document, isMap, isScalar, isSeq, parseDocument, visit, type Node as YamlNode } from 'yaml';
import {
  ENTRY_TYPES, RULE_SETTINGS, SCHEMA_VERSION, TYPE_FOLDERS,
  type Action, type Entry, type EntryType, type IntendedMark, type LoadIssue, type LocationSpan,
  type FactionStatus, type ItemStatus, type Look, type MapPin, type Participant, type Picture, type PlaceStatus, type Provenance, type RefImage, type Relation, type StoryChapter, type StoryIgnore, type World, type WorldManifest,
  type WorldMap,
} from './types.ts';
import { isMonth } from './dates.ts';
import { DETAIL_FIELDS } from './details.ts';
import { HEX_COLOUR } from './color.ts';
import { joined, msg, verbatim } from './i18n.ts';
import { LIFECYCLE } from './lifecycle.ts';
import { parseChapter, parseStoryIgnored, slugify, sortChapters, STORY_FOLDER, STORY_IGNORED_FILE } from './story.ts';
import { TYPE_WORD } from './words.ts';

export const MANIFEST_FILE = 'world.json';
export const INTENDED_FILE = 'intended.json';

export interface WorldFile {
  /** Path relative to the world folder, using forward slashes. */
  path: string;
  content: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Collects problems while reading one file. */
class Reader {
  readonly problems: string[] = [];
  str(o: Obj, key: string): string | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v); // YAML turns `born: 1800` into a number
    this.problems.push(msg`"${verbatim(key)}" should be text.`);
    return undefined;
  }
  strList(o: Obj, key: string): string[] | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.map(String);
    this.problems.push(msg`"${verbatim(key)}" should be a list of text.`);
    return undefined;
  }
  list<T>(o: Obj, key: string, item: (x: Obj, where: string) => T | undefined): T[] | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (!Array.isArray(v)) {
      this.problems.push(msg`"${verbatim(key)}" should be a list.`);
      return undefined;
    }
    const out: T[] = [];
    v.forEach((x, i) => {
      if (!isObj(x)) return void this.problems.push(msg`"${verbatim(key)}[${i}]" should be an object.`);
      const r = item(x, `${key}[${i}]`);
      if (r !== undefined) out.push(r);
    });
    return out;
  }
  num(o: Obj, key: string): number | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    this.problems.push(msg`"${verbatim(key)}" should be a number.`);
    return undefined;
  }
  strMap(o: Obj, key: string): Record<string, string> | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (!isObj(v)) {
      this.problems.push(msg`"${verbatim(key)}" should be a set of "name: text" lines.`);
      return undefined;
    }
    const out: Record<string, string> = {};
    for (const k of Object.keys(v)) {
      const s = this.str(v, k);
      if (s !== undefined && s.trim() !== '') out[k] = s;
    }
    return Object.keys(out).length ? out : undefined;
  }
  need(o: Obj, key: string, where: string): string | undefined {
    const v = this.str(o, key);
    if (v === undefined || v.trim() === '') this.problems.push(where === 'entry' ? msg`Missing "${verbatim(key)}".` : msg`"${verbatim(where)}" needs "${verbatim(key)}".`);
    return v;
  }
}

/** Drop undefined values so files and snapshots stay tidy. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

const KNOWN_KEYS: Record<EntryType, string[]> = {
  character: ['race', 'born', 'died', 'status', 'locations'],
  place: ['status', 'founded', 'destroyed', 'partOf', 'pins'],
  faction: ['status', 'founded', 'dissolved'],
  item: ['status', 'created', 'destroyed'],
  event: ['date', 'end', 'place', 'participants', 'actions'],
  note: ['date'],
};
const BASE_KEYS = ['id', 'type', 'name', 'aliases', 'tags', 'summary', 'relations', 'images', 'picture', 'visual', 'looks', 'chapter', 'bookOrder'];

/** Front-matter keys that hold dates: born, died, founded, ... at the top, and from/to inside relations and locations. */
const DATE_KEYS = new Set(['born', 'died', 'founded', 'destroyed', 'dissolved', 'created', 'date', 'end']);
const SPAN_LISTS = new Set(['relations', 'locations', 'looks']);
const SPAN_KEYS = new Set(['from', 'to']);

/**
 * A date typed without quotes reads as a number in YAML: `born: 03.1920` would become 3.192 and `12.10` 12.1.
 * Date fields take the text exactly as it was typed instead. Other numbers (bookOrder, order) stay numbers.
 */
function keepDateText(contents: YamlNode | null): void {
  if (!isMap(contents)) return;
  const asText = (node: unknown): void => {
    if (isScalar(node) && typeof node.value === 'number' && typeof node.source === 'string') node.value = node.source;
  };
  for (const pair of contents.items) {
    const key = isScalar(pair.key) ? pair.key.value : pair.key;
    if (typeof key !== 'string') continue;
    if (DATE_KEYS.has(key)) asText(pair.value);
    else if (SPAN_LISTS.has(key) && isSeq(pair.value)) {
      for (const row of pair.value.items) {
        if (!isMap(row)) continue;
        for (const p of row.items) if (isScalar(p.key) && typeof p.key.value === 'string' && SPAN_KEYS.has(p.key.value)) asText(p.value);
      }
    }
  }
}

export function splitFrontMatter(content: string): { data: unknown; body: string } | { error: string } {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { error: msg`File must start with a "---" front-matter block.` };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { error: msg`Front-matter block is not closed with "---".` };
  const yamlText = text.slice(4, end);
  const rest = text.slice(end + 4).replace(/^[^\n]*\n?/, '');
  try {
    const doc = parseDocument(yamlText);
    if (doc.errors.length) throw doc.errors[0];
    keepDateText(doc.contents);
    return { data: doc.toJS() ?? {}, body: rest.replace(/^\n/, '') };
  } catch (e) {
    return { error: msg`Front matter is not valid YAML: ${(e as Error).message.split('\n')[0]}` };
  }
}

/** Parse one entry file (Markdown with YAML front matter). */
export function parseEntry(content: string): { entry?: Entry; problems: string[] } {
  const split = splitFrontMatter(content);
  if ('error' in split) return { problems: [split.error] };
  if (!isObj(split.data)) return { problems: [msg`Front matter must be a set of "key: value" lines.`] };
  const o = split.data;
  const r = new Reader();
  const id = r.need(o, 'id', 'entry');
  // A file without a name line is broken. An empty name (cleared in the editor) still loads, so nothing else in the
  // file is lost; the file-error rule reports it while it stays empty.
  const name = !('name' in o) ? r.need(o, 'name', 'entry') : o['name'] === null ? '' : r.str(o, 'name');
  const type = r.str(o, 'type');
  if (!type || !(ENTRY_TYPES as readonly string[]).includes(type)) {
    r.problems.push(msg`"type" must be one of: ${ENTRY_TYPES.join(', ')}.`);
  }
  if (!id || name === undefined || r.problems.length > 0) return { problems: r.problems };
  const t = type as EntryType;

  // List rows keep whatever they have. The editor saves rows that are only half filled in (a relation with dates but
  // no target yet); dropping them here would lose their other fields on the next save. The rules skip empty references.
  const relation = (x: Obj): Relation => clean({ type: r.str(x, 'type') ?? '', target: r.str(x, 'target') ?? '', from: r.str(x, 'from'), to: r.str(x, 'to'), note: r.str(x, 'note') });
  const image = (x: Obj, w: string): RefImage | undefined => {
    const file = r.need(x, 'file', w);
    const view = r.need(x, 'view', w);
    if (!file || !view) return undefined;
    const p = x['provenance'];
    const provenance: Provenance | undefined = isObj(p)
      ? clean({ tool: r.str(p, 'tool'), prompt: r.str(p, 'prompt'), date: r.str(p, 'date'), sources: r.strList(p, 'sources'), rights: r.str(p, 'rights') })
      : undefined;
    return clean({ file, view, look: r.str(x, 'look')?.trim() || undefined, provenance });
  };
  // Looks keep half-filled rows too (a look named but not placed in time yet). The id stays as the file has it:
  // pictures and model folders use it, so renaming a look never cuts them off. Files written by hand may leave it out.
  const lookIds = new Set<string>();
  const look = (x: Obj): Look => {
    const name = r.str(x, 'name') ?? '';
    const base = r.str(x, 'id')?.trim() || slugify(name, 'look');
    let id = base;
    for (let n = 2; lookIds.has(id); n++) id = `${base}-${n}`;
    lookIds.add(id);
    return clean({ id, name, reason: r.str(x, 'reason'), from: r.str(x, 'from'), to: r.str(x, 'to'), era: r.str(x, 'era'), after: r.str(x, 'after'), before: r.str(x, 'before'), visual: r.strMap(x, 'visual') });
  };
  const picture = (): Picture | undefined => {
    const m = r.strMap(o, 'picture');
    if (!m) return undefined;
    const hex = (k: string) => {
      const v = m[k]?.trim();
      if (v && !HEX_COLOUR.test(v)) r.problems.push(msg`"picture.${verbatim(k)}" should be a colour like #a07c2c.`);
      return v && HEX_COLOUR.test(v) ? v : undefined;
    };
    const pic = clean({ icon: m['icon']?.trim() || undefined, color: hex('color'), accent: hex('accent'), image: m['image']?.trim() || undefined });
    return Object.keys(pic).length ? pic : undefined;
  };
  const detailKeys = DETAIL_FIELDS[t].map((f) => f.key);
  const extraKeys = Object.keys(o).filter((k) => !BASE_KEYS.includes(k) && !KNOWN_KEYS[t].includes(k) && !detailKeys.includes(k));
  const details: Record<string, string | string[]> = {};
  for (const f of DETAIL_FIELDS[t]) {
    const v = o[f.key];
    if (v === undefined || v === null) continue;
    const text = (x: unknown) => (typeof x === 'string' ? x : typeof x === 'number' || typeof x === 'boolean' ? String(x) : undefined);
    if (f.kind === 'list' || f.kind === 'refs') {
      const items = Array.isArray(v) ? v.map(text) : typeof v === 'string' ? v.split(',') : [text(v)];
      if (items.some((x) => x === undefined)) r.problems.push(msg`"${verbatim(f.key)}" should be a list of names.`);
      const list = items.filter((x): x is string => x !== undefined).map((x) => x.trim()).filter(Boolean);
      if (list.length) details[f.key] = list;
    } else {
      const s = text(v);
      if (s === undefined) r.problems.push(msg`"${verbatim(f.key)}" should be text.`);
      else if (s.trim()) details[f.key] = s;
    }
  }
  const base = clean({
    id, name,
    aliases: r.strList(o, 'aliases'),
    tags: r.strList(o, 'tags'),
    summary: r.str(o, 'summary'),
    relations: r.list(o, 'relations', relation),
    images: r.list(o, 'images', image),
    picture: picture(),
    visual: r.strMap(o, 'visual'),
    looks: r.list(o, 'looks', look),
    chapter: r.str(o, 'chapter'),
    bookOrder: r.num(o, 'bookOrder'),
    details: Object.keys(details).length ? details : undefined,
    body: split.body,
    extra: extraKeys.length ? Object.fromEntries(extraKeys.map((k) => [k, o[k]])) : undefined,
  });

  const lifecycle = LIFECYCLE[t];
  const status = lifecycle ? r.str(o, 'status') : undefined;
  if (lifecycle && status !== undefined && !lifecycle.statuses.some((x) => x.value === status)) {
    const values = lifecycle.statuses.map((x) => x.value);
    r.problems.push(msg`"status" must be ${verbatim(values.slice(0, -1).join(', '))} or ${verbatim(String(values.at(-1)))}.`);
  }

  let entry: Entry;
  switch (t) {
    case 'character': {
      const location = (x: Obj): LocationSpan => clean({ place: r.str(x, 'place') ?? '', from: r.str(x, 'from'), to: r.str(x, 'to'), note: r.str(x, 'note') });
      entry = clean({
        ...base, type: t, race: Array.isArray(o['race']) ? (r.strList(o, 'race') ?? []).join(', ') || undefined : r.str(o, 'race'), born: r.str(o, 'born'), died: r.str(o, 'died'),
        status: status as 'alive' | 'dead' | 'unknown' | undefined,
        locations: r.list(o, 'locations', location),
      });
      break;
    }
    case 'place': {
      // A pin needs its map and both numbers; a number past the edge is moved onto it.
      const pin = (x: Obj, w: string): MapPin | undefined => {
        const map = r.need(x, 'map', w)?.trim();
        const at = (k: 'x' | 'y'): number | undefined => {
          if (x[k] === undefined || x[k] === null) return void r.problems.push(msg`"${verbatim(w)}" needs "${verbatim(k)}".`);
          const v = r.num(x, k);
          if (v === undefined) return undefined;
          if (v < 0 || v > 100) r.problems.push(msg`"${verbatim(`${w}.${k}`)}" should be from 0 to 100 (percent of the map).`);
          return Math.min(100, Math.max(0, v));
        };
        const px = at('x');
        const py = at('y');
        return map && px !== undefined && py !== undefined ? { map, x: px, y: py } : undefined;
      };
      entry = clean({ ...base, type: t, status: status as PlaceStatus | undefined, founded: r.str(o, 'founded'), destroyed: r.str(o, 'destroyed'), partOf: r.str(o, 'partOf'), pins: r.list(o, 'pins', pin) });
      break;
    }
    case 'faction':
      entry = clean({ ...base, type: t, status: status as FactionStatus | undefined, founded: r.str(o, 'founded'), dissolved: r.str(o, 'dissolved') });
      break;
    case 'item':
      entry = clean({ ...base, type: t, status: status as ItemStatus | undefined, created: r.str(o, 'created'), destroyed: r.str(o, 'destroyed') });
      break;
    case 'event': {
      const participant = (x: Obj): Participant => clean({ id: r.str(x, 'id') ?? '', role: r.str(x, 'role') });
      const action = (x: Obj): Action => clean({ actor: r.str(x, 'actor') ?? '', verb: r.str(x, 'verb') ?? '', target: r.str(x, 'target') });
      entry = clean({
        ...base, type: t, date: r.str(o, 'date'), end: r.str(o, 'end'), place: r.str(o, 'place'),
        participants: r.list(o, 'participants', participant), actions: r.list(o, 'actions', action),
      });
      break;
    }
    case 'note':
      entry = clean({ ...base, type: t, date: r.str(o, 'date') });
      break;
  }
  return { entry, problems: r.problems };
}

/** Front-matter key order used when writing files, so diffs stay small. */
const DETAIL_KEYS = [...new Set(Object.values(DETAIL_FIELDS).flatMap((fs) => fs.map((f) => f.key)))];
const KEY_ORDER = ['id', 'type', 'name', 'aliases', 'summary', 'tags', 'race', ...DETAIL_KEYS, 'born', 'died', 'status', 'founded', 'created', 'dissolved', 'destroyed', 'partOf', 'pins', 'date', 'end', 'place', 'participants', 'actions', 'locations', 'relations', 'visual', 'looks', 'picture', 'images', 'chapter', 'bookOrder'];

export function serializeEntry(entry: Entry): string {
  const { body, extra, details, ...fields } = entry;
  const data: Obj = {};
  const all: Obj = { ...fields, ...details, ...extra };
  for (const k of [...KEY_ORDER, ...Object.keys(all).filter((k) => !KEY_ORDER.includes(k))]) {
    const v = all[k];
    // The name is written even when empty, so the file still loads (with everything else in it) next time.
    if (v === undefined || (v === '' && k !== 'name') || (Array.isArray(v) && v.length === 0)) continue;
    data[k] = v;
  }
  const doc = new Document(data);
  // Quote date-like text ("1800", "~1200", "2026-10-30") so every YAML reader sees a string, not a number or timestamp.
  visit(doc, { Scalar: (_k, node) => { if (isScalar(node) && typeof node.value === 'string' && /^[~?\d-]/.test(node.value)) node.type = 'QUOTE_DOUBLE'; } });
  const yamlText = doc.toString({ lineWidth: 0 });
  return `---\n${yamlText}---\n\n${body.replace(/^\n+/, '')}${body.endsWith('\n') || body === '' ? '' : '\n'}`;
}

export function entryPath(entry: Pick<Entry, 'id' | 'type'>): string {
  const slug = entry.id.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'entry';
  return `${TYPE_FOLDERS[entry.type]}/${slug}.md`;
}

/**
 * Read world.json. `problems` make the world unusable (no manifest is returned). `issues` are values that cannot be
 * used and were set aside, so the world still opens: months that are not a list of {name, days}, a negative
 * approxYears (both replaced by what works), and rule severities other than error, warning, info or off (kept in
 * the file; the rule keeps its default severity). parseWorld reports them as load issues of world.json.
 */
export function parseManifest(content: string): { manifest?: WorldManifest; problems: string[]; issues: string[] } {
  let o: unknown;
  try {
    o = JSON.parse(content);
  } catch (e) {
    return { problems: [msg`world.json is not valid JSON: ${(e as Error).message}`], issues: [] };
  }
  if (!isObj(o)) return { problems: [msg`world.json must be a JSON object.`], issues: [] };
  const problems: string[] = [];
  if (o['schemaVersion'] !== SCHEMA_VERSION) problems.push(msg`world.json has schemaVersion ${String(o['schemaVersion'])}; this Lore-Forge reads version ${SCHEMA_VERSION}.`);
  if (typeof o['id'] !== 'string' || typeof o['name'] !== 'string') problems.push(msg`world.json needs text "id" and "name".`);
  const cal = o['calendar'];
  if (!isObj(cal) || !Array.isArray(cal['eras']) || cal['eras'].length === 0 || typeof cal['defaultEra'] !== 'string') {
    problems.push(msg`world.json needs a "calendar" with at least one era and a "defaultEra".`);
  } else if (!cal['eras'].every((e) => isObj(e) && typeof e['id'] === 'string' && typeof e['name'] === 'string' && typeof e['start'] === 'number')) {
    problems.push(msg`Each era needs text "id", "name" and a number "start".`);
  } else if (!cal['eras'].some((e) => (e as Obj)['id'] === cal['defaultEra'])) {
    problems.push(msg`defaultEra "${verbatim(String(cal['defaultEra']))}" is not one of the eras.`);
  }
  if (problems.length) return { problems, issues: [] };
  const issues: string[] = [];
  const calendar = { ...(cal as Obj) };
  // null (possible in hand-written JSON) means the same as leaving the key out.
  for (const k of ['months', 'approxYears']) if (calendar[k] === null) delete calendar[k];
  if (calendar['months'] !== undefined) {
    const months = calendar['months'];
    if (!Array.isArray(months)) {
      issues.push(msg`"calendar.months" should be a list of months, each with a name and a number of days. The calendar uses 12 months of 30 days.`);
      delete calendar['months'];
    } else {
      const usable = months.filter(isMonth);
      months.forEach((m, i) => {
        if (!isMonth(m)) issues.push(msg`Month ${i + 1} in "calendar.months" needs a name and a number of days (at least 1). It was left out.`);
      });
      if (usable.length !== months.length) {
        if (usable.length) calendar['months'] = usable;
        else delete calendar['months'];
      }
    }
  }
  const approx = calendar['approxYears'];
  if (approx !== undefined && !(typeof approx === 'number' && Number.isFinite(approx) && approx >= 0)) {
    issues.push(msg`"calendar.approxYears" should be a number of years, 0 or more (not ${verbatim(String(JSON.stringify(approx)))}). The default 5 is used.`);
    delete calendar['approxYears'];
  }
  const rules = o['rules'];
  if (rules !== undefined && rules !== null && !isObj(rules)) issues.push(msg`"rules" should be a set of "rule-id": "error" / "warning" / "info" / "off" lines.`);
  else if (rules) {
    for (const [id, v] of Object.entries(rules)) {
      if (!(RULE_SETTINGS as readonly unknown[]).includes(v)) issues.push(msg`"rules": "${verbatim(id)}" is ${verbatim(String(JSON.stringify(v)))}; use "error", "warning", "info" or "off". The rule keeps its default.`);
    }
  }
  const manifest: Obj = { ...o, calendar };
  const maps = parseMaps(o['maps'], issues);
  if (maps) manifest['maps'] = maps;
  else delete manifest['maps'];
  return { manifest: manifest as unknown as WorldManifest, problems, issues };
}

/**
 * world.json `maps`: each map needs a text id, name and picture (and the place it shows, when given, as text).
 * Maps that cannot be used are set aside with an issue, so the others still work; so is a second map with an id
 * already taken. Keys Lore-Forge does not know stay on the map.
 */
function parseMaps(v: unknown, issues: string[]): WorldMap[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) {
    issues.push(msg`"maps" should be a list of maps, each with an id, a name and a picture. The maps were left out.`);
    return undefined;
  }
  const seen = new Set<string>();
  const out: WorldMap[] = [];
  v.forEach((m, i) => {
    const text = (k: string) => (isObj(m) && typeof m[k] === 'string' ? (m[k] as string).trim() : '');
    if (!isObj(m) || !text('id') || typeof m['name'] !== 'string' || !text('image') || (m['place'] !== undefined && m['place'] !== null && typeof m['place'] !== 'string')) {
      return void issues.push(msg`Map ${i + 1} in "maps" needs a text "id", "name" and "image". It was left out.`);
    }
    const id = text('id');
    if (seen.has(id.toLowerCase())) return void issues.push(msg`Map ${i + 1} in "maps" has the id of an earlier map ("${verbatim(id)}"). It was left out.`);
    seen.add(id.toLowerCase());
    const { place: _place, ...rest } = m;
    out.push({ ...rest, id, name: m['name'] as string, image: text('image'), ...(text('place') ? { place: text('place') } : {}) } as WorldMap);
  });
  return out;
}

export function parseIntended(content: string): { intended: IntendedMark[]; problems: string[] } {
  try {
    const o: unknown = JSON.parse(content);
    if (isObj(o) && Array.isArray(o['intended'])) {
      const intended = o['intended'].filter((m): m is IntendedMark => isObj(m) && typeof m['warningId'] === 'string');
      return { intended, problems: [] };
    }
    return { intended: [], problems: [msg`intended.json must look like { "schemaVersion": 1, "intended": [...] }.`] };
  } catch (e) {
    return { intended: [], problems: [msg`intended.json is not valid JSON: ${(e as Error).message}`] };
  }
}

export function serializeIntended(intended: IntendedMark[]): string {
  const sorted = [...intended].sort((a, b) => a.warningId.localeCompare(b.warningId));
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, intended: sorted }, null, 2) + '\n';
}

export function serializeManifest(manifest: WorldManifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}

export class WorldFormatError extends Error {}

/**
 * Build a World from its files. Entry files are the `*.md` files inside the type folders.
 * Throws WorldFormatError only when world.json is missing or unusable; every other problem becomes a LoadIssue.
 */
export function parseWorld(files: WorldFile[]): World {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const manifestText = byPath.get(MANIFEST_FILE);
  if (manifestText === undefined) throw new WorldFormatError(msg`This folder has no world.json, so it is not a Lore-Forge world.`);
  const m = parseManifest(manifestText);
  if (!m.manifest) throw new WorldFormatError(joined(m.problems, ' '));

  const issues: LoadIssue[] = m.issues.map((message) => ({ file: MANIFEST_FILE, message }));
  let intended: IntendedMark[] = [];
  const intendedText = byPath.get(INTENDED_FILE);
  if (intendedText !== undefined) {
    const r = parseIntended(intendedText);
    intended = r.intended;
    for (const p of r.problems) issues.push({ file: INTENDED_FILE, message: p });
  }

  const folders = new Set(Object.values(TYPE_FOLDERS));
  const entries: Entry[] = [];
  const paths: Record<string, string> = {};
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const folder = f.path.split('/')[0] ?? '';
    if (!folders.has(folder) || !f.path.endsWith('.md')) continue;
    const { entry, problems } = parseEntry(f.content);
    for (const p of problems) issues.push({ file: f.path, message: p });
    if (!entry) continue;
    const seen = paths[entry.id];
    if (seen !== undefined) {
      issues.push({ file: f.path, message: msg`Id "${verbatim(entry.id)}" is already used by ${seen}. This file was skipped.` });
      continue;
    }
    if (TYPE_FOLDERS[entry.type] !== folder) {
      issues.push({ file: f.path, message: msg`A ${TYPE_WORD[entry.type]} entry should live in ${TYPE_FOLDERS[entry.type]}/, not ${folder}/.` });
    }
    paths[entry.id] = f.path;
    entries.push(entry);
  }

  const story: StoryChapter[] = [];
  for (const f of files) {
    if (!f.path.startsWith(`${STORY_FOLDER}/`) || !f.path.endsWith('.md')) continue;
    const r = parseChapter(f.content, f.path);
    for (const p of r.problems) issues.push({ file: f.path, message: p });
    story.push(r.chapter);
  }
  let storyIgnored: StoryIgnore[] = [];
  const ignoredText = byPath.get(STORY_IGNORED_FILE);
  if (ignoredText !== undefined) {
    const r = parseStoryIgnored(ignoredText);
    storyIgnored = r.ignored;
    for (const p of r.problems) issues.push({ file: STORY_IGNORED_FILE, message: p });
  }
  return { manifest: m.manifest, entries, intended, files: paths, issues, story: sortChapters(story), storyIgnored };
}
