/**
 * Book history: snapshots of a book's files, kept by the app (not in the book folder), so changes can be taken back
 * later: an Ask AI task, one entry, or the whole book. A snapshot lists every file with the hash of its content; each
 * content is stored once (by its hash), so snapshots of a book that hardly changed take almost no room. Plain Node,
 * no Electron: the app passes the folder to keep the history in.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** Why a snapshot was taken. */
export type SnapshotReason = 'open' | 'auto' | 'ask' | 'restore' | 'undo' | 'manual';

/** A file in a snapshot: the hash of its content, its size and when it last changed (to skip hashing it again). */
export interface FileState {
  h: string;
  s: number;
  m: number;
}
export type Manifest = Record<string, FileState>;

export interface SnapshotInfo {
  id: string;
  at: number;
  reason: SnapshotReason;
  /** What it was taken for: the Ask AI message, the item restored. */
  label?: string;
  /** How many files the book had. */
  count: number;
}
interface Snapshot extends SnapshotInfo {
  files: Manifest;
}

/** A file an AI task changed: its content before (none: the task made it) and after (none: the task deleted it). */
export interface TaskFile {
  path: string;
  before?: string;
  after?: string;
}
export interface Task {
  id: string;
  at: number;
  /** The snapshot of the book just before the task. */
  snapshot: string;
  label: string;
  files: TaskFile[];
  /** Entries' names and chapters' titles of the files it changed, from after the task (or before, for one it deleted). */
  names?: Record<string, string>;
  undone?: boolean;
}

/** A difference between a snapshot and the book now. */
export interface Change {
  path: string;
  /** changed: both have it; added: only the book now has it; removed: only the snapshot has it. */
  state: 'changed' | 'added' | 'removed';
  /** An entry's name or a chapter's title, from whichever version has it. */
  name?: string;
}

/** Work under way when an Ask AI task starts: the book's files then, and the files the app itself saved since. */
export interface Pending {
  at: number;
  files: Manifest;
  /** Relative paths (see samePath), as the app wrote them. */
  app: Set<string>;
}

/** A relative path as the file system compares it: Windows does not mind the case of letters. */
export const samePath = (p: string): string => {
  const slashes = p.split('\\').join('/');
  return process.platform === 'win32' ? slashes.toLowerCase() : slashes;
};

/** Snapshots kept per book (the oldest go first), and AI tasks that can still be undone. */
export const KEEP_SNAPSHOTS = 80;
export const KEEP_TASKS = 60;
/** Files larger than this are left out (a huge video or model): the history is for the writing. */
export const MAX_FILE = 100 * 1024 * 1024;

const SKIP_TOP = new Set(['exports', 'node_modules']);
const SKIP_FILE = /\.(tmp|swp|swx|crdownload|part)$|~$|^(thumbs\.db|desktop\.ini)$/i;

/**
 * Every file of a book that the history keeps, as relative paths with /: no hidden files or folders, no exports. A
 * shared book file holds the same files.
 */
export async function* bookFiles(root: string, rel = ''): AsyncGenerator<string> {
  let list;
  try {
    list = await readdir(rel ? join(root, rel) : root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of list) {
    if (d.name.startsWith('.') || (!rel && SKIP_TOP.has(d.name.toLowerCase()))) continue;
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) yield* bookFiles(root, r);
    else if (d.isFile() && !SKIP_FILE.test(d.name)) yield r;
  }
}

const sha = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const newId = (): string => `${Date.now().toString(36).padStart(9, '0')}-${randomBytes(3).toString('hex')}`;
const same = (a: Manifest, b: Manifest): boolean => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k]?.h === a[k]!.h);
};
const info = (s: Snapshot): SnapshotInfo => ({ id: s.id, at: s.at, reason: s.reason, ...(s.label ? { label: s.label } : {}), count: s.count });

/** Written whole: a temporary file next to it, then a rename, so a crash never leaves half a file. */
async function writeWhole(file: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    // A file another program holds open cannot be replaced on Windows: write it in place instead.
    if (existsSync(dirname(file))) await writeFile(file, data);
    else throw e;
  }
}

