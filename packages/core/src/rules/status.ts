import type { Finding, Rule } from '../engine.ts';
import type { FactRef } from '../types.ts';

const DEATH_VERBS = new Set(['killed', 'murdered', 'slew', 'slain', 'executed']);

export const deadMarkedAlive: Rule = {
  id: 'dead-marked-alive',
  title: 'Dead character marked alive',
  description: 'A character is marked "alive" although a death date or a killing says they died.',
  severity: 'error',
  check: ({ ix }) => {
    const out: Finding[] = [];
    for (const c of ix.entries) {
      if (c.type !== 'character' || c.status !== 'alive') continue;
      let because: { text: string; at: FactRef } | undefined;
      if (c.died !== undefined && c.died.trim() !== '') {
        const d = ix.date(c.died);
        because = { text: `${c.name} died ${d ? ix.at(d) : '(date unknown)'}`, at: ix.fact(c, 'died') };
      }
      for (const e of ix.entries) {
        if (because) break;
        if (e.type !== 'event') continue;
        e.actions?.forEach((a, i) => {
          if (!because && a.target && ix.resolve(a.target)?.id === c.id && DEATH_VERBS.has(a.verb.toLowerCase())) {
            const d = ix.date(e.date);
            because = { text: `${c.name} was ${a.verb} by ${ix.nameOf(a.actor)}${d ? ` ${ix.at(d)}` : ''}`, at: ix.fact(e, `actions[${i}]`) };
          }
        });
      }
      if (because) {
        out.push({ key: c.id, message: `${c.name} is marked alive, but ${because.text} (source: ${because.at.source}).`, offending: ix.fact(c, 'status'), conflicting: because.at });
      }
    }
    return out;
  },
};
