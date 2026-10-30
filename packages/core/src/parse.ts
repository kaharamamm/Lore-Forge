import { Document, isScalar, parse as parseYaml, visit } from 'yaml';
import {
  ENTRY_TYPES, SCHEMA_VERSION, TYPE_FOLDERS,
  type Action, type Entry, type EntryType, type IntendedMark, type LoadIssue, type LocationSpan,
  type FactionStatus, type ItemStatus, type Participant, type Picture, type PlaceStatus, type Provenance, type RefImage, type Relation, type StoryChapter, type StoryIgnore, type World, type WorldManifest,
} from './types.ts';
import { DETAIL_FIELDS } from './details.ts';
import { HEX_COLOUR } from './color.ts';
import { LIFECYCLE } from './lifecycle.ts';
import { parseChapter, parseStoryIgnored, sortChapters, STORY_FOLDER, STORY_IGNORED_FILE } from './story.ts';

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
    this.problems.push(`"${key}" should be text.`);
    return undefined;
  }
  strList(o: Obj, key: string): string[] | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.map(String);
    this.problems.push(`"${key}" should be a list of text.`);
    return undefined;
  }
  list<T>(o: Obj, key: string, item: (x: Obj, where: string) => T | undefined): T[] | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (!Array.isArray(v)) {
      this.problems.push(`"${key}" should be a list.`);
      return undefined;
    }
    const out: T[] = [];
    v.forEach((x, i) => {
      if (!isObj(x)) return void this.problems.push(`"${key}[${i}]" should be an object.`);
      const r = item(x, `${key}[${i}]`);
      if (r !== undefined) out.push(r);
    });
    return out;
  }
  num(o: Obj, key: string): number | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    this.problems.push(`"${key}" should be a number.`);
    return undefined;
  }
  strMap(o: Obj, key: string): Record<string, string> | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (!isObj(v)) {
      this.problems.push(`"${key}" should be a set of "name: text" lines.`);
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
    if (v === undefined || v.trim() === '') this.problems.push(where === 'entry' ? `Missing "${key}".` : `"${where}" needs "${key}".`);
    return v;
  }
}

