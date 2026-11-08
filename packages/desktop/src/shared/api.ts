import type { ModelFile } from '@lore-forge/core/node';
import type { UpdateState } from './update-state.ts';
import type { DisplaySettings, DisplayState } from './display.ts';
import type { Lang } from './i18n.ts';
import type { CodexOptions, BookOptions, BookSettings, Calendar, ImageView, WorldCoverSettings, WorldFile } from '@lore-forge/core';

export type PdfKind = 'codex' | 'book';
export interface PdfExport { pdf: string; md: string; pages: number; notes: string[] }
/** A picture a cover can use: one in the world folder (path relative to it) or a recent upload (absolute path). */
export interface CoverImage { kind: 'world' | 'upload'; path: string; name: string; thumb: string | null }
/** Preview options; the same ones build the in-app preview and the PDF. */
export type PublishOptions = CodexOptions & BookOptions;

export interface Settings {
  /** Where new worlds go by default. Empty: the app's worlds folder. */
  worldsDir?: string;
  /** The first-run tour was finished or skipped. */
  tourDone?: boolean;
  /** Check for updates on launch and every few hours (default on). */
  autoUpdate?: boolean;
  /** The sample world was removed from the library (Settings "Show sample world" brings it back). */
  hideSample?: boolean;
  /** The library shelf in the order the user arranged it: world folder paths (see shared/library.ts orderShelf). */
  shelfOrder?: string[];
  /** Window mode, page size in a window and interface scale; only what differs from the defaults (see shared/display.ts). */
  display?: Partial<DisplaySettings>;
  /** The app's language, once picked in Settings; until then the system's (Turkish on a Turkish system, else English). */
  language?: Lang;
}
export interface CreateWorldOptions {
  name: string;
  /** Folder to create the world in; default the worlds folder. */
  parent?: string;
  /** Cover colour, #rrggbb. */
  color?: string;
  /** Cover picture path from pickImageFile; copied into the world as images/cover.<ext>. */
  image?: string;
  /** The rest of the cover: emblem, title and emblem switches, font. */
  cover?: WorldCoverSettings;
}

/** A picture service for AI-made pictures (Connect AI). */
export type PictureProvider = 'openai' | 'gemini' | 'xai';
/** An AI app Lore-Forge can add its MCP server to. */
export interface AiClient {
  id: string;
  name: string;
  /** The app seems to be installed on this computer. */
  installed: boolean;
  /** "elsewhere": a lore-forge entry exists but starts another copy of Lore-Forge (moved, or a source checkout). */
  connected: 'yes' | 'no' | 'elsewhere';
  /** One click can connect it (Claude Code needs its `claude` command). */
  canConnect: boolean;
  /** What to do after connecting, e.g. restart the app. */
  after: string;
  /** Claude Code: the command to run in a terminal instead. */
  command?: string;
}
export interface AiPictures {
  provider: PictureProvider | 'none';
  /** Saved keys, shown as their last four characters only. */
  keys: Partial<Record<PictureProvider, string>>;
  models: Partial<Record<PictureProvider, string>>;
  providers: { id: PictureProvider; label: string; keyPage: string }[];
}
export interface AiState {
  clients: AiClient[];
  pictures: AiPictures;
  /** The { "mcpServers": ... } snippet for any other MCP app; null when this install cannot be connected. */
  setup: string | null;
  /** Why connecting is not possible here (the AppImage). */
  unavailable?: string;
}
export type PictureCheck = { ok: true; model: string; models: string[] } | { ok: false; error: string };

