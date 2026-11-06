import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { WorldIndex, type Warning, type World } from '@lore-forge/core';

/** A callback that never changes identity but always calls the latest `fn` (so memoized children skip renders). */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A) => latest.current(...args), []);
}

/** `value`, or the previous one while `same` says nothing changed (so memoized children skip their render). */
export function useSame<T>(value: T, same: (a: T, b: T) => boolean): T {
  const kept = useRef(value);
  if (kept.current !== value && !same(kept.current, value)) kept.current = value;
  return kept.current;
}

/** Two warning lists say the same thing: same warnings, messages, places and intended marks, in the same order. */
export function sameWarnings(a: readonly Warning[], b: readonly Warning[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The world as the story analysis should see it. Typing in an entry only changes its entries: those reach it
 * check once the typing has paused for `ms`, so a keystroke does not re-run the analysis.
 * Any other change (calendar, intended marks, story, a different world) goes through at once. `now()` catches
 * up immediately (on blur).
 */
export function useSettledWorld(world: World | null, ms: number): [World | null, () => void] {
  const [settled, setSettled] = useState(world);
  const latest = useRef(world);
  latest.current = world;
  useEffect(() => {
    const t = setTimeout(() => setSettled(world), ms);
    return () => clearTimeout(t);
  }, [world]);
  const now = useCallback(() => setSettled(latest.current), []);
  const typingOnly = !!settled && !!world && settled.manifest === world.manifest && settled.intended === world.intended && settled.storyIgnored === world.storyIgnored && settled.story === world.story;
  return [typingOnly ? settled : world, now];
}

const indexes = new WeakMap<World, WorldIndex>();
/** One WorldIndex per world value: the editor's many fields share it instead of building one each per keystroke. */
export function worldIndex(world: World): WorldIndex {
  let ix = indexes.get(world);
  if (!ix) indexes.set(world, (ix = new WorldIndex(world)));
  return ix;
}
