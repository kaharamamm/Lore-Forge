/**
 * The changelog (CHANGELOG.md, "Keep a Changelog") read for the library's Patch notes: releases, their sections
 * (Added, Changed, Fixed, …) and their nested bullets, with the bits of Markdown the file uses (bold, code, links).
 * Pure, so it is tested without the app (test/changelog.test.ts).
 */

export interface NoteItem {
  /** The bullet's text (Markdown inline). */
  text: string;
  /** Paragraphs that continue it, after a blank line. */
  more: string[];
  items: NoteItem[];
}
export interface NoteSection {
  title: string;
  intro: string[];
  items: NoteItem[];
}
export interface Release {
  /** "1.0.0", or "Unreleased". */
  version: string;
  /** YYYY-MM-DD, when given. */
  date?: string;
  /** Paragraphs and bullets before the first section. */
  intro: string[];
  items: NoteItem[];
  sections: NoteSection[];
}

/** The releases in the file's order (newest first). The title, the preface and the link definitions are left out. */
export function parseChangelog(md: string): Release[] {
  const out: Release[] = [];
  let release: Release | null = null;
  let section: NoteSection | null = null;
  /** The open bullets, by depth. */
  let stack: NoteItem[] = [];
  let blank = false;
  let para: string[] | null = null;
  const paragraphs = () => (section ? section.intro : release!.intro);
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h) {
      stack = [];
      para = null;
      if (h[1] === '##') {
        const m = /^\[?([^\]\s]+)\]?(?:\s+-\s+(\d{4}-\d{2}-\d{2}))?/.exec(h[2]!);
        release = { version: m?.[1] ?? h[2]!, ...(m?.[2] ? { date: m[2] } : {}), intro: [], items: [], sections: [] };
        section = null;
        out.push(release);
      } else if (release) {
        section = { title: h[2]!.trim(), intro: [], items: [] };
        release.sections.push(section);
      }
      blank = false;
      continue;
    }
    if (!release || /^#\s/.test(line) || /^\[[^\]]+\]:\s+\S+$/.test(line)) continue;
    if (!line.trim()) {
      blank = true;
      para = null;
      continue;
    }
    const b = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (b) {
      // Two spaces a level; a bullet indented deeper than its parent allows nests under the deepest open one.
      const item: NoteItem = { text: b[2]!, more: [], items: [] };
      stack.length = Math.min(stack.length, Math.floor(b[1]!.length / 2));
      const parent = stack[stack.length - 1];
      (parent ? parent.items : (section ?? release).items).push(item);
      stack.push(item);
      blank = false;
      para = null;
      continue;
    }
    const indent = /^\s*/.exec(line)![0].length;
    if (stack.length && (indent >= 2 || !blank)) {
      if (!blank) {
        // Goes on with the line above.
        const last = stack[stack.length - 1]!;
        if (last.more.length) last.more[last.more.length - 1] += ` ${line.trim()}`;
        else last.text += ` ${line.trim()}`;
      } else {
        // A paragraph of its own after a blank line, inside the bullet its indent belongs to (two spaces: the top one).
        stack.length = Math.min(stack.length, Math.max(1, Math.floor(indent / 2)));
        stack[stack.length - 1]!.more.push(line.trim());
      }
    } else {
      stack = [];
      if (para && !blank) para[para.length - 1] += ` ${line.trim()}`;
      else {
        para = paragraphs();
        para.push(line.trim());
      }
    }
    blank = false;
  }
  return out;
}

/** A piece of a line of Markdown: plain text, bold, code or a link. */
export type Inline = string | { bold: Inline[] } | { code: string } | { link: string; text: Inline[] };

/** The inline Markdown of one line: **bold**, `code` and [text](url), nested as the file nests them. */
export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = '';
  const flush = () => { if (plain) out.push(plain); plain = ''; };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ bold: inline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    } else if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ code: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (text[i] === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(text.slice(i));
      if (m) {
        flush();
        out.push({ link: m[2]!, text: inline(m[1]!) });
        i += m[0].length;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  flush();
  return out;
}

/**
 * The releases in one language, each missing one taken from English: a translated changelog may lag behind.
 * `local` and `english` are both newest first.
 */
export function withFallback(local: readonly Release[], english: readonly Release[]): Release[] {
  return english.map((r) => local.find((l) => l.version === r.version) ?? r);
}
