import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, shell } from 'electron';
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { createWorld, deleteModel, duplicateWorld, importModel, listModels, loadWorld, MODEL_EXTS, moveModels, readModel, readWorldFiles, renameModel, worldSlug } from '@lore-forge/core/node';
import { calendarProblems, cleanCoverSettings, DEFAULT_TRIM, localize, localizeDoc, recordMessages, storyBook, TRIMS, viewLabel, worldCodex, type BookSettings, type Calendar, type Doc, type ImageView, type TrimSize, type WorldCoverSettings } from '@lore-forge/core';
import { defaultFontDir, systemFontFamilies, writeDocx, writePublication } from '@lore-forge/pdf';
import type { CoverImage, CreateWorldOptions, PdfKind, PublishOptions, Settings, SmokeMouse } from '../shared/api.ts';
import { checkForUpdates, downloadUpdate, installUpdate, setupUpdater, updateState } from './updater.ts';
import { cleanOrder, orderShelf, placeAfter, planShelf } from '../shared/library.ts';
import { FolderWatch, isOwnText, libraryFiles, ownTouch, ownWrite, worldFiles } from './watch.ts';
import { registerAi } from './ai.ts';
import { cleanDisplay, storedDisplay, type DisplaySettings } from '../shared/display.ts';
import { attachDisplay, windowSize, type WindowDisplay } from './display.ts';
import { isLang, langFor, language, lower, setLanguage, t, type Lang } from '../shared/i18n.ts';
import { TR, TR_CORE } from '../shared/locales/tr/index.ts';

const SMOKE = process.env['LORE_FORGE_SMOKE'] === '1';
// Core remembers how it made its texts, so the exports and its errors can be written in the app's language.
recordMessages(true);
/** A document core built, in the app's language: its headings and labels, never the user's own text. */
const inLanguage = (doc: Doc): Doc => (language() === 'en' ? doc : localizeDoc(doc, TR_CORE));
/** Something core said (a calendar problem, a 3D model error), in the app's language. */
const said = (text: string): string => (language() === 'en' ? text : localize(text, TR_CORE));
/** The same for whatever a core call throws, on its way to the page. */
async function inLang<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    throw new Error(said((e as Error).message ?? String(e)));
  }
}
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

let win: BrowserWindow | null = null;
/** The window's display settings (Settings, Display); none in the smoke test, which sizes its window itself. */
let display: WindowDisplay | null = null;
/** Smoke test: the world is opened from a throwaway copy, so the story checks can write files. */
let smokeWorld: string | null = null;
/** Smoke test: a throwaway worlds folder and settings, so creating and deleting worlds touches nothing real. */
let smokeHome: string | null = null;
/** Smoke only: a fingerprint of the sample world at start, to prove the smoke (and the tour) leave it unchanged. */
let sampleBefore: string | null = null;
/** Smoke test: the freedesktop trash goes to a throwaway folder too (shell.trashItem reads XDG_DATA_HOME). */
const smokeTrash = SMOKE ? join(tmpdir(), `lore-smoke-trash-${process.pid}`) : null;
if (smokeTrash) process.env['XDG_DATA_HOME'] = smokeTrash;

function smokeExit(code: number): void {
  if (smokeWorld) rmSync(smokeWorld, { recursive: true, force: true });
  if (smokeHome) rmSync(smokeHome, { recursive: true, force: true });
  if (smokeTrash) rmSync(smokeTrash, { recursive: true, force: true });
  app.exit(code);
}

/** Resolve a path inside a world folder, refusing anything that escapes it. */
function inside(dir: string, path: string): string {
  const full = resolve(dir, normalize(path));
  const rel = relative(resolve(dir), full);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(t('Refusing to touch a file outside the world folder: {path}', { path }));
  return full;
}

const dataDir = (): string => smokeHome ?? app.getPath('userData');
const recentFile = (): string => join(dataDir(), 'recent-worlds.json');
const settingsFile = (): string => join(dataDir(), 'settings.json');
/** Cover pictures uploaded from outside a world, newest first: offered again under "Upload picture". Never deleted. */
const uploadsFile = (): string => join(dataDir(), 'recent-cover-uploads.json');

/**
 * The repository root when running from source: the nearest folder above the app with a package.json
 * that has "workspaces". Not the app folder (packages/desktop) and not the current directory.
 */
function repoRoot(): string {
  let dir = resolve(app.getAppPath());
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { workspaces?: unknown };
      if (pkg.workspaces) return dir;
    } catch { /* no package.json here */ }
    const up = resolve(dir, '..');
    if (up === dir) return resolve(app.getAppPath(), '..', '..');
    dir = up;
  }
}

/**
 * Where new worlds go unless the create dialog says otherwise: the "worlds" folder at the repository
 * root when running from source, <userData>/worlds in the packaged app; a folder set in Settings wins.
 */
function defaultWorldsDir(): string {
  if (smokeHome) return join(smokeHome, 'worlds');
  return app.isPackaged ? join(app.getPath('userData'), 'worlds') : join(repoRoot(), 'worlds');
}

async function readSettings(): Promise<Settings> {
  try {
    return JSON.parse(await readFile(settingsFile(), 'utf8')) as Settings;
  } catch {
    return {};
  }
}
const worldsDir = async (): Promise<string> => (await readSettings()).worldsDir || defaultWorldsDir();

