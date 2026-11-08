import type { ParsedDate } from '../dates.ts';
import { when, type Appearance } from '../appearances.ts';
import type { Finding, Rule, RuleContext } from '../engine.ts';
import { msg } from '../i18n.ts';
import type { FactRef } from '../types.ts';

/** A known start or end of an entry's life, ready for a message. */
interface Edge {
  /** "was born", "died", "was killed by Orsan". */
  word: string;
  date: ParsedDate;
  /** The latest absolute day it can be. */
  hi: number;
  at: FactRef;
}

/** When a character's life ended: the death date, or else the earliest dated killing (an event or a "killed" relation). */
function lifeEnd(ctx: RuleContext, a: Appearance): Edge | undefined {
  const { ix } = ctx;
  const end = ix.life(a.who).end;
  if (end) return { word: end.word, date: end.date, hi: end.date.hi, at: ix.fact(a.who, end.field) };
  if (a.who.type !== 'character') return undefined;
  let first: Edge | undefined;
  for (const k of ix.killingsOf(a.who.id)) {
    if (!k.date || k.latest === undefined || (first && first.hi <= k.latest)) continue;
    first = { word: k.word, date: k.date, hi: k.latest, at: k.at };
  }
  return first;
}

function outsideLife(ctx: RuleContext, a: Appearance, side: 'before' | 'after'): Finding | undefined {
  const { ix } = ctx;
  // Taking part in an event only needs some overlap with the life: a 116-year war can have a 19-year life in it.
  // A stay or a dated relation lasts its whole span, so the whole span has to fit.
  const overlap = a.kind === 'event';
  let edge: Edge | undefined;
  if (side === 'after') {
    edge = lifeEnd(ctx, a);
    if (!edge || !(edge.hi < (overlap ? a.from : a.to).lo)) return undefined;
  } else {
    const start = ix.life(a.who).start;
    if (!start || !((overlap ? a.to : a.from).hi < start.date.lo)) return undefined;
    edge = { word: start.word, date: start.date, hi: start.date.hi, at: ix.fact(a.who, start.field) };
  }
  const f: Finding = {
    key: a.key,
    message: msg`${a.who.name} can't ${a.phrase} ${when(ix, a)}: ${a.who.name} ${edge.word} ${ix.at(edge.date)} (source: ${edge.at.source}).`,
    offending: a.at,
    conflicting: edge.at,
  };
  if (a.legacyKey !== undefined) f.legacyKey = a.legacyKey;
  return f;
}

export const afterDeath: Rule = {
  id: 'after-death',
  title: 'Acts after death',
  description: 'A character does something, takes part in an event or is somewhere after they died (or were killed).',
  severity: 'error',
  check: (ctx) => ctx.appearances.filter((a) => a.who.type === 'character').flatMap((a) => outsideLife(ctx, a, 'after') ?? []),
};

export const beforeBirth: Rule = {
  id: 'before-birth',
  title: 'Acts before birth',
  description: 'A character does something, takes part in an event or is somewhere before they were born.',
  severity: 'error',
  check: (ctx) => ctx.appearances.filter((a) => a.who.type === 'character').flatMap((a) => outsideLife(ctx, a, 'before') ?? []),
};

const EXISTING_TYPES: ReadonlySet<string> = new Set(['faction', 'item', 'place']);

export const participantNotExisting: Rule = {
  id: 'participant-not-existing',
  title: 'Participant does not exist yet (or any more)',
  description: 'A faction, item or place takes part in something before it was founded or made, or after it was dissolved or destroyed.',
  severity: 'error',
  check: (ctx) =>
    ctx.appearances
      .filter((a) => EXISTING_TYPES.has(a.who.type))
      .flatMap((a) => outsideLife(ctx, a, 'before') ?? outsideLife(ctx, a, 'after') ?? []),
};
