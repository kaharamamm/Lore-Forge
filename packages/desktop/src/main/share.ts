/**
 * A book as one file, to send to someone or keep as a backup. A .loreforge file is a zip of the book's folder (the
 * files the book history keeps: no exports, hidden or temporary files) inside one folder named after the book, so
 * any zip tool can open it too. Opening one puts a copy of the book in a free folder of the worlds folder, with its
 * own id and the same cover.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { coverSeed, localize, parseManifest, serializeManifest, type WorldManifest } from '@lore-forge/core';
import { uniqueWorldDir, worldSlug } from '@lore-forge/core/node';
import { bookFiles } from './history.ts';
import { language, t } from '../shared/i18n.ts';
import { TR_CORE } from '../shared/locales/tr/index.ts';

/** Core's own messages (a world.json problem) in the app's language. */
const said = (text: string): string => (language() === 'en' ? text : localize(text, TR_CORE));

export const BOOK_FILE_EXT = 'loreforge';
/** Already compressed: stored as they are, which is as small and much faster. */
const STORED = /\.(png|jpe?g|webp|gif|glb|fbx|zip|mp3|ogg|mp4|webm|woff2?)$/i;
/** The most a book file may hold, against a broken or hostile file: files, and bytes once unpacked. */
export const MAX_FILES = 50_000;
export const MAX_BYTES = 8 * 1024 ** 3;

/** Packs the book in `dir` into the book file `file` (written next to it first, then put in place). */
export async function packBook(dir: string, file: string): Promise<{ files: number; bytes: number }> {
  const manifest = JSON.parse(await readFile(join(dir, 'world.json'), 'utf8')) as { name?: unknown };
  const top = worldSlug(typeof manifest.name === 'string' ? manifest.name : '');
  const files: string[] = [];
  for await (const rel of bookFiles(dir)) files.push(rel);
  files.sort();
  const tmp = `${file}.${process.pid}.tmp`;
  const out = createWriteStream(tmp);
  const written = new Promise<void>((ok, fail) => { out.on('finish', ok); out.on('error', fail); });
  const state: { error: Error | null } = { error: null };
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      state.error = err;
      out.destroy(err);
      return;
    }
    out.write(chunk);
    if (final) out.end();
  });
  try {
    for (const rel of files) {
      const name = `${top}/${rel}`;
      const entry = STORED.test(rel) ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
      zip.add(entry);
      entry.push(await readFile(join(dir, rel)), true);
      if (state.error) throw state.error;
    }
    zip.end();
    await written;
    if (state.error) throw state.error;
    await rename(tmp, file);
  } catch (e) {
    out.destroy();
    await rm(tmp, { force: true });
    throw e;
  }
  return { files: files.length, bytes: (await stat(file)).size };
}

/**
 * A file's path inside the book, or null for what is not unpacked: folders, files outside the book's folder in the
 * zip, hidden files, and any path that could reach outside the folder it goes into.
 */
