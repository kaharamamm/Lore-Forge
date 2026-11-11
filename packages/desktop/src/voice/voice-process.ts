/**
 * The voice process: the built-in voices speak here, in a process of their own (Electron's utilityProcess), so the
 * window and the app's main process never wait on them and a crash here stops only the reading. Models, voice packs
 * and dictionaries load on first use. Messages in: { id, text, voice (a BuiltInVoice), speed, names (the book's names
 * with a pronunciation), batch? } or { drop: batch }; out: { id, audio, sampleRate } or { id, error }. Arguments: the
 * voices folder (kokoro/, piper/) and the dictionaries folder (en-us.txt, en-gb.txt).
 */
import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { parseLexicon, phonemize, type Accent } from './english.ts';
import { piperPhonemes } from './ipa.ts';
import { Kokoro, type OrtLike } from './kokoro.ts';
import { Piper, type PiperConfig } from './piper.ts';
import { spokenNames } from './respell.ts';
import { KOKORO_SAMPLE_RATE, type BuiltInVoice, type SpokenName } from '../shared/voices.ts';

const [voicesDir = '', lexiconDir = ''] = process.argv.slice(2);
// Half the processor, between 1 and 4 threads: fast enough to stay ahead of the reading, and the app stays smooth.
const THREADS = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));

/** Loads once and is kept; a load that failed is tried again next time (a missing file may be there by then). */
function once<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = load();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

const ort = (): Promise<OrtLike> => import('onnxruntime-node') as unknown as Promise<OrtLike>;
const kokoros = new Map<string, Promise<Kokoro>>();
const pipers = new Map<string, Promise<Piper>>();
const lexicons = new Map<string, Promise<Map<string, string>>>();
const packs = new Map<string, Promise<Float32Array>>();

const lexicon = (accent: Accent) => once(lexicons, accent, async () => parseLexicon(await readFile(join(lexiconDir, `en-${accent}.txt`), 'utf8')));

/** The book's names in a language's phonemes, made once for the same list (every sentence of a chapter sends it). */
let namesFor: { key: string; en: Map<string, string>; tr: Map<string, string> } | undefined;
function bookNames(names: readonly SpokenName[], language: 'en' | 'tr'): Map<string, string> {
  const key = JSON.stringify(names);
  if (namesFor?.key !== key) namesFor = { key, en: spokenNames(names, 'en'), tr: spokenNames(names, 'tr') };
  return namesFor[language];
}

/** Speech for a text in a built-in voice. */
async function speak(text: string, voice: BuiltInVoice, speed: number, names: readonly SpokenName[]): Promise<{ audio: Float32Array; sampleRate: number }> {
  if (voice.engine === 'piper') {
    const dir = join(voicesDir, 'piper', voice.id);
    const model = once(pipers, voice.id, async () => Piper.load(await ort(), join(dir, 'model.onnx'), JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')) as PiperConfig, THREADS));
    const phonemes = piperPhonemes(text, voice.language, voice.language === 'en' ? await lexicon('us') : undefined, bookNames(names, voice.language));
    const piper = await model;
    return { audio: await piper.speak(phonemes, speed), sampleRate: piper.sampleRate };
  }
  const accent = voice.accent ?? 'us';
  const model = once(kokoros, 'kokoro', async () => Kokoro.load(await ort(), join(voicesDir, 'kokoro', 'model.onnx'), THREADS));
  const pack = once(packs, voice.id, async () => {
    const b = await readFile(join(voicesDir, 'kokoro', `${voice.id}.bin`));
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  });
  const phonemes = phonemize(text, await lexicon(accent), accent, bookNames(names, 'en'));
  return { audio: await (await model).speak(phonemes, await pack, speed), sampleRate: KOKORO_SAMPLE_RATE };
}

interface Job { id: number; text: string; voice: BuiltInVoice; speed: number; names?: SpokenName[]; batch?: string }

// Sentences are made one at a time, in the order asked (ONNX Runtime holds this process while it makes one anyway).
// A caller that no longer wants its waiting sentences (Read aloud after a new voice or speed, or Stop) drops its
// batch, so the next sentence it asks for is not stuck behind them. A dropped sentence comes back without sound.
const queue: Job[] = [];
let working = false;

const answer = (id: number, out: { audio: Float32Array; sampleRate: number } | { error: string }): void => process.parentPort.postMessage({ id, ...out });

async function work(): Promise<void> {
  if (working) return;
  working = true;
  while (queue.length) {
    // Messages that came while the last sentence was made (a drop) are read before the next one starts.
    await new Promise((r) => setImmediate(r));
    const job = queue.shift();
    if (!job) break;
    try {
      answer(job.id, await speak(job.text, job.voice, job.speed, job.names ?? []));
    } catch (err) {
      answer(job.id, { error: (err as Error)?.message ?? String(err) });
    }
  }
  working = false;
}

process.parentPort.on('message', (e) => {
  const m = e.data as Job | { drop: string };
  if ('drop' in m) {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.batch === m.drop) answer(queue.splice(i, 1)[0]!.id, { audio: new Float32Array(0), sampleRate: KOKORO_SAMPLE_RATE });
    return;
  }
  queue.push(m);
  void work();
});