// Live view: the open world and the worlds folder are watched, so changes made outside the app (an AI assistant
// through `lore mcp`, an editor, git) show at once. Off in the smoke run, which must only see its own steps.
let worldWatch: FolderWatch | null = null;
let libraryWatch: FolderWatch | null = null;
function watchWorld(dir: string): void {
  if (SMOKE || resolve(worldWatch?.dir ?? '') === resolve(dir)) return;
  worldWatch?.close();
  worldWatch = new FolderWatch(resolve(dir), worldFiles, (files) => win?.webContents.send('world-changed', { dir, files }));
}
async function watchLibrary(): Promise<void> {
  if (SMOKE) return;
  const root = resolve(await worldsDir());
  if (libraryWatch?.dir === root) return;
  libraryWatch?.close();
  await mkdir(root, { recursive: true }).catch(() => {});
  libraryWatch = new FolderWatch(root, libraryFiles, () => win?.webContents.send('library-changed'), 500);
}

/**
 * Merge into settings.json, keeping only values that differ from the defaults. One save at a time: each reads the
 * file the one before it wrote, so a window resize saved while the shelf order is saved cannot undo it.
 */
let settingsSaved: Promise<void> = Promise.resolve();
function saveSettings(next: Settings): Promise<void> {
  const run = settingsSaved.then(() => writeSettings(next));
  settingsSaved = run.catch(() => {});
  return run;
}
async function writeSettings(next: Settings): Promise<void> {
  const all = { ...(await readSettings()), ...next };
  const stored = storedDisplay(all.display);
  const clean: Settings = {
    ...(all.worldsDir && resolve(all.worldsDir) !== defaultWorldsDir() ? { worldsDir: resolve(all.worldsDir) } : {}),
    ...(all.tourDone ? { tourDone: true } : {}),
    ...(all.autoUpdate === false ? { autoUpdate: false } : {}),
    ...(all.hideSample ? { hideSample: true } : {}),
    ...(cleanOrder(all.shelfOrder) ? { shelfOrder: cleanOrder(all.shelfOrder) } : {}),
    ...(stored ? { display: stored } : {}),
    ...(isLang(all.language) ? { language: all.language } : {}),
  };
  await mkdir(dataDir(), { recursive: true });
  await writeFile(settingsFile(), JSON.stringify(clean, null, 2));
}

/**
 * Every world on the shelf: recent ones first (from any folder), then the rest of the worlds folder, then the sample
 * (see shared/library.ts: one Camelamamm, this app's own; none when Settings hides it). Recent folders that
 * are gone, and samples of other installs, are dropped from recent-worlds.json for good.
 */
async function listWorlds(): Promise<string[]> {
  const root = await worldsDir();
  let inRoot: string[] = [];
  try {
    inRoot = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'world.json')))
      .map((d) => join(root, d.name))
      .sort((a, b) => a.localeCompare(b));
  } catch { /* no worlds folder yet */ }
  const stored = await storedRecents();
  const { shelf, recents } = planShelf({
    recents: stored, inRoot, sample: bundledWorld(), ownResources: app.isPackaged ? process.resourcesPath : null,
    hideSample: !!(await readSettings()).hideSample,
    exists: (d) => existsSync(join(d, 'world.json')),
    info: (d) => {
      try {
        const m = JSON.parse(readFileSync(join(d, 'world.json'), 'utf8')) as { id?: unknown; name?: unknown };
        return typeof m.id === 'string' && typeof m.name === 'string' ? { id: m.id, name: m.name } : null;
      } catch {
        return null;
      }
    },
    resolve: (d) => resolve(d),
  });
  if (recents.length !== stored.length) {
    await mkdir(dataDir(), { recursive: true });
    await writeFile(recentFile(), JSON.stringify(recents, null, 2));
  }
  // The order the user arranged wins; new worlds go at the end of it.
  return orderShelf(shelf, (await readSettings()).shelfOrder);
}

/** Images picked in a dialog this session: the only outside files the renderer may preview or copy. */
const picked = new Set<string>();

async function recentUploads(): Promise<string[]> {
  try {
    return (JSON.parse(await readFile(uploadsFile(), 'utf8')) as string[]).filter((p) => existsSync(p));
  } catch {
    return [];
  }
}
async function rememberUpload(path: string): Promise<void> {
  const list = [path, ...(await recentUploads()).filter((p) => p !== path)].slice(0, 12);
  await mkdir(dataDir(), { recursive: true });
  await writeFile(uploadsFile(), JSON.stringify(list, null, 2));
}

/** A small preview of a picture (96 px wide); the file itself when Electron cannot decode it (webp, gif). */
async function thumbnail(full: string): Promise<string | null> {
  const img = nativeImage.createFromPath(full);
  if (!img.isEmpty()) return img.resize({ width: 96, quality: 'good' }).toDataURL();
  const size = (await stat(full).catch(() => null))?.size ?? Infinity;
  return size < 4 * 1024 * 1024 ? dataUrl(full) : null;
}

