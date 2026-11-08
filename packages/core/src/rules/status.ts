import type { Finding, Rule } from '../engine.ts';
import { msg } from '../i18n.ts';
import { LIFECYCLE } from '../lifecycle.ts';
import { statusWord } from '../words.ts';

export const deadMarkedAlive: Rule = {
  id: 'dead-marked-alive',
  title: 'Dead or destroyed entry marked as still there',
  description: 'A character is marked "alive" although a death date or a killing (an event or a "killed" relation) says they died; or a place, faction or item is marked standing, active or intact although it has a destroyed or dissolved date. Hidden date fields still count.',
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
      out.push({ key: x.id, message: msg`${x.name} is marked ${statusWord(x.status)}, but was ${lc.endedWord} ${d ? ix.at(d) : msg`(date unknown)`} (source: ${at.source}).`, offending: ix.fact(x, 'status'), conflicting: at });
    }
    for (const c of ix.entries) {
      if (c.type !== 'character' || c.status !== 'alive') continue;
      if (c.died !== undefined && c.died.trim() !== '') {
        const d = ix.date(c.died);
        const at = ix.fact(c, 'died');
        out.push({ key: c.id, message: msg`${c.name} is marked alive, but ${c.name} died ${d ? ix.at(d) : msg`(date unknown)`} (source: ${at.source}).`, offending: ix.fact(c, 'status'), conflicting: at });
        continue;
      }
      // Killings are gathered once for the whole world (WorldIndex.killingsOf), not searched per character.
      const k = ix.killingsOf(c.id)[0];
      if (k) {
        const message = k.date
          ? msg`${c.name} is marked alive, but ${c.name} ${k.word} ${ix.at(k.date)} (source: ${k.at.source}).`
          : msg`${c.name} is marked alive, but ${c.name} ${k.word} (source: ${k.at.source}).`;
        out.push({ key: c.id, message, offending: ix.fact(c, 'status'), conflicting: k.at });
      }
    }
    return out;
  },
};
