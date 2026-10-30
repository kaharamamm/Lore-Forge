import { type EntryType, check, parseWorld, serializeEntry, entryPath, type Entry, type IntendedMark, type Warning, type World, type WorldManifest } from '@lore-forge/core';

export const manifest: WorldManifest = {
  schemaVersion: 1,
  id: 'test',
  name: 'Test World',
  calendar: { eras: [{ id: 'OK', name: 'Old Kingdom', start: -1000 }, { id: 'AS', name: 'After the Sundering', start: 1 }], defaultEra: 'AS' },
};

/** Loose entry literal for tests; parsing validates it like a real file. */
export interface Draft {
  readonly id: string;
  readonly type: EntryType;
  readonly name: string;
  readonly [field: string]: unknown;
}

/** Build a world the same way the app and CLI do: from files. */
export function world(drafts: Draft[], opts: { intended?: IntendedMark[]; manifest?: Partial<WorldManifest>; story?: string | string[]; ignored?: string[] } = {}): World {
  const files = drafts.map((d) => {
    const e = { body: '', ...d } as unknown as Entry;
    return { path: entryPath(e), content: serializeEntry(e) };
  });
  files.push({ path: 'world.json', content: JSON.stringify({ ...manifest, ...opts.manifest }) });
  if (opts.intended) files.push({ path: 'intended.json', content: JSON.stringify({ schemaVersion: 1, intended: opts.intended }) });
  const story = typeof opts.story === 'string' ? [opts.story] : (opts.story ?? []);
  story.forEach((body, i) => files.push({ path: `story/0${i + 1}-chapter-${i + 1}.md`, content: `---\ntitle: Chapter ${i + 1}\norder: ${i + 1}\n---\n\n${body}\n` }));
  if (opts.ignored) files.push({ path: 'story-ignored.json', content: JSON.stringify({ schemaVersion: 1, ignored: opts.ignored.map((key) => ({ key })) }) });
  return parseWorld(files);
}

export function warnings(drafts: Draft[], ruleId?: string, opts?: Parameters<typeof world>[1]): Warning[] {
  const all = check(world(drafts, opts));
  return ruleId ? all.filter((w) => w.ruleId === ruleId) : all;
}
