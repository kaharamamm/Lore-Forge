export * from './types.ts';
export * from './dates.ts';
export * from './parse.ts';
export * from './links.ts';
export * from './engine.ts';
export * from './snapshot.ts';
export { WorldIndex, normalizeName } from './world-index.ts';
export { appearances, type Appearance } from './appearances.ts';
export { references, type Reference } from './rules/references.ts';
export * from './lifecycle.ts';
export * from './relation-kinds.ts';
export * from './mentions.ts';
export * from './rules/index.ts';

import { checkWorld } from './engine.ts';
import { builtinRules } from './rules/index.ts';
import type { Warning, World } from './types.ts';

/** Check a world with the built-in rules. */
export function check(world: World): Warning[] {
  return checkWorld(world, builtinRules);
}
export * from './publish/doc.ts';
export { artBrief, type ArtBrief } from './publish/art.ts';
export { worldBible, BIBLE_FORMAT_VERSION } from './publish/bible.ts';
export { bookChapters, storyBook, LORE_AND_LEGENDS, type BookChapter, type BookPage } from './publish/book.ts';
export { toMarkdown } from './publish/markdown.ts';
