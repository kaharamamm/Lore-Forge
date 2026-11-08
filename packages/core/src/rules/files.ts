import type { Finding, Rule } from '../engine.ts';
import { msg } from '../i18n.ts';
import { entryPath } from '../parse.ts';
import type { FactRef } from '../types.ts';
import { slugify } from '../story.ts';
import { numberDuplicates } from '../world-index.ts';

const EMPTY_NAME = msg`"name" is empty.`;

export const fileError: Rule = {
  id: 'file-error',
  title: 'File that cannot be read',
  description: 'A world file has broken front matter, a missing id/name/type, an empty name, or a field of the wrong kind; or world.json has a value that cannot be used.',
  severity: 'error',
  check: ({ world, ix }) => {
    // Problems found when the files were read, plus entries whose name is empty. The name is checked here, on every
    // check, so the warning comes and goes with the editor (a load problem would stay until the world is reloaded).
    const issues = [...world.issues];
    const at = new Map<number, FactRef>();
    for (const e of ix.entries) {
      if (e.name.trim()) continue;
      const file = world.files[e.id] ?? entryPath(e);
      at.set(issues.length, ix.fact(e, 'name'));
      issues.push({ file, message: EMPTY_NAME });
    }
    if (!issues.length) return [];
    const entryOf = new Map(Object.entries(world.files).map(([id, path]) => [path, id]));
    // Keyed on the file and the problem, so fixing one file does not move the marks on another.
    const keys = numberDuplicates(issues.map((iss) => `${iss.file}:${slugify(iss.message, 'problem')}`));
    return issues.map((iss, i): Finding => ({
      key: keys[i]!,
      ...(i < world.issues.length ? { legacyKey: `${iss.file}:${i}` } : {}),
      message: msg`${iss.file}: ${iss.message}`,
      offending: at.get(i) ?? { entryId: entryOf.get(iss.file) ?? iss.file, field: 'file', source: iss.file },
    }));
  },
};
