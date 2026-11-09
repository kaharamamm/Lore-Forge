/**
 * Book history in the app (history.ts does the work): one history per book in the app's data folder, snapshots
 * taken by themselves (a book opened, every 20 minutes while it changes, before each Ask AI task), and the calls the
 * window makes to look back and restore. Restores write as an outside program would, so the open book shows them
 * through the folder watch like any other outside change.
 */
import { ipcMain } from 'electron';
import { createHash } from 'node:crypto';
import { join, relative, resolve, isAbsolute } from 'node:path';
import type { HistoryChange, HistorySnapshot, HistoryVersion } from '../shared/api.ts';
import { t } from '../shared/i18n.ts';
import { BookHistory, samePath, type Pending, type SnapshotReason, type Task } from './history.ts';
import { onOwnChange } from './watch.ts';

const AUTO_MS = 20 * 60_000;

let dataDir: () => string = () => '';
const histories = new Map<string, BookHistory>();
const keyOf = (dir: string): string => (process.platform === 'win32' ? resolve(dir).toLowerCase() : resolve(dir));

export function historyOf(dir: string): BookHistory {
  const k = keyOf(dir);
  let h = histories.get(k);
  if (!h) {
    h = new BookHistory(dir, join(dataDir(), 'history', createHash('sha1').update(k).digest('hex').slice(0, 20)));
    histories.set(k, h);
  }
  return h;
}

/** Books an AI is working on: nothing is restored under it. */
const busy = new Set<string>();
export function setBusy(dir: string, on: boolean): void {
  if (on) busy.add(keyOf(dir));
  else busy.delete(keyOf(dir));
}
function notBusy(dir: string): void {
  if (busy.has(keyOf(dir))) throw new Error(t('An AI is working on this book. Wait for it to finish, or stop it, then try again.'));
}

/** Ask AI tasks under way, per book: the files the app itself saves meanwhile are the person's, not the AI's. */
const pending = new Map<string, Pending>();
onOwnChange((full) => {
  for (const [k, p] of pending) {
    const rel = relative(k, keyOf(full));
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) p.app.add(samePath(rel));
  }
});

/** Before an Ask AI task (null when the history cannot be kept: the task still runs). */
export async function beginTask(dir: string): Promise<Pending | null> {
  try {
    const p = await historyOf(dir).begin();
    pending.set(keyOf(dir), p);
    return p;
  } catch {
    return null;
  }
}

/** After it: the task, when it changed any file. */
export async function finishTask(dir: string, p: Pending, label: string): Promise<Task | null> {
  try {
    return await historyOf(dir).finish(p, label);
  } catch {
    return null;
  } finally {
    if (pending.get(keyOf(dir)) === p) pending.delete(keyOf(dir));
  }
}

export function undoTask(dir: string, task: string, force: boolean): Promise<{ conflicts: string[]; changed: string[] }> {
  return historyOf(dir).undo(task, force);
}

let current: string | null = null;
/** A book was opened: keep it as it is now (when it changed since the last snapshot). */
export function bookOpened(dir: string): void {
  const k = keyOf(dir);
  if (current === k) return;
  current = k;
  void historyOf(dir).snapshot('open').catch(() => undefined);
}

export function registerHistory(data: () => string): void {
  dataDir = data;
  // While a book is open: every 20 minutes, when something changed.
  setInterval(() => {
    if (current) void histories.get(current)?.snapshot('auto').catch(() => undefined);
  }, AUTO_MS).unref?.();

  ipcMain.handle('historyList', (_e, dir: string): Promise<HistorySnapshot[]> => historyOf(dir).list());
  ipcMain.handle('historyVersions', (_e, dir: string, path: string): Promise<HistoryVersion[]> => historyOf(dir).versions(path));
  ipcMain.handle('historyChanges', (_e, dir: string, id: string): Promise<HistoryChange[]> => historyOf(dir).changes(id));
  ipcMain.handle('historyRead', (_e, dir: string, id: string, path: string): Promise<string | null> => historyOf(dir).read(id, path));
  ipcMain.handle('historyKeep', async (_e, dir: string, label?: string): Promise<HistorySnapshot | null> => historyOf(dir).snapshot('manual' as SnapshotReason, label));
  ipcMain.handle('historyRestore', async (_e, dir: string, id: string, paths: string[] | null, label: string): Promise<string[]> => {
    notBusy(dir);
    return historyOf(dir).restore(id, paths ?? undefined, label);
  });
}