/** What the preload script exposes to the renderer as window.lore. */
export interface LoreApi {
  /** World folder to open at startup (from the command line or LORE_FORGE_OPEN), if any. */
  initialWorld(): Promise<string | null>;
  /** The read-only world that ships with the packaged app; null when running from source (worlds/ is the author's own). */
  bundledWorld(): Promise<string | null>;
  /** The sample world Camelamamm, used by the tour (also when running from source). */
  sampleWorld(): Promise<string | null>;
  recentWorlds(): Promise<string[]>;
  pickWorld(): Promise<string | null>;
  /** Create <parent>/<slug of name> (parent defaults to the worlds folder). Returns the new world folder. */
  createWorld(options: CreateWorldOptions): Promise<string | null>;
  /** World folders for the library shelf: recent, then the worlds folder, then the bundled world. */
  listWorlds(): Promise<string[]>;
  settings(): Promise<Settings & Required<Pick<Settings, 'worldsDir'>> & { defaultWorldsDir: string }>;
  saveSettings(settings: Settings): Promise<void>;
  /** Display settings and the window and screen they apply to; null when there are none (the smoke test). */
  displayState(): Promise<DisplayState | null>;
  /** Change the display settings: applied to the window at once and saved. Returns the new state. */
  setDisplay(patch: Partial<DisplaySettings>): Promise<DisplayState | null>;
  /** The window changed mode, size, screen or zoom (also by F11 or its title bar). Returns a function that stops listening. */
  onDisplayChanged(cb: (state: DisplayState) => void): () => void;
  /** Folder picker; null when cancelled. */
  chooseFolder(title: string, start?: string): Promise<string | null>;
  /** Pick an image file anywhere (for a new world's cover). Returns its path. */
  pickImageFile(): Promise<string | null>;
  /** Pictures for a cover: the world's images and recent uploads (only recent uploads without a world), with thumbnails. */
  coverImages(dir: string | null): Promise<CoverImage[]>;
  /** Font families installed on this computer (fontconfig, the Windows registry or system_profiler). */
  systemFonts(): Promise<string[]>;
  /** Preview of a file returned by pickImageFile, as a data: URL. */
  readPickedImage(path: string): Promise<string | null>;
  /**
   * Copy a whole world (any world, even the read-only bundled one) into the worlds folder under a new name. Returns
   * the copy's folder and its files (world.json with the cover and its seed), so its book is drawn right at once.
   */
  duplicateWorld(dir: string, name: string): Promise<{ dir: string; files: WorldFile[] }>;
  /** 3D models of an entry (models/<entryId>/), sorted by name. */
  /** Models of an entry's look (none: the Default look). */
  listModels(dir: string, entryId: string, look?: string): Promise<ModelFile[]>;
  /** A deleted look's models go to the Default look. */
  moveLookModels(dir: string, entryId: string, look: string): Promise<void>;
  /** Pick a .glb, .gltf, .obj or .fbx file and copy it into models/<entryId>/. Returns its path inside the world. */
  importModel(dir: string, entryId: string, look?: string): Promise<string | null>;
  /** Rename a model (the extension stays). Returns its new path. */
  renameModel(dir: string, file: string, name: string): Promise<string>;
  deleteModel(dir: string, file: string): Promise<void>;
  /** A model file's bytes, for the 3D viewer. */
  readModel(dir: string, file: string): Promise<Uint8Array>;
  /** Self-update: the current state, a check, the download, and the restart that installs it. */
  updateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onUpdateState(cb: (state: UpdateState) => void): void;
  /** Move a world folder to the system trash (never a hard delete) and drop it from the recent list. */
  trashWorld(dir: string): Promise<void>;
  readWorld(dir: string): Promise<WorldFile[]>;
  /** Read a world for its cover card without adding it to the recent list. Null if the folder is gone or not a world. */
  peekWorld(dir: string): Promise<WorldFile[] | null>;
  /**
   * Write a file of the world. `expect` is the content the edit started from (null: the file must not exist yet):
   * when the file changed outside the app since, nothing is written and the promise fails with CHANGED_OUTSIDE, so
   * the app can merge first. Without `expect` the file is written as it is.
   */
  writeFile(dir: string, path: string, content: string, expect?: string | null): Promise<void>;
  deleteFile(dir: string, path: string): Promise<void>;
  /** Pick an image file and copy it into images/<entryId>/. Returns its path inside the world. */
  /** Copy a picture into images/<entry-id>/ (images/<entry-id>/<look-id>/ for a look); its path, or null when cancelled. */
  importImage(dir: string, entryId: string, view: ImageView, look?: string): Promise<string | null>;
  /** Image as a data: URL, or null if missing. */
  readImage(dir: string, path: string): Promise<string | null>;
  /** Ask where to save, then write the World Codex or Story Book PDF (with these options) and its .md sidecar. Null if cancelled. */
  exportPdf(dir: string, kind: PdfKind, options?: PublishOptions): Promise<PdfExport | null>;
  /** Ask where to save, then write the print Story Book as a Word .docx. Null if cancelled. */
  exportDocx(dir: string, options?: PublishOptions): Promise<{ docx: string } | null>;
  /** Write the book details (title, author, dedication, ...) into world.json's "book". Empty fields are removed. Returns what was saved. */
  saveBook(dir: string, book: BookSettings): Promise<BookSettings>;
  /** Replace world.json's "calendar" (eras, default era, months); other calendar keys stay. Rejects a calendar with problems. Returns what was saved. */
  saveCalendar(dir: string, calendar: Calendar): Promise<Calendar>;
  /**
   * Replace world.json's "cover" (empty fields removed). `picked` is an image from pickImageFile: it is copied into
   * images/ and becomes the cover picture. Returns what was saved.
   */
  saveCover(dir: string, cover: WorldCoverSettings, picked?: string): Promise<WorldCoverSettings>;
  /** Reveal a saved file in the system file manager. */
  showInFolder(path: string): Promise<void>;
  /** Save a copy of a file of the world (a picture, a 3D model) where the user picks; its new path, or null when cancelled. */
  saveCopy(dir: string, path: string): Promise<string | null>;
  /** Back/forward from the OS (Windows app-command: mouse buttons 4/5, media keys). */
  onNavigate(cb: (direction: 'back' | 'forward') => void): void;
  /** The window is about to close: write everything waiting to be saved, then call flushed(). Returns a function that stops listening. */
  onFlushBeforeClose(cb: () => void): () => void;
  /** Everything was written (ok), or something could not be (the window then asks before closing). */
  flushed(ok: boolean): void;
  /**
   * Files of the open world changed outside the app (an AI assistant through `lore mcp`, an editor, git): paths
   * relative to the world folder. Returns a function that stops listening.
   */
  onWorldChanged(cb: (change: { dir: string; files: string[] }) => void): () => void;
  /** A book appeared in, left or changed its name or cover in the worlds folder. Returns a function that stops listening. */
  onLibraryChanged(cb: () => void): () => void;
  /** Connect AI: the AI apps and their connection, the picture settings, the setup snippet. */
  aiState(): Promise<AiState>;
  /** Add Lore-Forge to an AI app (or remove it). Rejects with a message the user can act on. */
  aiConnect(id: string, connect: boolean): Promise<AiClient>;
  /** Try a picture service key (the saved one when none is given): which image model it would use. */
  aiCheckPictures(provider: PictureProvider, key?: string): Promise<PictureCheck>;
  /** Save the picture service, and its key and model when given. */
  aiSavePictures(next: { provider: PictureProvider | 'none'; key?: string; model?: string }): Promise<AiPictures>;
  /** Delete a saved picture service key. */
  aiForgetKey(provider: PictureProvider): Promise<AiPictures>;
  copyText(text: string): Promise<void>;
  /** Used by the headless smoke test only. */
  smokeReport(summary: Record<string, unknown>): void;
  /** Smoke test only: set the window's content size. */
  smokeResize(width: number, height: number): Promise<void>;
  /** Smoke test only: show the window (inactive) so transitions run in real time, or hide it again. */
  smokeShow(show: boolean): Promise<void>;
  /** Smoke test only: make a throwaway worlds folder of `count` generated worlds the library's worlds folder. */
  smokeLibrary(count: number): Promise<string | null>;
  /** Smoke test only: add the test .glb to an entry. Returns its path inside the world. */
  smokeImportModel(dir: string, entryId: string): Promise<string | null>;
  /** Smoke test only: real mouse input (moves and wheel turns), at window coordinates. */
  smokeMouse(events: SmokeMouse[]): Promise<void>;
}

export type SmokeMouse = { type: 'move'; x: number; y: number; /** The left button is held (a drag). */ held?: boolean } | { type: 'down'; x: number; y: number } | { type: 'up'; x: number; y: number } | { type: 'wheel'; x: number; y: number; deltaY: number };

declare global {
  interface Window {
    lore: LoreApi;
  }
}
