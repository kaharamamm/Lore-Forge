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
export { worldBible, BIBLE_FORMAT_VERSION, type BibleOptions } from './publish/bible.ts';
export { bookChapters, storyBook, LORE_AND_LEGENDS, SINGLE_CHAPTER, type BookChapter, type BookPage, type BookOptions, type ChapterGrouping } from './publish/book.ts';
export { toMarkdown } from './publish/markdown.ts';
export { familyTree, TREE_LAYOUT, type FamilyTree, type TreeNode, type TreeEdge } from './views/family-tree.ts';
export { relationWeb, WEB_LAYOUT, type RelationWeb, type WebNode, type WebEdge } from './views/relation-web.ts';
export { timelineModel, yearLabel, yearTicks, involvesEntry, type TimelineModel, type TimelineLane, type TimelineGroup, type EraBand } from './views/timeline-model.ts';
