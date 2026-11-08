export * from './types.ts';
export * from './icons.ts';
export * from './color.ts';
export * from './cover.ts';
export * from './fonts.ts';
export * from './dates.ts';
export * from './calendar.ts';
export * from './search.ts';
export * from './parse.ts';
export * from './links.ts';
export * from './engine.ts';
export * from './snapshot.ts';
export { WorldIndex, normalizeName } from './world-index.ts';
export { appearances, type Appearance } from './appearances.ts';
export { references, type Reference } from './rules/references.ts';
export * from './lifecycle.ts';
export * from './looks.ts';
export * from './details.ts';
export * from './entry-icons.ts';
export * from './relation-kinds.ts';
export * from './mentions.ts';
export * from './story.ts';
export * from './extract.ts';
export * from './story-check.ts';
export * from './rules/index.ts';
export { msg, recordMessages, localize, localizeDoc } from './i18n.ts';
export { CORE_TR } from './i18n-tr.ts';

import { checkWorld, sortWarnings } from './engine.ts';
import { analyzeStory } from './story-check.ts';
import { builtinRules } from './rules/index.ts';
import type { Warning, World } from './types.ts';

/** Check a world with the built-in rules, plus the live story warnings when the world has a story. */
export function check(world: World): Warning[] {
  const base = checkWorld(world, builtinRules);
  return world.story?.length ? sortWarnings([...base, ...analyzeStory(world).warnings]) : base;
}
export * from './publish/doc.ts';
export { artBrief, type ArtBrief } from './publish/art.ts';
export { worldCodex, CODEX_FORMAT_VERSION, type CodexOptions } from './publish/codex.ts';
/** Old names from before the World Bible became the World Codex (0.3.1); kept so existing callers keep working. */
export { worldCodex as worldBible, CODEX_FORMAT_VERSION as BIBLE_FORMAT_VERSION, type CodexOptions as BibleOptions } from './publish/codex.ts';
export { bookChapters, storyBook, writtenChapters, CHRONICLE_APPENDIX, LORE_AND_LEGENDS, SINGLE_CHAPTER, type BookChapter, type BookPage, type BookOptions, type ChapterGrouping } from './publish/book.ts';
export { toMarkdown } from './publish/markdown.ts';
export { familyTree, TREE_LAYOUT, type FamilyTree, type TreeNode, type TreeEdge } from './views/family-tree.ts';
export { relationWeb, WEB_LAYOUT, type RelationWeb, type WebOptions, type WebNode, type WebEdge } from './views/relation-web.ts';
export { timelineModel, yearLabel, yearTicks, monthTicks, packRows, involvesEntry, type TimelineModel, type TimelineLane, type TimelineGroup, type EraBand } from './views/timeline-model.ts';
