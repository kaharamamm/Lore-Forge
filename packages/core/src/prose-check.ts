/**
 * Writing that reads as if an AI wrote it, in the story's chapters and in the entries' own text (summary, body and
 * the longer details): the stock phrases language models lean on ("a testament to", "a tapestry of", "delve"), a
 * sentence with two dashes around an aside, and the "It wasn't just X. It was Y." turn. Each one is a note (info)
 * under the rule `ai-phrasing`: the writer decides, and it can be marked intended or turned off in world.json
 * `rules`. The phrases are English; text in another language gets no notes.
 */
import { filledDetails } from './details.ts';
import { msg, verbatim } from './i18n.ts';
import { ruleSetting, type Finding, type Rule } from './engine.ts';
import { STORY_REF_PREFIX } from './world-index.ts';
import type { Warning, World } from './types.ts';

export const AI_PHRASING = 'ai-phrasing';
export const aiPhrasing = {
  id: AI_PHRASING,
  title: 'Sounds like AI writing',
  description: 'A stock phrase that AI writing leans on, two dashes around an aside, or the "It wasn\'t X. It was Y." turn.',
  severity: 'info' as const,
};

/** The phrases, each as a pattern over the text (case aside). */
const PHRASES: readonly RegExp[] = [
  /\ba testament to\b/,
  /\b(?:rich |vibrant |intricate )?tapestr(?:y|ies) of\b/,
  /\bdelv(?:e|es|ed|ing) (?:into|deeper)\b/,
  /\ba symphony of\b/,
  /\blittle did (?:he|she|they|I|we|you) know\b/,
  /\bcould(?:n't| not) help but\b/,
  /\bsent (?:a )?shivers? (?:down|up) (?:his|her|their|my|your|the) spine\b/,
  /\ba (?:wave|flood|surge|rush) of (?:relief|emotions?|nostalgia|warmth|dread)\b/,
  /\ba breath (?:he|she|they|I|you|we) (?:did(?:n't| not) know|had(?:n't| not) realized) (?:he|she|they|I|you|we) (?:was|were|had been) holding\b/,
  /\bbarely above a whisper\b/,
  /\bthe silence was deafening\b/,
  /\bevery fib(?:er|re) of (?:his|her|their|my|your) being\b/,
  /\btime (?:itself )?(?:seemed to )?(?:stood still|stand still|slowed to a crawl)\b/,
  /\bthe air (?:was |hung |grew )?(?:thick|heavy|alive|electric|charged) with\b/,
  /\ba beacon of (?:hope|light)\b/,
  /\ban unspoken (?:understanding|promise|bond|agreement)\b/,
  /\bembark(?:ed|ing|s)? (?:up)?on (?:a|an|the|their|his|her|my|our) (?:journey|quest|adventure)\b/,
  /\bpalpable\b/,
  /\bever-(?:changing|present|evolving|shifting)\b/,
  /\bnavigat(?:e|es|ed|ing) the (?:complexities|challenges|intricacies)\b/,
  /\bin a world where\b/,
  /\bonly time (?:would|will) tell\b/,
  /\b(?:the world|the forest|the city|the night|everything) (?:seemed to )?(?:held|hold|holding) (?:its|their) breath\b/,
  /\bsomething shifted\b/,
  /\ba dance of (?:light and shadow|shadows?)\b/,
];

/** Two dashes (em dashes, or spaced en dashes) around an aside in one sentence. */
const DASH_PAIR = /(?:\u2014| \u2013 )[^\u2014\u2013.!?\n]{1,160}(?:\u2014| \u2013 )/;
/**
 * The reframing turn: "It wasn't just a map. It was a promise." and "It's not a map, it's a promise." A plain
 * description ("It was not old. It was made of grey stone.") is not one: only "just", "only" or "merely", or both
 * halves in one sentence, make it the turn.
 */
const NOT_X_BUT_Y: readonly RegExp[] = [
  /\b(it|this|that)(?:'s|’s| is| was)(?:n't|n’t| not) (?:just|only|merely|simply) [^.;!?\n\u2014]{1,60}[.;,\u2014] ?\1(?:'s|’s| is| was) /,
  /\b(it|this|that)(?:'s|’s| is| was)(?:n't|n’t| not) [^.;!?\n\u2014,]{1,40}, \1(?:'s|’s| is| was) /,
];

/**
 * The patterns, ready to run (once, not on every key). They need the u flag: without it, V8 misses a case-insensitive
 * match after an em dash anywhere earlier in the text (a two-byte string), which is most stories.
 */
const PHRASES_RUN = new RegExp(PHRASES.map((re) => `(?:${re.source})`).join('|'), 'giu');
const DASH_RUN = new RegExp(DASH_PAIR.source, 'gu');
const TURN_RUN = NOT_X_BUT_Y.map((re) => new RegExp(re.source, 'giu'));

/** At most this many notes in one text: past that, the writer has seen the point. */
const MAX_PER_TEXT = 25;

/** One AI-sounding place in a text: where it is, a key that stays when other text changes, and what to say. */
export interface AiPhrase {
  start: number;
  end: number;
  key: string;
  message: string;
}

/** The AI-sounding places in one text, in order (at most MAX_PER_TEXT). */
export function aiPhrasesIn(text: string): AiPhrase[] {
  const found: AiPhrase[] = [];
  const seen = new Map<string, number>();
  const add = (start: number, end: number, key: string, message: string): void => {
    if (found.some((f) => start < f.end && end > f.start)) return;
    // The key counts the same phrase in the text, so it stays when text elsewhere changes.
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    found.push({ start, end, message, key: `${key}:${n}` });
  };
  for (const m of text.matchAll(PHRASES_RUN)) {
    add(m.index, m.index + m[0].length, m[0].toLowerCase().replace(/\s+/g, '-'), msg`"${verbatim(m[0])}" sounds like AI writing. Say it plainly, or with a detail only this book has.`);
  }
  for (const m of text.matchAll(DASH_RUN)) {
    add(m.index, m.index + m[0].length, 'dashes', msg`Two dashes around an aside: AI writing leans on them. Commas, brackets or a sentence of its own read better.`);
  }
  for (const re of TURN_RUN) {
    for (const m of text.matchAll(re)) {
      add(m.index, m.index + m[0].length, 'not-x-but-y', msg`"It wasn't X. It was Y." is a turn AI writing overuses. Say what it is.`);
    }
  }
  return found.sort((a, b) => a.start - b.start).slice(0, MAX_PER_TEXT);
}

/** The same notes in the entries' own text: the summary, the longer details (personality, history...) and the body. */
export const aiPhrasingRule: Rule = {
  ...aiPhrasing,
  check: ({ ix }) => {
    const out: Finding[] = [];
    for (const e of ix.entries) {
      const texts: [string, string][] = [
        ['summary', e.summary ?? ''],
        ...filledDetails(e).flatMap((d): [string, string][] => (d.field.kind === 'long' && typeof d.value === 'string' ? [[d.field.key, d.value]] : [])),
        ['body', e.body],
      ];
      for (const [field, text] of texts) {
        for (const f of aiPhrasesIn(text)) out.push({ key: `${e.id}:${field}:${f.key}`, message: f.message, offending: { ...ix.fact(e, field), span: [f.start, f.end] } });
      }
    }
    return out;
  },
};

/** The notes for every chapter, with intended marks applied; none when the rule is off. */
export function aiPhrasingWarnings(world: World): Warning[] {
  const setting = ruleSetting(world, AI_PHRASING, aiPhrasing.severity);
  if (setting === 'off') return [];
  const marks = new Map(world.intended.map((m) => [m.warningId, m]));
  const out: Warning[] = [];
  for (const ch of world.story ?? []) {
    for (const f of aiPhrasesIn(ch.body)) {
      const id = `${AI_PHRASING}:${ch.file}:${f.key}`;
      const w: Warning = {
        id,
        ruleId: AI_PHRASING,
        severity: setting,
        message: f.message,
        offending: { entryId: STORY_REF_PREFIX + ch.file, field: 'body', source: msg`Story/${ch.title || ch.file}`, chapter: ch.file, span: [f.start, f.end] },
      };
      const mark = marks.get(id);
      if (mark) w.intended = mark;
      out.push(w);
    }
  }
  return out;
}
