/**
 * A manuscript brought in from elsewhere (Markdown, plain text, or a Word file turned into Markdown by the app),
 * split into chapters at its chapter headings: Markdown headings, or lines such as "Chapter 3: The Well",
 * "Bölüm 3" or "Birinci Bölüm". Text before the first heading is a chapter of its own. Titles lose a leading
 * "Chapter 3:" (the Story Book numbers chapters itself); a bare "Chapter 3" takes its name from the next line when that
 * line reads as one. Plain text written one paragraph per line gets blank lines between paragraphs.
 */

export interface ImportedChapter {
  title: string;
  body: string;
}

const NUMBER = String.raw`(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)`;
/** Turkish puts the number first: "Birinci Bölüm", "3. Bölüm". */
const TR_ORDINAL = String.raw`(?:\d+\.|birinci|ikinci|üçüncü|dördüncü|beşinci|altıncı|yedinci|sekizinci|dokuzuncu|onuncu)`;
/** "Chapter 3", "CHAPTER THREE", "Part IV", "Bölüm 3", "Birinci Bölüm", "3. Kısım". */
const LABEL = String.raw`(?:(?:chapter|bölüm|part|kısım)\s+${NUMBER}|${TR_ORDINAL}\s+(?:bölüm|kısım))`;
/** A chapter heading alone on a line: a label, maybe with a name after it, or a prologue or epilogue. */
const CHAPTER_LINE = new RegExp(String.raw`^(?:${LABEL}\b.{0,80}|prologue|epilogue|önsöz|sonsöz|giriş)$`, 'iu');
/** "Chapter 3: The Well", "Chapter 3. The Well", "Bölüm 3 - Kuyu": the name after the label. */
const NUMBERED = new RegExp(String.raw`^${LABEL}\s*[:.\-–)]\s*(.+)$`, 'iu');
/** A label with no name: "Chapter 3", "CHAPTER THREE.", "Birinci Bölüm". */
const BARE = new RegExp(String.raw`^${LABEL}\.?$`, 'iu');

/** Without Markdown's emphasis marks, spaces closed up. */
const plain = (text: string): string => text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
/** Case-insensitive in Turkish too: "BİRİNCİ" only lowers to "birinci" the Turkish way. */
const matches = (re: RegExp, text: string): RegExpExecArray | null => re.exec(text) ?? re.exec(text.toLocaleLowerCase('tr'));

/** A title that is only a chapter label, such as "Chapter 3": the Story Book prints its own number instead. */
export function bareChapterTitle(title: string): boolean {
  return !!matches(BARE, plain(title));
}

/** A heading's text as a chapter title: without a leading "Chapter 3:", without Markdown marks. */
export function chapterTitle(heading: string): string {
  const text = plain(heading);
  const m = matches(NUMBERED, text);
  // The name keeps its own case: Turkish lowering keeps the length, so it is the same stretch of the text.
  return (m && text.slice(text.length - m[1]!.length).trim()) || text;
}

/** A plain-text line that is a chapter heading. Prose is not: a line ending like a sentence ("Part one of it was easy.") is left alone. */
function chapterLine(line: string): boolean {
  const text = plain(line);
  if (!text || /[,;:…"'”’»]$/.test(text) || (text.endsWith('.') && !matches(BARE, text))) return false;
  return !!matches(CHAPTER_LINE, text);
}

/** The line after a bare "Chapter 3", when it reads as that chapter's name: short, and not ending like a sentence. */
function nameLine(line: string): string | undefined {
  const text = plain(line.replace(/^#{1,6}\s+/, ''));
  if (!text || text.length > 60 || text.split(' ').length > 8) return undefined;
  if (/[.,;:!?…"'”’»)\]-]$/.test(text) || chapterLine(text)) return undefined;
  return text;
}

/** A chapter's text, trimmed; `perLine`: the manuscript has a paragraph on each line, so each becomes a Markdown paragraph. */
function paragraphs(body: string, perLine: boolean): string {
  const text = body.replace(/\n{3,}/g, '\n\n').trim();
  return perLine ? text.replace(/\n/g, '\n\n') : text;
}

/** The chapters of a manuscript; `name` (the file's name) titles text that comes before any heading. */
export function splitManuscript(text: string, name: string): ImportedChapter[] {
  const all = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = all.split('\n');
  // A manuscript with no blank line anywhere has a paragraph on each line; one that has them keeps its single line
  // breaks (verse, a letter).
  const perLine = !all.trim().includes('\n\n') && all.trim().split('\n').length > 2;
  const atx = lines.map((l) => /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l));
  const ones = atx.filter((m) => m?.[1] === '#').length;
  const twos = atx.filter((m) => m?.[1] === '##').length;
  // One "#" over several "##" is the book's title over its chapters: the "##" headings are the chapters.
  const level = ones === 1 && twos >= 2 ? 2 : ones ? 1 : twos ? 2 : 0;
  const out: ImportedChapter[] = [];
  let title = name;
  // False while a bare "Chapter 3" may still take its name from the next line.
  let named = true;
  let body: string[] = [];
  // Text before the first heading becomes a chapter named after the file; an empty start is left out.
  const close = (): void => {
    const b = paragraphs(body.join('\n'), perLine);
    if (b || title !== name) out.push({ title, body: b });
    body = [];
  };
  lines.forEach((line, i) => {
    const m = atx[i];
    const heading = level && m && m[1]!.length === level ? m[2]! : !level && chapterLine(line) ? line : undefined;
    if (heading !== undefined) {
      close();
      title = chapterTitle(heading);
      named = !bareChapterTitle(title);
      return;
    }
    // The book's own title ("#" over "##" chapters) is not part of any chapter.
    if (level === 2 && m?.[1] === '#') return;
    if (!named && line.trim()) {
      named = true;
      const found = nameLine(line);
      if (found) {
        title = found;
        return;
      }
    }
    body.push(line);
  });
  close();
  return out.filter((c) => c.title || c.body);
}
