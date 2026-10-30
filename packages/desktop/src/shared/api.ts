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

/** What the preload script exposes to the renderer as window.lore. */
export interface LoreApi {
  /** World folder to open at startup (from the command line or LORE_FORGE_OPEN), if any. */
  initialWorld(): Promise<string | null>;
  /** The read-only world that ships with the packaged app; null when running from source (worlds/ is the author's own). */
  bundledWorld(): Promise<string | null>;
  recentWorlds(): Promise<string[]>;
  pickWorld(): Promise<string | null>;
  /** Create <parent>/<slug of name> (parent defaults to the worlds folder). Returns the new world folder. */
  createWorld(options: CreateWorldOptions): Promise<string | null>;
  /** World folders for the library shelf: recent, then the worlds folder, then the bundled world. */
  listWorlds(): Promise<string[]>;
  settings(): Promise<Required<Pick<Settings, 'worldsDir'>> & { defaultWorldsDir: string }>;
  saveSettings(settings: Settings): Promise<void>;
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
  /** Move a world folder to the system trash (never a hard delete) and drop it from the recent list. */
  trashWorld(dir: string): Promise<void>;
  readWorld(dir: string): Promise<WorldFile[]>;
  /** Read a world for its cover card without adding it to the recent list. Null if the folder is gone or not a world. */
  peekWorld(dir: string): Promise<WorldFile[] | null>;
  writeFile(dir: string, path: string, content: string): Promise<void>;
  deleteFile(dir: string, path: string): Promise<void>;
  /** Pick an image file and copy it into images/<entryId>/. Returns its path inside the world. */
  importImage(dir: string, entryId: string, view: ImageView): Promise<string | null>;
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
  /** Back/forward from the OS (Windows app-command: mouse buttons 4/5, media keys). */
  onNavigate(cb: (direction: 'back' | 'forward') => void): void;
  /** Used by the headless smoke test only. */
  smokeReport(summary: Record<string, unknown>): void;
  /** Smoke test only: set the window's content size. */
  smokeResize(width: number, height: number): Promise<void>;
  /** Smoke test only: show the window (inactive) so transitions run in real time, or hide it again. */
  smokeShow(show: boolean): Promise<void>;
  /** Smoke test only: make a throwaway worlds folder of `count` generated worlds the library's worlds folder. */
  smokeLibrary(count: number): Promise<string | null>;
  /** Smoke test only: real mouse input (moves and wheel turns), at window coordinates. */
  smokeMouse(events: SmokeMouse[]): Promise<void>;
}

export type SmokeMouse = { type: 'move'; x: number; y: number } | { type: 'wheel'; x: number; y: number; deltaY: number };

declare global {
  interface Window {
    lore: LoreApi;
  }
}
