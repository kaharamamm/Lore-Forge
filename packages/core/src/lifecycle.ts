import type { IconName } from './icons.ts';
import type { Entry, EntryType } from './types.ts';

export interface StatusOption {
  value: string;
  label: string;
  emoji: string;
  icon: IconName;
}

/**
 * Status and end-of-life field per type. `ongoing` statuses mean the end date does not apply,
 * so the editor hides it; `ended` statuses mean it does. The file keeps any value either way.
 */
export interface Lifecycle {
  /** Date field that records the end: died, destroyed, dissolved. */
  endField: 'died' | 'destroyed' | 'dissolved';
  endLabel: string;
  statuses: readonly StatusOption[];
  ongoing: readonly string[];
  ended: readonly string[];
  /** Word for an ended entry, e.g. "dead", "destroyed". */
  endedWord: string;
  /** Mark shown next to an ended entry, always together with endedWord (text and Markdown). */
  endedMark: string;
  /** The same mark as a game-icons.net icon (app and PDF). */
  endedIcon: IconName;
}

export const LIFECYCLE: Partial<Record<EntryType, Lifecycle>> = {
  character: {
    endField: 'died', endLabel: 'Died',
    statuses: [{ value: 'alive', label: 'Alive', emoji: '💚', icon: 'heart-beats' }, { value: 'dead', label: 'Dead', emoji: '🪦', icon: 'tombstone' }, { value: 'unknown', label: 'Unknown', emoji: '❔', icon: 'uncertainty' }],
    ongoing: ['alive'], ended: ['dead'], endedWord: 'dead', endedMark: '🪦', endedIcon: 'tombstone',
  },
  place: {
    endField: 'destroyed', endLabel: 'Destroyed',
    statuses: [{ value: 'standing', label: 'Standing', emoji: '🏰', icon: 'castle' }, { value: 'destroyed', label: 'Destroyed', emoji: '🏚️', icon: 'castle-ruins' }, { value: 'unknown', label: 'Unknown', emoji: '❔', icon: 'uncertainty' }],
    ongoing: ['standing'], ended: ['destroyed'], endedWord: 'destroyed', endedMark: '🏚️', endedIcon: 'castle-ruins',
  },
  faction: {
    endField: 'dissolved', endLabel: 'Dissolved',
    statuses: [{ value: 'active', label: 'Active', emoji: '🚩', icon: 'flying-flag' }, { value: 'dissolved', label: 'Dissolved', emoji: '🏳️', icon: 'broken-shield' }, { value: 'unknown', label: 'Unknown', emoji: '❔', icon: 'uncertainty' }],
    ongoing: ['active'], ended: ['dissolved'], endedWord: 'dissolved', endedMark: '🏳️', endedIcon: 'broken-shield',
  },
  item: {
    endField: 'destroyed', endLabel: 'Destroyed',
    statuses: [{ value: 'intact', label: 'Intact', emoji: '✨', icon: 'sparkles' }, { value: 'destroyed', label: 'Destroyed', emoji: '💥', icon: 'broken-axe' }, { value: 'lost', label: 'Lost', emoji: '🌫️', icon: 'fog' }, { value: 'unknown', label: 'Unknown', emoji: '❔', icon: 'uncertainty' }],
    ongoing: ['intact', 'lost'], ended: ['destroyed'], endedWord: 'destroyed', endedMark: '💥', endedIcon: 'broken-axe',
  },
};

const rec = (e: Entry) => e as unknown as Record<string, string | undefined>;
const filled = (v: string | undefined): boolean => v !== undefined && v.trim() !== '';

/** Every status set has exactly one value selected; a file without one reads as this. */
export const DEFAULT_STATUS = 'unknown';

/** The entry's status value (DEFAULT_STATUS when the file has none), if its type has statuses. */
export function statusOf(e: Entry): string | undefined {
  return LIFECYCLE[e.type] ? (rec(e)['status'] ?? DEFAULT_STATUS) : undefined;
}

/** "Alive", "Unknown", ... for display; undefined for types without a status. */
export function statusLabel(e: Entry): string | undefined {
  const s = statusOf(e);
  return LIFECYCLE[e.type]?.statuses.find((x) => x.value === s)?.label ?? s;
}

/** Races to suggest: the ones already used in the world first, then common defaults. */
export const DEFAULT_RACES = ['human', 'elf', 'dwarf', 'orc', 'camel-folk', 'ghoul', 'zombie', 'vampire', 'spirit', 'djinn'];

const RACE_ICONS: Record<string, IconName> = {
  human: 'person', elf: 'woman-elf-face', dwarf: 'dwarf-face', orc: 'orc-head', 'camel-folk': 'camel-head', camel: 'camel-head',
  ghoul: 'daemon-skull', zombie: 'shambling-zombie', vampire: 'vampire-dracula', spirit: 'spectre', ghost: 'spectre', djinn: 'djinn', jinn: 'djinn',
};

/** Icon for a race or kind: a known one by its (singular, lower-case) word, otherwise a hooded figure. */
export function raceIcon(race: string): IconName {
  const key = race.trim().toLowerCase().replace(/\s+/g, '-');
  return RACE_ICONS[key] ?? RACE_ICONS[key.replace(/s$/, '')] ?? 'hood';
}
export function raceSuggestions(entries: readonly Entry[]): string[] {
  const used = entries.flatMap((e) => (e.type === 'character' && e.race?.trim() ? [e.race.trim()] : []));
  return [...new Set([...used.sort((a, b) => a.localeCompare(b)), ...DEFAULT_RACES])];
}

/** The end date text (died/destroyed/dissolved), even when the editor hides it. */
export function endValue(e: Entry): string | undefined {
  const lc = LIFECYCLE[e.type];
  return lc ? rec(e)[lc.endField] : undefined;
}

/**
 * Show the end-date field only when the status says it ended, or when no status is set but a value is there.
 * An ongoing status (alive, standing, active, intact, lost) hides it; a hidden value stays in the file.
 */
export function endFieldVisible(e: Entry): boolean {
  const lc = LIFECYCLE[e.type];
  if (!lc) return false;
  const s = statusOf(e);
  if (s && lc.ended.includes(s)) return true;
  if (s && lc.ongoing.includes(s)) return false;
  return filled(endValue(e));
}

/** True when the entry is dead, destroyed or dissolved: by status, or by an end date when the status doesn't say otherwise. */
export function isEnded(e: Entry): boolean {
  const lc = LIFECYCLE[e.type];
  if (!lc) return false;
  const s = statusOf(e);
  if (s && lc.ended.includes(s)) return true;
  if (s && lc.ongoing.includes(s)) return false;
  return filled(endValue(e));
}
