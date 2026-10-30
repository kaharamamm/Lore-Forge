import { definitelyBefore, parseDate } from '../dates.ts';
import type { Finding, Rule } from '../engine.ts';

export const invalidDate: Rule = {
  id: 'invalid-date',
  title: 'Date that cannot be read',
  description: 'A date is not in the world calendar format, uses an unknown era, or has an impossible month or day.',
  severity: 'error',
  check: ({ ix }) =>
    ix.entries.flatMap((e) =>
      ix.dateFields(e).flatMap(([field, text]): Finding[] => {
        const r = parseDate(text, ix.calendar);
        return r.kind === 'invalid' ? [{ key: `${e.id}:${field}`, message: `${e.name}, ${field}: ${r.reason.replace(/\.$/, '')} (source: ${ix.source(e)}).`, offending: ix.fact(e, field) }] : [];
      }),
    ),
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
        out.push({ key: `${e.id}:life`, message: `${e.name} ${end.word} ${ix.at(end.date)}, before ${e.name} ${start.word} ${ix.at(start.date)} (source: ${ix.source(e)}).`, offending: ix.fact(e, end.field), conflicting: ix.fact(e, start.field) });
      }
      const spans: [string, string, string | undefined, string | undefined][] = [
        ...(e.relations ?? []).map((r, i): [string, string, string | undefined, string | undefined] => [`relations[${i}]`, `"${r.type}" ${ix.nameOf(r.target)}`, r.from, r.to]),
        ...(e.type === 'character' ? (e.locations ?? []).map((l, i): [string, string, string | undefined, string | undefined] => [`locations[${i}]`, `stay in ${ix.nameOf(l.place)}`, l.from, l.to]) : []),
      ];
      for (const [field, what, fromText, toText] of spans) {
        const from = ix.date(fromText);
        const to = ix.date(toText);
        if (from && to && definitelyBefore(to, from)) {
          out.push({ key: `${e.id}:${field}`, message: `${e.name}'s ${what} ends ${ix.at(to)}, before it starts ${ix.at(from)} (source: ${ix.source(e)}).`, offending: ix.fact(e, field) });
        }
      }
    }
    return out;
  },
};
