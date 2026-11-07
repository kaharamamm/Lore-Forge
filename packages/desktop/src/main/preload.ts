import { contextBridge, ipcRenderer } from 'electron';
import type { LoreApi } from '../shared/api.ts';

const api: LoreApi = {
  initialWorld: () => ipcRenderer.invoke('initialWorld'),
  bundledWorld: () => ipcRenderer.invoke('bundledWorld'),
  sampleWorld: () => ipcRenderer.invoke('sampleWorld'),
  recentWorlds: () => ipcRenderer.invoke('recentWorlds'),
  pickWorld: () => ipcRenderer.invoke('pickWorld'),
  createWorld: (options) => ipcRenderer.invoke('createWorld', options),
  listWorlds: () => ipcRenderer.invoke('listWorlds'),
  settings: () => ipcRenderer.invoke('settings'),
  saveSettings: (s) => ipcRenderer.invoke('saveSettings', s),
  chooseFolder: (title, start) => ipcRenderer.invoke('chooseFolder', title, start),
  pickImageFile: () => ipcRenderer.invoke('pickImageFile'),
  readPickedImage: (path) => ipcRenderer.invoke('readPickedImage', path),
  coverImages: (dir) => ipcRenderer.invoke('coverImages', dir),
  systemFonts: () => ipcRenderer.invoke('systemFonts'),
  duplicateWorld: (dir, name) => ipcRenderer.invoke('duplicateWorld', dir, name),
  listModels: (dir, entryId) => ipcRenderer.invoke('listModels', dir, entryId),
  importModel: (dir, entryId) => ipcRenderer.invoke('importModel', dir, entryId),
  renameModel: (dir, file, name) => ipcRenderer.invoke('renameModel', dir, file, name),
  deleteModel: (dir, file) => ipcRenderer.invoke('deleteModel', dir, file),
  readModel: (dir, file) => ipcRenderer.invoke('readModel', dir, file),
  updateState: () => ipcRenderer.invoke('updateState'),
  checkForUpdates: () => ipcRenderer.invoke('checkForUpdates'),
  downloadUpdate: () => ipcRenderer.invoke('downloadUpdate'),
  installUpdate: () => ipcRenderer.invoke('installUpdate'),
  onUpdateState: (cb) => void ipcRenderer.on('update-state', (_e, state: Parameters<typeof cb>[0]) => cb(state)),
  trashWorld: (dir) => ipcRenderer.invoke('trashWorld', dir),
  readWorld: (dir) => ipcRenderer.invoke('readWorld', dir),
  peekWorld: (dir) => ipcRenderer.invoke('peekWorld', dir),
  writeFile: (dir, path, content) => ipcRenderer.invoke('writeFile', dir, path, content),
  deleteFile: (dir, path) => ipcRenderer.invoke('deleteFile', dir, path),
  importImage: (dir, entryId, view) => ipcRenderer.invoke('importImage', dir, entryId, view),
  readImage: (dir, path) => ipcRenderer.invoke('readImage', dir, path),
  exportPdf: (dir, kind, options) => ipcRenderer.invoke('exportPdf', dir, kind, options ?? {}),
  exportDocx: (dir, options) => ipcRenderer.invoke('exportDocx', dir, options ?? {}),
  saveBook: (dir, book) => ipcRenderer.invoke('saveBook', dir, book),
  saveCalendar: (dir, calendar) => ipcRenderer.invoke('saveCalendar', dir, calendar),
  saveCover: (dir, cover, picked) => ipcRenderer.invoke('saveCover', dir, cover, picked),
  showInFolder: (path) => ipcRenderer.invoke('showInFolder', path),
  onNavigate: (cb) => void ipcRenderer.on('navigate', (_e, direction: 'back' | 'forward') => cb(direction)),
  onWorldChanged: (cb) => {
    const listener = (_e: unknown, change: { dir: string; files: string[] }) => cb(change);
    ipcRenderer.on('world-changed', listener);
    return () => void ipcRenderer.removeListener('world-changed', listener);
  },
  onLibraryChanged: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('library-changed', listener);
    return () => void ipcRenderer.removeListener('library-changed', listener);
  },
  aiState: () => ipcRenderer.invoke('aiState'),
  aiConnect: (id, connect) => ipcRenderer.invoke('aiConnect', id, connect),
  aiCheckPictures: (provider, key) => ipcRenderer.invoke('aiCheckPictures', provider, key),
  aiSavePictures: (next) => ipcRenderer.invoke('aiSavePictures', next),
  aiForgetKey: (provider) => ipcRenderer.invoke('aiForgetKey', provider),
  copyText: (text) => ipcRenderer.invoke('copyText', text),
  smokeReport: (summary) => ipcRenderer.send('smokeReport', summary),
  smokeResize: (width, height) => ipcRenderer.invoke('smokeResize', width, height),
  smokeShow: (show) => ipcRenderer.invoke('smokeShow', show),
  smokeLibrary: (count) => ipcRenderer.invoke('smokeLibrary', count),
  smokeImportModel: (dir, entryId) => ipcRenderer.invoke('smokeImportModel', dir, entryId),
  smokeMouse: (events) => ipcRenderer.invoke('smokeMouse', events),
};

contextBridge.exposeInMainWorld('lore', api);
