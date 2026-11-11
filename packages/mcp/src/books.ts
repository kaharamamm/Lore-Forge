/**
 * What the assistant can do to a book (a world folder): create it, read it, change its entries, relationships,
 * chapters and pictures, check it and export it. Every change goes through the same parser, serializer and rules as
 * the desktop app, so files written here look exactly like files the app writes.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import YAML from 'yaml';
import {
  analyzeStory, applyFields, bodyLinks, calendarProblems, chapterDate, chapterPath, chapterStatus, check, cleanCoverSettings, customFields, DATE_FORMATS_HINT, fieldKey, parseCustomFields,
  DEFAULT_STATUS, DETAIL_FIELDS, ENTRY_TYPES, entryPath, findMap, isStoryFact, LIFECYCLE, lookAt, lookImages, lookVisual, lookWhen, mapModel, newEntryId, newLookId, newMapId, PICTURE_VIEW, picturePrompt, pinNumber, withoutPin,
  normalizeName, parseEntry, proposalEntry, relationFits, relationKind, serializeEntry, slugify, sortChapters, splitFrontMatter, storyBook, TRIMS,
  TYPE_LABELS, TYPE_SINGULAR, wordCount, WorldIndex, worldCodex,
  type Calendar, type ChapterStatus, type CustomField, type Entry, type EntryType, type FactRef, type Look, type MapPin, type ParsedDate, type Place, type Proposal, type Relation, type StoryChapter,
  type TrimSize, type Warning, type World, type WorldCoverSettings, type WorldMap,
} from '@lore-forge/core';
import {
  createWorld, duplicateWorld, listModels, loadWorld, moveModels, saveChapter, saveEntry, saveIntended, saveStoryIgnored, uniqueWorldDir,
} from '@lore-forge/core/node';
import { writeDocx, writeEpub, writePublication } from '@lore-forge/pdf';
import type { Library } from './library.ts';

export type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const today = (): string => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------------------------------------- books

export interface BookPatch {
  name?: string;
  description?: string | null;
  /** One style line used for every picture of this book, e.g. "painterly fantasy concept art, warm desert light". */
  artStyle?: string | null;
  /** How the book is written (point of view, tense, tone, audience, what to avoid); every chapter follows it. */
  writingStyle?: string | null;
  calendar?: Calendar;
  /** Story Book details (title, author, dedication, epigraph, ...). null removes a field. */
  book?: Obj;
  /** Cover look on the shelf (colours, emblem, title colour and font). null removes a field. */
  cover?: Obj;
  /** The book's own fields per entry type: a type given replaces its list; null or [] removes it. */
  fields?: Record<string, unknown[] | null>;
}

async function readManifestRaw(dir: string): Promise<Obj> {
  return JSON.parse(await readFile(join(dir, 'world.json'), 'utf8')) as Obj;
}
async function writeManifestRaw(dir: string, raw: Obj): Promise<void> {
  await writeFile(join(dir, 'world.json'), JSON.stringify(raw, null, 2) + '\n', 'utf8');
}

