import type { Finding, Rule } from '../engine.ts';
import { LIFECYCLE } from '../lifecycle.ts';
import type { FactRef } from '../types.ts';

const DEATH_VERBS = new Set(['killed', 'murdered', 'slew', 'slain', 'executed']);

export const deadMarkedAlive: Rule = {
  id: 'dead-marked-alive',
  title: 'Dead or destroyed entry marked as still there',
  description: 'A character is marked "alive" although a death date or a killing says they died; or a place, faction or item is marked standing, active or intact although it has a destroyed or dissolved date. Hidden date fields still count.',
  severity: 'error',
  check: ({ ix }) => {
    const out: Finding[] = [];
    for (const x of ix.entries) {
      if (x.type !== 'place' && x.type !== 'faction' && x.type !== 'item') continue;
      const lc = LIFECYCLE[x.type]!;
      const end = (x as unknown as Record<string, string | undefined>)[lc.endField];
      if (!x.status || x.status === 'lost' || !lc.ongoing.includes(x.status) || !end || end.trim() === '') continue;
      const d = ix.date(end);
      const at = ix.fact(x, lc.endField);
      out.push({ key: x.id, message: `${x.name} is marked ${x.status}, but was ${lc.endedWord} ${d ? ix.at(d) : '(date unknown)'} (source: ${at.source}).`, offending: ix.fact(x, 'status'), conflicting: at });
    }
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
