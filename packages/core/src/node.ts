/** Node-only helpers for reading and writing world folders. The main entry point stays free of fs. */
import { chmod, copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import { INTENDED_FILE, MANIFEST_FILE, parseWorld, serializeEntry, serializeIntended, serializeManifest, entryPath, type WorldFile } from './parse.ts';
import { SCHEMA_VERSION, TYPE_FOLDERS, type Entry, type IntendedMark, type StoryChapter, type StoryIgnore, type World, type WorldManifest, type WorldCoverSettings } from './types.ts';
import { serializeChapter, serializeStoryIgnored, STORY_FOLDER, STORY_IGNORED_FILE } from './story.ts';
import { coverSeed } from './cover.ts';

/** Read world.json, intended.json, story-ignored.json and every Markdown file in the type folders and story/. */
export async function readWorldFiles(dir: string): Promise<WorldFile[]> {
  const files: WorldFile[] = [];
  for (const name of [MANIFEST_FILE, INTENDED_FILE, STORY_IGNORED_FILE]) {
    try {
      files.push({ path: name, content: await readFile(join(dir, name), 'utf8') });
    } catch {
      /* optional, or reported by parseWorld */
    }
  }
  for (const folder of [...Object.values(TYPE_FOLDERS), STORY_FOLDER]) {
    let names: string[];
    try {
      names = (await readdir(join(dir, folder), { recursive: true })) as string[];
    } catch {
      continue;
    }
    for (const n of names.filter((x) => x.endsWith('.md'))) {
      const full = join(dir, folder, n);
      files.push({ path: relative(dir, full).split(sep).join('/'), content: await readFile(full, 'utf8') });
    }
  }
  return files;
}

export async function loadWorld(dir: string): Promise<World> {
  return parseWorld(await readWorldFiles(dir));
}

export async function saveEntry(dir: string, entry: Entry, path = entryPath(entry)): Promise<string> {
  const full = join(dir, path);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, serializeEntry(entry), 'utf8');
  return path;
}

export async function saveChapter(dir: string, chapter: StoryChapter): Promise<void> {
  const full = join(dir, chapter.file);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, serializeChapter(chapter), 'utf8');
}

export async function saveStoryIgnored(dir: string, ignored: StoryIgnore[]): Promise<void> {
  await writeFile(join(dir, STORY_IGNORED_FILE), serializeStoryIgnored(ignored), 'utf8');
}

export async function saveIntended(dir: string, intended: IntendedMark[]): Promise<void> {
  await writeFile(join(dir, INTENDED_FILE), serializeIntended(intended), 'utf8');
}

/** Create a new, empty world folder with a default calendar. */
export async function createWorld(dir: string, name: string, opts: { cover?: WorldCoverSettings } = {}): Promise<WorldManifest> {
  const id = worldSlug(name);
  const manifest: WorldManifest = {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    calendar: { eras: [{ id: 'Y', name: 'Year', start: 0 }], defaultEra: 'Y' },
    ...(opts.cover && Object.keys(opts.cover).length ? { cover: opts.cover } : {}),
  };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, MANIFEST_FILE), serializeManifest(manifest), 'utf8');
  await writeFile(join(dir, INTENDED_FILE), serializeIntended([]), 'utf8');
  for (const folder of [...Object.values(TYPE_FOLDERS), 'images']) await mkdir(join(dir, folder), { recursive: true });
  return manifest;
}

/** Folder-safe slug for a world name; also the new world's id. */
export function worldSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world';
}

/** First free folder in `parent` for `name`: slug, slug-2, slug-3, ... */
export function uniqueWorldDir(parent: string, name: string): string {
  const slug = worldSlug(name);
  for (let i = 1; ; i++) {
    const dir = join(parent, i === 1 ? slug : `${slug}-${i}`);
    if (!existsSync(dir)) return dir;
  }
}

/**
 * Copy a whole world folder (entries, story, images, models, cover) into a new, unique folder in `parent`,
 * with a new name and world id. The source is only read, so read-only worlds (like the bundled sample) work.
 * Returns the new folder.
 */
export async function duplicateWorld(src: string, parent: string, name: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(src, MANIFEST_FILE), 'utf8')) as WorldManifest;
  const clean = name.trim() || `${manifest.name} (copy)`;
  const dest = uniqueWorldDir(parent, clean);
  await mkdir(parent, { recursive: true });
  await cp(src, dest, { recursive: true, errorOnExist: true, force: false, filter: (f) => !['.git', '.trash'].includes(basename(f)) });
  await makeWritable(dest);
  // Only the name and id change. The cover keeps every setting, and what its generated colours, emblem and stars
  // come from (the original's id, unless it was a copy itself), so the copy looks exactly like the original.
  const cover = { ...manifest.cover, seed: coverSeed(manifest) };
  await writeFile(join(dest, MANIFEST_FILE), serializeManifest({ ...manifest, id: basename(dest), name: clean, cover }), 'utf8');
  return dest;
}

