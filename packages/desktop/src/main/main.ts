import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, shell } from 'electron';
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createWorld, loadWorld, readWorldFiles } from '@lore-forge/core/node';
import { calendarProblems, storyBook, worldCodex, type BookSettings, type Calendar, type ImageView, type WorldCoverSettings } from '@lore-forge/core';
import { defaultFontDir, systemFontFamilies, writeDocx, writePublication } from '@lore-forge/pdf';
import type { CoverImage, CreateWorldOptions, PdfKind, PublishOptions, Settings, SmokeMouse } from '../shared/api.ts';

const SMOKE = process.env['LORE_FORGE_SMOKE'] === '1';
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

let win: BrowserWindow | null = null;
/** Smoke test: the world is opened from a throwaway copy, so the story checks can write files. */
let smokeWorld: string | null = null;
/** Smoke test: a throwaway worlds folder and settings, so creating and deleting worlds touches nothing real. */
let smokeHome: string | null = null;
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
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Refusing to touch a file outside the world folder: ${path}`);
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

/** Every world on the shelf: recent ones first (from any folder), then the rest of the worlds folder, then the bundled world. */
async function listWorlds(): Promise<string[]> {
  const root = await worldsDir();
  let inRoot: string[] = [];
  try {
    inRoot = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'world.json')))
      .map((d) => join(root, d.name))
      .sort((a, b) => a.localeCompare(b));
  } catch { /* no worlds folder yet */ }
  const bundled = bundledWorld();
  const all = [...(await recentWorlds()), ...inRoot, ...(bundled ? [bundled] : [])];
  return [...new Set(all.map((d) => resolve(d)))];
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

async function recentWorlds(): Promise<string[]> {
  try {
    const list = JSON.parse(await readFile(recentFile(), 'utf8')) as string[];
    return list.filter((d) => existsSync(join(d, 'world.json')));
  } catch {
    return [];
  }
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
  return writePublication(kind === 'codex' ? worldCodex(world, options) : storyBook(world, options), dir, file, fontDir(), join(__dirname, 'renderer', 'fonts', 'cover'));
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
    const d = await writeDocx(storyBook(await loadWorld(dir), { trim: 'a5' }), dir, join(out, 'book-a5.docx'));
    parts.push(`book-a5.docx ${(await stat(d.docx)).size} bytes`);
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

/** world.json "cover" keeps text values and the on/off switches only when they are off (on is the default). */
function cleanCover(cover: WorldCoverSettings): WorldCoverSettings {
  return Object.fromEntries(Object.entries(cover).filter(([, v]) => (typeof v === 'string' && v !== '') || v === false)) as WorldCoverSettings;
}

function registerIpc(): void {
  ipcMain.handle('initialWorld', () => initialWorld());
  ipcMain.handle('bundledWorld', () => (app.isPackaged ? bundledWorld() : null));
  ipcMain.handle('recentWorlds', () => recentWorlds());
  ipcMain.handle('pickWorld', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Open a Lore-Forge world folder', properties: ['openDirectory'] });
    const dir = r.filePaths[0];
    if (r.canceled || !dir) return null;
    if (!existsSync(join(dir, 'world.json'))) {
      await dialog.showMessageBox(win!, { type: 'warning', message: 'That folder is not a Lore-Forge world.', detail: 'A world folder has a world.json file. Use "Create world" to start a new one.' });
      return null;
    }
    return dir;
  });
  ipcMain.handle('listWorlds', () => listWorlds());
  ipcMain.handle('settings', async () => ({ ...(await readSettings()), defaultWorldsDir: defaultWorldsDir(), worldsDir: await worldsDir() }));
  ipcMain.handle('saveSettings', async (_e, next: Settings) => {
    await mkdir(dataDir(), { recursive: true });
    const clean: Settings = next.worldsDir && resolve(next.worldsDir) !== defaultWorldsDir() ? { worldsDir: resolve(next.worldsDir) } : {};
    await writeFile(settingsFile(), JSON.stringify(clean, null, 2));
  });
  ipcMain.handle('chooseFolder', async (_e, title: string, start?: string) => {
    if (SMOKE) return null;
    const r = await dialog.showOpenDialog(win!, { title, defaultPath: start, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle('pickImageFile', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose a cover picture', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
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
    const slug = o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world';
    const dir = join(parent, slug);
    if (existsSync(join(dir, 'world.json'))) throw new Error(`A world called "${o.name}" is already in that folder.`);
    let image: string | undefined;
    if (o.image && picked.has(o.image)) {
      image = `images/cover${extname(o.image).toLowerCase()}`;
      await mkdir(join(dir, 'images'), { recursive: true });
      await copyFile(o.image, join(dir, image));
    }
    await createWorld(dir, o.name, { cover: cleanCover({ ...o.cover, ...(o.color ? { color: o.color } : {}), ...(image ? { image } : {}) }) });
    return dir;
  });
  ipcMain.handle('trashWorld', async (_e, dir: string) => {
    // Only a real world folder goes, and only to the system trash: it can be restored from there.
    if (!existsSync(join(dir, 'world.json'))) throw new Error('That folder is not a Lore-Forge world.');
    if (app.isPackaged && bundledWorld() && resolve(dir) === resolve(bundledWorld()!)) throw new Error('The bundled world that ships with the app cannot be deleted.');
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
      if (existsSync(join(dir, 'world.json'))) throw new Error(`Could not move the folder to the trash (${(e as Error).message}). Nothing was deleted.`);
    }
    // Some platforms finish the move a moment after trashItem resolves: wait (briefly) until the shelf would not list it.
    for (let i = 0; i < 20 && existsSync(join(dir, 'world.json')); i++) await new Promise((ok) => setTimeout(ok, 100));
    await forget(dir);
  });
  ipcMain.handle('readWorld', async (_e, dir: string) => {
    const files = await readWorldFiles(dir);
    await remember(dir); // in the smoke run this is the throwaway smoke home
    return files;
  });
  ipcMain.handle('peekWorld', async (_e, dir: string) => (existsSync(join(dir, 'world.json')) ? readWorldFiles(dir).catch(() => null) : null));
  ipcMain.handle('writeFile', async (_e, dir: string, path: string, content: string) => {
    const full = inside(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  });
  ipcMain.handle('deleteFile', async (_e, dir: string, path: string) => {
    await rm(inside(dir, path), { force: true });
  });
  ipcMain.handle('importImage', async (_e, dir: string, entryId: string, view: ImageView) => {
    const r = await dialog.showOpenDialog(win!, { title: `Attach ${view} image`, properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    const src = r.filePaths[0];
    if (r.canceled || !src) return null;
    const safeId = entryId.replace(/[^\w-]+/g, '-');
    const rel = `images/${safeId}/${view.replace(/[^\w-]+/g, '-')}-${basename(src).replace(/[^\w.-]+/g, '-')}`;
    const full = inside(dir, rel);
    await mkdir(join(full, '..'), { recursive: true });
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
  ipcMain.handle('exportPdf', async (_e, dir: string, kind: PdfKind, options: PublishOptions) => {
    const world = JSON.parse(await readFile(join(dir, 'world.json'), 'utf8')) as { id?: string };
    const r = await dialog.showSaveDialog(win!, {
      title: kind === 'codex' ? 'Save World Codex PDF' : 'Save Story Book PDF',
      defaultPath: join(app.getPath('documents'), `${world.id ?? 'world'}-${kind}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return null;
    return publish(dir, kind, r.filePath, options);
  });
  ipcMain.handle('exportDocx', async (_e, dir: string, options: PublishOptions) => {
    const world = await loadWorld(dir);
    const r = await dialog.showSaveDialog(win!, {
      title: 'Save Story Book for Word',
      defaultPath: join(app.getPath('documents'), `${world.manifest.id}-book.docx`),
      filters: [{ name: 'Word document', extensions: ['docx'] }],
    });
    if (r.canceled || !r.filePath) return null;
    return writeDocx(storyBook(world, options), dir, r.filePath);
  });
  ipcMain.handle('saveBook', async (_e, dir: string, book: BookSettings) => {
    // Patch only "book" in the raw file, so every other key in world.json stays exactly as it was.
    const path = join(dir, 'world.json');
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const next = Object.fromEntries(Object.entries({ ...(raw['book'] as BookSettings | undefined), ...book }).filter(([, v]) => v !== '' && v !== undefined && v !== null)) as BookSettings;
    if (Object.keys(next).length) raw['book'] = next;
    else delete raw['book'];
    await writeFile(path, JSON.stringify(raw, null, 2) + '\n', 'utf8');
    return next;
  });
  ipcMain.handle('saveCalendar', async (_e, dir: string, calendar: Calendar) => {
    const problems = calendarProblems(calendar);
    if (problems.length) throw new Error(problems[0]);
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
    await writeFile(path, JSON.stringify(raw, null, 2) + '\n', 'utf8');
    return next;
  });
  ipcMain.handle('saveCover', async (_e, dir: string, cover: WorldCoverSettings, pickedImage?: string) => {
    const next: WorldCoverSettings = { ...cover };
    // A picture the user did not choose in this session is refused out loud rather than silently dropped.
    if (pickedImage && !picked.has(pickedImage)) throw new Error('That picture can no longer be used. Choose it again with Upload picture.');
    if (pickedImage) {
      // A new file name each time, so cached previews of an older cover picture never show.
      next.image = `images/cover-${Date.now().toString(36)}${extname(pickedImage).toLowerCase()}`;
      await mkdir(join(dir, 'images'), { recursive: true });
      await copyFile(pickedImage, inside(dir, next.image));
    }
    // Patch only "cover" in the raw file, like saveBook.
    const path = join(dir, 'world.json');
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const clean = cleanCover(next);
    if (Object.keys(clean).length) raw['cover'] = clean;
    else delete raw['cover'];
    await writeFile(path, JSON.stringify(raw, null, 2) + '\n', 'utf8');
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
    await mkdir(dataDir(), { recursive: true });
    await writeFile(settingsFile(), JSON.stringify({ worldsDir: shelf }, null, 2));
    return shelf;
  });
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
      if (ev.type === 'move') await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
      else await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', ...at, deltaX: 0, deltaY: ev.deltaY });
    }
  });
  ipcMain.on('smokeReport', (_e, summary: unknown) => {
    if (!SMOKE) return;
    const dir = initialWorld();
    void (dir ? smokePdfs(dir) : Promise.resolve('no world, PDFs skipped')).then(
      (pdfs) => {
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

function defaultSize(): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workAreaSize;
  return { width: Math.min(1920, area.width), height: Math.min(1080, area.height) };
}

function createWindow(): void {
  win = new BrowserWindow({
    // Made for a full-screen 1920x1080 window; smaller screens get a window that fits.
    ...defaultSize(),
    minWidth: 800,
    minHeight: 480,
    title: 'Lore-Forge',
    icon: join(__dirname, 'icon.png'),
    backgroundColor: '#14161b',
    show: !SMOKE,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !SMOKE },
  });
  win.setMenuBarVisibility(false);
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
    }, 240_000);
  }
  void win.loadFile(join(__dirname, 'renderer', 'index.html'), SMOKE ? { query: { smoke: '1' } } : undefined);
}

// Ubuntu 24.04's AppArmor blocks Chromium's sandbox for unpackaged Electron; allow an explicit dev opt-out.
if (process.env['LORE_FORGE_NO_SANDBOX'] === '1') app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async () => {
  const dir = SMOKE ? initialWorld() : null;
  if (dir) {
    smokeWorld = await mkdtemp(join(tmpdir(), 'lore-smoke-world-'));
    await cp(dir, smokeWorld, { recursive: true });
  }
  if (SMOKE) {
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
