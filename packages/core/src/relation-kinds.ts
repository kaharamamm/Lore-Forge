import type { IconName } from './icons.ts';
import { ENTRY_TYPES, type EntryType } from './types.ts';

export type RelationGroup = 'family' | 'bonds' | 'power' | 'possession' | 'place' | 'story' | 'other';

export const RELATION_GROUPS: Record<RelationGroup, { label: string; emoji: string; icon: IconName }> = {
  family: { label: 'Family', emoji: '👪', icon: 'family-tree' },
  bonds: { label: 'Allies and enemies', emoji: '🤝', icon: 'shaking-hands' },
  power: { label: 'Power and belonging', emoji: '👑', icon: 'crown' },
  possession: { label: 'Possessions', emoji: '🎒', icon: 'backpack' },
  place: { label: 'Places and parts', emoji: '📍', icon: 'position-marker' },
  story: { label: 'Deeds and events', emoji: '📖', icon: 'open-book' },
  other: { label: 'Other', emoji: '🔗', icon: 'linked-rings' },
};

/**
 * One relationship type: which entry types may use it (from) and point at (to).
 * `sameType` means the target must be the same type as the source (place part-of place).
 */
export interface RelationKind {
  type: string;
  /** "parent of": reads as "<source> parent of <target>". */
  label: string;
  /** Label seen from the target: "child of". */
  inverse: string;
  group: RelationGroup;
  from: readonly EntryType[];
  to: readonly EntryType[];
  sameType?: boolean;
  symmetric?: boolean;
  /** Other spellings accepted in files. */
  aliases?: readonly string[];
}

const C = 'character', P = 'place', F = 'faction', I = 'item', E = 'event', N = 'note';
const ALL = ENTRY_TYPES;

/** The relationship table. Shared by the editor, the checker and other tools (AI-HQ). Custom types outside it are allowed. */
export const RELATION_KINDS: readonly RelationKind[] = [
  { type: 'parent-of', label: 'parent of', inverse: 'child of', group: 'family', from: [C], to: [C] },
  { type: 'child-of', label: 'child of', inverse: 'parent of', group: 'family', from: [C], to: [C] },
  { type: 'spouse-of', label: 'spouse of', inverse: 'spouse of', group: 'family', from: [C], to: [C], symmetric: true },
  { type: 'sibling-of', label: 'sibling of', inverse: 'sibling of', group: 'family', from: [C], to: [C], symmetric: true },
  { type: 'friend-of', label: 'friend of', inverse: 'friend of', group: 'bonds', from: [C], to: [C], symmetric: true },
  { type: 'mentor-of', label: 'mentor of', inverse: 'student of', group: 'bonds', from: [C], to: [C] },
  { type: 'ally-of', label: 'ally of', inverse: 'ally of', group: 'bonds', from: [C, F], to: [C, F], symmetric: true, aliases: ['allied-with'] },
  { type: 'enemy-of', label: 'enemy of', inverse: 'enemy of', group: 'bonds', from: [C, F], to: [C, F], symmetric: true },
  { type: 'member-of', label: 'member of', inverse: 'has member', group: 'power', from: [C, F], to: [F] },
  { type: 'leader-of', label: 'leader of', inverse: 'led by', group: 'power', from: [C], to: [F] },
  { type: 'serves', label: 'serves', inverse: 'served by', group: 'power', from: [C, F], to: [C, F] },
  { type: 'rules', label: 'rules', inverse: 'ruled by', group: 'power', from: [C, F], to: [P, F] },
  { type: 'founded', label: 'founded', inverse: 'founded by', group: 'power', from: [C, F], to: [P, F] },
  { type: 'owns', label: 'owns', inverse: 'owned by', group: 'possession', from: [C, F], to: [I, P] },
  { type: 'wields', label: 'wields', inverse: 'wielded by', group: 'possession', from: [C], to: [I] },
  { type: 'made', label: 'made', inverse: 'made by', group: 'possession', from: [C, F], to: [I] },
  { type: 'lives-in', label: 'lives in', inverse: 'home of', group: 'place', from: [C], to: [P] },
  { type: 'located-in', label: 'located in', inverse: 'contains', group: 'place', from: [P, I, F], to: [P] },
  { type: 'part-of', label: 'part of', inverse: 'includes', group: 'place', from: [P, F, I, E], to: [P, F, I, E], sameType: true },
  { type: 'took-place-at', label: 'took place at', inverse: 'scene of', group: 'place', from: [E], to: [P] },
  { type: 'killed', label: 'killed', inverse: 'killed by', group: 'story', from: [C, F], to: [C] },
  { type: 'involved-in', label: 'involved in', inverse: 'involves', group: 'story', from: [C, F, I, P], to: [E] },
  { type: 'caused', label: 'caused', inverse: 'caused by', group: 'story', from: [E, C, F], to: [E] },
  { type: 'about', label: 'about', inverse: 'described in', group: 'story', from: [N], to: ALL },
  { type: 'related-to', label: 'related to', inverse: 'related to', group: 'other', from: ALL, to: ALL, symmetric: true },
];

const BY_TYPE = new Map<string, RelationKind>();
for (const k of RELATION_KINDS) for (const t of [k.type, ...(k.aliases ?? [])]) BY_TYPE.set(t, k);

/** The table row for a relation type (or one of its aliases); undefined for custom types. */
export function relationKind(type: string): RelationKind | undefined {
  return BY_TYPE.get(type.trim().toLowerCase());
}

/** True when `kind` may go from an entry of type `from` to one of type `to`. */
export function relationFits(kind: RelationKind, from: EntryType, to: EntryType): boolean {
  return kind.from.includes(from) && kind.to.includes(to) && (!kind.sameType || from === to);
}

/** Relation types that make sense from `from` (and to `to`, when known), in table order. */
export function relationKindsFor(from: EntryType, to?: EntryType): RelationKind[] {
  return RELATION_KINDS.filter((k) => (to ? relationFits(k, from, to) : k.from.includes(from)));
}

/** Entry types a relation of `type` may point at from `from`; every type for custom relation types. */
export function relationTargets(type: string, from: EntryType): EntryType[] {
  const k = relationKind(type);
  if (!k) return [...ENTRY_TYPES];
  if (!k.from.includes(from)) return [];
  return k.sameType ? [from] : [...k.to];
}

/** How a relation reads from the target's side, e.g. "child of" for parent-of. */
export function inverseLabel(type: string): string {
  return relationKind(type)?.inverse ?? `${type.replace(/-/g, ' ')} (from)`;
}

/** How a relation reads from the source's side. */
export function relationLabel(type: string): string {
  return relationKind(type)?.label ?? type.replace(/-/g, ' ');
}
