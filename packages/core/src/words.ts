/** Small words core puts into its messages, made so they can be translated in place (see i18n.ts). Not exported from index. */
import { fixed, joined, msg } from './i18n.ts';
import { LIFECYCLE } from './lifecycle.ts';
import type { EntryType } from './types.ts';

/** "character", "item": an entry type in a sentence. */
export const TYPE_WORD: Record<EntryType, string> = {
  character: msg`character`,
  place: msg`place`,
  faction: msg`faction`,
  item: msg`item`,
  event: msg`event`,
  note: msg`note`,
};

/** "a character", "an item". */
export const A_TYPE: Record<EntryType, string> = {
  character: msg`a character`,
  place: msg`a place`,
  faction: msg`a faction`,
  item: msg`an item`,
  event: msg`an event`,
  note: msg`a note`,
};

const STATUS_VALUES = new Set(Object.values(LIFECYCLE).flatMap((lc) => lc.statuses.map((s) => s.value)));

/** A status value as written in the files ("alive", "standing") in a sentence; other text stays as it is. */
export const statusWord = (value: string): string => (STATUS_VALUES.has(value) ? fixed(value) : value);

/** "A or B", "A or B or C": items joined with " or ", each still translatable. */
export const orList = (items: readonly string[]): string => joined(items, ' or ');
