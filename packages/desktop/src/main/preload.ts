import { contextBridge, ipcRenderer, webUtils } from 'electron';
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
  displayState: () => ipcRenderer.invoke('displayState'),
  setDisplay: (patch) => ipcRenderer.invoke('setDisplay', patch),
  onDisplayChanged: (cb) => {
    const listener = (_e: unknown, state: Parameters<typeof cb>[0]) => cb(state);
    ipcRenderer.on('display-changed', listener);
    return () => void ipcRenderer.removeListener('display-changed', listener);
  },
  chooseFolder: (title, start) => ipcRenderer.invoke('chooseFolder', title, start),
  pickImageFile: () => ipcRenderer.invoke('pickImageFile'),
  readPickedImage: (path) => ipcRenderer.invoke('readPickedImage', path),
  coverImages: (dir) => ipcRenderer.invoke('coverImages', dir),
  systemFonts: () => ipcRenderer.invoke('systemFonts'),
  duplicateWorld: (dir, name) => ipcRenderer.invoke('duplicateWorld', dir, name),
  listModels: (dir, entryId, look) => ipcRenderer.invoke('listModels', dir, entryId, look),
  moveLookModels: (dir, entryId, look) => ipcRenderer.invoke('moveLookModels', dir, entryId, look),
  importModel: (dir, entryId, look) => ipcRenderer.invoke('importModel', dir, entryId, look),
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
  writeFile: (dir, path, content, expect) => ipcRenderer.invoke('writeFile', dir, path, content, expect),
  deleteFile: (dir, path) => ipcRenderer.invoke('deleteFile', dir, path),
  importImage: (dir, entryId, view, look) => ipcRenderer.invoke('importImage', dir, entryId, view, look),
  readImage: (dir, path) => ipcRenderer.invoke('readImage', dir, path),
  exportPdf: (dir, kind, options) => ipcRenderer.invoke('exportPdf', dir, kind, options ?? {}),
  exportDocx: (dir, options) => ipcRenderer.invoke('exportDocx', dir, options ?? {}),
  exportEpub: (dir, options) => ipcRenderer.invoke('exportEpub', dir, options ?? {}),
  audiobookStart: (dir) => ipcRenderer.invoke('audiobookStart', dir),
  audiobookAdd: (id, data, sizes, samples) => ipcRenderer.invoke('audiobookAdd', id, data, sizes, samples),
  audiobookFinish: (id, dir, info) => ipcRenderer.invoke('audiobookFinish', id, dir, info),
  audiobookCancel: (id) => ipcRenderer.invoke('audiobookCancel', id),
  importManuscript: () => ipcRenderer.invoke('importManuscript'),
  builtInVoices: () => ipcRenderer.invoke('builtInVoices'),
  speakBuiltIn: (text, voice, speed, names, batch) => ipcRenderer.invoke('speakBuiltIn', text, voice, speed, names ?? [], batch),
  dropSpeech: (batch) => ipcRenderer.send('dropSpeech', batch),
  saveBook: (dir, book) => ipcRenderer.invoke('saveBook', dir, book),
  saveCalendar: (dir, calendar) => ipcRenderer.invoke('saveCalendar', dir, calendar),
  saveStyle: (dir, style) => ipcRenderer.invoke('saveStyle', dir, style),
  saveFields: (dir, fields) => ipcRenderer.invoke('saveFields', dir, fields),
  saveCover: (dir, cover, picked) => ipcRenderer.invoke('saveCover', dir, cover, picked),
  saveMaps: (dir, maps, picture) => ipcRenderer.invoke('saveMaps', dir, maps, picture),
  shareBook: (dir) => ipcRenderer.invoke('shareBook', dir),
  exportSite: (dir) => ipcRenderer.invoke('exportSite', dir),
  exportGameData: (dir) => ipcRenderer.invoke('exportGameData', dir),
  spelling: () => ipcRenderer.invoke('spelling'),
  setSpelling: (languages) => ipcRenderer.invoke('setSpelling', languages),
  spellingWords: (words) => ipcRenderer.invoke('spellingWords', words),
  addToDictionary: (word) => ipcRenderer.invoke('addToDictionary', word),
  onSpelling: (cb) => {
    const listener = (_e: unknown, spelling: Parameters<typeof cb>[0]) => cb(spelling);
    ipcRenderer.on('spelling', listener);
    return () => void ipcRenderer.removeListener('spelling', listener);
  },
  openBookFile: (file) => ipcRenderer.invoke('openBookFile', file),
  takeBookFiles: () => ipcRenderer.invoke('takeBookFiles'),
  mapPictureMake: (prompt) => ipcRenderer.invoke('mapPictureMake', prompt),
  onBookFiles: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('book-files', listener);
    return () => void ipcRenderer.removeListener('book-files', listener);
  },
  pathOfFile: (file) => webUtils.getPathForFile(file),
  showInFolder: (path) => ipcRenderer.invoke('showInFolder', path),
  saveCopy: (dir, path) => ipcRenderer.invoke('saveCopy', dir, path),
  onNavigate: (cb) => void ipcRenderer.on('navigate', (_e, direction: 'back' | 'forward') => cb(direction)),
  onFlushBeforeClose: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('flush-before-close', listener);
    return () => void ipcRenderer.removeListener('flush-before-close', listener);
  },
  flushed: (ok) => ipcRenderer.send('flushed', ok),
  askAgents: (refresh) => ipcRenderer.invoke('askAgents', refresh),
  askChat: (dir) => ipcRenderer.invoke('askChat', dir),
  askSend: (dir, agent, text, bookName, about) => ipcRenderer.invoke('askSend', dir, agent, text, bookName, about ?? null),
  askStop: (dir) => ipcRenderer.invoke('askStop', dir),
  askClear: (dir) => ipcRenderer.invoke('askClear', dir),
  askUndo: (dir, task, force) => ipcRenderer.invoke('askUndo', dir, task, force),
  pictureService: () => ipcRenderer.invoke('pictureService'),
  pictureMake: (dir, entryId, type, view, look, prompt) => ipcRenderer.invoke('pictureMake', dir, entryId, type, view, look, prompt),
  historyList: (dir) => ipcRenderer.invoke('historyList', dir),
  historyVersions: (dir, path) => ipcRenderer.invoke('historyVersions', dir, path),
  historyChanges: (dir, id) => ipcRenderer.invoke('historyChanges', dir, id),
  historyRead: (dir, id, path) => ipcRenderer.invoke('historyRead', dir, id, path),
  historyKeep: (dir, label) => ipcRenderer.invoke('historyKeep', dir, label),
  historyRestore: (dir, id, paths, label) => ipcRenderer.invoke('historyRestore', dir, id, paths, label),
  onAskChanged: (cb) => {
    const listener = (_e: unknown, chat: Parameters<typeof cb>[0]) => cb(chat);
    ipcRenderer.on('ask-changed', listener);
    return () => void ipcRenderer.removeListener('ask-changed', listener);
  },
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