/** Shallow merge where null (or an empty string) removes a key. */
function mergeObj(base: unknown, patch: Obj): Obj {
  const out: Obj = { ...(isObj(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') delete out[k];
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

function cleanCalendar(c: Calendar): Calendar {
  const out: Calendar = {
    eras: c.eras.map(({ id, name, start, end, color }) => ({ id: id.trim(), name: name.trim(), start, ...(end !== undefined ? { end } : {}), ...(color ? { color } : {}) })),
    defaultEra: c.defaultEra.trim(),
  };
  if (c.months?.length) out.months = c.months.map(({ name, days }) => ({ name, days }));
  if (c.approxYears !== undefined) out.approxYears = c.approxYears;
  return out;
}

/** Changes world.json in place, keeping every key Lore-Forge does not know about. */
export async function patchBook(dir: string, patch: BookPatch): Promise<void> {
  const raw = await readManifestRaw(dir);
  if (patch.name?.trim()) raw['name'] = patch.name.trim();
  for (const k of ['description', 'artStyle', 'writingStyle'] as const) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v === null || !v.trim()) delete raw[k];
    else raw[k] = v.trim();
  }
  if (patch.calendar) {
    const cal = cleanCalendar(patch.calendar);
    const problems = calendarProblems(cal);
    if (problems.length) throw new Error(`The calendar does not work: ${problems.join(' ')}`);
    raw['calendar'] = cal;
  }
  if (patch.book) {
    if (typeof patch.book['trim'] === 'string' && !(patch.book['trim'] in TRIMS)) throw new Error(`book.trim must be one of ${Object.keys(TRIMS).join(', ')}.`);
    const b = mergeObj(raw['book'], patch.book);
    if (Object.keys(b).length) raw['book'] = b;
    else delete raw['book'];
  }
  if (patch.cover) {
    const c = cleanCoverSettings(mergeObj(raw['cover'], patch.cover) as WorldCoverSettings);
    if (Object.keys(c).length) raw['cover'] = c;
    else delete raw['cover'];
  }
  if (patch.fields) {
    const all: Obj = { ...(isObj(raw['fields']) ? raw['fields'] : {}) };
    for (const [type, list] of Object.entries(patch.fields)) {
      if (!list?.length) {
        delete all[type];
        continue;
      }
      // A field given without a key gets one made from its name, as in the app.
      const taken = list.flatMap((f) => (isObj(f) && typeof f['key'] === 'string' && f['key'].trim() ? [f['key'].trim()] : []));
      all[type] = list.map((f) => {
        if (!isObj(f) || (typeof f['key'] === 'string' && f['key'].trim()) || typeof f['name'] !== 'string') return f;
        const key = fieldKey(f['name'], taken);
        taken.push(key);
        return { key, ...f };
      });
    }
    const issues: string[] = [];
    const fields = parseCustomFields(all, issues);
    if (issues.length) throw new Error(`The fields do not work: ${issues.join(' ')}`);
    if (fields) raw['fields'] = fields;
    else delete raw['fields'];
  }
  await writeManifestRaw(dir, raw);
}

/** A new, empty book in the library's worlds folder. Its id is its folder name, so two books never share one. */
export async function createBook(lib: Library, input: BookPatch & { name: string }): Promise<{ dir: string; id: string; name: string }> {
  const name = input.name.trim();
  if (!name) throw new Error('A book needs a name.');
  const root = lib.worldsDir();
  await mkdir(root, { recursive: true });
  const dir = uniqueWorldDir(root, name);
  await createWorld(dir, name);
  const raw = await readManifestRaw(dir);
  raw['id'] = basename(dir);
  await writeManifestRaw(dir, raw);
  await patchBook(dir, input);
  return { dir, id: basename(dir), name };
}

export async function duplicateBook(lib: Library, src: string, name: string): Promise<{ dir: string; id: string; name: string }> {
  const dir = await duplicateWorld(src, lib.worldsDir(), name);
  const world = await loadWorld(dir);
  return { dir, id: world.manifest.id, name: world.manifest.name };
}

/** The book in one page: settings, every entry in short, the chapters, the warning counts. */
export async function bookOverview(lib: Library, dir: string): Promise<Obj> {
  const world = await loadWorld(dir);
  const raw = await readManifestRaw(dir);
  const warnings = check(world);
  const open = warnings.filter((w) => !w.intended);
  const m = world.manifest;
  return {
    name: m.name,
    id: m.id,
    folder: dir,
    readOnly: lib.isReadOnly(dir) || undefined,
    description: m.description,
    artStyle: typeof raw['artStyle'] === 'string' ? raw['artStyle'] : undefined,
    writingStyle: typeof raw['writingStyle'] === 'string' ? raw['writingStyle'] : undefined,
    calendar: { defaultEra: m.calendar.defaultEra, eras: m.calendar.eras.map((e) => `${e.id} = ${e.name} (starts at absolute year ${e.start}${e.end !== undefined ? `, ends ${e.end}` : ''})`), months: m.calendar.months?.map((x) => `${x.name} (${x.days} days)`) },
    book: m.book,
    cover: m.cover,
    fields: m.fields,
    counts: Object.fromEntries(ENTRY_TYPES.map((t) => [TYPE_LABELS[t].toLowerCase(), world.entries.filter((e) => e.type === t).length])),
    entries: world.entries.map(entrySummary),
    ...(m.maps?.length ? { maps: m.maps.map((x) => mapSummary(world, x)) } : {}),
    chapters: sortChapters(world.story ?? []).map(chapterLine),
    warnings: { errors: open.filter((w) => w.severity === 'error').length, warnings: open.filter((w) => w.severity === 'warning').length, info: open.filter((w) => w.severity === 'info').length, intended: warnings.length - open.length },
  };
}

const DATE_KEYS = ['born', 'died', 'founded', 'created', 'dissolved', 'destroyed', 'date', 'end'] as const;

/** A map in short: its name, the place it shows and how many places are pinned on it. */
function mapSummary(world: World, map: WorldMap): Obj {
  const model = mapModel(world, map.id);
  return { id: map.id, name: map.name, ...(model?.place ? { shows: model.place.name } : {}), pinned: model?.pins.length ?? 0 };
}

function entrySummary(e: Entry): Obj {
  const r = e as unknown as Obj;
  const dates = DATE_KEYS.filter((k) => typeof r[k] === 'string').map((k) => `${k} ${r[k] as string}`).join(', ');
  return {
    id: e.id, type: e.type, name: e.name,
    ...((r['status'] as string | undefined) ? { status: r['status'] } : {}),
    ...(dates ? { dates } : {}),
    ...(e.summary ? { summary: e.summary } : {}),
    ...(e.looks?.length ? { looks: e.looks.map((l) => l.name || l.id) } : {}),
    ...(e.images?.length ? { images: e.images.length } : {}),
  };
}

// ----------------------------------------------------------------------------------------------- entries

/** An entry by id, name or alias (optionally of one type). The error lists close names, so the assistant can retry. */
export function findEntry(world: World, ref: string, type?: EntryType): Entry {
  const text = ref.trim();
  const byId = world.entries.find((e) => e.id === text);
  if (byId && (!type || byId.type === type)) return byId;
  const hit = new WorldIndex(world).resolve(text);
  if (hit && (!type || hit.type === type)) return hit;
  const want = normalizeName(text).replace(/^the /, '');
  const loose = world.entries.filter((e) => (!type || e.type === type) && [e.name, ...(e.aliases ?? [])].some((n) => normalizeName(n).replace(/^the /, '') === want));
  if (loose.length === 1) return loose[0]!;
  const near = world.entries.filter((e) => normalizeName(e.name).includes(want) || want.includes(normalizeName(e.name))).slice(0, 8).map((e) => `"${e.name}" (${e.id})`);
  throw new Error(`No ${type ? TYPE_SINGULAR[type].toLowerCase() : 'entry'} "${ref}" in ${world.manifest.name}.${near.length ? ` Did you mean ${near.join(', ')}?` : ''}`);
}

/** The entry as the assistant should see it: the file's front matter as JSON, plus the body text. */
export function entryJson(world: World, e: Entry): Obj {
  const split = splitFrontMatter(serializeEntry(e));
  const data = 'error' in split ? {} : (split.data as Obj);
  return { ...data, body: e.body, file: world.files[e.id] };
}

const COMMON_KEYS = ['id', 'type', 'name', 'aliases', 'pronunciation', 'summary', 'tags', 'relations', 'images', 'picture', 'visual', 'looks', 'chapter', 'bookOrder', 'body', 'fields'];
const TYPE_KEYS: Record<EntryType, readonly string[]> = {
  character: ['race', 'born', 'died', 'status', 'locations'],
  place: ['status', 'founded', 'destroyed', 'partOf', 'pins'],
  faction: ['status', 'founded', 'dissolved'],
  item: ['status', 'created', 'destroyed'],
  event: ['date', 'end', 'place', 'participants', 'actions'],
  note: ['date'],
};
export const knownKeys = (t: EntryType): string[] => [...COMMON_KEYS, ...TYPE_KEYS[t], ...DETAIL_FIELDS[t].map((f) => f.key)];

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v === undefined || v === null ? [] : [v]);
const asText = (v: unknown): unknown => (typeof v === 'number' ? String(v) : v);
const kebab = (s: string): string => s.trim().toLowerCase().replace(/[\s_]+/g, '-');

/**
 * The assistant's fields, tidied into the file format: numbers in dates become text, comma lists become lists,
 * names of other entries become their ids when those exist (or are being created in the same call). Looks are
 * merged one by one instead (mergeLooks).
 */
function normalizeFields(input: Obj, type: EntryType, ref: (s: unknown) => unknown): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(input)) {
    if (['id', 'type', 'body', 'looks', 'pins', 'fields'].includes(k)) continue;
    if (v === null) { out[k] = null; continue; }
    if ((DATE_KEYS as readonly string[]).includes(k)) out[k] = asText(v);
    else if (k === 'aliases' || k === 'tags') out[k] = asList(v).map(asText);
    else if (k === 'place' || k === 'partOf') out[k] = ref(v);
    else if (k === 'relations') {
      out[k] = asList(v).filter(isObj).map((r) => ({ ...r, type: typeof r['type'] === 'string' ? kebab(r['type']) : r['type'], target: ref(r['target']), from: asText(r['from']), to: asText(r['to']) }));
    } else if (k === 'locations') {
      out[k] = asList(v).map((l) => (isObj(l) ? { ...l, place: ref(l['place']), from: asText(l['from']), to: asText(l['to']) } : { place: ref(l) }));
    } else if (k === 'participants') {
      out[k] = asList(v).map((p) => (isObj(p) ? { ...p, id: ref(p['id'] ?? p['name']) } : { id: ref(p) }));
    } else if (k === 'actions') {
      out[k] = asList(v).filter(isObj).map((a) => ({ ...a, actor: ref(a['actor']), ...(a['target'] !== undefined ? { target: ref(a['target']) } : {}) }));
    } else if (k === 'visual' && isObj(v)) {
      out[k] = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined && x !== '').map(([kk, x]) => [kk, String(x)]));
    } else {
      const f = DETAIL_FIELDS[type].find((d) => d.key === k);
      if (f?.kind === 'ref') out[k] = ref(v);
      else if (f?.kind === 'refs') out[k] = asList(v).map(ref);
      else if (f?.kind === 'list') out[k] = asList(v).map(asText);
      else out[k] = asText(v);
    }
  }
  // Undefined dates inside relations etc. are dropped by YAML; keep objects tidy.
  return JSON.parse(JSON.stringify(out)) as Obj;
}

/**
 * An entry's values for the book's own fields after save_entries: merged into the ones it has, null removing one. A
 * field is found by its key or its name; numbers and yes or no given as text become numbers and true or false where
 * the field wants them, and a choice takes the spelling of the list. Values for fields the book does not have stay,
 * with a note.
 */