/** The name or title in a Markdown file's front matter, if it has one. */
export function frontName(text: string): string | undefined {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const m = /^(?:name|title):[ \t]*(.+?)[ \t]*$/m.exec(head);
  return m ? m[1]!.replace(/^(["'])(.*)\1$/, '$2') : undefined;
}

export class BookHistory {
  /** The book folder. */
  readonly dir: string;
  /** Where its history is kept. */
  readonly root: string;
  /** The book's files at the last look: their hashes stay good while size and time stay the same. */
  private known: Manifest = {};
  private chain: Promise<unknown> = Promise.resolve();

  constructor(dir: string, root: string) {
    this.dir = resolve(dir);
    this.root = root;
  }

  /** One thing at a time per book: a snapshot, a restore or an undo never runs into another. */
  private queue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job, job);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private blob(hash: string): string {
    return join(this.root, 'blobs', hash.slice(0, 2), hash);
  }

  /** The book's files now; with `keep`, every content not stored yet is stored. */
  private async scan(keep: boolean): Promise<Manifest> {
    const out: Manifest = {};
    for await (const rel of bookFiles(this.dir)) {
      let st;
      try {
        st = await stat(join(this.dir, rel));
      } catch {
        continue; // gone while we looked
      }
      if (st.size > MAX_FILE) continue;
      const m = Math.round(st.mtimeMs);
      const was = this.known[rel];
      if (was && was.s === st.size && was.m === m && (!keep || existsSync(this.blob(was.h)))) {
        out[rel] = was;
        continue;
      }
      let data;
      try {
        data = await readFile(join(this.dir, rel));
      } catch {
        continue;
      }
      const h = sha(data);
      if (keep && !existsSync(this.blob(h))) await writeWhole(this.blob(h), data);
      out[rel] = { h, s: st.size, m };
    }
    this.known = out;
    return out;
  }

  private async index(): Promise<SnapshotInfo[]> {
    try {
      const list = JSON.parse(await readFile(join(this.root, 'index.json'), 'utf8')) as SnapshotInfo[];
      if (Array.isArray(list)) return list;
    } catch { /* none yet, or unreadable: rebuilt from the snapshots */ }
    const out: SnapshotInfo[] = [];
    try {
      for (const f of await readdir(join(this.root, 'snapshots'))) {
        if (!f.endsWith('.json')) continue;
        try {
          out.push(info(JSON.parse(await readFile(join(this.root, 'snapshots', f), 'utf8')) as Snapshot));
        } catch { /* a broken snapshot is left out */ }
      }
    } catch { /* no snapshots */ }
    return out.sort((a, b) => b.at - a.at);
  }

  private async load(id: string): Promise<Snapshot | null> {
    if (!/^[\w-]+$/.test(id)) return null;
    try {
      return JSON.parse(await readFile(join(this.root, 'snapshots', `${id}.json`), 'utf8')) as Snapshot;
    } catch {
      return null;
    }
  }

  private async save(s: Snapshot): Promise<SnapshotInfo> {
    await writeWhole(join(this.root, 'snapshots', `${s.id}.json`), JSON.stringify(s));
    const list = (await this.index()).filter((x) => x.id !== s.id);
    list.push(info(s));
    list.sort((a, b) => b.at - a.at);
    await writeWhole(join(this.root, 'index.json'), JSON.stringify(list));
    await writeWhole(join(this.root, 'book.json'), JSON.stringify({ dir: this.dir }));
    await this.prune(list);
    return info(s);
  }

  /**
   * Keep the book as it is now. An automatic snapshot (open, auto) is skipped when nothing changed since the last
   * one; the others are always kept, as marks in the history.
   */
  snapshot(reason: SnapshotReason, label?: string): Promise<SnapshotInfo | null> {
    return this.queue(() => this.take(reason, label));
  }

  private async take(reason: SnapshotReason, label?: string, at = Date.now(), files?: Manifest): Promise<SnapshotInfo | null> {
    const now = files ?? (await this.scan(true));
    if (reason === 'open' || reason === 'auto') {
      const last = (await this.index())[0];
      const prev = last && (await this.load(last.id));
      if (prev && same(prev.files, now)) return null;
    }
    return this.save({ id: newId(), at, reason, ...(label ? { label: label.slice(0, 200) } : {}), count: Object.keys(now).length, files: now });
  }

  list(): Promise<SnapshotInfo[]> {
    return this.queue(() => this.index());
  }

  /** What differs between a snapshot and the book now. */
  changes(id: string): Promise<Change[]> {
    return this.queue(async () => {
      const snap = await this.load(id);
      if (!snap) throw new Error('missing snapshot');
      const now = await this.scan(false);
      const out: Change[] = [];
      for (const path of new Set([...Object.keys(snap.files), ...Object.keys(now)])) {
        const a = snap.files[path];
        const b = now[path];
        if (a?.h === b?.h) continue;
        out.push({ path, state: a && b ? 'changed' : b ? 'added' : 'removed' });
      }
      // Names for entries and chapters, from the version that has the file.
      for (const c of out) {
        if (!c.path.endsWith('.md')) continue;
        const text = c.state === 'removed' ? await this.text(snap.files[c.path]!.h) : await readFile(join(this.dir, c.path), 'utf8').catch(() => null);
        const name = text ? frontName(text) : undefined;
        if (name) c.name = name;
      }
      return out.sort((a, b) => a.path.localeCompare(b.path));
    });
  }

  /** The snapshots in which a file differs from the one before (newest first): its versions, and when it was gone. */
  versions(path: string): Promise<(SnapshotInfo & { exists: boolean })[]> {
    return this.queue(async () => {
      const list = (await this.index()).slice().reverse();
      const out: (SnapshotInfo & { exists: boolean })[] = [];
      let last: string | null = null;
      for (const s of list) {
        const snap = await this.load(s.id);
        if (!snap) continue;
        const h = snap.files[path]?.h ?? null;
        // Before the file first existed there is nothing to show; after, its being gone is a version too.
        if (h !== last && (h !== null || out.length)) out.push({ ...s, exists: h !== null });
        last = h;
      }
      return out.reverse();
    });
  }

  private async text(hash: string): Promise<string | null> {
    try {
      return await readFile(this.blob(hash), 'utf8');
    } catch {
      return null;
    }
  }

  /** A text file as a snapshot has it (null: the snapshot does not have it). */
  read(id: string, path: string): Promise<string | null> {
    return this.queue(async () => {
      const h = (await this.load(id))?.files[path]?.h;
      return h ? this.text(h) : null;
    });
  }

  /** Put one file back as a hash has it (or remove it), the way the app writes: whole, never half. */
  private async put(path: string, hash: string | undefined): Promise<void> {
    const full = resolve(this.dir, path);
    const rel = relative(this.dir, full);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`outside the book: ${path}`);
    if (hash) {
      let data;
      try {
        data = await readFile(this.blob(hash));
      } catch {
        throw new Error(`The history no longer has ${path} as it was.`);
      }
      await writeWhole(full, data);
      return;
    }
    await rm(full, { force: true });
    // Folders it leaves empty (a picture's look folder) go too, up to the book folder.
    for (let d = dirname(full); d.length > this.dir.length && d.startsWith(this.dir); d = dirname(d)) {
      try {
        await rmdir(d);
      } catch {
        break;
      }
    }
  }

  /**
   * Put the book (or some of its files) back as a snapshot has it. The book as it is now is kept first, so a restore
   * can be taken back too. Returns the files that changed.
   */
  restore(id: string, paths?: readonly string[], label?: string): Promise<string[]> {
    return this.queue(async () => {
      const snap = await this.load(id);
      if (!snap) throw new Error('missing snapshot');
      const now = await this.scan(true);
      const which = paths ?? [...new Set([...Object.keys(snap.files), ...Object.keys(now)])];
      const todo = which.filter((p) => snap.files[p]?.h !== now[p]?.h);
      if (!todo.length) return [];
      await this.take('restore', label, Date.now(), now);
      for (const p of todo) await this.put(p, snap.files[p]?.h);
      this.known = {};
      return todo;
    });
  }

  /** Before an Ask AI task: the book's files now, their contents kept, so the task can be undone. */
  begin(): Promise<Pending> {
    return this.queue(async () => ({ at: Date.now(), files: await this.scan(true), app: new Set<string>() }));
  }

  /**
   * After an Ask AI task: the files it changed, leaving out those the app itself saved meanwhile (the person at the
   * keyboard). When there are any, the book as it was before is kept as a snapshot and the task recorded.
   */
  finish(p: Pending, label: string): Promise<Task | null> {
    return this.queue(async () => {
      const now = await this.scan(false);
      const files: TaskFile[] = [];
      for (const path of new Set([...Object.keys(p.files), ...Object.keys(now)])) {
        if (p.app.has(samePath(path))) continue;
        const before = p.files[path]?.h;
        const after = now[path]?.h;
        if (before !== after) files.push({ path, ...(before ? { before } : {}), ...(after ? { after } : {}) });
      }
      if (!files.length) return null;
      const snap = await this.take('ask', label, p.at, p.files);
      const names: Record<string, string> = {};
      for (const f of files) {
        if (!f.path.endsWith('.md')) continue;
        const text = f.after ? await readFile(join(this.dir, f.path), 'utf8').catch(() => null) : await this.text(f.before!);
        const name = text ? frontName(text) : undefined;
        if (name) names[f.path] = name;
      }
      const task: Task = { id: newId(), at: Date.now(), snapshot: snap!.id, label: label.slice(0, 200), files: files.sort((a, b) => a.path.localeCompare(b.path)), ...(Object.keys(names).length ? { names } : {}) };
      await writeWhole(join(this.root, 'tasks', `${task.id}.json`), JSON.stringify(task));
      await this.pruneTasks();
      return task;
    });
  }

  private async loadTask(id: string): Promise<Task | null> {
    if (!/^[\w-]+$/.test(id)) return null;
    try {
      return JSON.parse(await readFile(join(this.root, 'tasks', `${id}.json`), 'utf8')) as Task;
    } catch {
      return null;
    }
  }

  /**
   * Take an Ask AI task back: each file it changed goes back as it was before. A file changed again since (by the
   * person, or another task) is a conflict: nothing changes unless `force`. The book as it is now is kept first.
   */
  undo(taskId: string, force = false): Promise<{ conflicts: string[]; changed: string[] }> {
    return this.queue(async () => {
      const task = await this.loadTask(taskId);
      if (!task) throw new Error('missing task');
      if (task.undone) return { conflicts: [], changed: [] };
      const now = await this.scan(true);
      const conflicts = task.files.filter((f) => now[f.path]?.h !== f.after).map((f) => f.path);
      if (conflicts.length && !force) return { conflicts, changed: [] };
      const todo = task.files.filter((f) => now[f.path]?.h !== f.before);
      if (todo.length) await this.take('undo', task.label, Date.now(), now);
      for (const f of todo) await this.put(f.path, f.before);
      this.known = {};
      task.undone = true;
      await writeWhole(join(this.root, 'tasks', `${task.id}.json`), JSON.stringify(task));
      return { conflicts, changed: todo.map((f) => f.path) };
    });
  }

  /** The oldest snapshots past the limit go (a few at a time), and the contents nothing refers to any more. */
  private async prune(list: SnapshotInfo[]): Promise<void> {
    if (list.length <= KEEP_SNAPSHOTS + 10) return;
    const keep = list.slice(0, KEEP_SNAPSHOTS);
    for (const s of list.slice(KEEP_SNAPSHOTS)) await rm(join(this.root, 'snapshots', `${s.id}.json`), { force: true });
    await writeWhole(join(this.root, 'index.json'), JSON.stringify(keep));
    await this.sweep(keep);
  }

  private async pruneTasks(): Promise<void> {
    let names: string[];
    try {
      names = (await readdir(join(this.root, 'tasks'))).filter((f) => f.endsWith('.json')).sort();
    } catch {
      return;
    }
    if (names.length <= KEEP_TASKS + 10) return;
    for (const f of names.slice(0, names.length - KEEP_TASKS)) await rm(join(this.root, 'tasks', f), { force: true });
    await this.sweep(await this.index());
  }

  /** Contents that no kept snapshot or task refers to are deleted. */
  private async sweep(keep: SnapshotInfo[]): Promise<void> {
    const used = new Set<string>();
    for (const s of keep) for (const f of Object.values((await this.load(s.id))?.files ?? {})) used.add(f.h);
    try {
      for (const f of await readdir(join(this.root, 'tasks'))) {
        const task = f.endsWith('.json') ? await this.loadTask(f.slice(0, -5)) : null;
        for (const x of task?.files ?? []) if (x.before) used.add(x.before);
      }
    } catch { /* no tasks */ }
    let dirs: string[];
    try {
      dirs = await readdir(join(this.root, 'blobs'));
    } catch {
      return;
    }
    for (const d of dirs) {
      for (const h of await readdir(join(this.root, 'blobs', d)).catch(() => [] as string[])) {
        if (!used.has(h)) await rm(join(this.root, 'blobs', d, h), { force: true });
      }
    }
  }
}
