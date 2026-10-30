import type { Rule } from '../engine.ts';

export const fileError: Rule = {
  id: 'file-error',
  title: 'File that cannot be read',
  description: 'A world file has broken front matter, a missing id/name/type, or a field of the wrong kind.',
  severity: 'error',
  check: ({ world }) =>
    world.issues.map((iss, i) => {
      const entryId = Object.entries(world.files).find(([, p]) => p === iss.file)?.[0] ?? iss.file;
      return { key: `${iss.file}:${i}`, message: `${iss.file}: ${iss.message}`, offending: { entryId, field: 'file', source: iss.file } };
    }),
};
