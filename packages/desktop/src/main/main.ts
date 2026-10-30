import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createWorld, loadWorld, readWorldFiles } from '@lore-forge/core/node';
import { storyBook, worldCodex, type ImageView } from '@lore-forge/core';
import { defaultFontDir, writePublication } from '@lore-forge/pdf';
import type { PdfKind, PublishOptions } from '../shared/api.ts';

const SMOKE = process.env['LORE_FORGE_SMOKE'] === '1';
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

let win: BrowserWindow | null = null;

/** Resolve a path inside a world folder, refusing anything that escapes it. */
function inside(dir: string, path: string): string {
  const full = resolve(dir, normalize(path));
  const rel = relative(resolve(dir), full);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Refusing to touch a file outside the world folder: ${path}`);
  return full;
}

const recentFile = (): string => join(app.getPath('userData'), 'recent-worlds.json');

async function recentWorlds(): Promise<string[]> {
  try {
    const list = JSON.parse(await readFile(recentFile(), 'utf8')) as string[];
    return list.filter((d) => existsSync(join(d, 'world.json')));
  } catch {
    return [];
  }
}

async function remember(dir: string): Promise<void> {
  const list = [dir, ...(await recentWorlds()).filter((d) => d !== dir)].slice(0, 8);
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(recentFile(), JSON.stringify(list, null, 2));
}

function exampleWorld(): string | null {
  const dir = app.isPackaged
    ? join(process.resourcesPath, 'examples', 'shifting-sands')
    : join(app.getAppPath(), '..', '..', 'examples', 'shifting-sands');
  return existsSync(join(dir, 'world.json')) ? dir : null;
}

function initialWorld(): string | null {
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
  return writePublication(kind === 'codex' ? worldCodex(world, options) : storyBook(world, options), dir, file, fontDir());
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
    return parts.join(', ');
  } finally {
    if (!process.env['LORE_FORGE_SMOKE_OUT']) await rm(out, { recursive: true, force: true });
  }
}

function registerIpc(): void {
  ipcMain.handle('initialWorld', () => initialWorld());
  ipcMain.handle('exampleWorld', () => exampleWorld());
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
  ipcMain.handle('createWorld', async (_e, name: string) => {
    const r = await dialog.showOpenDialog(win!, { title: `Choose where to create "${name}"`, properties: ['openDirectory', 'createDirectory'] });
    const parent = r.filePaths[0];
    if (r.canceled || !parent) return null;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world';
    const dir = join(parent, slug);
    if (existsSync(join(dir, 'world.json'))) throw new Error(`${dir} already holds a world.`);
    await createWorld(dir, name);
    return dir;
  });
  ipcMain.handle('readWorld', async (_e, dir: string) => {
    const files = await readWorldFiles(dir);
    if (!SMOKE) await remember(dir);
    return files;
  });
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
      const full = inside(dir, path);
      const type = IMAGE_TYPES[extname(full).toLowerCase()];
      if (!type || (await stat(full)).size > 50 * 1024 * 1024) return null;
      return `data:${type};base64,${(await readFile(full)).toString('base64')}`;
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
  ipcMain.handle('smokeResize', (_e, width: number, height: number) => {
    if (SMOKE) win?.setContentSize(width, height);
  });
  ipcMain.on('smokeReport', (_e, summary: unknown) => {
    if (!SMOKE) return;
    const dir = initialWorld();
    void (dir ? smokePdfs(dir) : Promise.resolve('no world, PDFs skipped')).then(
      (pdfs) => {
        console.log(`SMOKE OK ${JSON.stringify(summary)} PDF: ${pdfs}`);
        app.exit(0);
      },
      (e: unknown) => {
        console.error(`SMOKE FAIL PDF export: ${(e as Error).stack ?? String(e)}`);
        app.exit(1);
      },
    );
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 800,
    minHeight: 480,
    title: 'Lore-Forge',
    backgroundColor: '#14161b',
    show: !SMOKE,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
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
        app.exit(1);
      }
    });
    win.webContents.on('render-process-gone', (_e, d) => {
      console.error(`SMOKE FAIL renderer gone: ${d.reason}`);
      app.exit(1);
    });
    setTimeout(() => {
      console.error('SMOKE FAIL timeout: the renderer never reported a loaded world');
      app.exit(1);
    }, 30_000);
  }
  void win.loadFile(join(__dirname, 'renderer', 'index.html'), SMOKE ? { query: { smoke: '1' } } : undefined);
}

// Ubuntu 24.04's AppArmor blocks Chromium's sandbox for unpackaged Electron; allow an explicit dev opt-out.
if (process.env['LORE_FORGE_NO_SANDBOX'] === '1') app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
