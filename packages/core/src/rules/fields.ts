import type { Finding, Rule } from '../engine.ts';
import { customFields, fieldValueProblem } from '../fields.ts';
import { msg, verbatim } from '../i18n.ts';

/** A value that does not fit its field (World settings): words in a number field, a yes-or-no field holding something else, a choice not on the list. */
export const fieldValue: Rule = {
  id: 'field-value',
  title: 'Field value of the wrong kind',
  description: "A value in one of the book's own fields (World settings) does not fit the field: words in a number field, something other than yes or no, or a choice that is not on the field's list.",
  severity: 'warning',
  check: ({ ix, world }) => {
    const out: Finding[] = [];
    if (!world.manifest.fields) return out;
    for (const e of ix.entries) {
      if (!e.fields) continue;
      for (const f of customFields(world.manifest, e.type)) {
        const value = e.fields[f.key];
        if (value === undefined) continue;
        const wrong = fieldValueProblem(f, value);
        if (!wrong) continue;
        const name = verbatim(f.name);
        const shown = verbatim(String(value));
        const message = wrong === 'number'
          ? msg`${e.name}: "${name}" should be a number, not "${shown}" (source: ${ix.source(e)}).`
          : wrong === 'yes-no'
            ? msg`${e.name}: "${name}" should be yes or no, not "${shown}" (source: ${ix.source(e)}).`
            : msg`${e.name}: "${name}" should be one of ${verbatim(f.choices?.join(', ') ?? '')}, not "${shown}" (source: ${ix.source(e)}).`;
        out.push({ key: `${e.id}:${f.key}`, message, offending: ix.fact(e, `fields.${f.key}`) });
      }
    }
    return out;
  },
};
