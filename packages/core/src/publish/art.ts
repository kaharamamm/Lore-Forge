import { lookAt, lookVisual } from '../looks.ts';
import { VISUAL_FIELDS, type Entry, type Look } from '../types.ts';
import type { WorldIndex } from '../world-index.ts';
import { showDate } from './doc.ts';

export interface ArtBrief {
  /** One ready-to-use text-to-image prompt. */
  prompt: string;
  /** Characters and items: a 3D turnaround sheet brief. */
  turnaround?: string;
  /** Labels of visual fields that are empty; filling them makes the brief better. */
  missing: string[];
}

const ART_TYPES = new Set<Entry['type']>(['character', 'place', 'item', 'event']);
const sentence = (s: string): string => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/**
 * Build an art brief from an entry's name, summary and visual description. Characters, places, items and events only.
 * With a look: that look's description (the Default one with what the look changes), and why it looks that way.
 */
export function artBrief(entry: Entry, ix: WorldIndex, look?: Look): ArtBrief | undefined {
  if (!ART_TYPES.has(entry.type)) return undefined;
  const v = lookVisual(entry, look);
  const fields = VISUAL_FIELDS[entry.type];
  const missing = fields.filter((f) => !v[f.key]?.trim()).map((f) => f.label);
  const described = fields.filter((f) => v[f.key]?.trim()).map((f) => `${f.label}: ${sentence(v[f.key]!)}`);
  const traits = (keys: string[]) => fields.filter((f) => keys.includes(f.key) && v[f.key]?.trim()).map((f) => `${f.label}: ${sentence(v[f.key]!)}`);
  const lookLine = look ? ` As they look in "${look.name || look.id}"${look.reason?.trim() ? `: ${look.reason.trim().replace(/\.$/, '')}` : ''}.` : '';
  const about = `${entry.summary ? ` ${sentence(entry.summary)}` : ''}${lookLine}`;
  const world = `Setting: the world of ${ix.world.manifest.name}.`;
  const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' ');

  switch (entry.type) {
    case 'character': {
      const d = (k: string) => (typeof entry.details?.[k] === 'string' ? (entry.details[k] as string).trim() : '');
      const races = entry.race?.split(',').map((r) => r.trim()).filter(Boolean).join(' and ') ?? '';
      const who = [d('gender'), races, d('occupation')].filter(Boolean).join(' ');
      const titled = d('title') && !entry.name.toLowerCase().startsWith(d('title').toLowerCase()) ? `${d('title')} ${entry.name}` : entry.name;
      const build = v['build']?.trim();
      const props = v['props']?.trim();
      return {
        prompt: join(`Full-body character concept art of ${titled}${who ? `, a ${who}` : ''}.${about}`, ...described, world, 'Clear silhouette, readable costume details.'),
        turnaround: join(
          `3D turnaround reference sheet of ${titled}${who ? ` (${who})` : ''}.`,
          'Neutral A-pose, arms slightly away from the body, relaxed hands, neutral expression.',
          `Five views side by side: front, back, left, right and three-quarter, same scale and the same height in every view${build ? ` (${build.replace(/\.$/, '')})` : ''}.`,
          'Plain light-grey background, flat even lighting, no cast shadows, no motion blur, no text.',
          props ? `Props: only ${props.replace(/\.$/, '')}.` : 'No props.',
          ...traits(['appearance', 'clothing', 'palette', 'features']),
        ),
        missing,
      };
    }
    case 'item': {
      const size = v['size']?.trim();
      return {
        prompt: join(`Detailed prop concept art of ${entry.name}, shown alone.${about}`, ...described, world),
        turnaround: join(
          `3D turnaround reference sheet of ${entry.name}, a single object.`,
          'Neutral resting orientation, centred, not held by anyone.',
          `Views side by side: front, back, left, right, three-quarter and top, same scale in every view${size ? ` (${size.replace(/\.$/, '')})` : ''}.`,
          'Plain light-grey background, flat even lighting, no cast shadows, no other props, no text.',
          ...traits(['material', 'details']),
        ),
        missing,
      };
    }
    case 'place':
      return { prompt: join(`Wide establishing shot of ${entry.name}.${about}`, ...described, world, 'No text or labels.'), missing };
    case 'event': {
      const place = entry.place ? ix.nameOf(entry.place) : undefined;
      const date = showDate(entry.date, ix);
      const who = (entry.participants ?? []).map((p) => ix.nameOf(p.id));
      // Each one as they look on the day: a look that started before the event shows, not the Default one.
      const when = ix.date(entry.date);
      const looks = when ? (entry.participants ?? []).flatMap((p) => {
        const e = ix.resolve(p.id);
        const lk = e && lookAt(e, when, ix);
        if (!e || !lk) return [];
        const changed = VISUAL_FIELDS[e.type].filter((f) => lk.visual?.[f.key]?.trim()).map((f) => `${f.label.toLowerCase()}: ${lk.visual![f.key]!.trim().replace(/\.$/, '')}`);
        return [`${e.name} as in "${lk.name || lk.id}"${lk.reason?.trim() ? ` (${lk.reason.trim().replace(/\.$/, '')})` : ''}${changed.length ? `: ${changed.join('; ')}` : ''}.`];
      }) : [];
      return {
        prompt: join(
          `Illustration of the scene "${entry.name}"${place ? ` at ${place}` : ''}${date ? ` (${date})` : ''}.${about}`,
          ...described,
          who.length ? `Shows: ${who.join(', ')}.` : undefined,
          ...looks,
          world, 'Cinematic composition, no text.',
        ),
        missing,
      };
    }
    default:
      return undefined;
  }
}
