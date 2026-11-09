/**
 * A book's files in words, for the book history and Ask AI's undo: an entry by its name, a chapter by its title,
 * the book's settings, a picture or a 3D model of someone.
 */
import type { World } from '@lore-forge/core';
import { t } from './i18n.tsx';

export interface Described {
  kind: 'entry' | 'chapter' | 'book' | 'picture' | 'model' | 'file';
  label: string;
  /** The entry it is, or belongs to (a picture), when the book has it. */
  entryId?: string;
  /** A chapter's title, to open it. */
  chapter?: string;
}

const stem = (p: string): string => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '');

/** `name`: the name or title the file had (from the history), when the book no longer has it. */
export function describeFile(world: World, path: string, name?: string): Described {
  const p = path.split('\\').join('/');
  const id = Object.keys(world.files).find((k) => world.files[k] === p);
  const entry = id ? world.entries.find((e) => e.id === id) : undefined;
  if (entry) return { kind: 'entry', label: entry.name || entry.id, entryId: entry.id };
  if (/^(characters|places|factions|items|events|notes)\//.test(p)) return { kind: 'entry', label: name ?? stem(p) };
  if (p.startsWith('story/') && p.endsWith('.md')) {
    const title = world.story?.find((c) => c.file === p)?.title ?? name;
    return { kind: 'chapter', label: title ?? stem(p), ...(title ? { chapter: title } : {}) };
  }
  if (p === 'world.json') return { kind: 'book', label: t('Book settings') };
  if (p === 'intended.json') return { kind: 'book', label: t('Warnings marked intended') };
  if (p === 'story-ignored.json') return { kind: 'book', label: t('Ignored story proposals') };
  if (p.startsWith('maps/')) {
    const m = world.manifest.maps?.find((x) => x.image === p);
    return { kind: 'picture', label: m ? t('The picture of the map {name}', { name: m.name }) : t('A map picture: {file}', { file: stem(p) }) };
  }
  const owner = /^(images|models)\/([^/]+)\//.exec(p);
  if (owner) {
    const e = world.entries.find((x) => x.id === owner[2]);
    const who = e?.name ?? owner[2]!;
    return owner[1] === 'images'
      ? { kind: 'picture', label: t('A picture of {name}', { name: who }), ...(e ? { entryId: e.id } : {}) }
      : { kind: 'model', label: t('A 3D model of {name}', { name: who }), ...(e ? { entryId: e.id } : {}) };
  }
  if (p.startsWith('images/')) return { kind: 'picture', label: t('A picture: {file}', { file: stem(p) }) };
  return { kind: 'file', label: p };
}
