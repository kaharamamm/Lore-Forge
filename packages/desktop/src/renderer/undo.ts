/**
 * Undo and redo in the entry editor (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z): every change to an entry, whatever made it
 * (a status pill, a list choice, a picture, a row added or removed, typing), is one step. Pure, so it is tested
 * without the app (test/undo.test.ts).
 *
 * A step keeps only what it changed: the paths it touched (top-level fields, and single fields inside details,
 * visual, picture and extra) with their values before and after. Undo puts back a path only while it still holds
 * the value the step left, so a change made since, by an AI assistant or an editor outside the app, is never undone
 * by accident. Typing in one field is one step until a pause.
 */
import type { Entry } from '@lore-forge/core';

export interface EditStep {
  /** "status", "body", "details.gender", "visual.appearance", ... */
  paths: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** The key order of each nested object (details, visual, ...) before the step, so undo puts fields back in place. */
  order: Record<string, string[]>;
  /** When the step began, and when it last grew (typing). */
  started: number;
  at: number;
}

export interface EntryHistory {
  undo: readonly EditStep[];
  redo: readonly EditStep[];
}

export const EMPTY_HISTORY: EntryHistory = { undo: [], redo: [] };

/** Typing in the same field joins the step before it, unless there was a pause this long (ms)... */
export const MERGE_MS = 1000;
/** ...or the step is this old (ms): long typing still comes back in pieces. */
export const MERGE_MAX_MS = 8000;
/** Steps kept per entry. */
export const MAX_STEPS = 200;

/** Fields whose values are plain objects of single fields: their fields are undone one by one. */
const NESTED = new Set(['details', 'visual', 'picture', 'extra']);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
/** Equal values; text is compared as it is (typing in a long body text must not turn it into JSON every keystroke). */
const same = (a: unknown, b: unknown): boolean => a === b || (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

/** The paths whose values differ between two versions of an entry. */
export function changedPaths(a: Entry, b: Entry): string[] {
  const x = a as unknown as Obj;
  const y = b as unknown as Obj;
  const out: string[] = [];
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const u = x[k];
    const v = y[k];
    if (u === v) continue;
    if (NESTED.has(k) && (isObj(u) || u === undefined) && (isObj(v) || v === undefined)) {
      const p = (u ?? {}) as Obj;
      const q = (v ?? {}) as Obj;
      for (const s of new Set([...Object.keys(p), ...Object.keys(q)])) if (!same(p[s], q[s])) out.push(`${k}.${s}`);
    } else if (!same(u, v)) out.push(k);
  }
  return out;
}

export function getPath(e: Entry, path: string): unknown {
  const dot = path.indexOf('.');
  const o = e as unknown as Obj;
  if (dot < 0) return o[path];
  const inner = o[path.slice(0, dot)];
  return isObj(inner) ? inner[path.slice(dot + 1)] : undefined;
}

/**
 * The entry with these paths set (undefined removes a field; a nested object left empty goes). Fields restored into
 * a nested object take their old places from `order`.
 */
