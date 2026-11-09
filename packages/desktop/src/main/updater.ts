import { app, shell, type BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppUpdater, ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import { LORE_FORGE_VERSION } from '@lore-forge/core';
import { debInstallCommand, initialUpdateState, nextUpdateState, notesText, updateErrorText, updaterOff, type UpdateEvent, type UpdateState } from '../shared/update-state.ts';
import { t } from '../shared/i18n.ts';

/** Automatic checks: a few seconds after launch, then every four hours while the app stays open. */
const FIRST_CHECK_MS = 4_000;
const EVERY_MS = 4 * 60 * 60 * 1000;

/** Linux: electron-builder writes resources/package-type for deb, rpm and pacman builds. */
function packageType(): string | null {
  const file = join(process.resourcesPath ?? '', 'package-type');
  try {
    return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
  } catch {
    return null;
  }
}

let state: UpdateState;
let updater: AppUpdater | null = null;
let downloaded: string | null = null;
let getWin: () => BrowserWindow | null = () => null;

function emit(e: UpdateEvent): void {
  state = nextUpdateState(state, e);
  getWin()?.webContents.send('update-state', state);
}

/**
 * Self-update from the public GitHub Releases (electron-builder's latest*.yml files). Nothing downloads until the
 * user says so in the toast. Off in development, in the smoke test and with LORE_FORGE_NO_UPDATE=1.
 * LORE_FORGE_UPDATE_URL points it at another feed (a local folder served over http, for testing).
 */
export function setupUpdater(opts: { smoke: boolean; window: () => BrowserWindow | null; autoCheck: () => Promise<boolean> }): void {
  getWin = opts.window;
  const appImage = Boolean(process.env['APPIMAGE']);
  const off = updaterOff({ isPackaged: app.isPackaged, smoke: opts.smoke, disabled: process.env['LORE_FORGE_NO_UPDATE'] === '1', platform: process.platform, packageType: packageType(), appImage });
  // macOS builds are unsigned: Squirrel.Mac refuses to install them, so a found update is downloaded by hand.
  // From source, package.json still says 1.0.0: the build's version (the newest release tag) is the one to show.
  state = initialUpdateState(app.isPackaged ? app.getVersion() : LORE_FORGE_VERSION, off, process.platform === 'darwin');
  if (off) return;

  // Loaded only when updates are on, so development and the smoke run never touch it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  updater = (require('electron-updater') as typeof import('electron-updater')).autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.logger = null;
  const feed = process.env['LORE_FORGE_UPDATE_URL'];
  if (feed) updater.setFeedURL({ provider: 'generic', url: feed });
  updater.on('checking-for-update', () => emit({ type: 'check' }));
  updater.on('update-not-available', () => emit({ type: 'none' }));
  updater.on('update-available', (info: UpdateInfo) => emit({ type: 'found', version: info.version, notes: notesText(info.releaseNotes) }));
  updater.on('download-progress', (p: ProgressInfo) => emit({ type: 'progress', percent: p.percent }));
  updater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    downloaded = info.downloadedFile;
    emit({ type: 'downloaded', version: info.version });
  });
  updater.on('error', (e: Error) => emit({ type: 'error', message: updateErrorText(e.message ?? String(e)) }));

  const auto = async (): Promise<void> => {
    if (await opts.autoCheck()) void checkForUpdates();
  };
  setTimeout(() => void auto(), FIRST_CHECK_MS);
  setInterval(() => void auto(), EVERY_MS).unref();
}

export const updateState = (): UpdateState => state;

export async function checkForUpdates(): Promise<UpdateState> {
  if (!updater || ['off', 'checking', 'downloading', 'ready', 'installing'].includes(state.status)) return state;
  try {
    await updater.checkForUpdates();
  } catch (e) {
    emit({ type: 'error', message: updateErrorText((e as Error).message ?? String(e)) });
  }
  return state;
}

/** "Download" in the toast: fetch the update in the background, or (macOS) open the stable download link. */
export async function downloadUpdate(): Promise<UpdateState> {
  if (!updater || state.status !== 'available') return state;
  if (state.manual) {
    await shell.openExternal(`https://github.com/kaharamamm/Lore-Forge/releases/latest/download/Lore-Forge-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}.dmg`);
    return state;
  }
  emit({ type: 'download' });
  updater.downloadUpdate().catch((e: Error) => emit({ type: 'error', message: updateErrorText(e.message ?? String(e)) }));
  return state;
}

/** "Restart to update". Worlds and settings live in the user's folders, never in the install folder, so they stay. */
export function installUpdate(): void {
  if (!updater || state.status !== 'ready') return;
  emit({ type: 'install' });
  if (process.platform === 'linux' && !process.env['APPIMAGE'] && downloaded) {
    // One password prompt (pkexec) for dpkg; on success start the new version.
    const [cmd, args] = debInstallCommand(downloaded, process.env['LORE_FORGE_UPDATE_SUDO'] || 'pkexec');
    const child = spawn(cmd, args, { stdio: 'ignore' });
    child.on('error', (e) => emit({ type: 'install-failed', message: e.message }));
    child.on('exit', (code) => {
      if (code === 0) {
        app.relaunch();
        app.exit(0);
      } else {
        // The fixed text stays English in the state, like updateErrorText's: updateText translates it when shown.
        emit({ type: 'install-failed', message: code === 126 || code === 127 ? 'the password prompt was cancelled.' : t('the installer stopped (exit {code}).', { code }) });
      }
    });
    return;
  }
  // Windows (NSIS) and the AppImage replace themselves and start again.
  setImmediate(() => updater?.quitAndInstall(false, true));
}
