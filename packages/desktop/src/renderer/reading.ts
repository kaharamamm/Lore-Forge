/**
 * Reading a chapter aloud with the computer's own voices (the system's speech, which works without the internet):
 * what is said for each sentence, and which voice fits the text.
 */
import { sentences } from '@lore-forge/core';

/** One sentence to read: where it is in the chapter, and what is said. */
export interface ReadPart {
  start: number;
  end: number;
  say: string;
}

/** What is said for a piece of text: Markdown marks and link brackets left out, a link said by its label or name. */
export function speakable(text: string, nameOf: (ref: string) => string = (ref) => ref): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_m, ref: string) => nameOf(ref.trim()))
    .replace(/(^|[\s(])@([\w-]+)/g, (_m, before: string, ref: string) => before + nameOf(ref))
    .replace(/^\s*(?:#{1,6}|>)\s*/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The sentences of `body` between `from` and `to`, the first and last cut to that stretch. Parts with nothing to say
 * (a scene break such as "* * *") are left out.
 */
export function readParts(body: string, from = 0, to = body.length, nameOf?: (ref: string) => string): ReadPart[] {
  const out: ReadPart[] = [];
  for (const s of sentences(body)) {
    const start = Math.max(s.start, from);
    const end = Math.min(s.start + s.text.length, to);
    if (end <= start) continue;
    const say = speakable(body.slice(start, end), nameOf);
    if (/[\p{L}\p{N}]/u.test(say)) out.push({ start, end, say });
  }
  return out;
}

/** Where reading starts in a text box: the part chosen, else the sentence with the caret, else (caret at the end) the start. */
export function readRange(body: string, selStart: number, selEnd: number): { from: number; to: number } {
  if (selEnd > selStart) return { from: selStart, to: selEnd };
  if (selStart <= 0 || selStart >= body.length) return { from: 0, to: body.length };
  const s = sentences(body).find((x) => x.start + x.text.length >= selStart);
  return { from: s ? Math.min(s.start, selStart) : selStart, to: body.length };
}

/** The language a text is most likely in, for a voice: Turkish when its letters say so (ğ, ş, ı), else English. */
export function textLanguage(text: string): 'tr' | 'en' {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const turkish = text.match(/[ğşıİĞŞ]/g)?.length ?? 0;
  // A Turkish name or two in English prose is not enough: Turkish prose has these letters in most sentences.
  return turkish >= 3 && turkish / letters > 0.01 ? 'tr' : 'en';
}

/**
 * The language a book's own text is in, only when the text says so: Turkish by its letters, English once there is
 * enough text without them (a short Turkish text may have none of ğ, ş, ı). Undefined while it cannot tell.
 */
export function confidentLanguage(text: string): 'tr' | 'en' | undefined {
  if (textLanguage(text) === 'tr') return 'tr';
  return (text.match(/\p{L}/gu)?.length ?? 0) >= 300 ? 'en' : undefined;
}

/** A voice as the system lists it. */
export interface VoiceInfo {
  name: string;
  lang: string;
  default: boolean;
}

/** The voice to read with: the one chosen before for this language, else one that speaks it (the system's default first), else the default. */
export function pickVoice<V extends VoiceInfo>(voices: readonly V[], lang: string, chosen?: string | null): V | undefined {
  const speaks = (v: V) => v.lang.toLowerCase().replace('_', '-').startsWith(lang);
  return voices.find((v) => v.name === chosen)
    ?? voices.find((v) => v.default && speaks(v))
    ?? voices.find(speaks)
    ?? voices.find((v) => v.default)
    ?? voices[0];
}
