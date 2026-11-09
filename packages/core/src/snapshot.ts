import { parseDate, type ParsedDate } from './dates.ts';
import { checkWorld, report, sortWarnings, type CheckReport } from './engine.ts';
import { analyzeStory } from './story-check.ts';
import { wordCount } from './story.ts';
import { builtinRules } from './rules/index.ts';
import { references } from './rules/references.ts';
import { SCHEMA_VERSION, type Entry, type StoryChapter, type WorldManifest, type World } from './types.ts';
import { WorldIndex } from './world-index.ts';

export const SNAPSHOT_FORMAT = 'lore-forge.world-snapshot';
/** The version, written in when the app is built (packages/desktop/build.mjs); none when run from source. */
declare const __LORE_FORGE_VERSION__: string | undefined;
/** The Lore-Forge version: the release being built, or the newest release tag for a build from source. */
export const LORE_FORGE_VERSION = typeof __LORE_FORGE_VERSION__ === 'string' && __LORE_FORGE_VERSION__ ? __LORE_FORGE_VERSION__ : '1.0.0';
/** Lore-Forge and its version, in snapshots, the World Codex, the Story Book and About. */
export const GENERATOR = `lore-forge ${LORE_FORGE_VERSION}`;

export type SnapshotDate = Omit<ParsedDate, 'lo' | 'hi'> & { text: string; lo: number; hi: number };

export interface SnapshotEntry {
  entry: Entry;
  /** Path of the entry file inside the world folder. */
  file: string;
  /** Every readable date field, parsed. `lo`/`hi` are absolute day numbers on the world axis. */
  dates: Record<string, SnapshotDate>;
  /**
   * Every reference this entry makes: fields, [[links]], @mentions and plain names in the text (implicit).
   * `id` is set when the reference resolves to an entry.
   */
  references: SnapshotReference[];
}

export interface SnapshotReference {
  field: string;
  ref: string;
  id?: string;
  implicit?: boolean;
  ambiguous?: boolean;
}

export interface WorldSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  schemaVersion: number;
  generator: string;
  manifest: WorldManifest;
  entries: SnapshotEntry[];
  /** The story manuscript in reading order. Only present when the world has story/ chapters. */
  story?: (StoryChapter & { words: number })[];
  check: CheckReport;
}

/** One deterministic JSON-ready snapshot of a world, including the check results. */
export function snapshot(world: World): WorldSnapshot {
  const ix = new WorldIndex(world);
  const entries = [...world.entries].sort((a, b) => a.id.localeCompare(b.id)).map((entry): SnapshotEntry => {
    const dates: Record<string, SnapshotDate> = {};
    for (const [field, text] of ix.dateFields(entry)) {
      const r = parseDate(text, ix.calendar);
      if (r.kind === 'date') dates[field] = { text, ...r.date };
    }
    const refs = references(entry, ix).map((r): SnapshotReference => {
      const id = ix.resolve(r.ref)?.id;
      return { field: r.field, ref: r.ref, ...(id ? { id } : {}), ...(r.implicit ? { implicit: true } : {}), ...(r.ambiguous ? { ambiguous: true } : {}) };
    });
    return { entry, file: world.files[entry.id] ?? '', dates, references: refs };
  });
  const story = world.story?.length ? world.story.map((c) => ({ ...c, words: wordCount(c.body) })) : undefined;
  const warnings = checkWorld(world, builtinRules);
  if (story) warnings.push(...analyzeStory(world).warnings);
  return {
    format: SNAPSHOT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    manifest: world.manifest,
    entries,
    ...(story ? { story } : {}),
    check: report(world, sortWarnings(warnings)),
  };
}
