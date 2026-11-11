/**
 * A manuscript brought into a book's story: Markdown and plain text as they are, a Word file (.docx) turned into
 * Markdown first. In Word, the chapter headings are the paragraphs in a heading style (found by the style's own name,
 * "heading 1", which stays English in every language of Word, or by its outline level); bold and italic stay, and each
 * paragraph is one. Core splits the text into chapters (splitManuscript).
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { splitManuscript, type ImportedChapter } from '@lore-forge/core';
import { t } from '../shared/i18n.ts';

/** The kinds of file a manuscript can be. */
export const MANUSCRIPT_EXTS = ['docx', 'md', 'markdown', 'txt'] as const;
/** The largest manuscript taken in, against a wrong file picked by mistake. */
const MAX_BYTES = 50 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s: string): string => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m)));

/** Word's paragraph styles that make a heading, by style id: 0 for the title style, else the heading level. */
function headingStyles(stylesXml: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    if (!/w:type="paragraph"/.test(m[1]!)) continue;
    const id = /w:styleId="([^"]+)"/.exec(m[1]!)?.[1];
    const name = /<w:name w:val="([^"]+)"/.exec(m[2]!)?.[1]?.toLowerCase();
    const outline = /<w:outlineLvl w:val="(\d+)"/.exec(m[2]!)?.[1];
    if (!id) continue;
    if (name === 'title') out.set(id, 0);
    else if (name && /^heading [1-6]$/.test(name)) out.set(id, Number(name.slice(-1)));
    else if (outline !== undefined && Number(outline) < 6) out.set(id, Number(outline) + 1);
  }
  return out;
}

/** One run of text with its emphasis. */
interface Piece { text: string; bold: boolean; italic: boolean }

/** Pieces as Markdown: neighbours with the same emphasis joined, and spaces kept outside the marks. */
function markdown(pieces: Piece[]): string {
  const joined: Piece[] = [];
  for (const p of pieces) {
    const last = joined[joined.length - 1];
    if (last && last.bold === p.bold && last.italic === p.italic) last.text += p.text;
    else joined.push({ ...p });
  }
  return joined.map((p) => {
    const mark = p.bold && p.italic ? '***' : p.bold ? '**' : p.italic ? '*' : '';
    if (!mark || !p.text.trim()) return p.text;
    const lead = /^\s*/.exec(p.text)![0];
    const tail = /\s*$/.exec(p.text)![0];
    return `${lead}${mark}${p.text.trim()}${mark}${tail}`;
  }).join('');
}

/** A Word file's text as Markdown: the title style as "#", headings one level below it ("##", "###"...), paragraphs apart. */
export function docxMarkdown(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' || f.name === 'word/styles.xml' });
  } catch {
    throw new Error(t('This is not a Word file (.docx), or it is damaged.'));
  }
  const doc = files['word/document.xml'];
  if (!doc) throw new Error(t('This is not a Word file (.docx), or it is damaged.'));
  const styles = headingStyles(files['word/styles.xml'] ? strFromU8(files['word/styles.xml']) : '');
  const out: string[] = [];
  for (const p of strFromU8(doc).matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const inner = p[1] ?? '';
    const style = /<w:pStyle w:val="([^"]+)"/.exec(inner)?.[1];
    const outline = /<w:pPr>[\s\S]*?<w:outlineLvl w:val="(\d+)"[\s\S]*?<\/w:pPr>/.exec(inner)?.[1];
    const level = style !== undefined && styles.has(style) ? styles.get(style)! : outline !== undefined && Number(outline) < 6 ? Number(outline) + 1 : undefined;
    const pieces: Piece[] = [];
    for (const r of inner.matchAll(/<w:r\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:r>)/g)) {
      const run = r[1] ?? '';
      const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] ?? '';
      const on = (tag: string): boolean => new RegExp(`<w:${tag}(?:\\s+w:val="(?:true|1|on)")?\\s*/>`).test(props);
      let text = '';
      for (const piece of run.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t\s*\/>|<w:tab\s*\/>|<w:(?:br|cr)\b[^>]*\/>/g)) {
        if (piece[1] !== undefined) text += unxml(piece[1]);
        else if (piece[0].startsWith('<w:tab')) text += '\t';
        else if (!/w:type="page"/.test(piece[0]) && !piece[0].startsWith('<w:t')) text += '\n';
      }
      if (text) pieces.push({ text, bold: on('b'), italic: on('i') });
    }
    const text = level !== undefined ? pieces.map((x) => x.text).join('').replace(/\s+/g, ' ').trim() : markdown(pieces).trim();
    if (!text) continue;
    out.push(level !== undefined ? `${'#'.repeat(Math.min(level + 1, 6))} ${text}` : text);
  }
  return out.join('\n\n');
}

/** A manuscript file as chapters, named after the file for any text before its first heading. */
export async function readManuscript(file: string): Promise<{ name: string; chapters: ImportedChapter[] }> {
  const ext = extname(file).toLowerCase().slice(1);
  if (!(MANUSCRIPT_EXTS as readonly string[]).includes(ext)) throw new Error(t('Lore-Forge imports Word (.docx), Markdown and plain text files.'));
  if ((await stat(file)).size > MAX_BYTES) throw new Error(t('This file is too large to import.'));
  const name = basename(file, extname(file));
  const text = ext === 'docx' ? docxMarkdown(new Uint8Array(await readFile(file))) : await readFile(file, 'utf8');
  return { name, chapters: splitManuscript(text, name) };
}
