export * from './types.ts';
export * from './dates.ts';
export * from './parse.ts';
export * from './links.ts';
export * from './engine.ts';
export * from './snapshot.ts';
export { WorldIndex, normalizeName } from './world-index.ts';
export { appearances, type Appearance } from './appearances.ts';
export { references } from './rules/references.ts';
export * from './rules/index.ts';

import { checkWorld } from './engine.ts';
import { builtinRules } from './rules/index.ts';
import type { Warning, World } from './types.ts';

/** Check a world with the built-in rules. */
export function check(world: World): Warning[] {
  return checkWorld(world, builtinRules);
}
