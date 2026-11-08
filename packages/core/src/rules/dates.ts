import { definitelyBefore } from '../dates.ts';
import { eraBounds, eraRangeProblem } from '../calendar.ts';
import type { Finding, Rule } from '../engine.ts';
import { msg, verbatim, withoutStop } from '../i18n.ts';
import { chapterDate } from '../story.ts';
import { STORY_REF_PREFIX } from '../world-index.ts';
import type { FactRef } from '../types.ts';

export const invalidDate: Rule = {
  id: 'invalid-date',
  title: 'Date that cannot be read',
  description: 'A date is not in the world calendar format, uses an unknown era, has an impossible month or day, or falls outside its era (story chapter dates too).',
  severity: 'error',
  check: ({ ix, world }) => {
    const out: Finding[] = [];
    const bounds = eraBounds(ix.calendar);
    const problem = (text: string): string | undefined => {
      const r = ix.parse(text);
      return r.kind === 'invalid' ? r.reason : r.kind === 'date' ? eraRangeProblem(text, r.date, ix.calendar, bounds) : undefined;
    };
    const report = (reason: string, who: string, field: string, at: FactRef, key: string, legacyKey?: string): void => {
      const f: Finding = { key, message: msg`${who}, ${verbatim(field)}: ${withoutStop(reason)} (source: ${at.source}).`, offending: at };
      if (legacyKey !== undefined && legacyKey !== key) f.legacyKey = legacyKey;
      out.push(f);
    };
    for (const e of ix.entries) {
      for (const [field, text] of ix.lifeFields(e)) {
        const reason = problem(text);
        if (reason) report(reason, e.name, field, ix.fact(e, field), `${e.id}:${field}`);
      }
      // Rows are keyed by what they are (WorldIndex.rowKeys), worked out only for a row that has a problem.
      const rows = (list: 'relations' | 'locations', spans: readonly { from?: string; to?: string }[] | undefined): void =>
        spans?.forEach((span, i) => {
          for (const end of ['from', 'to'] as const) {
            const text = span[end];
            const reason = text === undefined ? undefined : problem(text);
            if (!reason) continue;
            const field = `${list}[${i}].${end}`;
            report(reason, e.name, field, ix.fact(e, field), `${e.id}:${ix.rowKeys(e)[list][i]}.${end}`, `${e.id}:${field}`);
          }
        });
      rows('relations', e.relations);
      if (e.type === 'character') rows('locations', e.locations);
      // Looks have their own ids, so the key names the look, not where it sits in the list.
      e.looks?.forEach((look, i) => {
        for (const end of ['from', 'to'] as const) {
          const text = look[end];
          const reason = text === undefined ? undefined : problem(text);
          if (reason) report(reason, e.name, `looks[${i}].${end}`, ix.fact(e, `looks[${i}].${end}`), `${e.id}:${look.id}.${end}`);
        }
      });
    }
    for (const ch of world.story ?? []) {
      const text = chapterDate(ch);
      const reason = text === undefined ? undefined : problem(text);
      if (!reason) continue;
      const field = ch.date ? 'date' : 'year';
      report(reason, ch.title, field, ix.chapterFact(ch, field), `${STORY_REF_PREFIX}${ch.file}:${field}`);
    }
    return out;
  },
};

export const dateOrder: Rule = {
  id: 'date-order',
  title: 'End before start',
  description: 'Something ends before it starts: death before birth, destruction before founding, an event or stay that ends before it begins.',
  severity: 'error',
  check: ({ ix }) => {
    const out: Finding[] = [];
    for (const e of ix.entries) {
      const { start, end } = ix.life(e);
      if (start && end && definitelyBefore(end.date, start.date)) {
        out.push({ key: `${e.id}:life`, message: msg`${e.name} ${end.word} ${ix.at(end.date)}, before ${e.name} ${start.word} ${ix.at(start.date)} (source: ${ix.source(e)}).`, offending: ix.fact(e, end.field), conflicting: ix.fact(e, start.field) });
      }
      const spans = (list: 'relations' | 'locations', rows: readonly { from?: string; to?: string }[] | undefined, what: (i: number) => string): void =>
        rows?.forEach((row, i) => {
          if (row.from === undefined || row.to === undefined) return;
          const from = ix.date(row.from);
          const to = ix.date(row.to);
          if (!from || !to || !definitelyBefore(to, from)) return;
          const field = `${list}[${i}]`;
          out.push({ key: `${e.id}:${ix.rowKeys(e)[list][i]}`, legacyKey: `${e.id}:${field}`, message: msg`${e.name}'s ${what(i)} ends ${ix.at(to)}, before it starts ${ix.at(from)} (source: ${ix.source(e)}).`, offending: ix.fact(e, field) });
        });
      spans('relations', e.relations, (i) => msg`"${verbatim(e.relations![i]!.type)}" ${ix.nameOf(e.relations![i]!.target)}`);
      if (e.type === 'character') spans('locations', e.locations, (i) => msg`stay in ${ix.nameOf(e.locations![i]!.place)}`);
    }
    return out;
  },
};
