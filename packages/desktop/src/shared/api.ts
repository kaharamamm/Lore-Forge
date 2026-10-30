import type { CodexOptions, BookOptions, ImageView, WorldFile } from '@lore-forge/core';

export type PdfKind = 'codex' | 'book';
export interface PdfExport { pdf: string; md: string; pages: number }
/** Preview options; the same ones build the in-app preview and the PDF. */
export type PublishOptions = CodexOptions & BookOptions;

/** What the preload script exposes to the renderer as window.lore. */
export interface LoreApi {
  /** World folder to open at startup (from the command line or LORE_FORGE_OPEN), if any. */
  initialWorld(): Promise<string | null>;
  exampleWorld(): Promise<string | null>;
  recentWorlds(): Promise<string[]>;
  pickWorld(): Promise<string | null>;
  /** Ask for a parent folder and create <parent>/<slug of name>. Returns the new world folder. */
  createWorld(name: string): Promise<string | null>;
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
  /** Reveal a saved file in the system file manager. */
  showInFolder(path: string): Promise<void>;
  /** Back/forward from the OS (Windows app-command: mouse buttons 4/5, media keys). */
  onNavigate(cb: (direction: 'back' | 'forward') => void): void;
  /** Used by the headless smoke test only. */
  smokeReport(summary: Record<string, unknown>): void;
  /** Smoke test only: set the window's content size. */
  smokeResize(width: number, height: number): Promise<void>;
}

declare global {
  interface Window {
    lore: LoreApi;
  }
}