function mergeCustomValues(have: unknown, input: unknown, defs: readonly CustomField[], notes: string[], who: string, type: EntryType): Obj | undefined {
  if (input === null) return undefined;
  if (!isObj(input)) throw new Error('"fields" must be an object of field: value, such as {"hp": 30}');
  const out: Obj = { ...(isObj(have) ? have : {}) };
  const unknown: string[] = [];
  for (const [k, raw] of Object.entries(input)) {
    const def = defs.find((f) => f.key === k) ?? defs.find((f) => f.key.toLowerCase() === k.toLowerCase() || normalizeName(f.name) === normalizeName(k));
    const key = def?.key ?? k;
    if (raw === null || raw === undefined || raw === '') {
      delete out[key];
      continue;
    }
    if (!def) unknown.push(k);
    let v: unknown = raw;
    const text = typeof raw === 'string' ? raw.trim() : undefined;
    if (def?.kind === 'number' && text && Number.isFinite(Number(text))) v = Number(text);
    else if (def?.kind === 'yes-no' && text) v = ['yes', 'true'].includes(text.toLowerCase()) ? true : ['no', 'false'].includes(text.toLowerCase()) ? false : raw;
    else if (def?.kind === 'choice') v = def.choices?.find((c) => c.toLowerCase() === String(raw).trim().toLowerCase()) ?? raw;
    else if (def?.kind === 'text' && (typeof raw === 'number' || typeof raw === 'boolean')) v = String(raw);
    out[key] = v;
  }
  if (unknown.length) notes.push(`${who}: ${unknown.map((k) => `"${k}"`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not one of the book's ${type} fields (get_book lists them); kept in the file.`);
  return Object.keys(out).length ? out : undefined;
}

/** The fields of a look in the file. */
const LOOK_FIELDS = ['id', 'name', 'reason', 'from', 'to', 'era', 'after', 'before', 'visual'];
const LOOK_TEXT = ['reason', 'from', 'to', 'era', 'after', 'before'] as const;

/** A free id for a new look, made from its name (or the id asked for) the way the app makes them. */
const freeLookId = (looks: readonly Look[], name: string): string => newLookId({ looks } as Entry, name);

interface MergedLooks {
  looks: Look[];
  removed: Look[];
  /** Keys given in a look that a look does not have. */
  unknown: string[];
  /** Looks asked to be removed that the entry does not have. */
  missing: string[];
}

/**
 * An entry's looks after save_entries. Each look given changes the look with its id (else its name), only in the
 * fields it gives (null removes one), or is added with an id made from its name. A name renames a look only when
 * the id found it. Looks not given stay; remove: true
 * takes one out. An id never changes, because pictures and 3D model folders use it: a rename keeps it. Events and
 * entries in after/before become ids like other references; an era's name becomes its code.
 */
function mergeLooks(have: readonly Look[], input: unknown, ref: (s: unknown) => unknown, calendar: Calendar): MergedLooks {
  if (input === null) return { looks: [], removed: [...have], unknown: [], missing: [] };
  if (!Array.isArray(input)) throw new Error('"looks" must be a list of looks');
  const looks: Look[] = have.map((l) => ({ ...l }));
  const removed: Look[] = [];
  const unknown = new Set<string>();
  const missing: string[] = [];
  const eraId = (t: string): string => (calendar.eras.find((e) => e.id.toLowerCase() === t.toLowerCase()) ?? calendar.eras.find((e) => normalizeName(e.name) === normalizeName(t)))?.id ?? t;
  input.forEach((raw: unknown, i) => {
    if (!isObj(raw)) throw new Error(`looks[${i}] must be an object such as {name, reason, after, visual}`);
    for (const k of Object.keys(raw)) if (!LOOK_FIELDS.includes(k) && k !== 'remove') unknown.add(k);
    const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
    const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
    let at = id ? looks.findIndex((l) => l.id === id) : -1;
    // Found by its id, a name renames it; found by its name, the name only finds it.
    const byId = at >= 0;
    if (at < 0 && name) at = looks.findIndex((l) => normalizeName(l.name) === normalizeName(name));
    if (raw['remove'] === true) {
      if (at >= 0) removed.push(...looks.splice(at, 1));
      else missing.push(id || name || `#${i + 1}`);
      return;
    }
    if (at < 0 && !name) throw new Error(`looks[${i}]${id ? ` ("${id}")` : ''} is not a look of this entry; a new look needs a name`);
    // Ids of removed looks stay taken, so a new look never picks up their pictures or models.
    const look: Look = at >= 0 ? looks[at]! : { id: freeLookId([...looks, ...removed], id || name), name };
    if ('name' in raw && raw['name'] !== undefined) {
      if (!name) throw new Error(`the look "${look.name || look.id}" needs a name`);
      if (byId || at < 0) look.name = name;
    }
    for (const k of LOOK_TEXT) {
      const v = raw[k];
      if (v === undefined) continue;
      if (v === null || (typeof v === 'string' && !v.trim())) {
        delete look[k];
        continue;
      }
      if (typeof v !== 'string' && typeof v !== 'number') throw new Error(`looks[${i}].${k} must be text`);
      const text = String(v).trim();
      look[k] = k === 'after' || k === 'before' ? String(ref(text)) : k === 'era' ? eraId(text) : text;
    }
    const visual = raw['visual'];
    if (visual !== undefined) {
      if (visual !== null && !isObj(visual)) throw new Error(`looks[${i}].visual must be a map such as {features: "An eye patch"}`);
      const map = Object.fromEntries(Object.entries(visual ?? {}).filter(([, x]) => x !== null && x !== undefined && String(x).trim() !== '').map(([k, x]) => [k, String(x)]));
      if (Object.keys(map).length) look.visual = map;
      else delete look.visual;
    }
    if (at < 0) looks.push(look);
  });
  return { looks, removed, unknown: [...unknown], missing };
}

export interface EntryInput extends Obj {
  id?: string;
  type?: string;
  name?: string;
  body?: string;
}

export interface SavedEntry { id: string; type: EntryType; name: string; file: string; created: boolean }

export interface SaveOutcome {
  saved: SavedEntry[];
  /** Entries that could not be saved, with the reason. */
  problems: string[];
  /**
   * Field names that are not part of the format (kept in the file, but Lore-Forge does not use them), look fields
   * that were left out, and looks that were removed.
   */
  notes: string[];
  /** Open errors and warnings that involve the saved entries. */
  warnings: FormattedWarning[];
}

/**
 * Creates or updates entries. An item with the id or the exact name of an existing entry (of that type) updates it:
 * only the fields given change, null removes a field, lists replace the whole list (but looks are matched one by
 * one: see mergeLooks). Others are created; ids come from the type and name ("char-mr-camel"). Names of entries in
 * the same call can be used as references. A removed look's pictures and 3D models go back to the Default look.
 */