export function bookPath(name: string, top: string): string | null {
  const n = name.replace(/\\/g, '/');
  if (!n.startsWith(top) || n.endsWith('/')) return null;
  const parts = n.slice(top.length).split('/');
  if (parts.some((p) => !p || p === '.' || p === '..' || p.startsWith('.') || /[:*?"<>|\u0000-\u001f]/.test(p))) return null;
  return parts.join('/');
}

/** Reads a zip file once, in chunks. `pick` says for each file whether to read it, and gets its whole content. */
async function readZip(file: string, pick: (name: string) => ((data: Uint8Array) => void) | null): Promise<void> {
  const state: { error: Error | null; files: number; bytes: number } = { error: null, files: 0, bytes: 0 };
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (f) => {
    if (++state.files > MAX_FILES) {
      state.error ??= new Error(t('This book file holds too many files to open.'));
      return;
    }
    const take = pick(f.name);
    if (!take) return;
    const parts: Uint8Array[] = [];
    f.ondata = (err, data, final) => {
      if (err) {
        state.error ??= err;
        return;
      }
      state.bytes += data.length;
      if (state.bytes > MAX_BYTES) {
        state.error ??= new Error(t('This book file is too large to open.'));
        f.terminate();
        return;
      }
      parts.push(data);
      if (final) take(parts.length === 1 ? parts[0]! : Buffer.concat(parts));
    };
    f.start();
  };
  try {
    for await (const chunk of createReadStream(file)) {
      unzip.push(chunk as Uint8Array);
      if (state.error) throw state.error;
    }
    unzip.push(new Uint8Array(0), true);
  } catch (e) {
    throw state.error ?? new Error(t('This file is not a Lore-Forge book file, or it is damaged ({error}).', { error: (e as Error).message }));
  }
  if (state.error) throw state.error;
}

/**
 * Opens a book file: its book goes into a new folder in `parent`, named after the book (a free name), with an id of its
 * own and the same cover as in the file. Returns the folder and the book's name.
 */
export async function unpackBook(file: string, parent: string): Promise<{ dir: string; name: string }> {
  // First the book's world.json: where the book is in the file, and its name.
  let top: string | null = null;
  let text = '';
  await readZip(file, (name) => {
    const m = top === null ? /^(?:([^/]+)\/)?world\.json$/.exec(name.replace(/\\/g, '/')) : null;
    if (!m) return null;
    top = m[1] ? `${m[1]}/` : '';
    return (data) => { text = Buffer.from(data).toString('utf8'); };
  });
  if (top === null) throw new Error(t('This file is not a Lore-Forge book: it has no world.json.'));
  const parsed = parseManifest(text);
  if (!parsed.manifest) throw new Error(t('The book in this file cannot be opened: {error}', { error: parsed.problems.map(said).join(' ') }));
  const manifest = JSON.parse(text) as WorldManifest;
  await mkdir(parent, { recursive: true });
  const dir = uniqueWorldDir(parent, manifest.name);
  const root = resolve(dir);
  // Then every file of the book, written one after the other.
  let writing: Promise<void> = Promise.resolve();
  const from = top as string;
  try {
    await mkdir(dir);
    await readZip(file, (name) => {
      const rel = bookPath(name, from);
      if (!rel || rel === 'world.json') return null;
      const target = resolve(dir, ...rel.split('/'));
      if (!target.startsWith(root + sep)) return null;
      return (data) => {
        writing = writing.then(async () => {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, data);
        });
      };
    });
    await writing;
    // Its own id, so two copies of a book never share one; the cover keeps what its look comes from.
    const cover = { ...manifest.cover, seed: coverSeed(manifest) };
    await writeFile(join(dir, 'world.json'), serializeManifest({ ...manifest, id: basename(dir), cover }), 'utf8');
  } catch (e) {
    await writing.catch(() => {});
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
    throw e;
  }
  return { dir, name: manifest.name };
}

/** The book files among the arguments Lore-Forge was started with: what the file manager asked it to open. */
export function bookFileArgs(args: readonly string[], cwd = process.cwd()): string[] {
  return args.filter((a) => !a.startsWith('-') && /\.loreforge$/i.test(a)).map((a) => resolve(cwd, a)).filter((a) => existsSync(a));
}

/** SHA-256 of a file's bytes, read in chunks. */
async function fileHash(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

/**
 * Opens a book file onto the shelf once: the same file opened again (the same bytes, from wherever) opens the book it
 * gave the first time, while that book is still there, instead of making another copy. `known` is the small JSON file
 * that remembers which file gave which book.
 */
export async function openBook(file: string, parent: string, known: string): Promise<{ dir: string; name: string }> {
  const key = await fileHash(file);
  let seen: Record<string, string> = {};
  try {
    const raw = JSON.parse(await readFile(known, 'utf8')) as unknown;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) seen = Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch { /* nothing opened yet */ }
  const before = seen[key];
  if (before && existsSync(join(before, 'world.json'))) {
    try {
      const name = (JSON.parse(await readFile(join(before, 'world.json'), 'utf8')) as { name?: unknown }).name;
      return { dir: before, name: typeof name === 'string' ? name : basename(before) };
    } catch { /* that book cannot be read now: a new copy */ }
  }
  const book = await unpackBook(file, parent);
  delete seen[key];
  seen[key] = book.dir;
  await mkdir(dirname(known), { recursive: true });
  // The last few hundred book files are plenty to remember.
  await writeFile(known, JSON.stringify(Object.fromEntries(Object.entries(seen).slice(-300)), null, 1) + '\n', 'utf8');
  return book;
}
