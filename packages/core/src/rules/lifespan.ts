import { definitelyBefore } from '../dates.ts';
import { when, type Appearance } from '../appearances.ts';
import type { Finding, Rule, RuleContext } from '../engine.ts';

function outsideLife(ctx: RuleContext, a: Appearance, side: 'before' | 'after'): Finding | undefined {
  const { ix } = ctx;
  const life = ix.life(a.who);
  const point = side === 'after' ? life.end : life.start;
  if (!point) return undefined;
  const broken = side === 'after' ? definitelyBefore(point.date, a.to) : definitelyBefore(a.from, point.date);
  if (!broken) return undefined;
  return {
    key: a.key,
    message: `${a.who.name} can't ${a.phrase} ${when(ix, a)}: ${a.who.name} ${point.word} ${ix.at(point.date)} (source: ${ix.source(a.who)}).`,
    offending: a.at,
    conflicting: ix.fact(a.who, point.field),
  };
}

export const afterDeath: Rule = {
  id: 'after-death',
  title: 'Acts after death',
  description: 'A character does something, takes part in an event or is somewhere after they died.',
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

export const participantNotExisting: Rule = {
  id: 'participant-not-existing',
  title: 'Participant does not exist yet (or any more)',
  description: 'A faction, item or place takes part in something before it was founded or made, or after it was dissolved or destroyed.',
  severity: 'error',
  check: (ctx) =>
    ctx.appearances
      .filter((a) => a.who.type !== 'character')
      .flatMap((a) => outsideLife(ctx, a, 'before') ?? outsideLife(ctx, a, 'after') ?? []),
};
