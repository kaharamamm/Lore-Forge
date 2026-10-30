import type { ImageView, WorldFile } from '@lore-forge/core';

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
  writeFile(dir: string, path: string, content: string): Promise<void>;
  deleteFile(dir: string, path: string): Promise<void>;
  /** Pick an image file and copy it into images/<entryId>/. Returns its path inside the world. */
  importImage(dir: string, entryId: string, view: ImageView): Promise<string | null>;
  /** Image as a data: URL, or null if missing. */
  readImage(dir: string, path: string): Promise<string | null>;
  /** Used by the headless smoke test only. */
  smokeReport(summary: { world: string; entries: number; warnings: number }): void;
}

declare global {
  interface Window {
    lore: LoreApi;
  }
}