/** Drop undefined values so files and snapshots stay tidy. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

const KNOWN_KEYS: Record<EntryType, string[]> = {
  character: ['race', 'born', 'died', 'status', 'locations'],
  place: ['status', 'founded', 'destroyed', 'partOf'],
  faction: ['status', 'founded', 'dissolved'],
  item: ['status', 'created', 'destroyed'],
  event: ['date', 'end', 'place', 'participants', 'actions'],
  note: ['date'],
};
const BASE_KEYS = ['id', 'type', 'name', 'aliases', 'tags', 'summary', 'relations', 'images', 'picture', 'visual', 'chapter', 'bookOrder'];

export function splitFrontMatter(content: string): { data: unknown; body: string } | { error: string } {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { error: 'File must start with a "---" front-matter block.' };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { error: 'Front-matter block is not closed with "---".' };
  const yamlText = text.slice(4, end);
  const rest = text.slice(end + 4).replace(/^[^\n]*\n?/, '');
  try {
    return { data: parseYaml(yamlText) ?? {}, body: rest.replace(/^\n/, '') };
  } catch (e) {
    return { error: `Front matter is not valid YAML: ${(e as Error).message.split('\n')[0]}` };
  }
}

/** Parse one entry file (Markdown with YAML front matter). */
export function parseEntry(content: string): { entry?: Entry; problems: string[] } {
  const split = splitFrontMatter(content);
  if ('error' in split) return { problems: [split.error] };
  if (!isObj(split.data)) return { problems: ['Front matter must be a set of "key: value" lines.'] };
  const o = split.data;
  const r = new Reader();
  const id = r.need(o, 'id', 'entry');
  const name = r.need(o, 'name', 'entry');
  const type = r.str(o, 'type');
  if (!type || !(ENTRY_TYPES as readonly string[]).includes(type)) {
    r.problems.push(`"type" must be one of: ${ENTRY_TYPES.join(', ')}.`);
  }
  if (!id || !name || r.problems.length > 0) return { problems: r.problems };
  const t = type as EntryType;

  const relation = (x: Obj, w: string): Relation | undefined => {
    const rt = r.need(x, 'type', w);
    const target = r.need(x, 'target', w);
    if (!rt || !target) return undefined;
    return clean({ type: rt, target, from: r.str(x, 'from'), to: r.str(x, 'to'), note: r.str(x, 'note') });
  };
  const image = (x: Obj, w: string): RefImage | undefined => {
    const file = r.need(x, 'file', w);
    const view = r.need(x, 'view', w);
    if (!file || !view) return undefined;
    const p = x['provenance'];
    const provenance: Provenance | undefined = isObj(p)
      ? clean({ tool: r.str(p, 'tool'), prompt: r.str(p, 'prompt'), date: r.str(p, 'date'), sources: r.strList(p, 'sources'), rights: r.str(p, 'rights') })
      : undefined;
    return clean({ file, view, provenance });
  };
  const picture = (): Picture | undefined => {
    const m = r.strMap(o, 'picture');
    if (!m) return undefined;
    const hex = (k: string) => {
      const v = m[k]?.trim();
      if (v && !HEX_COLOUR.test(v)) r.problems.push(`"picture.${k}" should be a colour like #a07c2c.`);
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
      if (items.some((x) => x === undefined)) r.problems.push(`"${f.key}" should be a list of names.`);
      const list = items.filter((x): x is string => x !== undefined).map((x) => x.trim()).filter(Boolean);
      if (list.length) details[f.key] = list;
    } else {
      const s = text(v);
      if (s === undefined) r.problems.push(`"${f.key}" should be text.`);
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
    r.problems.push(`"status" must be ${values.slice(0, -1).join(', ')} or ${values.at(-1)}.`);
  }

  let entry: Entry;
  switch (t) {
    case 'character': {
      const location = (x: Obj, w: string): LocationSpan | undefined => {
        const place = r.need(x, 'place', w);
        return place ? clean({ place, from: r.str(x, 'from'), to: r.str(x, 'to'), note: r.str(x, 'note') }) : undefined;
      };
      entry = clean({
        ...base, type: t, race: Array.isArray(o['race']) ? (r.strList(o, 'race') ?? []).join(', ') || undefined : r.str(o, 'race'), born: r.str(o, 'born'), died: r.str(o, 'died'),
        status: status as 'alive' | 'dead' | 'unknown' | undefined,
        locations: r.list(o, 'locations', location),
      });
      break;
    }
    case 'place':
      entry = clean({ ...base, type: t, status: status as PlaceStatus | undefined, founded: r.str(o, 'founded'), destroyed: r.str(o, 'destroyed'), partOf: r.str(o, 'partOf') });
      break;
    case 'faction':
      entry = clean({ ...base, type: t, status: status as FactionStatus | undefined, founded: r.str(o, 'founded'), dissolved: r.str(o, 'dissolved') });
      break;
    case 'item':
      entry = clean({ ...base, type: t, status: status as ItemStatus | undefined, created: r.str(o, 'created'), destroyed: r.str(o, 'destroyed') });
      break;
    case 'event': {
      const participant = (x: Obj, w: string): Participant | undefined => {
        const pid = r.need(x, 'id', w);
        return pid ? clean({ id: pid, role: r.str(x, 'role') }) : undefined;
      };
      const action = (x: Obj, w: string): Action | undefined => {
        const actor = r.need(x, 'actor', w);
        const verb = r.need(x, 'verb', w);
        return actor && verb ? clean({ actor, verb, target: r.str(x, 'target') }) : undefined;
      };
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
const KEY_ORDER = ['id', 'type', 'name', 'aliases', 'summary', 'tags', 'race', ...DETAIL_KEYS, 'born', 'died', 'status', 'founded', 'created', 'dissolved', 'destroyed', 'partOf', 'date', 'end', 'place', 'participants', 'actions', 'locations', 'relations', 'visual', 'picture', 'images', 'chapter', 'bookOrder'];

export function serializeEntry(entry: Entry): string {
  const { body, extra, details, ...fields } = entry;
  const data: Obj = {};
  const all: Obj = { ...fields, ...details, ...extra };
  for (const k of [...KEY_ORDER, ...Object.keys(all).filter((k) => !KEY_ORDER.includes(k))]) {
    const v = all[k];
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
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

export function parseManifest(content: string): { manifest?: WorldManifest; problems: string[] } {
  let o: unknown;
  try {
    o = JSON.parse(content);
  } catch (e) {
    return { problems: [`world.json is not valid JSON: ${(e as Error).message}`] };
  }
  if (!isObj(o)) return { problems: ['world.json must be a JSON object.'] };
  const problems: string[] = [];
  if (o['schemaVersion'] !== SCHEMA_VERSION) problems.push(`world.json has schemaVersion ${String(o['schemaVersion'])}; this Lore-Forge reads version ${SCHEMA_VERSION}.`);
  if (typeof o['id'] !== 'string' || typeof o['name'] !== 'string') problems.push('world.json needs text "id" and "name".');
  const cal = o['calendar'];
  if (!isObj(cal) || !Array.isArray(cal['eras']) || cal['eras'].length === 0 || typeof cal['defaultEra'] !== 'string') {
    problems.push('world.json needs a "calendar" with at least one era and a "defaultEra".');
  } else if (!cal['eras'].every((e) => isObj(e) && typeof e['id'] === 'string' && typeof e['name'] === 'string' && typeof e['start'] === 'number')) {
    problems.push('Each era needs text "id", "name" and a number "start".');
  } else if (!cal['eras'].some((e) => (e as Obj)['id'] === cal['defaultEra'])) {
    problems.push(`defaultEra "${cal['defaultEra']}" is not one of the eras.`);
  }
  if (problems.length) return { problems };
  return { manifest: o as unknown as WorldManifest, problems };
}

export function parseIntended(content: string): { intended: IntendedMark[]; problems: string[] } {
  try {
    const o: unknown = JSON.parse(content);
    if (isObj(o) && Array.isArray(o['intended'])) {
      const intended = o['intended'].filter((m): m is IntendedMark => isObj(m) && typeof m['warningId'] === 'string');
      return { intended, problems: [] };
    }
    return { intended: [], problems: ['intended.json must look like { "schemaVersion": 1, "intended": [...] }.'] };
  } catch (e) {
    return { intended: [], problems: [`intended.json is not valid JSON: ${(e as Error).message}`] };
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
  if (manifestText === undefined) throw new WorldFormatError('This folder has no world.json, so it is not a Lore-Forge world.');
  const m = parseManifest(manifestText);
  if (!m.manifest) throw new WorldFormatError(m.problems.join(' '));

  const issues: LoadIssue[] = [];
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
      issues.push({ file: f.path, message: `Id "${entry.id}" is already used by ${seen}. This file was skipped.` });
      continue;
    }
    if (TYPE_FOLDERS[entry.type] !== folder) {
      issues.push({ file: f.path, message: `A ${entry.type} entry should live in ${TYPE_FOLDERS[entry.type]}/, not ${folder}/.` });
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