function setPaths(e: Entry, values: Record<string, unknown>, order: Record<string, string[]>): Entry {
  const o: Obj = { ...(e as unknown as Obj) };
  const nested = new Map<string, Obj>();
  for (const [path, v] of Object.entries(values)) {
    const dot = path.indexOf('.');
    if (dot < 0) {
      if (v === undefined) delete o[path];
      else o[path] = v;
      continue;
    }
    const parent = path.slice(0, dot);
    let inner = nested.get(parent);
    if (!inner) nested.set(parent, (inner = { ...(isObj(o[parent]) ? (o[parent] as Obj) : {}) }));
    const key = path.slice(dot + 1);
    if (v === undefined) delete inner[key];
    else inner[key] = v;
  }
  for (const [parent, inner] of nested) {
    const keys = Object.keys(inner);
    if (!keys.length) {
      delete o[parent];
      continue;
    }
    const was = order[parent] ?? [];
    const sorted = [...was.filter((k) => k in inner), ...keys.filter((k) => !was.includes(k))];
    o[parent] = Object.fromEntries(sorted.map((k) => [k, inner[k]]));
  }
  return o as unknown as Entry;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The history after an edit from `before` to `after`: a new step, or the last step grown when the edit touches the
 * same fields soon after it (typing). Nothing changes for an edit that changes nothing. Redo is cleared.
 */
export function record(h: EntryHistory, before: Entry, after: Entry, now: number): EntryHistory {
  const paths = changedPaths(before, after);
  if (!paths.length) return h;
  const last = h.undo[h.undo.length - 1];
  if (last && !h.redo.length && sameSet(last.paths, paths) && now - last.at < MERGE_MS && now - last.started < MERGE_MAX_MS) {
    const grown: EditStep = { ...last, after: Object.fromEntries(paths.map((p) => [p, getPath(after, p)])), at: now };
    // Typed back to where the step began: the step is gone.
    if (paths.every((p) => same(grown.before[p], grown.after[p]))) return { undo: h.undo.slice(0, -1), redo: [] };
    return { undo: [...h.undo.slice(0, -1), grown], redo: [] };
  }
  const order: Record<string, string[]> = {};
  for (const p of paths) {
    const dot = p.indexOf('.');
    if (dot < 0) continue;
    const parent = p.slice(0, dot);
    const inner = (before as unknown as Obj)[parent];
    order[parent] ??= isObj(inner) ? Object.keys(inner) : [];
  }
  const step: EditStep = {
    paths,
    before: Object.fromEntries(paths.map((p) => [p, getPath(before, p)])),
    after: Object.fromEntries(paths.map((p) => [p, getPath(after, p)])),
    order,
    started: now,
    at: now,
  };
  return { undo: [...h.undo, step].slice(-MAX_STEPS), redo: [] };
}

export interface Moved {
  entry: Entry;
  history: EntryHistory;
  step: EditStep;
  /** The paths actually put back (those changed since outside the app are left alone). */
  paths: string[];
}

/**
 * Takes steps off the end of `steps` until one still applies, and sets its paths to their `to` values (before for
 * undo, after for redo). Steps none of whose fields still hold their values were overtaken by changes made outside
 * the app: they are dropped.
 */
function move(current: Entry, steps: readonly EditStep[], to: 'before' | 'after'): { entry: Entry; rest: EditStep[]; step: EditStep; paths: string[] } | null {
  const rest = [...steps];
  while (rest.length) {
    const step = rest.pop()!;
    const now = to === 'before' ? step.after : step.before;
    const paths = step.paths.filter((p) => same(getPath(current, p), now[p]));
    if (!paths.length) continue;
    const values = Object.fromEntries(paths.map((p) => [p, step[to][p]]));
    return { entry: setPaths(current, values, step.order), rest, step, paths };
  }
  return null;
}

/** Undo the last step that still applies: its fields go back to how they were before it. Null when there is none. */
export function undo(h: EntryHistory, current: Entry): Moved | null {
  const m = move(current, h.undo, 'before');
  return m && { entry: m.entry, history: { undo: m.rest, redo: [...h.redo, m.step] }, step: m.step, paths: m.paths };
}

/** Redo the last undone step that still applies. Null when there is none. */
export function redo(h: EntryHistory, current: Entry): Moved | null {
  const m = move(current, h.redo, 'after');
  return m && { entry: m.entry, history: { undo: [...h.undo, m.step], redo: m.rest }, step: m.step, paths: m.paths };
}

/**
 * Where the caret goes in a text after undo or redo turned `from` into `to`: the end of what came back, or where
 * text was taken out.
 */
export function caretAfter(from: string, to: string): number {
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  let j = 0;
  while (j < from.length - i && j < to.length - i && from[from.length - 1 - j] === to[to.length - 1 - j]) j++;
  return to.length - j;
}
