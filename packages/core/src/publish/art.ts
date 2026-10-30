import { VISUAL_FIELDS, type Entry } from '../types.ts';
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

/** Build an art brief from an entry's name, summary and visual description. Characters, places, items and events only. */
export function artBrief(entry: Entry, ix: WorldIndex): ArtBrief | undefined {
  if (!ART_TYPES.has(entry.type)) return undefined;
  const v = entry.visual ?? {};
  const fields = VISUAL_FIELDS[entry.type];
  const missing = fields.filter((f) => !v[f.key]?.trim()).map((f) => f.label);
  const described = fields.filter((f) => v[f.key]?.trim()).map((f) => `${f.label}: ${sentence(v[f.key]!)}`);
  const look = (keys: string[]) => fields.filter((f) => keys.includes(f.key) && v[f.key]?.trim()).map((f) => `${f.label}: ${sentence(v[f.key]!)}`);
  const about = entry.summary ? ` ${sentence(entry.summary)}` : '';
  const world = `Setting: the world of ${ix.world.manifest.name}.`;
  const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' ');

  switch (entry.type) {
    case 'character': {
      const build = v['build']?.trim();
      const props = v['props']?.trim();
      return {
        prompt: join(`Full-body character concept art of ${entry.name}${entry.race?.trim() ? `, a ${entry.race.trim()}` : ''}.${about}`, ...described, world, 'Clear silhouette, readable costume details.'),
        turnaround: join(
          `3D turnaround reference sheet of ${entry.name}${entry.race?.trim() ? ` (${entry.race.trim()})` : ''}.`,
          'Neutral A-pose, arms slightly away from the body, relaxed hands, neutral expression.',
          `Five views side by side: front, back, left, right and three-quarter, same scale and the same height in every view${build ? ` (${build.replace(/\.$/, '')})` : ''}.`,
          'Plain light-grey background, flat even lighting, no cast shadows, no motion blur, no text.',
          props ? `Props: only ${props.replace(/\.$/, '')}.` : 'No props.',
          ...look(['appearance', 'clothing', 'palette', 'features']),
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
          ...look(['material', 'details']),
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
      return {
        prompt: join(
          `Illustration of the scene "${entry.name}"${place ? ` at ${place}` : ''}${date ? ` (${date})` : ''}.${about}`,
          ...described,
          who.length ? `Shows: ${who.join(', ')}.` : undefined,
          world, 'Cinematic composition, no text.',
        ),
        missing,
      };
    }
    default:
      return undefined;
  }
}
