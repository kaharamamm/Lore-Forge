/** Node-only helpers for reading and writing world folders. The main entry point stays free of fs. */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { INTENDED_FILE, MANIFEST_FILE, parseWorld, serializeEntry, serializeIntended, serializeManifest, entryPath, type WorldFile } from './parse.ts';
import { SCHEMA_VERSION, TYPE_FOLDERS, type Entry, type IntendedMark, type World, type WorldManifest } from './types.ts';

/** Read world.json, intended.json and every Markdown file in the type folders. */
export async function readWorldFiles(dir: string): Promise<WorldFile[]> {
  const files: WorldFile[] = [];
  for (const name of [MANIFEST_FILE, INTENDED_FILE]) {
    try {
      files.push({ path: name, content: await readFile(join(dir, name), 'utf8') });
    } catch {
      /* optional, or reported by parseWorld */
    }
  }
  for (const folder of Object.values(TYPE_FOLDERS)) {
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

export async function saveIntended(dir: string, intended: IntendedMark[]): Promise<void> {
  await writeFile(join(dir, INTENDED_FILE), serializeIntended(intended), 'utf8');
}

/** Create a new, empty world folder with a default calendar. */
export async function createWorld(dir: string, name: string): Promise<WorldManifest> {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world';
  const manifest: WorldManifest = {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    calendar: { eras: [{ id: 'Y', name: 'Year', start: 0 }], defaultEra: 'Y' },
  };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, MANIFEST_FILE), serializeManifest(manifest), 'utf8');
  await writeFile(join(dir, INTENDED_FILE), serializeIntended([]), 'utf8');
  for (const folder of [...Object.values(TYPE_FOLDERS), 'images']) await mkdir(join(dir, folder), { recursive: true });
  return manifest;
}
