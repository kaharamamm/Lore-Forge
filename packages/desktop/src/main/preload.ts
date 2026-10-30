import { contextBridge, ipcRenderer } from 'electron';
import type { LoreApi } from '../shared/api.ts';

const api: LoreApi = {
  initialWorld: () => ipcRenderer.invoke('initialWorld'),
  exampleWorld: () => ipcRenderer.invoke('exampleWorld'),
  recentWorlds: () => ipcRenderer.invoke('recentWorlds'),
  pickWorld: () => ipcRenderer.invoke('pickWorld'),
  createWorld: (name) => ipcRenderer.invoke('createWorld', name),
  readWorld: (dir) => ipcRenderer.invoke('readWorld', dir),
  writeFile: (dir, path, content) => ipcRenderer.invoke('writeFile', dir, path, content),
  deleteFile: (dir, path) => ipcRenderer.invoke('deleteFile', dir, path),
  importImage: (dir, entryId, view) => ipcRenderer.invoke('importImage', dir, entryId, view),
  readImage: (dir, path) => ipcRenderer.invoke('readImage', dir, path),
  exportPdf: (dir, kind) => ipcRenderer.invoke('exportPdf', dir, kind),
  smokeReport: (summary) => ipcRenderer.send('smokeReport', summary),
};

contextBridge.exposeInMainWorld('lore', api);
