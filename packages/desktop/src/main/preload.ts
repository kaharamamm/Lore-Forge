import { contextBridge, ipcRenderer } from 'electron';
import type { LoreApi } from '../shared/api.ts';

const api: LoreApi = {
  initialWorld: () => ipcRenderer.invoke('initialWorld'),
  bundledWorld: () => ipcRenderer.invoke('bundledWorld'),
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
  smokeReport: (summary) => ipcRenderer.send('smokeReport', summary),
  smokeResize: (width, height) => ipcRenderer.invoke('smokeResize', width, height),
  smokeShow: (show) => ipcRenderer.invoke('smokeShow', show),
  smokeLibrary: (count) => ipcRenderer.invoke('smokeLibrary', count),
  smokeMouse: (events) => ipcRenderer.invoke('smokeMouse', events),
};

contextBridge.exposeInMainWorld('lore', api);
