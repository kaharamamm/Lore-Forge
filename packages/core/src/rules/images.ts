import type { Finding, Rule } from '../engine.ts';
import { IMAGE_VIEWS, viewLabel } from '../types.ts';

export const imageView: Rule = {
  id: 'image-view',
  title: 'Unusual image view',
  description: 'A reference image uses a view label that is not one of the usual views for its entry type (often a typo).',
  severity: 'info',
  check: ({ ix }) => {
    const out: Finding[] = [];
    for (const e of ix.entries) {
      const usual = IMAGE_VIEWS[e.type];
      e.images?.forEach((img, i) => {
        if (usual.includes(img.view)) return;
        out.push({
          key: `${e.id}:${i}`,
          message: `${img.file} is labelled "${img.view}", which is not a usual view for ${/^[aeiou]/.test(e.type) ? 'an' : 'a'} ${e.type} (usual: ${usual.map(viewLabel).join(', ')}).`,
          offending: ix.fact(e, `images[${i}]`),
        });
      });
    }
    return out;
  },
};