/** Pictures a cover can use: the world's own images (newest first, cover pictures before entry images), then recent uploads. */
async function coverImages(dir: string): Promise<CoverImage[]> {
  const found: { file: string; time: number }[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    let items;
    try {
      items = await readdir(join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of items) {
      const file = `${rel}/${d.name}`;
      if (d.isDirectory() && depth < 2) await walk(file, depth + 1);
      else if (d.isFile() && IMAGE_TYPES[extname(d.name).toLowerCase()]) found.push({ file, time: (await stat(join(dir, file))).mtimeMs + (rel === 'images' ? 1e13 : 0) });
    }
  };
  await walk('images', 0);
  const world = found.sort((a, b) => b.time - a.time).slice(0, 18);
  const uploads = await recentUploads();
  for (const p of uploads) picked.add(p); // picked in a dialog before, so the renderer may use them again
  const out: CoverImage[] = [];
  for (const w of world) out.push({ kind: 'world', path: w.file, name: basename(w.file), thumb: await thumbnail(join(dir, w.file)) });
  for (const p of uploads) out.push({ kind: 'upload', path: p, name: basename(p), thumb: await thumbnail(p) });
  return out.filter((c) => c.thumb);
}

/** recent-worlds.json as stored. */
async function storedRecents(): Promise<string[]> {
  try {
    const list = JSON.parse(await readFile(recentFile(), 'utf8')) as unknown;
    return Array.isArray(list) ? list.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}
async function recentWorlds(): Promise<string[]> {
  return (await storedRecents()).filter((d) => existsSync(join(d, 'world.json')));
}

async function remember(dir: string): Promise<void> {
  // No limit: every world opened from outside the worlds folder stays on the shelf.
  const list = [dir, ...(await recentWorlds()).filter((d) => d !== dir)];
  await mkdir(dataDir(), { recursive: true });
  await writeFile(recentFile(), JSON.stringify(list, null, 2));
}
async function forget(dir: string): Promise<void> {
  const list = (await recentWorlds()).filter((d) => resolve(d) !== resolve(dir));
  await mkdir(dataDir(), { recursive: true });
  await writeFile(recentFile(), JSON.stringify(list, null, 2));
}

/** The sample world Camelamamm: shipped read-only with the packaged app, in worlds/ when running from source. */
function bundledWorld(): string | null {
  const dir = app.isPackaged ? join(process.resourcesPath, 'worlds', 'camelamamm') : join(repoRoot(), 'worlds', 'camelamamm');
  return existsSync(join(dir, 'world.json')) ? dir : null;
}

/** Every file of a folder, names and bytes, as one hash. */
async function treeHash(dir: string): Promise<string> {
  const h = createHash('sha256');
  const files = (await readdir(dir, { recursive: true, withFileTypes: true })).filter((d) => d.isFile()).map((d) => join(d.parentPath, d.name)).sort();
  for (const f of files) h.update(relative(dir, f)).update('\0').update(await readFile(f)).update('\0');
  return h.digest('hex');
}

function initialWorld(): string | null {
  if (smokeWorld) return smokeWorld;
  const fromEnv = process.env['LORE_FORGE_OPEN'];
  const fromArgs = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith('-') && existsSync(join(a, 'world.json')));
  const dir = fromEnv || fromArgs;
  return dir ? resolve(dir) : null;
}

/** DejaVu fonts: shipped as a resource in the packaged app, from node_modules in development. */
function fontDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'fonts') : defaultFontDir();
}

/** Same document builders and options as the renderer preview, so the PDF matches what was reviewed. */
async function publish(dir: string, kind: PdfKind, file: string, options: PublishOptions = {}) {
  const world = await loadWorld(dir);
  return writePublication(inLanguage(kind === 'codex' ? worldCodex(world, options) : storyBook(world, options)), dir, file, fontDir(), join(__dirname, 'renderer', 'fonts', 'cover'), t);
}

/**
 * The Story Book cover as a PNG for Word: the renderer draws the cover alone (the preview's cover sheet, the same art
 * and title as the PDF) in a hidden offscreen window, and we capture it, 1240 px wide in the page's proportions. The
 * page is laid out 620 px wide at 2x through the DevTools protocol, so the capture is not limited by the screen size.
 * Undefined when the world has no cover art or the capture fails; Word then gets the plain text cover.
 */