export async function saveEntries(dir: string, items: EntryInput[]): Promise<SaveOutcome> {
  let world = await loadWorld(dir);
  const taken = new Set(world.entries.map((e) => e.id));
  const problems: string[] = [];
  const notes: string[] = [];
  type Plan = { item: EntryInput; type: EntryType; name: string; id: string; existing?: Entry };
  const plans: Plan[] = [];
  for (const [i, item] of items.entries()) {
    const label = `#${i + 1}${item.name ? ` "${item.name}"` : item.id ? ` (${item.id})` : ''}`;
    try {
      const typeText = typeof item.type === 'string' ? item.type.trim().toLowerCase() : undefined;
      if (typeText && !(ENTRY_TYPES as readonly string[]).includes(typeText)) throw new Error(`type must be one of ${ENTRY_TYPES.join(', ')}`);
      let existing = item.id ? world.entries.find((e) => e.id === item.id) : undefined;
      if (!existing && item.name && typeText) {
        const want = normalizeName(item.name);
        existing = world.entries.find((e) => e.type === typeText && normalizeName(e.name) === want);
      }
      if (existing && typeText && existing.type !== typeText) throw new Error(`"${existing.name}" is a ${existing.type}; an entry cannot change type (delete it and create a new one)`);
      const type = (existing?.type ?? typeText) as EntryType | undefined;
      const name = (typeof item.name === 'string' && item.name.trim()) || existing?.name;
      if (!type || !name) throw new Error('a new entry needs a "type" and a "name"');
      const id = existing?.id ?? (item.id && /^[A-Za-z0-9][\w-]*$/.test(item.id) && !taken.has(item.id) ? item.id : newEntryId(type, name, taken));
      taken.add(id);
      plans.push({ item, type, name: name.trim(), id, ...(existing ? { existing } : {}) });
    } catch (e) {
      problems.push(`${label}: ${(e as Error).message}.`);
    }
  }
  // Names (and aliases) of everything in this call, so they can refer to each other before they exist on disk.
  const pending = new Map<string, string>();
  for (const p of plans) {
    for (const n of [p.name, ...asList(p.item['aliases']).map(String)]) pending.set(normalizeName(n).replace(/^the /, ''), p.id);
  }
  const ix = new WorldIndex(world);
  const ref = (v: unknown): unknown => {
    if (typeof v !== 'string' || !v.trim()) return v;
    const t = v.trim();
    return ix.resolve(t)?.id ?? pending.get(normalizeName(t).replace(/^the /, '')) ?? ix.resolve(t.replace(/^the\s+/i, ''))?.id ?? t;
  };
  const saved: SavedEntry[] = [];
  for (const p of plans) {
    try {
      const base: Obj = p.existing
        ? (() => { const s = splitFrontMatter(serializeEntry(p.existing)); return 'error' in s ? {} : (s.data as Obj); })()
        : { id: p.id, type: p.type, name: p.name, ...(LIFECYCLE[p.type] ? { status: DEFAULT_STATUS } : {}) };
      const fm = mergeObj(base, normalizeFields(p.item, p.type, ref));
      fm['id'] = p.id;
      fm['type'] = p.type;
      fm['name'] = p.name;
      const unknown = Object.keys(p.item).filter((k) => !knownKeys(p.type).includes(k));
      const said: string[] = [];
      if (unknown.length) said.push(`${p.name}: ${unknown.map((k) => `"${k}"`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not a ${p.type} field; kept in the file but not shown in Lore-Forge. Use lore_forge_guide for the field names.`);
      if (p.item['fields'] !== undefined) {
        const values = mergeCustomValues(base['fields'], p.item['fields'], customFields(world.manifest, p.type), said, p.name, p.type);
        if (values) fm['fields'] = values;
        else delete fm['fields'];
      }
      let gone: Look[] = [];
      let gonePictures = 0;
      if (p.item['looks'] !== undefined) {
        const m = mergeLooks(p.existing?.looks ?? [], p.item['looks'], ref, world.manifest.calendar);
        if (m.looks.length) fm['looks'] = m.looks;
        else delete fm['looks'];
        gone = m.removed;
        if (m.unknown.length) said.push(`${p.name}: ${m.unknown.map((k) => `"${k}"`).join(', ')} ${m.unknown.length === 1 ? 'is' : 'are'} not a look field and ${m.unknown.length === 1 ? 'was' : 'were'} left out. A look has id, name, reason, from, to, era, after, before and visual.`);
        if (m.missing.length) said.push(`${p.name}: there is no look ${m.missing.map((x) => `"${x}"`).join(', ')} to remove.`);
        // The pictures of a removed look go back to the Default look, as in the app.
        const goneIds = new Set(gone.map((l) => l.id));
        if (goneIds.size && Array.isArray(fm['images'])) {
          fm['images'] = fm['images'].map((img: unknown) => {
            if (!isObj(img) || typeof img['look'] !== 'string' || !goneIds.has(img['look'])) return img;
            gonePictures++;
            const { look: _look, ...rest } = img;
            return rest;
          });
        }
      }
      if (p.item['pins'] !== undefined) {
        if (p.type !== 'place') said.push(`${p.name}: only places can be pinned on a map; "pins" was left out.`);
        else {
          const m = mergePins((p.existing as Place | undefined)?.pins ?? [], p.item['pins'], world.manifest.maps ?? []);
          if (m.pins.length) fm['pins'] = m.pins;
          else delete fm['pins'];
          said.push(...m.notes.map((n) => `${p.name}: ${n}.`));
        }
      }
      const body = typeof p.item.body === 'string' ? p.item.body : (p.existing?.body ?? '');
      const parsed = parseEntry(`---\n${YAML.stringify(fm, { lineWidth: 0 })}---\n\n${body.replace(/^\n+/, '')}`);
      if (!parsed.entry || parsed.problems.length) throw new Error(parsed.problems.join(' '));
      const file = (p.existing && world.files[p.existing.id]) || entryPath(parsed.entry);
      await saveEntry(dir, parsed.entry, file);
      if (gone.length) {
        // And its 3D models (models/<entry-id>/<look-id>/) move to the Default look's folder.
        let goneModels = 0;
        for (const l of gone) {
          try {
            goneModels += (await listModels(dir, p.id, l.id)).length;
            await moveModels(dir, p.id, l.id);
          } catch { /* an id that cannot name a folder has no models */ }
        }
        const kept = [gonePictures ? `${gonePictures} picture${gonePictures === 1 ? '' : 's'}` : '', goneModels ? `${goneModels} 3D model${goneModels === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
        said.push(`${p.name}: removed the look${gone.length === 1 ? '' : 's'} ${gone.map((l) => `"${l.name || l.id}"`).join(', ')}.${kept ? ` ${gone.length === 1 ? 'Its' : 'Their'} ${kept} now ${gonePictures + goneModels === 1 ? 'belongs' : 'belong'} to the Default look.` : ''}`);
      }
      notes.push(...said);
      saved.push({ id: p.id, type: p.type, name: p.name, file, created: !p.existing });
    } catch (e) {
      problems.push(`"${p.name}": ${(e as Error).message}`);
    }
  }
  world = await loadWorld(dir);
  const ids = new Set(saved.map((s) => s.id));
  const warnings = check(world).filter((w) => !w.intended && w.severity !== 'info' && (ids.has(w.offending.entryId) || (w.conflicting && ids.has(w.conflicting.entryId))));
  return { saved, problems, notes, warnings: warnings.map((w) => formatWarning(world, w)) };
}

/**
 * A place's pins after save_entries, matched by map: each pin given replaces the place's pin on that map (by its name
 * or id) or is added; {map, remove: true} takes the place off that map; pins on maps not given stay. null removes all.
 */
function mergePins(have: readonly MapPin[], input: unknown, maps: readonly WorldMap[]): { pins: MapPin[]; notes: string[] } {
  if (input === null) return { pins: [], notes: [] };
  const pins = [...have];
  const notes: string[] = [];
  for (const x of asList(input)) {
    if (!isObj(x) || typeof x['map'] !== 'string') { notes.push('a pin needs {map, x, y}; one was left out'); continue; }
    const map = findMap(maps, x['map']);
    if (!map) {
      notes.push(`there is no map "${x['map']}" (${maps.length ? `maps: ${maps.map((m) => m.name).join(', ')}` : 'add one with save_map first'}); that pin was left out`);
      continue;
    }
    const at = pins.findIndex((pin) => findMap([map], pin.map) === map);
    if (x['remove'] === true) {
      if (at >= 0) pins.splice(at, 1);
      continue;
    }
    const px = Number(x['x']), py = Number(x['y']);
    if (x['x'] === undefined || x['y'] === undefined || !Number.isFinite(px) || !Number.isFinite(py)) {
      notes.push(`the pin on "${map.name}" needs x and y (percent of the picture from its left and top edges); it was left out`);
      continue;
    }
    if (px < 0 || px > 100 || py < 0 || py > 100) notes.push(`the pin on "${map.name}" was off the picture and was moved onto its edge`);
    const pin: MapPin = { map: map.id, x: pinNumber(px), y: pinNumber(py) };
    if (at >= 0) pins[at] = pin;
    else pins.push(pin);
  }
  return { pins, notes };
}

export async function deleteEntry(dir: string, ref: string): Promise<{ id: string; name: string; file: string }> {
  const world = await loadWorld(dir);
  const e = findEntry(world, ref);
  const file = world.files[e.id] ?? entryPath(e);
  await rm(join(dir, file), { force: true });
  return { id: e.id, name: e.name, file };
}

// ----------------------------------------------------------------------------------------- relationships

export interface LinkInput {
  /** The entry the relationship is written in: "<entry> <type> <target>", e.g. Mr Camel ally-of Queen Samira. */
  entry: string;
  type: string;
  target: string;
  from?: string;
  to?: string;
  note?: string;
  remove?: boolean;
}

export async function linkEntries(dir: string, links: LinkInput[]): Promise<{ done: string[]; problems: string[] }> {
  const world = await loadWorld(dir);
  const touched = new Map<string, Entry>();
  const done: string[] = [];
  const problems: string[] = [];
  for (const l of links) {
    try {
      const a = touched.get(findEntry(world, l.entry).id) ?? structuredClone(findEntry(world, l.entry));
      const b = findEntry(world, l.target);
      const kind = relationKind(kebab(l.type));
      const type = kind?.type ?? kebab(l.type);
      if (!type) throw new Error('a relationship needs a type');
      const ix = new WorldIndex(world);
      const has = (x: Relation) => x.type === type && (x.target === b.id || ix.resolve(x.target)?.id === b.id);
      if (l.remove) {
        const before = a.relations?.length ?? 0;
        a.relations = (a.relations ?? []).filter((x) => !has(x));
        // A symmetric link may sit on the other entry instead.
        const other = touched.get(b.id) ?? structuredClone(b);
        const otherBefore = other.relations?.length ?? 0;
        if (kind?.symmetric) other.relations = (other.relations ?? []).filter((x) => !(x.type === type && x.target === a.id));
        if ((a.relations.length) === before && (other.relations?.length ?? 0) === otherBefore) throw new Error(`there is no "${type}" link from ${a.name} to ${b.name}`);
        touched.set(a.id, a);
        if (kind?.symmetric) touched.set(b.id, other);
        done.push(`Removed: ${a.name} ${type} ${b.name}`);
        continue;
      }
      // Earlier links of this same call count: the other entry may have just been given the link.
      if (kind?.symmetric && ((touched.get(b.id) ?? b).relations ?? []).some((x) => x.type === type && x.target === a.id)) {
        done.push(`Already linked: ${b.name} ${type} ${a.name} (shown on both entries)`);
        continue;
      }
      const rel: Relation = { type, target: b.id, ...(l.from ? { from: l.from } : {}), ...(l.to ? { to: l.to } : {}), ...(l.note ? { note: l.note } : {}) };
      const list = a.relations ?? [];
      const i = list.findIndex(has);
      a.relations = i >= 0 ? list.map((x, j) => (j === i ? rel : x)) : [...list, rel];
      touched.set(a.id, a);
      const fit = kind && !relationFits(kind, a.type, b.type) ? ` (note: "${type}" usually links ${kind.from.join('/')} to ${kind.to.join('/')}; check_book will warn)` : '';
      done.push(`${i >= 0 ? 'Updated' : 'Linked'}: ${a.name} ${kind?.label ?? type} ${b.name}${fit}`);
    } catch (e) {
      problems.push(`${l.entry} ${l.type} ${l.target}: ${(e as Error).message}.`);
    }
  }
  for (const e of touched.values()) await saveEntry(dir, e, world.files[e.id] ?? entryPath(e));
  return { done, problems };
}

// ------------------------------------------------------------------------------------------------ story

export interface ChapterInput {
  title: string;
  text: string;
  date?: string;
  /** Planning: whose point of view (a character, by name or id), how far it is, and what happens in it. '' removes one. */
  pov?: string;
  status?: ChapterStatus;
  summary?: string;
  /** Reading position: 1 = first chapter. A chapter with this number and another title is replaced only with replace. */
  number?: number;
  /** Replace this existing chapter (its number or title) instead of matching by title. */
  replace?: string | number;
}

function findChapter(chapters: StoryChapter[], ref: string | number): StoryChapter | undefined {
  const sorted = sortChapters(chapters);
  const byFile = typeof ref === 'string' ? sorted.find((c) => c.file === ref.trim().replace(/\\/g, '/')) : undefined;
  if (byFile) return byFile;
  if (typeof ref === 'number' || /^\d+$/.test(String(ref).trim())) return sorted[Number(ref) - 1];
  const want = normalizeName(String(ref));
  return sorted.find((c) => normalizeName(c.title) === want || c.file === ref);
}

/** Writes one chapter (new, or replacing the one with that title or number) and reports what the story now proposes. */
export async function writeChapter(dir: string, input: ChapterInput): Promise<Obj> {
  const title = input.title.trim();
  if (!title) throw new Error('A chapter needs a title.');
  let world = await loadWorld(dir);
  const chapters = world.story ?? [];
  const sorted = sortChapters(chapters);
  const old = input.replace !== undefined ? findChapter(chapters, input.replace) : sorted.find((c) => normalizeName(c.title) === normalizeName(title));
  if (input.replace !== undefined && !old) throw new Error(`There is no chapter "${input.replace}" to replace. Chapters: ${sorted.map((c, i) => `${i + 1}. ${c.title}`).join('; ') || 'none yet'}.`);
  let chapter: StoryChapter;
  if (old) {
    chapter = { ...old, title, body: input.text, ...(input.date !== undefined ? { date: input.date } : {}) };
    if (input.date === '') delete chapter.date;
  } else {
    const order = input.number ?? (sorted.length ? Math.max(...sorted.map((c) => c.order)) + 1 : 1);
    chapter = { file: chapterPath(order, title, chapters.map((c) => c.file)), title, order, body: input.text, ...(input.date ? { date: input.date } : {}) };
  }
  for (const key of ['pov', 'status', 'summary'] as const) {
    const value = input[key]?.trim();
    if (value === undefined) continue;
    if (value) Object.assign(chapter, { [key]: value });
    else delete chapter[key];
  }
  await saveChapter(dir, chapter);
  world = await loadWorld(dir);
  const analysis = analyzeStory(world);
  const here = (p: Proposal) => p.sourceSpan.chapter === chapter.file || p.alsoAt?.some((s) => s.chapter === chapter.file);
  const number = sortChapters(world.story ?? []).findIndex((c) => c.file === chapter.file) + 1;
  const looks = chapterLooks(world, world.story?.find((c) => c.file === chapter.file) ?? chapter);
  return {
    chapter: { number, title, file: chapter.file, words: wordCount(chapter.body), status: chapterStatus(chapter), replaced: !!old },
    proposals: analysis.proposals.filter(here).map(proposalJson),
    storyWarnings: analysis.warnings.filter((w) => !w.intended && w.offending.chapter === chapter.file).map((w) => formatWarning(world, w)),
    ...(looks.length ? { looks } : {}),
  };
}

/**
 * For a dated chapter: the people and things it names that do not have their Default look on that date, with the
 * look they have and what it changes. The text should describe them that way.
 */
function chapterLooks(world: World, chapter: StoryChapter): Obj[] {
  const ix = new WorldIndex(world);
  const when = ix.date(chapterDate(chapter));
  if (!when) return [];
  const named = new Set<string>();
  for (const m of ix.mentions.find(chapter.body)) if (m.ids.length === 1) named.add(m.ids[0]!);
  for (const l of bodyLinks(chapter.body)) {
    const e = ix.resolve(l.ref);
    if (e) named.add(e.id);
  }
  return [...named].flatMap((id) => {
    const e = ix.byIdOf(id);
    const look = e && lookAt(e, when, ix);
    if (!e || !look) return [];
    return [{
      entry: e.name,
      look: look.name || look.id,
      ...(look.reason?.trim() ? { why: look.reason.trim() } : {}),
      ...(look.visual && Object.keys(look.visual).length ? { changes: look.visual } : {}),
    }];
  });
}

/** One change to a chapter: `find` (text that is in it exactly once) becomes `replace`. */
export interface ChapterEdit {
  find: string;
  replace: string;
}

/**
 * Changes part of a chapter: each edit's `find` must be in the text exactly once (as written, line breaks too), and
 * `replace` takes its place, so the rest stays word for word. Answers like write_chapter.
 */
export async function editChapter(dir: string, ref: string | number, edits: ChapterEdit[]): Promise<Obj> {
  const world = await loadWorld(dir);
  const sorted = sortChapters(world.story ?? []);
  const c = findChapter(sorted, ref);
  if (!c) throw new Error(`No chapter "${ref}". Chapters: ${sorted.map((x, i) => `${i + 1}. ${x.title}`).join('; ') || 'none yet'}.`);
  if (!edits.length) throw new Error('Give at least one edit: {find, replace}.');
  let text = c.body;
  edits.forEach((e, i) => {
    const n = e.find ? text.split(e.find).length - 1 : 0;
    if (n !== 1) {
      throw new Error(n === 0
        ? `Edit ${i + 1}: its find text is not in the chapter (as it is after the edits before it). Copy it exactly from read_story; nothing was changed.`
        : `Edit ${i + 1}: its find text is in the chapter ${n} times. Give more of the text around it, so it is there once; nothing was changed.`);
    }
    text = text.replace(e.find, () => e.replace);
  });
  return writeChapter(dir, { title: c.title, text, replace: c.file });
}

export async function readStory(dir: string, ref?: string | number): Promise<Obj> {
  const world = await loadWorld(dir);
  const sorted = sortChapters(world.story ?? []);
  if (ref === undefined || ref === '') {
    return { chapters: sorted.map((c, i) => chapterLine(c, i)) };
  }
  const c = findChapter(sorted, ref);
  if (!c) throw new Error(`No chapter "${ref}". Chapters: ${sorted.map((x, i) => `${i + 1}. ${x.title}`).join('; ') || 'none yet'}.`);
  return { ...chapterLine(c, sorted.indexOf(c)), text: c.body };
}

/** A chapter in a list: its place, title, date, plan (point of view, status, what happens) and length. */
export function chapterLine(c: StoryChapter, i: number): Obj {
  return {
    number: i + 1,
    title: c.title,
    date: chapterDate(c),
    ...(c.pov ? { pov: c.pov } : {}),
    status: chapterStatus(c),
    ...(c.summary ? { summary: c.summary } : {}),
    words: wordCount(c.body),
    file: c.file,
  };
}

function proposalJson(p: Proposal): Obj {
  return {
    key: p.key,
    action: p.kind === 'create' ? `create ${p.entryType}` : `update ${p.entryType}`,
    name: p.name,
    fields: p.fields,
    ...(p.previous ? { replaces: p.previous } : {}),
    quote: p.sourceSpan.quote,
  };
}

/** What the story mentions that the world does not have yet. Accepts or ignores proposals by key ("all" accepts every one). */
export async function storyProposals(dir: string, opts: { accept?: string[]; ignore?: string[] }): Promise<Obj> {
  let world = await loadWorld(dir);
  let analysis = analyzeStory(world);
  const added: string[] = [];
  const acceptAll = opts.accept?.includes('all');
  const accept = analysis.proposals.filter((p) => acceptAll || opts.accept?.includes(p.key));
  if (accept.length) {
    const taken = new Set(world.entries.map((e) => e.id));
    const pending = new Map<string, string>();
    const made: Entry[] = [];
    for (const p of accept.filter((x) => x.kind === 'create')) {
      const e = proposalEntry(p, world, taken, pending);
      taken.add(e.id);
      pending.set(normalizeName(p.name).replace(/^the /, ''), e.id);
      made.push(e);
    }
    for (const e of made) {
      await saveEntry(dir, e);
      added.push(`Created ${e.type} "${e.name}" (${e.id})`);
    }
    for (const p of accept.filter((x) => x.kind === 'update' && x.matchedExistingId)) {
      const target = world.entries.find((e) => e.id === p.matchedExistingId);
      if (!target) continue;
      const next = applyFields(target, p.fields, world, pending);
      await saveEntry(dir, next, world.files[target.id] ?? entryPath(next));
      added.push(`Updated ${target.type} "${target.name}"`);
    }
  }
  if (opts.ignore?.length) {
    const have = new Set((world.storyIgnored ?? []).map((i) => i.key));
    const add = analysis.proposals.filter((p) => opts.ignore!.includes(p.key) && !have.has(p.key)).map((p) => ({ key: p.key, name: p.name, ignoredAt: today() }));
    if (add.length) await saveStoryIgnored(dir, [...(world.storyIgnored ?? []), ...add]);
    added.push(...add.map((i) => `Ignored "${i.name}"`));
  }
  if (added.length) {
    world = await loadWorld(dir);
    analysis = analyzeStory(world);
  }
  return { done: added, open: analysis.proposals.map(proposalJson) };
}

// ------------------------------------------------------------------------------------------------ checks

export interface FormattedWarning {
  id: string;
  severity: string;
  rule: string;
  message: string;
  at: string;
  conflictsWith?: string;
  note?: string;
}

function where(world: World, f: FactRef): string {
  if (isStoryFact(f) && f.chapter && f.span) {
    const quote = world.story?.find((c) => c.file === f.chapter)?.body.slice(f.span[0], f.span[1]);
    return `${f.source}${quote ? `: "${quote.length > 140 ? `${quote.slice(0, 137)}...` : quote}"` : ''}`;
  }
  return `${f.source} (${f.field})`;
}

export function formatWarning(world: World, w: Warning): FormattedWarning {
  return {
    id: w.id,
    severity: w.intended ? 'intended' : w.severity,
    rule: w.ruleId,
    message: w.message,
    at: where(world, w.offending),
    ...(w.conflicting ? { conflictsWith: where(world, w.conflicting) } : {}),
    ...(w.intended?.note ? { note: w.intended.note } : {}),
  };
}

export async function checkBook(dir: string, opts: { entry?: string; includeInfo?: boolean; includeIntended?: boolean }): Promise<Obj> {
  const world = await loadWorld(dir);
  const all = check(world);
  const only = opts.entry ? findEntry(world, opts.entry).id : undefined;
  const list = all.filter((w) => (opts.includeIntended || !w.intended) && (opts.includeInfo || w.severity !== 'info' || w.intended) && (!only || w.offending.entryId === only || w.conflicting?.entryId === only));
  const open = all.filter((w) => !w.intended);
  return {
    counts: { errors: open.filter((w) => w.severity === 'error').length, warnings: open.filter((w) => w.severity === 'warning').length, info: open.filter((w) => w.severity === 'info').length, intended: all.length - open.length },
    warnings: list.map((w) => formatWarning(world, w)),
  };
}

export async function markIntended(dir: string, warningId: string, note: string): Promise<string> {
  const world = await loadWorld(dir);
  const w = check(world).find((x) => x.id === warningId);
  if (!w) throw new Error(`No open warning with id "${warningId}". Use check_book to see the ids.`);
  await saveIntended(dir, [...world.intended.filter((m) => m.warningId !== warningId), { warningId, ...(note.trim() ? { note: note.trim() } : {}), markedAt: today() }]);
  return w.message;
}

// -------------------------------------------------------------------------------------------------- looks

/**
 * One of an entry's looks, by its id or name. Undefined for the Default look: no look given, or "Default" when no
 * look has that name. The error lists the looks the entry has, so the assistant can retry.
 */
export function findLook(entry: Entry, ref: string | undefined): Look | undefined {
  const text = ref?.trim() ?? '';
  if (!text) return undefined;
  const looks = entry.looks ?? [];
  const hit = looks.find((l) => l.id === text) ?? looks.find((l) => normalizeName(l.name) === normalizeName(text)) ?? looks.find((l) => l.id === slugify(text, ''));
  if (hit || normalizeName(text) === 'default') return hit;
  throw new Error(`${entry.name} has no look "${text}". ${looks.length ? `Its looks: ${looks.map((l) => `"${l.name || l.id}" (${l.id})`).join(', ')}.` : 'It has no looks yet; add one with save_entries (looks).'}`);
}

/** A date the book's calendar can place, for look_at. */
function placedDate(ix: WorldIndex, text: string): ParsedDate {
  const r = ix.parse(text.trim());
  if (r.kind === 'date') return r.date;
  if (r.kind === 'invalid') throw new Error(r.reason);
  throw new Error(`"${text}" has no year, so it cannot be placed in time. Use ${DATE_FORMATS_HINT}.`);
}

/** How an entry looks in one look (undefined: the Default look): when, why, the full description and its pictures. */
function lookJson(e: Entry, look: Look | undefined, ix: WorldIndex): Obj {
  const visual = lookVisual(e, look);
  const when = look ? lookWhen(look, ix) : '';
  const pictures = lookImages(e, look).map((i) => i.file);
  return {
    entry: e.name,
    look: look ? look.name || look.id : 'Default',
    ...(look ? { id: look.id } : {}),
    ...(when ? { when } : {}),
    ...(look?.reason?.trim() ? { why: look.reason.trim() } : {}),
    ...(Object.keys(visual).length ? { visual } : {}),
    ...(look?.visual && Object.keys(look.visual).length ? { changes: Object.keys(look.visual) } : {}),
    ...(pictures.length ? { pictures } : {}),
  };
}

/**
 * How entries look on a date: the look in effect (of the looks that cover the date, the one that started last) or
 * the Default look. Without entries: every entry that has a look other than its Default one on that date.
 */
export async function looksOn(dir: string, date: string, refs?: string[]): Promise<Obj> {
  const world = await loadWorld(dir);
  const ix = new WorldIndex(world);
  const when = placedDate(ix, date);
  const entries = refs?.length ? refs.map((r) => findEntry(world, r)) : world.entries.filter((e) => lookAt(e, when, ix));
  return {
    date: ix.fmt(when),
    looks: entries.map((e) => lookJson(e, lookAt(e, when, ix), ix)),
    ...(!refs?.length && !entries.length ? { note: `On ${ix.fmt(when)} every entry has its Default look.` } : {}),
  };
}

// ----------------------------------------------------------------------------------------------- pictures

/**
 * The entry a picture is for, its default view, and a ready prompt built from its visual description. With a look:
 * the look's description (the Default one with what the look changes) and why it looks that way.
 */
export async function pictureBrief(dir: string, ref: string, view?: string, lookRef?: string): Promise<{ world: World; entry?: Entry; look?: Look; view: string; prompt: string; artStyle?: string }> {
  const world = await loadWorld(dir);
  const raw = await readManifestRaw(dir);
  const artStyle = typeof raw['artStyle'] === 'string' && raw['artStyle'].trim() ? raw['artStyle'].trim() : undefined;
  if (normalizeName(ref) === 'cover') {
    if (lookRef?.trim() && normalizeName(lookRef) !== 'default') throw new Error('The book cover has no looks; leave out look.');
    const m = world.manifest;
    const title = m.book?.title ?? m.name;
    const prompt = `Book cover illustration for "${title}"${m.description ? `: ${m.description}` : ''}. A single striking scene, rich detail, leave calm space at the top and bottom for the title. No text, no letters, no logos, no border.`;
    return { world, view: 'cover', prompt, ...(artStyle ? { artStyle } : {}) };
  }
  const entry = findEntry(world, ref);
  const look = findLook(entry, lookRef);
  const v = view?.trim() ? kebab(view) : PICTURE_VIEW[entry.type];
  // The same prompt the app's own picture making builds (core picturePrompt).
  return { world, entry, ...(look ? { look } : {}), view: v, prompt: picturePrompt(entry, new WorldIndex(world), v, look), ...(artStyle ? { artStyle } : {}) };
}

function freePath(dir: string, rel: string): string {
  const ext = extname(rel);
  const stem = rel.slice(0, -ext.length);
  let out = rel;
  for (let n = 2; existsSync(join(dir, out)); n++) out = `${stem}-${n}${ext}`;
  return out;
}

/**
 * Saves picture bytes into the book and attaches them: to an entry's images (its card picture too, when it had none),
 * or as the cover. With a look id the picture is that look's: it goes to images/<entry-id>/<look-id>/ and names the
 * look. The card shows the entry itself, so only a picture of the Default look becomes its card picture.
 */
export async function attachPicture(dir: string, ref: string, view: string, data: Uint8Array, ext: string, provenance: { tool?: string; prompt?: string; sources?: string[] }, look?: string): Promise<{ file: string; entry?: string }> {
  const world = await loadWorld(dir);
  const prov = { ...(provenance.tool ? { tool: provenance.tool } : {}), ...(provenance.prompt ? { prompt: provenance.prompt } : {}), date: today(), ...(provenance.sources?.length ? { sources: provenance.sources } : {}) };
  if (normalizeName(ref) === 'cover') {
    // A new file name each time, like the app's cover editor, so no cached copy of an older cover shows.
    const file = freePath(dir, `images/cover-${Date.now().toString(36)}.${ext}`);
    await mkdir(join(dir, 'images'), { recursive: true });
    await writeFile(join(dir, file), data);
    await patchBook(dir, { cover: { image: file } });
    return { file };
  }
  const entry = structuredClone(findEntry(world, ref));
  const safeId = entry.id.replace(/[^\w-]+/g, '-');
  const folder = look ? `images/${safeId}/${look.replace(/[^\w-]+/g, '-')}` : `images/${safeId}`;
  const file = freePath(dir, `${folder}/${kebab(view).replace(/[^\w-]+/g, '-') || 'concept'}.${ext}`);
  await mkdir(join(dir, dirname(file)), { recursive: true });
  await writeFile(join(dir, file), data);
  entry.images = [...(entry.images ?? []), { file, view: kebab(view), ...(look ? { look } : {}), provenance: prov }];
  if (!look && !entry.picture?.image) entry.picture = { ...entry.picture, image: file };
  await saveEntry(dir, entry, world.files[entry.id] ?? entryPath(entry));
  return { file, entry: entry.name };
}

const IMAGE_EXT: Record<string, string> = { '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.webp': 'webp', '.gif': 'gif' };

/** Picture bytes from a local file, a web address or a data: URL. */
export async function loadPictureSource(source: string, fetchFn: typeof fetch = fetch): Promise<{ data: Uint8Array; ext: string }> {
  const s = source.trim();
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/is.exec(s);
  if (m) return { data: Uint8Array.from(Buffer.from(m[2]!, 'base64')), ext: m[1]!.toLowerCase().replace('jpeg', 'jpg') };
  if (/^https?:\/\//i.test(s)) {
    const res = await fetchFn(s, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Could not download the picture (${res.status}).`);
    const type = res.headers.get('content-type') ?? '';
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.length > 30 * 1024 * 1024) throw new Error('The picture is larger than 30 MB.');
    const ext = /png/.test(type) ? 'png' : /jpe?g/.test(type) ? 'jpg' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : IMAGE_EXT[extname(new URL(s).pathname).toLowerCase()];
    if (!ext) throw new Error('That address is not a PNG, JPEG, WebP or GIF picture.');
    return { data, ext };
  }
  const path = isAbsolute(s) ? s : resolve(s);
  const ext = IMAGE_EXT[extname(path).toLowerCase()];
  if (!ext) throw new Error('Pictures can be PNG, JPEG, WebP or GIF files.');
  if (!existsSync(path)) throw new Error(`There is no file at ${path}.`);
  const tmp = await readFile(path);
  return { data: new Uint8Array(tmp), ext };
}

// -------------------------------------------------------------------------------------------------- maps

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
/** Pictures larger than this are not sent with get_map (clients refuse very large images). */
const MAX_MAP_BYTES = 3.5 * 1024 * 1024;

export interface MapInput { map: string; name?: string; picture?: string; place?: string | null; remove?: boolean }

/**
 * Adds a map or changes one (world.json "maps"): its name, its picture (copied to maps/<id>.<ext>) and the place it
 * shows. remove takes it out with its picture and every pin on it.
 */
export async function saveMap(dir: string, input: MapInput, fetchFn: typeof fetch = fetch): Promise<Obj> {
  const world = await loadWorld(dir);
  const raw = await readManifestRaw(dir);
  const maps = (Array.isArray(raw['maps']) ? raw['maps'] : []) as WorldMap[];
  const known = world.manifest.maps ?? [];
  const found = findMap(known, input.map);
  const list = (): string => (known.length ? ` Maps: ${known.map((m) => `"${m.name}"`).join(', ')}.` : '');
  const unused = (file: string | undefined, rest: readonly WorldMap[]): boolean => !!file && file.startsWith('maps/') && !rest.some((m) => m.image === file);
  if (input.remove) {
    if (!found) throw new Error(`There is no map "${input.map}" in ${world.manifest.name}.${list()}`);
    const rest = maps.filter((m) => m.id !== found.id);
    if (rest.length) raw['maps'] = rest;
    else delete raw['maps'];
    await writeManifestRaw(dir, raw);
    if (unused(found.image, rest)) await rm(join(dir, found.image), { force: true });
    const pinned = world.entries.filter((e): e is Place => e.type === 'place' && (e.pins ?? []).some((p) => findMap([found], p.map) === found));
    for (const p of pinned) await saveEntry(dir, withoutPin(p, found), world.files[p.id] ?? entryPath(p));
    return { removed: found.name, unpinned: pinned.map((p) => p.name) };
  }
  if (!found && !input.picture?.trim()) throw new Error(`A new map needs a picture.${list()}`);
  const name = (input.name ?? (found ? found.name : input.map)).trim();
  if (!name) throw new Error('A map needs a name.');
  const map: WorldMap = found ? { ...(maps.find((m) => m.id === found.id) ?? found) } : { id: newMapId(known, name), name, image: '' };
  map.name = name;
  if (input.place === null) delete map.place;
  else if (input.place !== undefined) map.place = findEntry(world, input.place, 'place').id;
  if (input.picture?.trim()) {
    // A picture of the book itself (create_image's) by its path inside the book, or a file, address or data: URL.
    const inBook = !/^(data:|https?:)/i.test(input.picture.trim()) && !isAbsolute(input.picture.trim()) && existsSync(join(dir, input.picture.trim()));
    const pic = await loadPictureSource(inBook ? join(dir, input.picture.trim()) : input.picture, fetchFn);
    const file = `maps/${map.id.replace(/[^\w-]+/g, '-')}.${pic.ext}`;
    await mkdir(join(dir, 'maps'), { recursive: true });
    await writeFile(join(dir, file), pic.data);
    const old = map.image;
    map.image = file;
    if (old !== file && unused(old, maps.filter((m) => m.id !== map.id).concat(map))) await rm(join(dir, old), { force: true });
  }
  raw['maps'] = found ? maps.map((m) => (m.id === map.id ? map : m)) : [...maps, map];
  await writeManifestRaw(dir, raw);
  return {
    map: { id: map.id, name: map.name, picture: map.image, ...(map.place ? { shows: findEntry(world, map.place, 'place').name } : {}) },
    created: !found,
    next: 'Look at it with get_map, then pin places on it with save_entries: a place\'s pins [{map, x, y}], x and y in percent of the picture from its left and top edges.',
  };
}

/** One map for get_map: what is pinned where, what is not on it yet, and its picture to look at (when not too large). */
export async function mapView(dir: string, ref?: string): Promise<{ info: Obj; image?: { data: string; mimeType: string } }> {
  const world = await loadWorld(dir);
  const maps = world.manifest.maps ?? [];
  if (!maps.length) throw new Error(`${world.manifest.name} has no maps yet. Add one with save_map.`);
  const map = ref?.trim() ? findMap(maps, ref) : maps[0];
  if (!map) throw new Error(`There is no map "${ref}" in ${world.manifest.name}. Maps: ${maps.map((m) => `"${m.name}"`).join(', ')}.`);
  const model = mapModel(world, map.id)!;
  const info: Obj = {
    map: { id: map.id, name: map.name, picture: map.image, ...(model.place ? { shows: model.place.name } : {}) },
    pins: model.pins.map((p) => ({ place: p.entry.name, id: p.entry.id, x: p.x, y: p.y })),
    notOnThisMap: model.unpinned.map((p) => p.name),
    ...(maps.length > 1 ? { otherMaps: maps.filter((m) => m.id !== map.id).map((m) => m.name) } : {}),
    howPinsWork: 'x and y are percent of the picture from its left and top edges (0 to 100).',
  };
  const file = join(dir, map.image);
  if (!existsSync(file)) return { info: { ...info, picture: `The picture ${map.image} is missing.` } };
  const data = await readFile(file);
  const ext = extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg');
  if (data.length > MAX_MAP_BYTES || !MIME[ext]) return { info: { ...info, picture: `The picture is too large to show here (${(data.length / 1048576).toFixed(1)} MB).` } };
  return { info, image: { data: data.toString('base64'), mimeType: MIME[ext]! } };
}

// ------------------------------------------------------------------------------------------------ export

export interface ExportOptions { kind: 'story-book' | 'codex'; format: 'pdf' | 'docx' | 'epub'; output?: string; trim?: TrimSize; fontDir?: string; coverFontDir?: string }

/** The Story Book or World Codex as a file, into <book>/exports/ unless another path is given. */
export async function exportBook(dir: string, o: ExportOptions): Promise<Obj> {
  const world = await loadWorld(dir);
  if (o.kind === 'codex' && o.format !== 'pdf') throw new Error('The World Codex is made as a PDF; only the Story Book can also be a Word file or an e-book.');
  const name = `${world.manifest.id}-${o.kind === 'codex' ? 'codex' : 'book'}.${o.format}`;
  let file = o.output?.trim() ? resolve(o.output.trim()) : join(dir, 'exports', name);
  if (o.output?.trim() && !extname(file)) file = join(file, name);
  await mkdir(dirname(file), { recursive: true });
  const doc = o.kind === 'codex' ? worldCodex(world) : storyBook(world, o.trim ? { trim: o.trim } : {});
  if (o.format === 'docx') {
    const r = await writeDocx(doc, dir, file);
    return { file: r.docx };
  }
  if (o.format === 'epub') {
    const author = world.manifest.book?.author?.trim();
    const r = await writeEpub(doc, dir, file, { id: world.manifest.id, ...(author ? { author } : {}) });
    return { file: r.epub, chapters: r.chapters, pictures: r.pictures, ...(r.notes.length ? { notes: r.notes } : {}) };
  }
  const r = await writePublication(doc, dir, file, o.fontDir, o.coverFontDir);
  return { file: r.pdf, markdownCopy: r.md, pages: r.pages, ...(r.notes.length ? { notes: r.notes } : {}) };
}
