/**
 * Changes made outside the app (an AI assistant through `lore mcp`, a text editor, git) while the user's own edits
 * are still waiting to be saved. A three-way merge keeps both: against what both sides started from (the file as the
 * app last read or wrote it), each side keeps what only it changed, and where both changed the same field, the
 * user's edit wins. Files the user is not editing simply take what is on disk.
 */
import { parseChapter, parseEntry, parseIntended, parseStoryIgnored, sortChapters, type Entry, type IntendedMark, type StoryChapter, type StoryIgnore, type World } from '@lore-forge/core';

type Value = unknown;
const isObj = (v: Value): v is Record<string, Value> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep equality for parsed file contents; key order and undefined keys do not count. */
export function same(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => same(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => same(a[k], b[k]));
  }
  return false;
}

/** One value: a side that left it as it was takes the other side's change; if both changed it, ours wins. Objects merge key by key. */
export function merge3<T>(base: T | undefined, ours: T | undefined, theirs: T | undefined): T | undefined {
  if (same(ours, base)) return theirs;
  if (same(theirs, base) || same(ours, theirs)) return ours;
  if (isObj(base) && isObj(ours) && isObj(theirs)) {
    const out: Record<string, Value> = {};
    for (const k of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
      const v = merge3(base[k], ours[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    }
    return out as T;
  }
  return ours;
}

/** Lists of records with a key (intended marks, ignored proposals): additions and removals from both sides are kept. */
export function mergeKeyed<T>(base: readonly T[], ours: readonly T[], theirs: readonly T[], key: (t: T) => string): T[] {
  const b = new Map(base.map((t) => [key(t), t]));
  const o = new Map(ours.map((t) => [key(t), t]));
  const th = new Map(theirs.map((t) => [key(t), t]));
  const out: T[] = [];
  for (const k of new Set([...o.keys(), ...th.keys(), ...b.keys()])) {
    const v = merge3(b.get(k), o.get(k), th.get(k));
    if (v !== undefined) out.push(v);
  }
  return out;
}

export interface LiveMerge {
  world: World;
  /** Entries, chapters and lists that mix the user's and the outside edits: they are written again. */
  rewrite: { entries: Entry[]; chapters: StoryChapter[]; intended: boolean; ignored: boolean };
}

/**
 * The world after files changed on disk. `cur` is what the app shows (with unsaved edits), `fresh` the world read
 * again, `changed` the paths that changed outside the app, `unsaved` the paths with edits not written yet, and
 * `base` gives a file's content as the app last read or wrote it.
 */
export function mergeLive(cur: World, fresh: World, changed: ReadonlySet<string>, unsaved: ReadonlySet<string>, base: (path: string) => string | undefined): LiveMerge {
  const rewrite: LiveMerge['rewrite'] = { entries: [], chapters: [], intended: false, ignored: false };
  const curById = new Map(cur.entries.map((e) => [e.id, e]));
  const freshById = new Map(fresh.entries.map((e) => [e.id, e]));
  const entries: Entry[] = [];
  const files: Record<string, string> = {};
  for (const id of new Set([...curById.keys(), ...freshById.keys()])) {
    const ours = curById.get(id);
    const theirs = freshById.get(id);
    const path = cur.files[id] ?? fresh.files[id]!;
    let next: Entry | undefined;
    if (!changed.has(path) && !(theirs && changed.has(fresh.files[id]!))) next = ours ?? theirs;
    else if (ours && unsaved.has(path)) {
      // Edited here and changed outside: both edits stay. Deleted outside while being edited: the edit wins.
      const was = base(path);
      const merged = theirs ? (merge3<Entry>(was ? parseEntry(was).entry : undefined, ours, theirs) ?? ours) : ours;
      next = merged;
      if (!same(merged, theirs)) rewrite.entries.push(merged);
    } else next = theirs;
    if (!next) continue;
    entries.push(next);
    files[id] = theirs && !ours ? fresh.files[id]! : path;
  }
  entries.sort((a, b) => files[a.id]!.localeCompare(files[b.id]!));

  const curCh = new Map((cur.story ?? []).map((c) => [c.file, c]));
  const freshCh = new Map((fresh.story ?? []).map((c) => [c.file, c]));
  const story: StoryChapter[] = [];
  for (const file of new Set([...curCh.keys(), ...freshCh.keys()])) {
    const ours = curCh.get(file);
    const theirs = freshCh.get(file);
    let next: StoryChapter | undefined;
    if (!changed.has(file)) next = ours ?? theirs;
    else if (ours && unsaved.has(file)) {
      const was = base(file);
      const merged = theirs ? (merge3<StoryChapter>(was ? parseChapter(was, file).chapter : undefined, ours, theirs) ?? ours) : ours;
      next = merged;
      if (!same(merged, theirs)) rewrite.chapters.push(merged);
    } else next = theirs;
    if (next) story.push(next);
  }

  const list = <T,>(file: string, ours: readonly T[], theirs: readonly T[], read: (text: string) => readonly T[], key: (t: T) => string): { value: T[]; again: boolean } => {
    if (!changed.has(file)) return { value: [...ours], again: false };
    if (!unsaved.has(file)) return { value: [...theirs], again: false };
    const was = base(file);
    const value = mergeKeyed(was ? read(was) : [], ours, theirs, key);
    return { value, again: !same(value, theirs) };
  };
  const intended = list<IntendedMark>('intended.json', cur.intended, fresh.intended, (t) => parseIntended(t).intended, (m) => m.warningId);
  const ignored = list<StoryIgnore>('story-ignored.json', cur.storyIgnored ?? [], fresh.storyIgnored ?? [], (t) => parseStoryIgnored(t).ignored, (i) => i.key);
  rewrite.intended = intended.again;
  rewrite.ignored = ignored.again;

  const world: World = {
    ...cur,
    manifest: changed.has('world.json') ? fresh.manifest : cur.manifest,
    entries,
    files,
    issues: fresh.issues,
    intended: intended.value,
    story: sortChapters(story),
    storyIgnored: ignored.value,
  };
  return { world, rewrite };
}