/** Copies of files from a read-only install keep their read-only mode; give the owner write access back. */
async function makeWritable(dir: string): Promise<void> {
  await chmod(dir, 0o755);
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, d.name);
    if (d.isDirectory()) await makeWritable(full);
    else if (d.isFile()) await chmod(full, 0o644);
  }
}

/** 3D model files an entry can hold: glTF binary or embedded glTF, plus OBJ and FBX. */
export const MODEL_EXTS = ['.glb', '.gltf', '.obj', '.fbx'] as const;
export const MODELS_FOLDER = 'models';

export interface ModelFile {
  /** Path relative to the world folder, e.g. models/char-pip/pip.glb */
  file: string;
  /** Display name: the file name without its extension. */
  name: string;
  bytes: number;
}

const ENTRY_ID = /^[a-z0-9][a-z0-9-]*$/;

function modelDir(dir: string, entryId: string): string {
  if (!ENTRY_ID.test(entryId)) throw new Error(`Not an entry id: ${entryId}`);
  return join(dir, MODELS_FOLDER, entryId);
}

/** A model's file name from a display name: no path parts, no odd characters. */
function modelFileName(name: string, ext: string): string {
  const base = name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, ' ') || 'model';
  return `${base}${ext}`;
}

function isModel(file: string): boolean {
  return (MODEL_EXTS as readonly string[]).includes(extname(file).toLowerCase());
}

/** Models of one entry, sorted by name. The models folder is optional: none means []. */
export async function listModels(dir: string, entryId: string): Promise<ModelFile[]> {
  const folder = modelDir(dir, entryId);
  if (!existsSync(folder)) return [];
  const out: ModelFile[] = [];
  for (const d of await readdir(folder, { withFileTypes: true })) {
    if (!d.isFile() || !isModel(d.name)) continue;
    out.push({ file: `${MODELS_FOLDER}/${entryId}/${d.name}`, name: d.name.slice(0, -extname(d.name).length), bytes: (await stat(join(folder, d.name))).size });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Free file name in a folder: "name.ext", then "name 2.ext", ... */
function freeName(folder: string, base: string, ext: string): string {
  for (let i = 1; ; i++) {
    const f = `${base}${i === 1 ? '' : ` ${i}`}${ext}`;
    if (!existsSync(join(folder, f))) return f;
  }
}

/** Copy a model file into models/<entry-id>/. Returns its path relative to the world folder. */
export async function importModel(dir: string, entryId: string, source: string, name = basename(source, extname(source))): Promise<string> {
  const ext = extname(source).toLowerCase();
  if (!isModel(source)) throw new Error(`3D models must be ${MODEL_EXTS.join(', ')} files.`);
  if (ext === '.gltf') gltfMustBeEmbedded(await readFile(source, 'utf8'));
  const folder = modelDir(dir, entryId);
  await mkdir(folder, { recursive: true });
  const file = freeName(folder, modelFileName(name, ''), ext);
  await copyFile(source, join(folder, file));
  return `${MODELS_FOLDER}/${entryId}/${file}`;
}

/** A .gltf is copied alone, so its buffers and textures must be inside it (data: URIs); otherwise ask for a .glb. */
export function gltfMustBeEmbedded(json: string): void {
  let gltf: { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  try {
    gltf = JSON.parse(json) as typeof gltf;
  } catch {
    throw new Error('That .gltf file is not valid glTF JSON.');
  }
  const outside = [...(gltf.buffers ?? []), ...(gltf.images ?? [])].find((b) => b.uri && !b.uri.startsWith('data:'));
  if (outside) throw new Error(`That .gltf needs a separate file (${outside.uri}). Export it as .glb or as embedded .gltf instead.`);
}

/** Check that `file` is a model inside models/<entry-id>/ of this world. Returns its full path. */
function modelPath(dir: string, file: string): string {
  const parts = file.split('/');
  if (parts.length !== 3 || parts[0] !== MODELS_FOLDER || !ENTRY_ID.test(parts[1]!) || !isModel(parts[2]!) || parts[2]!.startsWith('.')) throw new Error(`Not a model file: ${file}`);
  return join(dir, ...parts);
}

/** Rename a model; keeps its extension. Returns the new path relative to the world folder. */
export async function renameModel(dir: string, file: string, name: string): Promise<string> {
  const from = modelPath(dir, file);
  const [, entryId, old] = file.split('/') as [string, string, string];
  const ext = extname(old).toLowerCase();
  const wanted = modelFileName(name, ext);
  if (wanted === old) return file;
  const next = freeName(join(dir, MODELS_FOLDER, entryId), wanted.slice(0, -ext.length), ext);
  await rename(from, join(dir, MODELS_FOLDER, entryId, next));
  return `${MODELS_FOLDER}/${entryId}/${next}`;
}

/** Delete a model file. */
export async function deleteModel(dir: string, file: string): Promise<void> {
  await rm(modelPath(dir, file), { force: true });
}

/** Read a model file's bytes (for the viewer). */
export async function readModel(dir: string, file: string): Promise<Buffer> {
  return readFile(modelPath(dir, file));
}
