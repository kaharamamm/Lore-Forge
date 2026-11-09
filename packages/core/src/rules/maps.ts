import type { Finding, Rule } from '../engine.ts';
import { msg } from '../i18n.ts';
import { MANIFEST_FILE } from '../parse.ts';
import { findMap } from '../views/map-model.ts';

/** A pin on a map the book does not have, or a map set to show a place the book does not have. */
export const mapPin: Rule = {
  id: 'map-pin',
  title: 'Pin on a map that does not exist',
  description: 'A place is pinned on a map that the book does not have, or a map is set to show a place that does not exist.',
  severity: 'warning',
  check: ({ ix, world }) => {
    const out: Finding[] = [];
    const maps = world.manifest.maps ?? [];
    for (const e of ix.entries) {
      if (e.type !== 'place') continue;
      e.pins?.forEach((p, i) => {
        if (findMap(maps, p.map)) return;
        out.push({ key: `${e.id}:${p.map}`, message: msg`${e.name} is pinned on the map "${p.map}", which this book does not have (source: ${ix.source(e)}).`, offending: ix.fact(e, `pins[${i}]`) });
      });
    }
    maps.forEach((m, i) => {
      const ref = m.place?.trim();
      if (!ref) return;
      const target = ix.resolve(ref);
      if (target?.type === 'place') return;
      const at = { entryId: MANIFEST_FILE, field: `maps[${i}].place`, source: MANIFEST_FILE };
      out.push({
        key: `map:${m.id}`,
        message: target
          ? msg`The map "${m.name}" is set to show ${target.name}, which is not a place (source: ${MANIFEST_FILE}).`
          : msg`The map "${m.name}" is set to show "${ref}", but no entry has that id or name (source: ${MANIFEST_FILE}).`,
        offending: at,
        ...(target ? { conflicting: ix.fact(target, 'type') } : {}),
      });
    });
    return out;
  },
};
