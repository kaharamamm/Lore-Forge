/**
 * The audiobook, made in this window: what is said (the title, the author, each chapter's heading and text, with
 * pauses where a page has them), spoken by a Lore-Forge voice, encoded as Opus and sent to the main process, which
 * writes the file. One audiobook at a time; it goes on while the user works, and the dialog and the top bar follow it.
 */
import { useEffect, useState } from 'preact/hooks';
import { bareChapterTitle, sortChapters, wordCount, writtenChapters, type World } from '@lore-forge/core';
import type { BuiltInVoice, SpokenName } from '../shared/voices.ts';
import type { AudiobookInfo } from '../shared/api.ts';
import { readParts } from './reading.ts';

/** One thing said in one go (a few sentences of a paragraph, or a heading), and the quiet after it, in seconds. */
export interface Said {
  text: string;
  pause: number;
  words: number;
}

export interface ScriptChapter {
  /** As the chapter marks show it: "Chapter 3. The Hollow of Echoes". */
  title: string;
  said: Said[];
}

export interface AudiobookScript {
  title: string;
  author?: string;
  opening: Said[];
  chapters: ScriptChapter[];
  /** Words in all, for the progress. */
  words: number;
}

/** Sentences said in one go: up to about two lines of a page, within one paragraph. */
const GROUP = 320;
/** Quiet after each kind of break, in seconds. */
const PAUSE = { sentences: 0.3, paragraph: 0.7, scene: 1.5, heading: 1.3, chapter: 2.5, title: 1, opening: 2.5 };
/** The headings in the book's language, which may not be the app's. */
const SAY = {
  en: { chapter: (n: number) => `Chapter ${n}`, by: (a: string) => `By ${a}` },
  tr: { chapter: (n: number) => `Bölüm ${n}`, by: (a: string) => `Yazan: ${a}` },
};
/** A line that only breaks a scene: "* * *", "---", "###". */
const SCENE = /^[ \t]*(?:[*#~=_-][ \t]*){3,}$/m;

/** Ends a heading with a full stop, so the voice says it as a sentence of its own. */
const stop = (s: string): string => (/[.!?…:;]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** A chapter's text in things said in one go, each with the quiet after it. */
export function chapterSaid(body: string, nameOf: (ref: string) => string): Said[] {
  const out: Said[] = [];
  let text = '';
  let words = 0;
  let last = -1;
  for (const p of readParts(body, 0, body.length, nameOf)) {
    const gap = last < 0 ? '' : body.slice(last, p.start);
    const brk = /\n[ \t]*\n/.test(gap) ? (SCENE.test(gap) ? 'scene' : 'paragraph') : null;
    if (text && (brk || text.length + 1 + p.say.length > GROUP)) {
      out.push({ text, pause: brk ? PAUSE[brk] : PAUSE.sentences, words });
      text = '';
      words = 0;
    }
    text = text ? `${text} ${p.say}` : p.say;
    words += wordCount(p.say);
    last = p.end;
  }
  if (text) out.push({ text, pause: PAUSE.paragraph, words });
  return out;
}

/** What the audiobook says: the title and author, then each written chapter, its heading first. */
export function audiobookScript(world: World, language: 'en' | 'tr', nameOf: (ref: string) => string): AudiobookScript {
  const m = world.manifest;
  const title = (m.book?.title ?? m.name).trim() || m.name;
  const author = m.book?.author?.trim();
  const say = SAY[language];
  const opening: Said[] = [{ text: stop(title), pause: author ? PAUSE.title : PAUSE.opening, words: wordCount(title) }];
  if (author) opening.push({ text: stop(say.by(author)), pause: PAUSE.opening, words: wordCount(author) });
  const chapters = sortChapters(writtenChapters(world)).map((ch, i): ScriptChapter => {
    const named = ch.title.trim() && !bareChapterTitle(ch.title);
    const heading = named ? `${say.chapter(i + 1)}. ${ch.title.trim()}` : say.chapter(i + 1);
    const said = [{ text: stop(heading), pause: PAUSE.heading, words: 0 }, ...chapterSaid(ch.body, nameOf)];
    said[said.length - 1]!.pause = PAUSE.chapter;
    return { title: heading, said };
  });
  const count = (list: Said[]) => list.reduce((n, s) => n + s.words, 0);
  return { title, ...(author ? { author } : {}), opening, chapters, words: count(opening) + chapters.reduce((n, c) => n + count(c.said), 0) };
}

/** About how long the audiobook plays at a normal speed: an English voice says about 155 words a minute. */
export function listeningMinutes(words: number): number {
  return words / 155;
}

// -------------------------------------------------------------------------------------------- the job

export type AudiobookState = 'reading' | 'saving' | 'done' | 'stopped' | 'failed';

export interface AudiobookJob {
  dir: string;
  file: string;
  title: string;
  reader: string;
  state: AudiobookState;
  /** Words in all and words said so far. */
  words: number;
  done: number;
  /** The chapter being read (1 is the first), of how many, and its title. */
  chapter: number;
  chapters: number;
  chapterTitle: string;
  /** Seconds of sound so far. */
  seconds: number;
  /** When it started (Date.now()). */
  started: number;
  error?: string;
  bytes?: number;
}

let job: AudiobookJob | null = null;
let stopping = false;
const listeners = new Set<() => void>();
function update(next: Partial<AudiobookJob>): void {
  if (job) job = { ...job, ...next };
  for (const f of listeners) f();
}

/** The audiobook being made, or the last one made, as it changes. */
export function useAudiobook(): AudiobookJob | null {
  const [, setTurn] = useState(0);
  useEffect(() => {
    const f = () => setTurn((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return job;
}

export const audiobookBusy = (j: AudiobookJob | null = job): boolean => !!j && (j.state === 'reading' || j.state === 'saving');

/** Stops the audiobook after the sentence being made; nothing is saved. */
export function stopAudiobook(): void {
  if (audiobookBusy()) stopping = true;
}

/** Forgets a finished audiobook (its result has been seen). */
export function clearAudiobook(): void {
  if (job && !audiobookBusy()) {
    job = null;
    update({});
  }
}

/** The sample rates Opus takes as they are; other voices are made 48 kHz first. */
const OPUS_RATES = [8000, 12000, 16000, 24000, 48000];
/** Bits a second: clear speech, about 18 MB an hour. */
const BITRATE = 40000;

async function resample(pcm: Float32Array, from: number, to: number): Promise<Float32Array<ArrayBuffer>> {
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil((pcm.length * to) / from)), to);
  const buffer = ctx.createBuffer(1, pcm.length, from);
  buffer.getChannelData(0).set(pcm);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/** An identification header for an encoder that gave none: one channel, its usual delay at 48 kHz. */
function opusHead(rate: number, preSkip = 312): Uint8Array {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode('OpusHead'));
  const v = new DataView(head.buffer);
  head[8] = 1;
  head[9] = 1;
  v.setUint16(10, preSkip, true);
  v.setUint32(12, rate, true);
  return head;
}

const bytesOf = (d: AllowSharedBufferSource): Uint8Array => (d instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && d instanceof SharedArrayBuffer)
  ? new Uint8Array(d.slice(0))
  : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength)));

/**
 * Makes an audiobook of the book in `dir`: asks where to save it, then reads it in `voice`. Resolves when it is saved,
 * stopped or failed, with how it ended; null when no file was chosen.
 */
export async function makeAudiobook(o: { dir: string; world: World; voice: BuiltInVoice; names: SpokenName[]; nameOf: (ref: string) => string }): Promise<AudiobookJob | null> {
  if (audiobookBusy()) throw new Error('An audiobook is being made already.');
  if (typeof AudioEncoder === 'undefined') throw new Error('This computer cannot encode the sound.');
  const script = audiobookScript(o.world, o.voice.language, o.nameOf);
  const start = await window.lore.audiobookStart(o.dir);
  if (!start) return null;
  stopping = false;
  job = {
    dir: o.dir, file: start.file, title: script.title, reader: o.voice.name, state: 'reading', words: script.words, done: 0,
    chapter: 0, chapters: script.chapters.length, chapterTitle: '', seconds: 0, started: Date.now(),
  };
  update({});

  let encoder: AudioEncoder | null = null;
  let rate = 0;
  let frames = 0;
  let head: Uint8Array | null = null;
  let failure: unknown = null;
  let held: Uint8Array[] = [];
  let sizes: number[] = [];
  let samples: number[] = [];
  let sending: Promise<void> = Promise.resolve();
  const send = (): void => {
    if (!sizes.length) return;
    const data = new Uint8Array(sizes.reduce((n, s) => n + s, 0));
    let at = 0;
    for (const b of held) {
      data.set(b, at);
      at += b.length;
    }
    const [s, d] = [sizes, samples];
    held = [];
    sizes = [];
    samples = [];
    sending = sending.then(() => window.lore.audiobookAdd(start.id, data, s, d));
    sending.catch((e: unknown) => { failure ??= e; });
  };
  const feed = async (pcm: Float32Array<ArrayBuffer>, from: number): Promise<void> => {
    if (!encoder) {
      rate = OPUS_RATES.includes(from) ? from : 48000;
      encoder = new AudioEncoder({
        output: (chunk, meta) => {
          const d = meta?.decoderConfig?.description;
          if (d && !head) head = bytesOf(d);
          const b = new Uint8Array(chunk.byteLength);
          chunk.copyTo(b);
          held.push(b);
          sizes.push(b.length);
          samples.push(Math.round(((chunk.duration ?? 20000) * 48000) / 1e6));
          if (sizes.length >= 250) send();
        },
        error: (e) => { failure ??= e; },
      });
      encoder.configure({ codec: 'opus', sampleRate: rate, numberOfChannels: 1, bitrate: BITRATE, opus: { frameDuration: 20000, complexity: 10 } });
    }
    const data = from === rate ? pcm : await resample(pcm, from, rate);
    encoder.encode(new AudioData({ format: 'f32', sampleRate: rate, numberOfFrames: data.length, numberOfChannels: 1, timestamp: Math.round((frames / rate) * 1e6), data }));
    frames += data.length;
    // The encoder keeps up with the voice; this only waits when it does not.
    const e = encoder;
    while (e.encodeQueueSize > 8) await new Promise((ok) => e.addEventListener('dequeue', ok, { once: true }));
  };
  const say = async (s: Said): Promise<void> => {
    const speech = await window.lore.speakBuiltIn(s.text, o.voice.id, 1, o.names);
    const quiet = Math.round(s.pause * speech.sampleRate);
    const pcm = new Float32Array(speech.audio.length + quiet);
    pcm.set(speech.audio);
    await feed(pcm, speech.sampleRate);
    if (failure) throw failure;
  };
  const seconds = () => (rate ? frames / rate : 0);

  try {
    const marks: { title: string; start: number }[] = [{ title: script.title, start: 0 }];
    let done = 0;
    for (const s of script.opening) {
      if (stopping) break;
      await say(s);
      done += s.words;
      update({ done, seconds: seconds() });
    }
    for (const [i, ch] of script.chapters.entries()) {
      if (stopping) break;
      marks.push({ title: ch.title, start: seconds() });
      update({ chapter: i + 1, chapterTitle: ch.title });
      for (const s of ch.said) {
        if (stopping) break;
        await say(s);
        done += s.words;
        update({ done, seconds: seconds() });
      }
    }
    if (stopping) {
      (encoder as AudioEncoder | null)?.close();
      await sending.catch(() => {});
      await window.lore.audiobookCancel(start.id);
      update({ state: 'stopped' });
      return job;
    }
    if (!encoder) throw new Error('The book has nothing to read.');
    await (encoder as AudioEncoder).flush();
    (encoder as AudioEncoder).close();
    send();
    await sending;
    if (failure) throw failure;
    update({ state: 'saving' });
    const opus = head ?? opusHead(rate);
    const preSkip = new DataView(opus.buffer, opus.byteOffset).getUint16(10, true);
    const info: AudiobookInfo = {
      head: opus,
      end: preSkip + Math.round((frames * 48000) / rate),
      title: script.title,
      ...(script.author ? { author: script.author } : {}),
      reader: o.voice.name,
      language: o.voice.language,
      chapters: marks,
    };
    const saved = await window.lore.audiobookFinish(start.id, o.dir, info);
    update({ state: 'done', bytes: saved.bytes, seconds: seconds() });
  } catch (e) {
    try { (encoder as AudioEncoder | null)?.close(); } catch { /* closed already */ }
    await window.lore.audiobookCancel(start.id).catch(() => {});
    update({ state: 'failed', error: (e as Error).message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? String(e) });
  }
  return job;
}
