/**
 * Where the user's books are: the same folders the desktop app uses. The app keeps settings.json in its user-data
 * folder (Electron's app.getPath('userData') for the product name "Lore-Forge"); new books go to the folder chosen in
 * Library settings, else <user data>/worlds. Books opened from elsewhere are listed in recent-worlds.json.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { normalizeName } from '@lore-forge/core';

export const APP_NAME = 'Lore-Forge';

export interface LibraryOptions {
  /** The app's user-data folder. Default: the platform's usual place for "Lore-Forge". */
  dataDir?: string;
  /** Where new books go when Library settings chose no folder. Default <dataDir>/worlds. */
  defaultWorldsDir?: string;
  /** The sample world that ships with the app (read-only), if any. */
  sampleDir?: string | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** Electron's userData folder for the app, worked out the same way Electron does. LORE_FORGE_DATA overrides it. */
export function appDataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env['LORE_FORGE_DATA']) return resolve(env['LORE_FORGE_DATA']);
  if (platform === 'win32') return join(env['APPDATA'] || join(homedir(), 'AppData', 'Roaming'), APP_NAME);
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', APP_NAME);
  return join(env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), APP_NAME);
}

/**
 * The app's own resources folder when this runs as the `lore` command inside an installed app
 * (resources/app.asar/dist/cli.cjs), else null. Holds the bundled fonts and the read-only sample world.
 */
export function bundledResources(script: string | undefined = process.argv[1]): string | null {
  if (!script) return null;
  const dist = dirname(script);
  const asar = dirname(dist);
  if (!/app\.asar$/i.test(asar)) return null;
  return dirname(asar);
}

interface Settings {
  worldsDir?: string;
  hideSample?: boolean;
}

export class Library {
  readonly dataDir: string;
  private readonly fallbackWorldsDir: string;
  private readonly sample: string | null;

  constructor(opts: LibraryOptions = {}) {
    const env = opts.env ?? process.env;
    this.dataDir = opts.dataDir ?? appDataDir(env, opts.platform);
    this.fallbackWorldsDir = opts.defaultWorldsDir ?? (env['LORE_FORGE_WORLDS'] ? resolve(env['LORE_FORGE_WORLDS']) : join(this.dataDir, 'worlds'));
    if (opts.sampleDir !== undefined) this.sample = opts.sampleDir;
    else {
      const res = bundledResources();
      const dir = env['LORE_FORGE_SAMPLE'] || (res ? join(res, 'worlds', 'camelamamm') : '');
      this.sample = dir && existsSync(join(dir, 'world.json')) ? resolve(dir) : null;
    }
  }

  private settings(): Settings {
    try {
      return JSON.parse(readFileSync(join(this.dataDir, 'settings.json'), 'utf8')) as Settings;
    } catch {
      return {};
    }
  }

  /** The folder new books go to (Library settings, else the default). */
  worldsDir(): string {
    const chosen = this.settings().worldsDir;
    return chosen ? resolve(chosen) : this.fallbackWorldsDir;
  }

  /** The read-only sample world of the installed app, if it is on the shelf. */
  sampleDir(): string | null {
    return this.sample && !this.settings().hideSample ? this.sample : null;
  }

  /** A book that must not be changed in place: the installed sample. Duplicate it first. */
  isReadOnly(dir: string): boolean {
    return (!!this.sample && resolve(dir) === this.sample) || /[\\/]resources[\\/]worlds[\\/][^\\/]+[\\/]?$/i.test(resolve(dir));
  }

  /** Every book folder on the shelf: recent ones, the worlds folder, the sample. Each folder once. */
  bookDirs(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (d: string) => {
      const r = resolve(d);
      const key = process.platform === 'win32' ? r.toLowerCase() : r;
      if (seen.has(key) || !existsSync(join(r, 'world.json'))) return;
      seen.add(key);
      out.push(r);
    };
    try {
      const recents = JSON.parse(readFileSync(join(this.dataDir, 'recent-worlds.json'), 'utf8')) as unknown;
      if (Array.isArray(recents)) for (const d of recents) if (typeof d === 'string') add(d);
    } catch { /* no recent worlds yet */ }
    const root = this.worldsDir();
    try {
      for (const d of readdirSync(root, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) add(join(root, d));
    } catch { /* no worlds folder yet */ }
    const sample = this.sampleDir();
    if (sample) add(sample);
    return out;
  }

  /**
   * A book by folder path, id or name (also the title of its Story Book). Throws a message listing the books
   * when nothing matches, so the assistant can pick one.
   */
  resolveBook(ref: string): string {
    const text = ref.trim();
    if (!text) throw new Error('Say which book: its name, id or folder.');
    if (existsSync(join(text, 'world.json'))) return resolve(text);
    const dirs = this.bookDirs();
    const want = normalizeName(text);
    const info = dirs.map((d) => ({ d, m: readManifestInfo(d) }));
    const hit = info.find((x) => x.m && (x.m.id === text || normalizeName(x.m.name) === want))
      ?? info.find((x) => x.m?.title && normalizeName(x.m.title) === want);
    if (hit) return hit.d;
    const names = info.filter((x) => x.m).map((x) => `"${x.m!.name}" (id ${x.m!.id})`);
    throw new Error(`No book called "${text}". ${names.length ? `Books on the shelf: ${names.join(', ')}.` : 'The shelf is empty: create a book first.'}`);
  }
}

export function readManifestInfo(dir: string): { id: string; name: string; title?: string } | null {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8')) as { id?: unknown; name?: unknown; book?: { title?: unknown } };
    if (typeof m.id !== 'string' || typeof m.name !== 'string') return null;
    return { id: m.id, name: m.name, ...(typeof m.book?.title === 'string' ? { title: m.book.title } : {}) };
  } catch {
    return null;
  }
}