async function renderCoverPng(dir: string, trim: TrimSize): Promise<Uint8Array | undefined> {
  const t = TRIMS[trim] ?? TRIMS[DEFAULT_TRIM];
  const width = 620;
  const height = Math.round((width * t.height) / t.width);
  const w = new BrowserWindow({
    show: false, width: 400, height: 400, frame: false, paintWhenInitiallyHidden: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false },
  });
  const dbg = w.webContents.debugger;
  // Every step is bounded, so a stuck capture falls back to the text cover instead of hanging the export.
  const within = <T,>(p: Promise<T>, ms = 10_000) =>
    Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('cover capture timed out')), ms))]);
  try {
    await within(w.loadFile(join(__dirname, 'renderer', 'index.html'), { query: { cover: dir, trim, lang: language() } }), 20_000);
    // Emulating before the page exists stalls; emulate once loaded, then let the cover lay out at the new size.
    dbg.attach('1.3');
    await within(dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }));
    let state: string | null = null;
    for (let i = 0; i < 200 && !state; i++) {
      state = (await within(w.webContents.executeJavaScript('window.__coverReady ?? null'))) as string | null;
      if (!state) await new Promise((ok) => setTimeout(ok, 50));
    }
    if (state !== 'ok') return undefined;
    await within(w.webContents.executeJavaScript('new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 250))))'));
    const shot = (await within(dbg.sendCommand('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } }))) as { data: string };
    const png = Buffer.from(shot.data, 'base64');
    return png.length > 0 ? new Uint8Array(png) : undefined;
  } catch {
    return undefined;
  } finally {
    if (dbg.isAttached()) dbg.detach();
    w.destroy();
  }
}

/** The Story Book for Word with the captured cover as its first page. */
async function bookDocx(dir: string, options: PublishOptions, path: string) {
  const doc = inLanguage(storyBook(await loadWorld(dir), options));
  const cover = await renderCoverPng(dir, doc.print?.trim ?? DEFAULT_TRIM);
  return { ...(await writeDocx(doc, dir, path, { ...(cover ? { cover } : {}), t })), coverPicture: !!cover };
}

/** Smoke test: prove the bundled PDF path works by exporting both documents. */
async function smokePdfs(dir: string): Promise<string> {
  const out = process.env['LORE_FORGE_SMOKE_OUT'] ?? (await mkdtemp(join(tmpdir(), 'lore-smoke-')));
  try {
    const parts: string[] = [];
    const runs: [PdfKind, string, PublishOptions][] = [
      ['codex', 'codex', {}],
      ['book', 'book', {}],
      ['codex', 'codex-characters-no-warnings', { types: ['character'], warnings: false }],
      ['book', 'book-single-chapter', { grouping: 'single' }],
    ];
    for (const [kind, name, options] of runs) {
      const r = await publish(dir, kind, join(out, `${name}.pdf`), options);
      parts.push(`${name}.pdf ${r.pages} pages ${(await stat(r.pdf)).size} bytes`);
    }
    const d = await bookDocx(dir, { trim: 'a5' }, join(out, 'book-a5.docx'));
    // The Word file opens with the captured cover: a page-sized picture behind the text, in the first section.
    const files = unzipSync(new Uint8Array(await readFile(d.docx)));
    const body = strFromU8(files['word/document.xml']!);
    const first = body.slice(0, body.indexOf('</w:p>', body.indexOf('<w:sectPr')));
    const media = Object.entries(files).filter(([k]) => k.startsWith('word/media/'));
    const png = media.find(([, v]) => v[0] === 0x89 && v[1] === 0x50 && v.length > 20_000);
    if (!d.coverPicture || !png || !first.includes('<wp:anchor') || !first.includes('behindDoc="1"')) throw new Error(`book-a5.docx: no captured cover on the first page (captured ${d.coverPicture}, ${media.length} pictures)`);
    const cw = (png[1][16]! << 24) | (png[1][17]! << 16) | (png[1][18]! << 8) | png[1][19]!;
    const ch = (png[1][20]! << 24) | (png[1][21]! << 16) | (png[1][22]! << 8) | png[1][23]!;
    if (Math.abs(ch / cw - 595.28 / 419.53) > 0.01) throw new Error(`book-a5.docx: the cover picture is ${cw}x${ch}, not A5-shaped`);
    parts.push(`book-a5.docx ${(await stat(d.docx)).size} bytes, cover ${cw}x${ch}`);
    return parts.join(', ');
  } finally {
    if (!process.env['LORE_FORGE_SMOKE_OUT']) await rm(out, { recursive: true, force: true });
  }
}

async function dataUrl(full: string): Promise<string | null> {
  try {
    const type = IMAGE_TYPES[extname(full).toLowerCase()];
    if (!type || (await stat(full)).size > 50 * 1024 * 1024) return null;
    return `data:${type};base64,${(await readFile(full)).toString('base64')}`;
  } catch {
    return null;
  }
}

/** Writes a text file the app itself changed (world.json), so the live view does not echo it back. */
async function writeOwn(path: string, text: string): Promise<void> {
  ownWrite(path, text);
  await writeFile(path, text, 'utf8');
}

/** world.json "cover" keeps text values and the on/off switches only when they are off (on is the default). */
function cleanCover(cover: WorldCoverSettings): WorldCoverSettings {
  return cleanCoverSettings(cover);
}

function registerIpc(): void {
  ipcMain.handle('initialWorld', () => initialWorld());
  ipcMain.handle('bundledWorld', () => (app.isPackaged ? bundledWorld() : null));
  // The sample for the tour: also when running from source, where it is not marked as bundled.
  ipcMain.handle('sampleWorld', () => bundledWorld());
  ipcMain.handle('recentWorlds', () => recentWorlds());
  ipcMain.handle('pickWorld', async () => {
    const r = await dialog.showOpenDialog(win!, { title: t('Open a Lore-Forge world folder'), properties: ['openDirectory'] });
    const dir = r.filePaths[0];
    if (r.canceled || !dir) return null;
    if (!existsSync(join(dir, 'world.json'))) {
      await dialog.showMessageBox(win!, { type: 'warning', message: t('That folder is not a Lore-Forge world.'), detail: t('A world folder has a world.json file. Use "Create world" to start a new one.') });
      return null;
    }
    return dir;
  });
  ipcMain.handle('listWorlds', () => listWorlds());
  ipcMain.handle('settings', async () => ({ ...(await readSettings()), defaultWorldsDir: defaultWorldsDir(), worldsDir: await worldsDir() }));
  ipcMain.handle('saveSettings', async (_e, next: Settings) => {
    if (isLang(next.language)) useLang(next.language);
    await saveSettings(next);
    await watchLibrary();
  });
  // Settings, Display: null in the smoke test, which has no display settings.
  ipcMain.handle('displayState', () => display?.state() ?? null);
  ipcMain.handle('setDisplay', (_e, patch: Partial<DisplaySettings>) => display?.set(patch) ?? null);
  ipcMain.handle('chooseFolder', async (_e, title: string, start?: string) => {
    if (SMOKE) return null;
    const r = await dialog.showOpenDialog(win!, { title, defaultPath: start, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle('pickImageFile', async () => {
    const r = await dialog.showOpenDialog(win!, { title: t('Choose a cover picture'), properties: ['openFile'], filters: [{ name: t('Images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    const src = r.filePaths[0];
    if (r.canceled || !src) return null;
    picked.add(src);
    await rememberUpload(src);
    return src;
  });
  ipcMain.handle('coverImages', (_e, dir: string | null) => (dir ? coverImages(dir) : recentUploads().then(async (list) => {
    for (const p of list) picked.add(p);
    return (await Promise.all(list.map(async (p): Promise<CoverImage> => ({ kind: 'upload', path: p, name: basename(p), thumb: await thumbnail(p) })))).filter((c) => c.thumb);
  })));
  ipcMain.handle('systemFonts', () => systemFontFamilies());
  ipcMain.handle('readPickedImage', async (_e, path: string) => (picked.has(path) ? dataUrl(path) : null));
  ipcMain.handle('createWorld', async (_e, o: CreateWorldOptions) => {
    const parent = o.parent || (await worldsDir());
    const dir = join(parent, worldSlug(o.name));
    if (existsSync(join(dir, 'world.json'))) throw new Error(t('A world called "{name}" is already in that folder.', { name: o.name }));
    let image: string | undefined;
    if (o.image && picked.has(o.image)) {
      image = `images/cover${extname(o.image).toLowerCase()}`;
      await mkdir(join(dir, 'images'), { recursive: true });
      await copyFile(o.image, join(dir, image));
    }
    await createWorld(dir, o.name, { cover: cleanCover({ ...o.cover, ...(o.color ? { color: o.color } : {}), ...(image ? { image } : {}) }) });
    return dir;
  });
  // A copy always goes into the worlds folder, so the read-only bundled world can be copied and edited.
  ipcMain.handle('duplicateWorld', async (_e, dir: string, name: string) => {
    if (!existsSync(join(dir, 'world.json'))) throw new Error(t('That folder is not a Lore-Forge world.'));
    const copy = resolve(await duplicateWorld(dir, await worldsDir(), name));
    // The copy goes right after its original on the shelf, which keeps the order from then on.
    await saveSettings({ shelfOrder: placeAfter(await listWorlds(), resolve(dir), copy) });
    return { dir: copy, files: await readWorldFiles(copy) };
  });
  ipcMain.handle('listModels', (_e, dir: string, entryId: string, look?: string) => inLang(() => listModels(dir, entryId, look || undefined)));
  ipcMain.handle('moveLookModels', (_e, dir: string, entryId: string, look: string) => inLang(() => moveModels(dir, entryId, look)));
  ipcMain.handle('importModel', async (_e, dir: string, entryId: string, look?: string) => {
    const r = await dialog.showOpenDialog(win!, { title: t('Add a 3D model'), properties: ['openFile'], filters: [{ name: t('3D models (glTF, OBJ, FBX)'), extensions: MODEL_EXTS.map((x) => x.slice(1)) }] });
    const src = r.filePaths[0];
    return r.canceled || !src ? null : inLang(() => importModel(dir, entryId, src, undefined, look || undefined));
  });
  ipcMain.handle('renameModel', (_e, dir: string, file: string, name: string) => inLang(() => renameModel(dir, file, name)));
  ipcMain.handle('deleteModel', (_e, dir: string, file: string) => inLang(() => deleteModel(dir, file)));
  ipcMain.handle('readModel', (_e, dir: string, file: string) => inLang(async () => new Uint8Array(await readModel(dir, file))));
  ipcMain.handle('updateState', () => updateState());
  ipcMain.handle('checkForUpdates', () => checkForUpdates());
  ipcMain.handle('downloadUpdate', () => downloadUpdate());
  ipcMain.handle('installUpdate', () => installUpdate());
  ipcMain.handle('trashWorld', async (_e, dir: string) => {
    // Only a real world folder goes, and only to the system trash: it can be restored from there.
    if (!existsSync(join(dir, 'world.json'))) throw new Error(t('That folder is not a Lore-Forge world.'));
    // The sample that comes with the app is never deleted: Remove from library hides it (Settings brings it back).
    if (bundledWorld() && resolve(dir) === resolve(bundledWorld()!)) throw new Error(t('The sample world that comes with the app is not deleted: remove it from the library instead.'));
    try {
      // The smoke box has no desktop trash (gio), so the smoke run moves the folder into its throwaway trash instead.
      if (smokeTrash) {
        await mkdir(smokeTrash, { recursive: true });
        await rename(resolve(dir), join(smokeTrash, basename(dir)));
      } else {
        await shell.trashItem(resolve(dir));
      }
    } catch (e) {
      // Some trash implementations report an error after the move went through; only a folder still there is a failure.
      if (existsSync(join(dir, 'world.json'))) throw new Error(t('Could not move the folder to the trash ({error}). Nothing was deleted.', { error: (e as Error).message }));
    }
    // Some platforms finish the move a moment after trashItem resolves: wait (briefly) until the shelf would not list it.
    for (let i = 0; i < 20 && existsSync(join(dir, 'world.json')); i++) await new Promise((ok) => setTimeout(ok, 100));
    await forget(dir);
  });
  ipcMain.handle('readWorld', async (_e, dir: string) => {
    const files = await readWorldFiles(dir);
    await remember(dir); // in the smoke run this is the throwaway smoke home
    watchWorld(dir);
    return files;
  });
  ipcMain.handle('peekWorld', async (_e, dir: string) => (existsSync(join(dir, 'world.json')) ? readWorldFiles(dir).catch(() => null) : null));
  ipcMain.handle('writeFile', (_e, dir: string, path: string, content: string, expect?: string | null) => {
    const full = inside(dir, path);
    // One write per file at a time, in the order they came: two saves of one file never interleave.
    const k = process.platform === 'win32' ? full.toLowerCase() : full;
    const job = (writing.get(k) ?? Promise.resolve()).catch(() => {}).then(() => writeChecked(full, content, expect));
    writing.set(k, job);
    void job.catch(() => {}).finally(() => { if (writing.get(k) === job) writing.delete(k); });
    return job;
  });
  ipcMain.handle('deleteFile', async (_e, dir: string, path: string) => {
    ownTouch(inside(dir, path));
    await rm(inside(dir, path), { force: true });
  });
  ipcMain.handle('importImage', async (_e, dir: string, entryId: string, view: ImageView, look?: string) => {
    // The view by its name in the app's language ("front" stays as it is in English, "ön" in Turkish).
    const r = await dialog.showOpenDialog(win!, { title: t('Attach {view} image', { view: language() === 'en' ? view : lower(said(viewLabel(view))) }), properties: ['openFile'], filters: [{ name: t('Images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    const src = r.filePaths[0];
    if (r.canceled || !src) return null;
    const safeId = entryId.replace(/[^\w-]+/g, '-');
    // A look's pictures get a folder of their own: images/<entry-id>/<look-id>/.
    const folder = look ? `images/${safeId}/${look.replace(/[^\w-]+/g, '-')}` : `images/${safeId}`;
    const rel = `${folder}/${view.replace(/[^\w-]+/g, '-')}-${basename(src).replace(/[^\w.-]+/g, '-')}`;
    const full = inside(dir, rel);
    await mkdir(join(full, '..'), { recursive: true });
    ownTouch(full);
    await copyFile(src, full);
    return rel;
  });
  ipcMain.handle('readImage', async (_e, dir: string, path: string) => {
    try {
      return await dataUrl(inside(dir, path));
    } catch {
      return null;
    }
  });
  ipcMain.handle('showInFolder', (_e, path: string) => shell.showItemInFolder(path));
  // A copy of a picture or a 3D model of the world, anywhere the user likes (to use it in other programs).
  ipcMain.handle('saveCopy', async (_e, dir: string, path: string) => {
    const from = inside(dir, path);
    if (SMOKE) return existsSync(from) ? '' : null;
    const ext = extname(path).slice(1).toLowerCase();
    const r = await dialog.showSaveDialog(win!, {
      title: t('Save a copy'),
      defaultPath: join(app.getPath('downloads'), basename(path)),
      ...(ext ? { filters: [{ name: ext.toUpperCase(), extensions: [ext] }] } : {}),
    });
    if (r.canceled || !r.filePath) return null;
    await copyFile(from, r.filePath);
    return r.filePath;
  });
  ipcMain.handle('exportPdf', async (_e, dir: string, kind: PdfKind, options: PublishOptions) => {
    const world = JSON.parse(await readFile(join(dir, 'world.json'), 'utf8')) as { id?: string };
    const r = await dialog.showSaveDialog(win!, {
      title: kind === 'codex' ? t('Save World Codex PDF') : t('Save Story Book PDF'),
      defaultPath: join(app.getPath('documents'), `${world.id ?? 'world'}-${kind}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return null;
    return publish(dir, kind, r.filePath, options);
  });
  ipcMain.handle('exportDocx', async (_e, dir: string, options: PublishOptions) => {
    const world = await loadWorld(dir);
    const r = await dialog.showSaveDialog(win!, {
      title: t('Save Story Book for Word'),
      defaultPath: join(app.getPath('documents'), `${world.manifest.id}-book.docx`),
      filters: [{ name: t('Word document'), extensions: ['docx'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const { coverPicture: _c, ...out } = await bookDocx(dir, options, r.filePath);
    return out;
  });
  ipcMain.handle('saveBook', async (_e, dir: string, book: BookSettings) => {
    // Patch only "book" in the raw file, so every other key in world.json stays exactly as it was.
    const path = join(dir, 'world.json');
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const next = Object.fromEntries(Object.entries({ ...(raw['book'] as BookSettings | undefined), ...book }).filter(([, v]) => v !== '' && v !== undefined && v !== null)) as BookSettings;
    if (Object.keys(next).length) raw['book'] = next;
    else delete raw['book'];
    await writeOwn(path, JSON.stringify(raw, null, 2) + '\n');
    return next;
  });
  ipcMain.handle('saveCalendar', async (_e, dir: string, calendar: Calendar) => {
    const problems = calendarProblems(calendar);
    if (problems.length) throw new Error(said(problems[0]!));
    // Patch only "calendar" in the raw file, like saveBook; keys we don't edit (approxYears, ...) stay.
    const path = join(dir, 'world.json');
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const next: Calendar = {
      ...(raw['calendar'] as Calendar | undefined),
      eras: calendar.eras.map(({ id, name, start, end, color }) => ({ id, name, start, ...(end !== undefined ? { end } : {}), ...(color ? { color } : {}) })),
      defaultEra: calendar.defaultEra,
    };
    if (calendar.months?.length) next.months = calendar.months.map(({ name, days }) => ({ name, days }));
    else delete next.months;
    raw['calendar'] = next;
    await writeOwn(path, JSON.stringify(raw, null, 2) + '\n');
    return next;
  });
  ipcMain.handle('saveCover', async (_e, dir: string, cover: WorldCoverSettings, pickedImage?: string) => {
    const next: WorldCoverSettings = { ...cover };
    // A picture the user did not choose in this session is refused out loud rather than silently dropped.
    if (pickedImage && !picked.has(pickedImage)) throw new Error(t('That picture can no longer be used. Choose it again with Upload picture.'));
    if (pickedImage) {
      // A new file name each time, so cached previews of an older cover picture never show.
      next.image = `images/cover-${Date.now().toString(36)}${extname(pickedImage).toLowerCase()}`;
      await mkdir(join(dir, 'images'), { recursive: true });
      ownTouch(inside(dir, next.image));
      await copyFile(pickedImage, inside(dir, next.image));
    }
    // Patch only "cover" in the raw file, like saveBook.
    const path = join(dir, 'world.json');
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const clean = cleanCover(next);
    if (Object.keys(clean).length) raw['cover'] = clean;
    else delete raw['cover'];
    await writeOwn(path, JSON.stringify(raw, null, 2) + '\n');
    return clean;
  });
  ipcMain.handle('smokeResize', (_e, width: number, height: number) => {
    if (SMOKE) win?.setContentSize(width, height);
  });
  // Smoke only: a library of `count` small generated worlds in a throwaway folder, made the worlds folder.
  ipcMain.handle('smokeLibrary', async (_e, count: number) => {
    if (!SMOKE || !smokeHome) return null;
    const shelf = join(smokeHome, 'shelf');
    await rm(shelf, { recursive: true, force: true });
    const special: { name: string; book?: { title?: string; author?: string }; description?: string }[] = [
      { name: 'Şehir Masalları', book: { author: 'Ayşe Yılmaz' } },
      { name: 'İSTANBUL Gecesi', description: 'Boğazda bir gece.' },
      { name: 'Ilık Rüzgar', description: 'Çöl kervanlarının şarkısı.' },
      { name: 'Northern Tales', book: { title: 'Songs of the Fjords', author: 'Émile Brontë' } },
      { name: 'The Glass Garden', description: 'A quiet story about lighthouse keepers.' },
      // Long titles: the shelf fits them (smaller font, balanced lines) instead of cutting them off.
      { name: 'The Extraordinary Chronicles of the Seventeen Sunken Kingdoms' },
      { name: 'Kartaltepe Mahallesinin Unutulmuş Masalları' },
    ];
    const colours = ['#7a2e2e', '#8a5a1c', '#2f5d3a', '#1f4f6b', '#3b3478', '#5c2a5e', '#6b4a2b'];
    for (let i = 0; i < count; i++) {
      const s = special[i] ?? { name: `Shelf Book ${String(i + 1).padStart(3, '0')}`, ...(i === special.length ? { description: 'Glass beads and other trinkets.' } : {}) };
      const dir = join(shelf, `of-${count}-${String(i + 1).padStart(3, '0')}`);
      await createWorld(dir, s.name, { cover: { color: colours[i % colours.length]! } });
      if (s.book || s.description) {
        const raw = JSON.parse(await readFile(join(dir, 'world.json'), 'utf8')) as Record<string, unknown>;
        if (s.book) raw['book'] = s.book;
        if (s.description) raw['description'] = s.description;
        await writeFile(join(dir, 'world.json'), JSON.stringify(raw, null, 2) + '\n', 'utf8');
      }
    }
    await saveSettings({ worldsDir: shelf });
    return shelf;
  });
  // Smoke only: add the test model (a small .glb) to an entry without the file dialog.
  ipcMain.handle('smokeImportModel', (_e, dir: string, entryId: string) =>
    SMOKE ? importModel(dir, entryId, join(repoRoot(), 'packages', 'desktop', 'test', 'fixtures', 'cube.glb'), 'Test cube') : null);
  ipcMain.handle('smokeShow', (_e, show: boolean) => {
    if (!SMOKE || !win) return;
    if (show) win.showInactive();
    else win.hide();
  });
  // Smoke only: real input through the DevTools protocol, so hover and wheel scrolling go through Chromium's own input path.
  ipcMain.handle('smokeMouse', async (_e, events: SmokeMouse[]) => {
    if (!SMOKE || !win) return;
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    for (const ev of events) {
      const at = { x: Math.round(ev.x), y: Math.round(ev.y) };
      if (ev.type === 'move') await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, ...(ev.held ? { button: 'left', buttons: 1 } : {}) });
      else if (ev.type === 'down' || ev.type === 'up') await dbg.sendCommand('Input.dispatchMouseEvent', { type: ev.type === 'down' ? 'mousePressed' : 'mouseReleased', ...at, button: 'left', buttons: ev.type === 'down' ? 1 : 0, clickCount: 1 });
      else await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', ...at, deltaX: 0, deltaY: ev.deltaY });
    }
  });
  ipcMain.on('smokeReport', (_e, summary: unknown) => {
    if (!SMOKE) return;
    const dir = initialWorld();
    const sample = bundledWorld();
    void (dir ? smokePdfs(dir) : Promise.resolve('no world, PDFs skipped')).then(
      async (pdfs) => {
        if (sample && sampleBefore && (await treeHash(sample)) !== sampleBefore) {
          console.error(`SMOKE FAIL the sample world ${sample} changed during the smoke`);
          return smokeExit(1);
        }
        console.log(`SMOKE OK ${JSON.stringify(summary)} PDF: ${pdfs}`);
        smokeExit(0);
      },
      (e: unknown) => {
        console.error(`SMOKE FAIL PDF export: ${(e as Error).stack ?? String(e)}`);
        smokeExit(1);
      },
    );
  });
}

/** Writes to a file still under way, per file. */
const writing = new Map<string, Promise<void>>();
/** The start of the message of a write refused because the file changed outside the app (see writeChecked). */
const CHANGED_OUTSIDE = 'CHANGED_OUTSIDE';

/**
 * Writes a file the app edits. With `expect` (the content the edit started from; null: the file must not exist
 * yet), a file someone else changed meanwhile is not written over: the write is refused and the app merges first.
 * It goes to a temporary file that is then moved into place, so a crash or a power cut never leaves half a file.
 */
async function writeChecked(full: string, content: string, expect?: string | null): Promise<void> {
  if (expect !== undefined) {
    let now: string | null;
    try {
      now = await readFile(full, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      now = null;
    }
    // As the edit expected, already this content, or the app's own last write (a save of the same file just before).
    if (now !== expect && now !== content && !(now !== null && isOwnText(full, now))) throw new Error(`${CHANGED_OUTSIDE}: ${full}`);
  }
  await mkdir(join(full, '..'), { recursive: true });
  ownWrite(full, content);
  const tmp = `${full}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, full);
  } catch {
    // A file another program holds open cannot be replaced on Windows: write it in place instead.
    await rm(tmp, { force: true }).catch(() => {});
    await writeFile(full, content, 'utf8');
  }
}

function defaultSize(): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workAreaSize;
  return { width: Math.min(1920, area.width), height: Math.min(1080, area.height) };
}

/** The app's language for the main process's own words (dialogs); the page gets it with its address. */
function useLang(l: Lang): void {
  setLanguage(l, l === 'tr' ? TR : null);
}

async function createWindow(): Promise<void> {
  // The language picked in Settings, else the system's. The smoke run is always in English.
  const saved = (await readSettings()).language;
  useLang(SMOKE ? 'en' : isLang(saved) ? saved : langFor(app.getLocale()));
  // Display settings (Settings): the window opens in its saved mode, with its saved page size in a window
  // (by default maximized; made for a full-screen 1920x1080 window, smaller screens get a window that fits). The
  // smoke window keeps the plain default size, stays hidden and sets its own sizes, with no zoom.
  const settings: DisplaySettings | null = SMOKE ? null : cleanDisplay((await readSettings()).display);
  const w = new BrowserWindow({
    ...(settings ? windowSize(settings) : defaultSize()),
    minWidth: 800,
    minHeight: 480,
    title: 'Lore-Forge',
    icon: join(__dirname, 'icon.png'),
    backgroundColor: '#14161b',
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !SMOKE },
  });
  win = w;
  if (settings) {
    // The hidden menu bar must be gone before the display settings measure the window frame.
    w.setMenuBarVisibility(false);
    const own = attachDisplay(w, settings, {
      save: (d) => void saveSettings({ display: d }).catch(() => {}),
      changed: (s) => { if (!w.isDestroyed()) w.webContents.send('display-changed', s); },
    });
    display = own;
    w.on('closed', () => { if (display === own) display = null; });
    // Put in its mode (maximized, full screen) and zoomed before the first show, so it never flashes at another size.
    w.once('ready-to-show', () => own.show());
  }
  win.setMenuBarVisibility(false);
  // Closing waits for the page to write what is still waiting to be saved. If something cannot be saved (a locked
  // or read-only file), the window asks before it closes; a page that does not answer closes after a few seconds.
  let closing = false;
  w.on('close', (e) => {
    if (closing || SMOKE || w.webContents.isCrashed()) return;
    e.preventDefault();
    closing = true;
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      ipcMain.removeListener('flushed', onFlushed);
      if (w.isDestroyed()) return;
      if (ok || dialog.showMessageBoxSync(w, { type: 'warning', buttons: [t('Close anyway'), t('Keep open')], defaultId: 1, cancelId: 1, title: 'Lore-Forge', message: t('Some changes could not be saved.'), detail: t('A file may be open in another program, or the folder may be read-only. Lore-Forge keeps trying while it stays open.') }) === 0) w.close();
      else closing = false;
    };
    const onFlushed = (ev: Electron.IpcMainEvent, ok: boolean) => { if (ev.sender === w.webContents) finish(ok); };
    const timer = setTimeout(() => finish(true), 8000);
    ipcMain.on('flushed', onFlushed);
    w.webContents.send('flush-before-close');
  });
  // Links in lore text open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Windows sends the mouse back/forward buttons as app commands; Linux and macOS deliver them to the page.
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') win?.webContents.send('navigate', 'back');
    if (cmd === 'browser-forward') win?.webContents.send('navigate', 'forward');
  });
  if (SMOKE) {
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error') {
        console.error(`SMOKE FAIL renderer error: ${e.message}`);
        smokeExit(1);
      }
    });
    win.webContents.on('render-process-gone', (_e, d) => {
      console.error(`SMOKE FAIL renderer gone: ${d.reason}`);
      smokeExit(1);
    });
    setTimeout(() => {
      console.error('SMOKE FAIL timeout: the renderer never reported a loaded world');
      smokeExit(1);
    }, 360_000);
  }
  void win.loadFile(join(__dirname, 'renderer', 'index.html'), { query: SMOKE ? { smoke: '1' } : { lang: language() } });
}

// Ubuntu 24.04's AppArmor blocks Chromium's sandbox for unpackaged Electron; allow an explicit dev opt-out.
if (process.env['LORE_FORGE_NO_SANDBOX'] === '1') app.commandLine.appendSwitch('no-sandbox');
// The smoke run renders a 3D model under xvfb, whose software GL Chromium blocklists for WebGL.
if (SMOKE) app.commandLine.appendSwitch('ignore-gpu-blocklist');

app.whenReady().then(async () => {
  const dir = SMOKE ? initialWorld() : null;
  if (dir) {
    smokeWorld = await mkdtemp(join(tmpdir(), 'lore-smoke-world-'));
    await cp(dir, smokeWorld, { recursive: true });
  }
  if (SMOKE) {
    const sampleDir = bundledWorld();
    if (sampleDir) sampleBefore = await treeHash(sampleDir);
    smokeHome = await mkdtemp(join(tmpdir(), 'lore-smoke-home-'));
    // One "uploaded before" cover picture (a copy of a world image), so the recent pictures list has something to show.
    const sample = smokeWorld && join(smokeWorld, 'images', 'place-saltmere', 'establishing.png');
    if (sample && existsSync(sample)) {
      await mkdir(join(smokeHome, 'uploads'), { recursive: true });
      await copyFile(sample, join(smokeHome, 'uploads', 'saltmere.png'));
      await rememberUpload(join(smokeHome, 'uploads', 'saltmere.png'));
    }
  }
  registerIpc();
  registerAi(defaultWorldsDir);
  await createWindow();
  void watchLibrary();
  setupUpdater({ smoke: SMOKE, window: () => win, autoCheck: async () => (await readSettings()).autoUpdate !== false });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
