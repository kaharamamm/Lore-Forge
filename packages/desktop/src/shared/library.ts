/**
 * Which worlds the library shelf shows, and which recent folders are worth keeping. Pure, so it is tested without
 * Electron (test/library.test.ts); main.ts gives it the folders and reads world.json for it.
 */

/** A world's id and name from its world.json. */
export interface WorldInfo { id: string; name: string }

export interface ShelfSources {
  /** recent-worlds.json, newest first. */
  recents: string[];
  /** World folders in the worlds folder. */
  inRoot: string[];
  /** The sample world that comes with the running app (the install's copy, or worlds/camelamamm from source). */
  sample: string | null;
  /** The running app's own resources folder when packaged, so its sample is not taken for another install's. */
  ownResources: string | null;
  /** Settings "Show sample world" is off. */
  hideSample: boolean;
  /** The folder has a world.json. */
  exists: (dir: string) => boolean;
  /** id and name from the folder's world.json, or null when it cannot be read. */
  info: (dir: string) => WorldInfo | null;
  /** Absolute, normalised path (path.resolve). */
  resolve: (dir: string) => string;
}

/** A world inside some app's resources/worlds folder: the sample of an install. */
const INSTALL_SAMPLE = /[\\/]resources[\\/]worlds[\\/][^\\/]+[\\/]?$/i;
const sameOrInside = (dir: string, root: string) => {
  const a = dir.replace(/[\\/]+$/, ''), b = root.replace(/[\\/]+$/, '');
  return a === b || a.startsWith(`${b}/`) || a.startsWith(`${b}\\`);
};

/** The sample of another install (an older version, a moved or unpacked copy): not this app's own. */
export function otherInstallSample(dir: string, ownResources: string | null): boolean {
  return INSTALL_SAMPLE.test(dir) && !(ownResources && sameOrInside(dir, ownResources));
}

/**
 * The shelf: recent worlds first, then the worlds folder, then the sample. One book per world: the same folder
 * once, and only one Camelamamm, the running app's own sample (with the current pictures), never a copy of the
 * sample left by another install or an older version (same id and name). Copies made with Duplicate get a new
 * id, so they stay. The sample is left out when "Show sample world" is off.
 * `recents` is the recent list to keep: folders that still exist, without other installs' samples.
 */
export function planShelf(src: ShelfSources): { shelf: string[]; recents: string[] } {
  const seen = new Set<string>();
  const recents: string[] = [];
  for (const d of src.recents) {
    const r = src.resolve(d);
    if (seen.has(r) || !src.exists(r) || otherInstallSample(r, src.ownResources)) continue;
    seen.add(r);
    recents.push(d);
  }
  const sample = src.sample ? src.resolve(src.sample) : null;
  const sampleInfo = sample ? src.info(sample) : null;
  const isStaleSample = (d: string) => {
    if (d === sample) return false;
    if (otherInstallSample(d, src.ownResources)) return true;
    const i = sampleInfo && src.info(d);
    return !!i && !!sampleInfo && i.id === sampleInfo.id && i.name === sampleInfo.name;
  };
  const shelf: string[] = [];
  const listed = new Set<string>();
  for (const d of [...recents, ...src.inRoot, ...(sample ? [sample] : [])]) {
    const r = src.resolve(d);
    if (listed.has(r)) continue;
    listed.add(r);
    if (r === sample ? src.hideSample : isStaleSample(r)) continue;
    shelf.push(r);
  }
  return { shelf, recents };
}

/** How a book leaves the library: the app's own sample is only taken off the shelf; any other folder goes to the trash. */
export type RemoveKind = 'hide' | 'trash';
export const removeKind = (dir: string, sample: string | null): RemoveKind => (sample && dir === sample ? 'hide' : 'trash');

/**
 * The shelf in the order the user arranged it (Library drag and drop, Alt+Arrow keys), saved in settings.json as
 * world folder paths. Books in the saved order keep it; books not in it (new worlds, worlds added elsewhere) go
 * after them, in the shelf's own order (recent first). Saved folders that are gone are skipped.
 */
export function orderShelf(shelf: readonly string[], order: readonly string[] | undefined): string[] {
  if (!order?.length) return [...shelf];
  const rank = new Map<string, number>();
  for (const d of order) if (!rank.has(d)) rank.set(d, rank.size);
  const known = shelf.filter((d) => rank.has(d)).sort((a, b) => rank.get(a)! - rank.get(b)!);
  return [...known, ...shelf.filter((d) => !rank.has(d))];
}

/** `key` taken out of the shelf and put back at `to`, an index into the shelf without it (clamped). */
export function moveBook(shelf: readonly string[], key: string, to: number): string[] {
  if (!shelf.includes(key)) return [...shelf];
  const rest = shelf.filter((d) => d !== key);
  const at = Math.max(0, Math.min(Math.round(to), rest.length));
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}

/** The shelf with `copy` right after `original` (a Duplicate sits next to the book it was made from). */
export function placeAfter(shelf: readonly string[], original: string, copy: string): string[] {
  const rest = shelf.filter((d) => d !== copy);
  const i = rest.indexOf(original);
  return i < 0 ? [...rest, copy] : [...rest.slice(0, i + 1), copy, ...rest.slice(i + 1)];
}

/** A saved shelf order as settings.json keeps it: strings only, each folder once, a sane length. */
export function cleanOrder(order: unknown): string[] | undefined {
  if (!Array.isArray(order)) return undefined;
  const out = [...new Set(order.filter((d): d is string => typeof d === 'string' && d.length > 0 && d.length < 4096))].slice(0, 10_000);
  return out.length ? out : undefined;
}
