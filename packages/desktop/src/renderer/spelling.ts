/** The words of the open book that the spell checker takes as spelled right while it is open. */
import type { World } from '@lore-forge/core';

/**
 * Every word of the names in the book: entries and their other names, eras, months and maps. A hyphenated name gives
 * each part (spell checkers check them one by one), and an English possessive ("Camelamamm's") counts too.
 */
export function bookWords(world: World): string[] {
  const texts = [
    ...world.entries.flatMap((e) => [e.name, ...(e.aliases ?? [])]),
    ...world.manifest.calendar.eras.map((e) => e.name),
    ...(world.manifest.calendar.months ?? []).map((m) => m.name),
    ...(world.manifest.maps ?? []).map((m) => m.name),
  ];
  const words = new Set<string>();
  for (const text of texts) {
    for (const part of text.split(/[^\p{L}\p{M}'’]+/u)) {
      const w = part.replace(/^['’]+|['’]+$/g, '');
      if (w.length < 2 || w.length > 40 || !/\p{L}/u.test(w)) continue;
      words.add(w);
      if (!/['’]/.test(w)) words.add(`${w}'s`).add(`${w}’s`);
    }
  }
  return [...words].sort();
}

/** The Story's text has a right-click menu of its own: marking the right-click sends the spelling there (main/spelling.ts). */
export function markOwnMenu(): void {
  (window as unknown as { loreOwnMenu?: number }).loreOwnMenu = performance.now();
}
