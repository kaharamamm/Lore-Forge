import { isEnded, LIFECYCLE, TYPE_EMOJI, TYPE_SINGULAR, type Entry, type EntryType } from '@lore-forge/core';

/** Emoji + type word, in the type colour. Never colour alone. */
export function TypeBadge({ type, short }: { type: EntryType; short?: boolean }) {
  return (
    <span class={`type-badge t-${type}`}>
      <span aria-hidden="true">{TYPE_EMOJI[type]}</span>
      <span class={short ? 'sr-only' : undefined}>{TYPE_SINGULAR[type]}</span>
    </span>
  );
}

/** "✝️ dead" (or destroyed, dissolved) when the entry has ended; nothing otherwise. */
export function EndedMark({ entry }: { entry: Entry }) {
  const lc = LIFECYCLE[entry.type];
  if (!lc || !isEnded(entry)) return null;
  return (
    <span class="ended-mark" title={lc.endedWord}>
      <span aria-hidden="true">{lc.endedMark}</span>
      <span class="sr-only"> ({lc.endedWord})</span>
    </span>
  );
}

/** Emoji, name and ended mark, for lists, chips and links. */
export function EntryLabel({ entry }: { entry: Entry }) {
  return (
    <span class={`entry-label t-${entry.type}${isEnded(entry) ? ' is-ended' : ''}`}>
      <span class="type-emoji" aria-hidden="true">{TYPE_EMOJI[entry.type]}</span>
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
