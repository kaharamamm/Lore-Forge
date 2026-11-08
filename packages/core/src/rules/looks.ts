import type { Finding, Rule } from '../engine.ts';
import { msg } from '../i18n.ts';
import { lookEnd, lookSpan, lookStart, pointOf } from '../looks.ts';

const nameOf = (l: { name: string; id: string }): string => l.name.trim() || l.id;

/** A look's era, event or picture that does not exist, a look tied to an entry without a date, or one that ends before it starts. */
export const lookTime: Rule = {
  id: 'look-time',
  title: 'Look that cannot be placed in time',
  description: 'A look names an era or an entry that does not exist, or an entry without a date, or it ends before it starts; or a picture names a look its entry does not have.',
  severity: 'warning',
  check: ({ ix, world }) => {
    const out: Finding[] = [];
    const eras = world.manifest.calendar.eras;
    for (const e of ix.entries) {
      const looks = e.looks ?? [];
      looks.forEach((l, i) => {
        const at = ix.fact(e, `looks[${i}]`);
        const name = nameOf(l);
        const era = l.era?.trim();
        if (era && !eras.some((x) => x.id.toLowerCase() === era.toLowerCase())) {
          out.push({ key: `${e.id}:${l.id}:era`, message: msg`${e.name}: the look "${name}" is in the era "${era}", but the calendar has no such era (source: ${ix.source(e)}).`, offending: at });
        }
        for (const side of ['after', 'before'] as const) {
          const ref = l[side]?.trim();
          if (!ref) continue;
          const target = ix.resolve(ref);
          if (!target) {
            out.push({ key: `${e.id}:${l.id}:${side}`, message: side === 'after'
              ? msg`${e.name}: the look "${name}" starts after "${ref}", but no entry has that id or name (source: ${ix.source(e)}).`
              : msg`${e.name}: the look "${name}" ends before "${ref}", but no entry has that id or name (source: ${ix.source(e)}).`, offending: at });
          } else if (!pointOf(target, side, ix)) {
            out.push({ key: `${e.id}:${l.id}:${side}`, message: side === 'after'
              ? msg`${e.name}: the look "${name}" starts after ${target.name}, which has no date to start from (source: ${ix.source(e)}).`
              : msg`${e.name}: the look "${name}" ends before ${target.name}, which has no date to end at (source: ${ix.source(e)}).`, offending: at, conflicting: ix.fact(target, target.type === 'event' ? 'date' : 'status') });
          }
        }
        const s = lookSpan(l, ix);
        if (s?.lo !== undefined && s.hi !== undefined && s.lo > s.hi) {
          out.push({ key: `${e.id}:${l.id}:order`, message: msg`${e.name}: the look "${name}" ends before it starts (source: ${ix.source(e)}).`, offending: at });
        }
      });
      e.images?.forEach((img, i) => {
        if (img.look && !looks.some((l) => l.id === img.look)) {
          out.push({ key: `${e.id}:${img.file}:look`, message: msg`${e.name}: ${img.file} is for the look "${img.look}", which the entry does not have (source: ${ix.source(e)}).`, offending: ix.fact(e, `images[${i}]`) });
        }
      });
    }
    return out;
  },
};

/** A look that starts before its entry existed or after it ended (died, destroyed, dissolved). */
export const lookOutsideLife: Rule = {
  id: 'look-outside-life',
  title: "Look outside the entry's lifetime",
  description: 'A look starts after the entry ended (died, destroyed or dissolved), or starts or ends before it existed (born, founded or made).',
  severity: 'warning',
  check: ({ ix }) => {
    const out: Finding[] = [];
    for (const e of ix.entries) {
      if (!e.looks?.length) continue;
      const life = ix.life(e);
      e.looks.forEach((l, i) => {
        const at = ix.fact(e, `looks[${i}]`);
        const name = nameOf(l);
        const start = lookStart(l, ix);
        const end = lookEnd(l, ix);
        if (start && life.end && start.date.lo > life.end.date.hi) {
          out.push({ key: `${e.id}:${l.id}:after-end`, message: msg`${e.name}: the look "${name}" starts ${ix.at(start.date)}, after ${e.name} ${life.end.word} ${ix.at(life.end.date)} (source: ${ix.source(e)}).`, offending: at, conflicting: ix.fact(e, life.end.field) });
        } else if (start && life.start && start.date.hi < life.start.date.lo) {
          out.push({ key: `${e.id}:${l.id}:before-start`, message: msg`${e.name}: the look "${name}" starts ${ix.at(start.date)}, before ${e.name} ${life.start.word} ${ix.at(life.start.date)} (source: ${ix.source(e)}).`, offending: at, conflicting: ix.fact(e, life.start.field) });
        } else if (end && life.start && end.date.hi < life.start.date.lo) {
          out.push({ key: `${e.id}:${l.id}:before-start`, message: msg`${e.name}: the look "${name}" ends ${ix.at(end.date)}, before ${e.name} ${life.start.word} ${ix.at(life.start.date)} (source: ${ix.source(e)}).`, offending: at, conflicting: ix.fact(e, life.start.field) });
        }
      });
    }
    return out;
  },
};

/**
 * Two looks of one entry at the same time. A look with no end gives way to the next one that starts (that is a
 * change of look, not a clash); it clashes when both start together, or when one runs on, by its own end, into the
 * time of a look that starts later.
 */
export const lookOverlap: Rule = {
  id: 'look-overlap',
  title: 'Two looks at the same time',
  description: 'Two looks of one entry apply at the same time, so it is unclear which one shows. A look without an end simply gives way to the next one. Mark it intended when one look is worn over the other.',
  severity: 'warning',
  check: ({ ix }) => {
    const out: Finding[] = [];
    for (const e of ix.entries) {
      const timed = (e.looks ?? []).map((l, i) => ({ l, i, s: lookSpan(l, ix) })).filter((x): x is { l: typeof x.l; i: number; s: NonNullable<typeof x.s> } => !!x.s);
      for (let a = 0; a < timed.length; a++) {
        for (let b = a + 1; b < timed.length; b++) {
          const [first, second] = (timed[a]!.s.lo ?? -Infinity) <= (timed[b]!.s.lo ?? -Infinity) ? [timed[a]!, timed[b]!] : [timed[b]!, timed[a]!];
          const sameStart = (first.s.lo ?? -Infinity) === (second.s.lo ?? -Infinity);
          const runsInto = first.s.hi !== undefined && second.s.lo !== undefined && first.s.hi >= second.s.lo;
          const beforeEnd = second.s.lo === undefined || second.s.lo <= (first.s.hi ?? Infinity);
          if (!(sameStart && beforeEnd) && !runsInto) continue;
          out.push({
            key: `${e.id}:${first.l.id}+${second.l.id}`,
            message: msg`${e.name}: the looks "${nameOf(first.l)}" and "${nameOf(second.l)}" apply at the same time (source: ${ix.source(e)}).`,
            offending: ix.fact(e, `looks[${second.i}]`),
            conflicting: ix.fact(e, `looks[${first.i}]`),
          });
        }
      }
    }
    return out;
  },
};
