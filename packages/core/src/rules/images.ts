import type { Finding, Rule } from '../engine.ts';
import { joined, msg, verbatim } from '../i18n.ts';
import { IMAGE_VIEWS, viewLabel } from '../types.ts';
import { A_TYPE } from '../words.ts';
import { numberDuplicates } from '../world-index.ts';

export const imageView: Rule = {
  id: 'image-view',
  title: 'Unusual image view',
  description: 'A reference image uses a view label that is not one of the usual views for its entry type (often a typo).',
  severity: 'info',
  check: ({ ix }) => {
    const out: Finding[] = [];
    for (const e of ix.entries) {
      if (!e.images?.length) continue;
      const usual = IMAGE_VIEWS[e.type];
      const keys = numberDuplicates(e.images.map((img) => img.file));
      e.images.forEach((img, i) => {
        if (usual.includes(img.view)) return;
        out.push({
          key: `${e.id}:${keys[i]}`,
          legacyKey: `${e.id}:${i}`,
          message: msg`${img.file} is labelled "${verbatim(img.view)}", which is not a usual view for ${A_TYPE[e.type]} (usual: ${joined(usual.map(viewLabel), ', ')}).`,
          offending: ix.fact(e, `images[${i}]`),
        });
      });
    }
    return out;
  },
};
