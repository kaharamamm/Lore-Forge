import { isEnded, LIFECYCLE, TYPE_ICON, TYPE_SINGULAR, type Entry, type EntryType } from '@lore-forge/core';
import { Icon } from './icon.tsx';

/** Emoji + type word, in the type colour. Never colour alone. */
export function TypeBadge({ type, short }: { type: EntryType; short?: boolean }) {
  return (
    <span class={`type-badge t-${type}`}>
      <Icon name={TYPE_ICON[type]} />
      <span class={short ? 'sr-only' : undefined}>{TYPE_SINGULAR[type]}</span>
    </span>
  );
}

/** Tombstone + "dead" (or destroyed, dissolved) when the entry has ended; nothing otherwise. */
export function EndedMark({ entry }: { entry: Entry }) {
  const lc = LIFECYCLE[entry.type];
  if (!lc || !isEnded(entry)) return null;
  return (
    <span class="ended-mark" title={lc.endedWord}>
      <Icon name={lc.endedIcon} />
      <span class="sr-only"> ({lc.endedWord})</span>
    </span>
  );
}

/** Emoji, name and ended mark, for lists, chips and links. */
export function EntryLabel({ entry }: { entry: Entry }) {
  return (
    <span class={`entry-label t-${entry.type}${isEnded(entry) ? ' is-ended' : ''}`}>
      <Icon class="type-icon" name={TYPE_ICON[entry.type]} />
      <span class="entry-label-name">{entry.name}</span>
      <EndedMark entry={entry} />
    </span>
  );
}

/** A clickable entry name. */
export function EntryLink({ entry, onOpen }: { entry: Entry; onOpen: (id: string) => void }) {
  return (
    <button type="button" class="entry-chip" onClick={() => onOpen(entry.id)} title={`Open ${TYPE_SINGULAR[entry.type].toLowerCase()} ${entry.name}`}>
      <EntryLabel entry={entry} />
      <span class="sr-only">, {TYPE_SINGULAR[entry.type].toLowerCase()}</span>
    </button>
  );
}
