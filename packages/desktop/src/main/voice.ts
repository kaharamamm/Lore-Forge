/**
 * The built-in voices, on the main side: where their files are, whether this computer can run them, and the voice
 * process (voice/voice-process.ts) that speaks, started on first use and started again after a crash.
 */
import { app, utilityProcess, type UtilityProcess } from 'electron';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KOKORO_VOICES, piperVoice, type BuiltInVoice, type SpokenName } from '../shared/voices.ts';

/** The voices folder (models and packs) and the dictionaries: resources in the app, beside dist/ when run from source. */
function folders(): { voices: string; lexicons: string } {
  return app.isPackaged
    ? { voices: join(process.resourcesPath, 'voices'), lexicons: join(process.resourcesPath, 'voice-data') }
    : { voices: join(__dirname, '..', 'voices'), lexicons: join(__dirname, '..', 'voice-data') };
}

/** ONNX Runtime has no build for Intel Macs; those read with the system's own voices. */
const RUNTIME = !(process.platform === 'darwin' && process.arch === 'x64');

/** The voices made with the Voice Studio: each folder in voices/piper with its model, config and lore-forge.json. */
function piperVoices(dir: string, lexicons: string): BuiltInVoice[] {
  const root = join(dir, 'piper');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((d) => {
    const at = join(root, d.name);
    if (!d.isDirectory() || !existsSync(join(at, 'model.onnx')) || !existsSync(join(at, 'config.json'))) return [];
    try {
      const v = piperVoice(d.name, JSON.parse(readFileSync(join(at, 'lore-forge.json'), 'utf8')));
      // English needs its pronunciation dictionary.
      return v && (v.language !== 'en' || existsSync(join(lexicons, 'en-us.txt'))) ? [v] : [];
    } catch {
      return [];
    }
  });
}

/** The built-in voices whose files are there; none where they cannot run or were not fetched (a source build). */
export function builtInVoices(): BuiltInVoice[] {
  const { voices, lexicons } = folders();
  if (!RUNTIME) return [];
  const kokoro = existsSync(join(voices, 'kokoro', 'model.onnx'))
    ? KOKORO_VOICES.filter((v) => existsSync(join(voices, 'kokoro', `${v.id}.bin`)) && existsSync(join(lexicons, `en-${v.accent}.txt`)))
    : [];
  return [...piperVoices(voices, lexicons), ...kokoro];
}

let child: UtilityProcess | null = null;
let seq = 0;
type Speech = { audio: Float32Array; sampleRate: number };
const waiting = new Map<number, { resolve: (s: Speech) => void; reject: (e: Error) => void }>();

function voiceProcess(): UtilityProcess {
  if (child) return child;
  const { voices, lexicons } = folders();
  const p = utilityProcess.fork(join(__dirname, 'voice.cjs'), [voices, lexicons], { serviceName: 'Lore-Forge voices', stdio: 'inherit' });
  p.on('message', (m: { id: number; audio?: Float32Array; sampleRate?: number; error?: string }) => {
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.audio && m.sampleRate) w.resolve({ audio: m.audio, sampleRate: m.sampleRate });
    else w.reject(new Error(m.error ?? 'The voice did not answer.'));
  });
  p.on('exit', () => {
    if (child === p) child = null;
    for (const w of waiting.values()) w.reject(new Error('The voice stopped.'));
    waiting.clear();
  });
  child = p;
  return p;
}

/**
 * Speech in a built-in voice: samples from -1 to 1, and how many a second. `names` are the book's names with a
 * pronunciation, said the way their authors wrote them. The voice process makes one sentence at a time; a sentence
 * asked for with a `batch` name can be dropped while it waits (dropSpeech).
 */
export function speakBuiltIn(text: string, voice: string, speed: number, names: SpokenName[] = [], batch?: string): Promise<Speech> {
  const v = builtInVoices().find((x) => x.id === voice);
  if (!v) return Promise.reject(new Error(`There is no built-in voice called ${voice}.`));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    voiceProcess().postMessage({ id, text, voice: v, speed: Math.min(2, Math.max(0.5, speed || 1)), names, ...(batch ? { batch } : {}) });
  });
}

/** The sentences of a batch that wait their turn are not made (Read aloud after a new voice or speed, or Stop). */
export function dropSpeech(batch: string): void {
  child?.postMessage({ drop: batch });
}

/** Names with a pronunciation as sent by the window: only well-formed ones, and not too many. */
export function spokenNamesFrom(value: unknown): SpokenName[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((n): n is SpokenName => !!n && typeof (n as SpokenName).name === 'string' && typeof (n as SpokenName).say === 'string')
    .slice(0, 5000)
    .map((n) => ({ name: n.name.slice(0, 200), say: n.say.slice(0, 200) }));
}

/** Ends the voice process, when the app quits; sentences still being made are let go without an error. */
export function stopVoices(): void {
  waiting.clear();
  child?.kill();
  child = null;
}
