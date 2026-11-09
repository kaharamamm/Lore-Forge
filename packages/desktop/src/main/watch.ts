/**
 * Live view of changes made outside the app: an AI assistant writing through `lore mcp`, a text editor, git.
 * The open world's folder and the worlds folder are watched; the app's own writes are recognised and not echoed back.
 */
import { readFileSync, watch, type FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';

const key = (p: string): string => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));

/** Text the app wrote, per file: a change event whose file still holds exactly this text is the app's own. */
const ownText = new Map<string, string>();
/** Files the app copied, moved or deleted, with when: events within a moment of that are its own. */
const touched = new Map<string, number>();
const TOUCH_MS = 3000;

/** Told of every file the app itself writes, copies, moves or deletes (book history: the person's own saves). */
const ownListeners = new Set<(full: string) => void>();
export function onOwnChange(listener: (full: string) => void): () => void {
  ownListeners.add(listener);
  return () => void ownListeners.delete(listener);
}

/** Call just before the app writes a text file. */
export function ownWrite(full: string, content: string): void {
  ownText.set(key(full), content);
  for (const f of ownListeners) f(full);
}
/** Whether `text` is what the app itself last wrote to this file (and nobody else wrote since). */
export function isOwnText(full: string, text: string): boolean {
  return ownText.get(key(full)) === text;
}
/** Call just before the app copies, moves or deletes a file (or folder). */
export function ownTouch(full: string): void {
  touched.set(key(full), Date.now());
  for (const f of ownListeners) f(full);
}

function isOwn(full: string): boolean {
  const k = key(full);
  const t = touched.get(k);
  if (t !== undefined && Date.now() - t < TOUCH_MS) return true;
  const text = ownText.get(k);
  if (text === undefined) return false;
  try {
    if (readFileSync(full, 'utf8') === text) return true;
  } catch { /* gone: not ours to report */ }
  // Someone else wrote it after the app did.
  ownText.delete(k);
  return false;
}

/** Version-control folders, export output, editor temp files and hidden files never count as world changes. */
const SKIP = /(^|\/)(\.git|\.hg|\.svn|exports|node_modules)(\/|$)|(^|\/)\.[^/]*$|~$|\.(tmp|swp|swx|crdownload|part)$/i;

/** Watches a folder tree and reports, after a short quiet spell, which files others changed (paths relative, with /). */
export class FolderWatch {
  readonly dir: string;
  private readonly wanted: (rel: string) => boolean;
  private readonly onChange: (files: string[]) => void;
  private readonly quiet: number;
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly changed = new Set<string>();

  constructor(dir: string, wanted: (rel: string) => boolean, onChange: (files: string[]) => void, quiet = 300) {
    this.dir = dir;
    this.wanted = wanted;
    this.onChange = onChange;
    this.quiet = quiet;
    try {
      this.watcher = watch(dir, { recursive: true }, (_event, name) => this.event(name ? String(name) : ''));
      this.watcher.on('error', () => this.close());
    } catch {
      this.watcher = null; // a folder that is gone or cannot be watched: no live view, nothing breaks
    }
  }

  private event(name: string): void {
    const rel = name.replace(/\\/g, '/');
    if (!rel || SKIP.test(rel) || !this.wanted(rel) || isOwn(join(this.dir, rel))) return;
    this.changed.add(rel);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const files = [...this.changed];
      this.changed.clear();
      this.onChange(files);
    }, this.quiet);
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * The open world: any file in it except 3D models (loaded on demand). Folders are left out: the app makes
 * `story/` and `images/<id>/` itself when it writes the first file there, and the files inside report themselves.
 */
export const worldFiles = (rel: string): boolean => !rel.startsWith('models/') && /\.[^/.]+$/.test(rel);
/** The worlds folder: a book folder appearing or going, or a book's world.json (its name or cover) changing. */
export const libraryFiles = (rel: string): boolean => /^[^/]+(\/world\.json)?$/.test(rel);
