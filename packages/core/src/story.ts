/** The story manuscript: chapter files in story/ and the list of ignored proposals. */
import { Document, isScalar, visit } from 'yaml';
import { splitFrontMatter } from './parse.ts';
import { SCHEMA_VERSION, type StoryChapter, type StoryIgnore } from './types.ts';

export const STORY_FOLDER = 'story';
export const STORY_IGNORED_FILE = 'story-ignored.json';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** ASCII slug for file names: Turkish and other accented letters lose their marks (ş -> s, ı -> i). */
export function slugify(s: string, fallback = 'entry'): string {
  return s.replace(/ı/g, 'i').replace(/İ/g, 'I').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

/** Title from a file name like story/02-the-salt-road.md -> "The salt road". */
function titleFromFile(file: string): string {
  const base = file.split('/').pop()!.replace(/\.md$/, '').replace(/^\d+-/, '').replace(/-/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Untitled chapter';
}

/** Parse one chapter file. A missing title or order is filled in from the file name, so a bare Markdown file works too. */
export function parseChapter(content: string, file: string): { chapter: StoryChapter; problems: string[] } {
  const problems: string[] = [];
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  let data: Obj = {};
  let body = text;
  if (text.startsWith('---\n')) {
    const split = splitFrontMatter(text);
    if ('error' in split) problems.push(split.error);
    else if (!isObj(split.data)) problems.push('The header must be a set of "key: value" lines.');
    else {
      data = split.data;
      body = split.body.replace(/^\n+/, '');
    }
  }
  const str = (k: string): string | undefined => {
    const v = data[k];
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    problems.push(`"${k}" should be text.`);
    return undefined;
  };
  const prefix = /^(\d+)-/.exec(file.split('/').pop() ?? '');
  let order = prefix ? Number(prefix[1]) : 0;
  if (data['order'] !== undefined) {
    if (typeof data['order'] === 'number' && Number.isFinite(data['order'])) order = data['order'];
    else problems.push('"order" should be a number.');
  }
  const title = str('title')?.trim() || titleFromFile(file);
  const date = str('date');
  const extraKeys = Object.keys(data).filter((k) => !['title', 'order', 'date'].includes(k));
  const chapter: StoryChapter = { file, title, order, body };
  if (date !== undefined && date.trim() !== '') chapter.date = date;
  if (extraKeys.length) chapter.extra = Object.fromEntries(extraKeys.map((k) => [k, data[k]]));
  return { chapter, problems };
}

export function serializeChapter(ch: StoryChapter): string {
  const data: Obj = { title: ch.title, order: ch.order };
  if (ch.date) data['date'] = ch.date;
  Object.assign(data, ch.extra);
  const doc = new Document(data);
  visit(doc, { Scalar: (_k, node) => { if (isScalar(node) && typeof node.value === 'string' && /^[~?\d-]/.test(node.value)) node.type = 'QUOTE_DOUBLE'; } });
  const body = ch.body.replace(/^\n+/, '');
  return `---\n${doc.toString({ lineWidth: 0 })}---\n\n${body}${body.endsWith('\n') || body === '' ? '' : '\n'}`;
}

/** Chapters in reading order: `order`, then file name. */
export function sortChapters(chapters: readonly StoryChapter[]): StoryChapter[] {
  return [...chapters].sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));
}

/** A free file name for a new chapter: story/NN-slug.md. */
export function chapterPath(order: number, title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `${STORY_FOLDER}/${String(order).padStart(2, '0')}-${slugify(title, 'chapter')}`;
  let path = `${base}.md`;
  for (let n = 2; used.has(path); n++) path = `${base}-${n}.md`;
  return path;
}

export function parseStoryIgnored(content: string): { ignored: StoryIgnore[]; problems: string[] } {
  try {
    const o: unknown = JSON.parse(content);
    if (isObj(o) && Array.isArray(o['ignored'])) {
      return { ignored: o['ignored'].filter((x): x is StoryIgnore => isObj(x) && typeof x['key'] === 'string'), problems: [] };
    }
    return { ignored: [], problems: [`${STORY_IGNORED_FILE} must look like { "schemaVersion": 1, "ignored": [...] }.`] };
  } catch (e) {
    return { ignored: [], problems: [`${STORY_IGNORED_FILE} is not valid JSON: ${(e as Error).message}`] };
  }
}

export function serializeStoryIgnored(ignored: readonly StoryIgnore[]): string {
  const sorted = [...ignored].sort((a, b) => a.key.localeCompare(b.key));
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, ignored: sorted }, null, 2) + '\n';
}

/** The chapter's in-world date: `date`, else `year` (+ `era`) from the header. */
export function chapterDate(ch: StoryChapter): string | undefined {
  if (ch.date) return ch.date;
  const year = ch.extra?.['year'];
  if (typeof year !== 'number' && typeof year !== 'string') return undefined;
  const era = ch.extra?.['era'];
  return `${year}${typeof era === 'string' && era.trim() ? ` ${era.trim()}` : ''}`;
}

/** Words in a text, for the word count (any script). */
export function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu)?.length ?? 0;
}
