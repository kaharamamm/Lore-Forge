import { contextBridge, ipcRenderer } from 'electron';
import type { LoreApi } from '../shared/api.ts';

const api: LoreApi = {
  initialWorld: () => ipcRenderer.invoke('initialWorld'),
  exampleWorld: () => ipcRenderer.invoke('exampleWorld'),
  recentWorlds: () => ipcRenderer.invoke('recentWorlds'),
  pickWorld: () => ipcRenderer.invoke('pickWorld'),
  createWorld: (name) => ipcRenderer.invoke('createWorld', name),
  readWorld: (dir) => ipcRenderer.invoke('readWorld', dir),
  peekWorld: (dir) => ipcRenderer.invoke('peekWorld', dir),
  writeFile: (dir, path, content) => ipcRenderer.invoke('writeFile', dir, path, content),
  deleteFile: (dir, path) => ipcRenderer.invoke('deleteFile', dir, path),
  importImage: (dir, entryId, view) => ipcRenderer.invoke('importImage', dir, entryId, view),
  readImage: (dir, path) => ipcRenderer.invoke('readImage', dir, path),
  exportPdf: (dir, kind, options) => ipcRenderer.invoke('exportPdf', dir, kind, options ?? {}),
  showInFolder: (path) => ipcRenderer.invoke('showInFolder', path),
  onNavigate: (cb) => void ipcRenderer.on('navigate', (_e, direction: 'back' | 'forward') => cb(direction)),
  smokeReport: (summary) => ipcRenderer.send('smokeReport', summary),
  smokeResize: (width, height) => ipcRenderer.invoke('smokeResize', width, height),
};

contextBridge.exposeInMainWorld('lore', api);
